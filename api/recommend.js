const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Timing budgets ─────────────────────────────────────────────────────────
// Vercel's Hobby plan caps a function at 10s (`maxDuration` in vercel.json) and
// that is a HARD kill: the response is lost, not merely slow. Every timeout here
// is therefore clamped against a single wall-clock budget, sized to leave real
// headroom for the response to be serialised and written before the kill.
//
// TOTAL_BUDGET_MS must stay comfortably below the 10s cap. `tests/budget.test.mjs`
// asserts that invariant, so raising one without the other fails the build.
const TOTAL_BUDGET_MS = 7_000;
// A single model call gets at most this much of the remaining budget. Sized so
// that two attempts still fit inside the total: 3s + 3s = 6s < 7s.
const GROQ_TIMEOUT_MS = 3_000;
// A model attempt only starts when a *full* GROQ_TIMEOUT still fits. Anything
// less means the call would be truncated mid-stream and its output discarded.
const MIN_ATTEMPT_BUDGET_MS = 3_000;
// Enrichment runs several AniList lookups concurrently; cap the fan-out so a
// burst cannot trip AniList's own rate limiter.
const ENRICHMENT_CONCURRENCY = 4;
const ANILIST_TIMEOUT_MS = 2_500;
const ANILIST_RETRIES = 1;

// How many titles a results page holds. Must equal the perPage of
// ANILIST_DISCOVER_QUERY; `budget.test.mjs` asserts the two agree, so the top-up
// cannot quietly build a page the query never asked for.
const RESULT_PAGE_SIZE = 12;

// A timeout below this is not worth issuing: `setTimeout(fn, 1)` aborts before
// the connection is even attempted, so the request would burn the remainder of
// its budget for nothing. Callers gate on MIN_QUERY_BUDGET_MS before starting.
const MIN_USEFUL_TIMEOUT_MS = 250;
const MIN_QUERY_BUDGET_MS = MIN_USEFUL_TIMEOUT_MS * 2;

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
// How many already-seen titles are considered for de-duplication, and how many
// of those the prompt can actually carry. The client sends its full history;
// only the most recent slice fits in the prompt.
const MAX_EXCLUDE_TOTAL = 60;
const MAX_EXCLUDE_IN_PROMPT = 20;

const rateLimitMap = new Map();
const aiRecommendationCache = new Map();
const anilistCache = new Map();
// Raw AniList query results. Both upstream queries are deterministic, so an
// identical request can be served without touching the network at all — this
// is the only cache that helps once the AI path is unavailable.
const anilistQueryCache = new Map();

// AniList's canonical genre list.
// AI must NEVER invent or infer a genre.
// If a user selects a genre, the title must have that genre
// in AniList's actual metadata.
const ANILIST_GENRES = new Set([
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
]);

// Maps a UI trope to the AniList tag that actually carries it.
//
// Every value here was verified against AniList's live tag vocabulary: an
// unrecognised tag does not return an empty page, it makes the whole query
// match nothing, so a wrong mapping is a silently dead filter.
// `tests/live.test.mjs` re-checks all 30 UI tags against the API and fails on
// drift.
const TAG_MAP = {
  "murim": "Martial Arts",
  "op mc": "Super Power",
  "villainess": "Villainess",
  "dungeon": "Dungeon",
  "hunter": "Super Power",
  "system": "Virtual World",
  "regression": "Time Manipulation",
  "reincarnation": "Reincarnation",
  "isekai": "Isekai",
  "necromancer": "Necromancy",
  "tower climbing": "Dungeon",
  "magic": "Magic",
  "school life": "School",
  "academy": "School",
  "survival": "Survival",
  "revenge": "Revenge",
  "cultivation": "Cultivation",
  "time travel": "Time Manipulation",
  "kingdom building": "Politics",
  "politics": "Politics",
  "beast taming": "Creature Taming",
  "female protagonist": "Female Protagonist",
  "demons": "Demons",
  "monsters": "Kaiju",
  "virtual reality": "Virtual World",
  "modern day": null,
};

// UI tropes AniList has no usable tag for. Kept explicit so the gap is visible
// rather than hidden behind a plausible-looking but non-matching alias — every
// name here was probed against the live API and returns nothing.
//   crafting    : no crafting, artisan or smithing tag exists
//   slow burn   : no pacing tag exists
//   gods        : exists, but on a handful of titles only
//   nobility    : "Nobility" / "Royalty" / "Noble" all return zero
//   modern day  : "Contemporary" / "Modern Setting" both return zero
const DEAD_TAGS = new Set([
  "crafting",
  "slow burn",
  "gods",
  "nobility",
  "modern day",
]);

function mapTag(tag) {
  if (!tag) return null;
  const trimmed = String(tag).trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (DEAD_TAGS.has(lower)) return null;
  // An unmapped UI tag is passed through so a tag AniList *does* know (added
  // to the UI later) still works without a code change.
  return TAG_MAP[lower] ?? trimmed;
}

function normalizeGenre(value) {
  return String(value || "").trim().toLowerCase();
}

// ── Input Sanitization ─────────────────────────────────────────────────────
// The request body is fully attacker-controlled: it reaches AniList variables
// and is interpolated straight into the LLM prompt. Normalize everything to a
// known shape and a bounded length before it is used anywhere.

// Strips control characters and clamps a free-text field. Quotes are kept
// because they are legitimate in titles and this value also feeds the AniList
// query, where the raw title is what we want.
const MAX_TEXT_LENGTH = 120;

function sanitizeText(value, maxLength = MAX_TEXT_LENGTH) {
  if (value === null || value === undefined) return "";
  return String(value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitises a value destined for an LLM prompt.
 *
 * The prompts quote user input, e.g. `... the exact title: "${promptQuery}"`.
 * `sanitizeText` deliberately keeps quotes (AniList needs them), which means a
 * query containing `"` can terminate that quoted slot and append instructions of
 * its own. Dropping the quotes and angle brackets removes the escape hatch
 * entirely, at the cost of a mangled title in a prompt nobody reads.
 */
function sanitizeForPrompt(value, maxLength = MAX_TEXT_LENGTH) {
  return sanitizeText(value, maxLength)
    .replace(/["'`<>\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Keeps only string entries, sanitized and de-duplicated. Non-string and
// non-array input collapses to an empty list rather than throwing deep inside
// the handler.
function sanitizeList(value, maxLength = MAX_TEXT_LENGTH, maxItems = 25) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const text = sanitizeText(entry, maxLength);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function matchesRequestedGenres(genres, requestedGenres) {
  if (!requestedGenres?.length) return true;
  const actualGenres = new Set((genres || []).map(normalizeGenre));
  // Every selected genre must exist in the title's canonical
  // AniList genre metadata.
  return requestedGenres.every(genre =>
    actualGenres.has(normalizeGenre(genre))
  );
}

function matchesRequestedFormats(type, formats) {
  if (!formats?.length) return true;
  return formats.includes(type);
}

function getClientIp(req) {
  return (
    req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers?.["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function getCachedValue(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

// A warm serverless instance handles requests forever, so an unbounded Map is
// a real leak. Drop expired entries first and, if still at capacity, evict the
// oldest insertions (Map preserves insertion order).
function setCachedValue(cache, key, value) {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [existingKey, entry] of cache) {
      if (entry.timestamp < cutoff) cache.delete(existingKey);
    }
    while (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }
  cache.set(key, {
    value,
    timestamp: Date.now(),
  });
}

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, {
      windowStart: now,
      count: 1,
    });
    return false;
  }
  record.count += 1;
  return record.count > RATE_LIMIT_MAX_REQUESTS;
}

// Same leak as the response caches: the rate-limit table grows one entry per
// distinct IP forever. Drop windows that have already expired.
function pruneRateLimits(now) {
  for (const [key, record] of rateLimitMap) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(key);
    }
  }
}

// ── Per-request wall-clock budget ──────────────────────────────────────────
// A warm serverless instance serves many requests concurrently, so the budget
// must live in a per-call object rather than in module state.
function createBudget(totalMs = TOTAL_BUDGET_MS) {
  // `start` is a plain property on purpose: a caller (or a test simulating
  // elapsed time) can shift it and every accessor follows. Capturing it in a
  // closure instead would silently ignore such an adjustment, which is how a
  // test can appear to verify budget exhaustion while measuring nothing.
  const budget = {
    totalMs,
    start: Date.now(),
    remaining() {
      return Math.max(0, budget.totalMs - (Date.now() - budget.start));
    },
    elapsed() {
      return Date.now() - budget.start;
    },
    /** Pretend `ms` have passed. Used by tests to exercise spent budgets. */
    advance(ms) {
      budget.start -= ms;
      return budget;
    },
  };
  return budget;
}

/**
 * Clamps a per-request timeout to what is left of the wall-clock budget.
 *
 * The clamp must never exceed the remaining budget. An earlier version applied
 * a 500ms *floor*, so a caller holding 50ms was handed a 500ms timeout — ten
 * times its budget, which is exactly how a "budgeted" request overran the cap
 * and lost the response to the platform kill. Reporting the remaining time
 * honestly matters more than the comfort of a round number.
 */
function clampTimeout(desiredMs, budget) {
  if (!budget) return Math.max(1, desiredMs);
  const remaining = budget.remaining();
  if (remaining <= 0) return 1;
  return Math.max(1, Math.min(desiredMs, remaining));
}

/**
 * The request's hard deadline.
 *
 * Every individual timeout is clamped, but they are sequential: AI generation
 * can spend the budget, then enrichment starts, then recovery queries run. This
 * signal aborts *all* outstanding work at once when the budget is gone, so the
 * total request time cannot exceed `TOTAL_BUDGET_MS` no matter how the stages
 * compose. The handler still gets to return whatever it has.
 */
function createDeadline(budget) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget.remaining());
  // Never hold the process open for this timer alone.
  if (typeof timer.unref === "function") timer.unref();
  return {
    signal: controller.signal,
    expired: () => controller.signal.aborted,
    dispose() {
      clearTimeout(timer);
    },
  };
}

// Merges the deadline signal with any caller-supplied signal so either can abort.
function anySignal(signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  const controller = new AbortController();
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

async function fetchWithTimeout(url, options, timeoutMs = ANILIST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const upstream = anySignal([options?.signal]);
  const cleanOptions = { ...options };
  if (upstream) {
    cleanOptions.signal = anySignal([controller.signal, upstream]);
  }

  try {
    return await fetch(url, cleanOptions);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Maps over `items` with at most `limit` in-flight tasks. A rejected task
// resolves to `fallback` so one failure never sinks the whole batch.
async function mapWithConcurrency(items, limit, worker, fallback = null) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch {
        results[index] = fallback;
      }
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, run));
  return results;
}

// ── AniList GraphQL Queries ────────────────────────────────────────────────
const ANILIST_SINGLE_QUERY = `
query ($search: String) {
  Page(perPage: 6) {
    media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
      title { romaji english native }
      description(asHtml: false)
      coverImage { large medium }
      averageScore
      status
      genres
      siteUrl
      format
      countryOfOrigin
      externalLinks { url site }
    }
  }
}`;

const ANILIST_SEARCH_WITH_RECS_QUERY = `
query ($search: String) {
  Page(perPage: 5) {
    media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
      title { romaji english native }
      description(asHtml: false)
      coverImage { large medium }
      averageScore
      status
      genres
      siteUrl
      format
      countryOfOrigin
      externalLinks { url site }
      recommendations(sort: RATING_DESC, perPage: 6) {
        nodes {
          mediaRecommendation {
            title { romaji english native }
            description(asHtml: false)
            coverImage { large medium }
            averageScore
            status
            genres
            siteUrl
            format
            countryOfOrigin
            externalLinks { url site }
          }
        }
      }
    }
  }
}`;

const ANILIST_DISCOVER_QUERY = `
query ($genre_in: [String], $tag_in: [String], $format_in: [MediaFormat], $countryOfOrigin: CountryCode, $search: String, $page: Int) {
  Page(page: $page, perPage: 12) {
    media(
      genre_in: $genre_in,
      tag_in: $tag_in,
      format_in: $format_in,
      countryOfOrigin: $countryOfOrigin,
      search: $search,
      type: MANGA,
      sort: [POPULARITY_DESC, SCORE_DESC]
    ) {
      title { romaji english native }
      description(asHtml: false)
      coverImage { large medium }
      averageScore
      status
      genres
      siteUrl
      format
      countryOfOrigin
      externalLinks { url site }
    }
  }
}`;

const STATUS_MAP = {
  FINISHED: "Completed",
  RELEASING: "Ongoing",
  NOT_YET_RELEASED: "Upcoming",
  CANCELLED: "Cancelled",
  HIATUS: "On Hiatus",
};

const FORMAT_MAP = {
  MANGA: "Manga",
  NOVEL: "Light Novel",
  ONE_SHOT: "Manga",
};

// The exact set of formats the UI can produce. Anything else in the request
// body is dropped, so `matchesRequestedFormats` can never reject every result
// because of a stray value.
const VALID_FORMATS = new Set(["Manga", "Manhwa", "Manhua", "Light Novel"]);

// Manga / Manhwa / Manhua are the same AniList `format` (MANGA, ONE_SHOT) and
// are distinguished only by country of origin. Light Novels (NOVEL) are a real
// format and must not be re-labelled by origin.
function deriveType(media) {
  if (media.format === "NOVEL") return "Light Novel";

  const country = media.countryOfOrigin;
  if (country === "KR") return "Manhwa";
  if (country === "CN" || country === "TW") return "Manhua";
  return FORMAT_MAP[media.format] || "Manga";
}

const SYNOPSIS_MAX_LENGTH = 400;

function cleanSynopsis(rawDesc) {
  if (!rawDesc) return null;
  const cleaned = rawDesc
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    // Entities are decoded BEFORE the bracket strip. Decoding afterwards would
    // reintroduce the very markup that was just removed: a description
    // containing `&lt;script&gt;` would decode back into a literal <script> in
    // the text. (The client escapes on render, but the API should not hand back
    // a string that looks like markup.)
    .replace(/&nbsp;/gi, " ")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    // Now strip anything that still looks like a tag, including an unclosed
    // `<b` with no closing bracket, which the tag regex above cannot match.
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  // The ellipsis must be decided from the *cleaned* length. Using the raw
  // length appends an ellipsis to descriptions that were only long because the
  // HTML markup was stripped away.
  if (cleaned.length <= SYNOPSIS_MAX_LENGTH) return cleaned;
  return `${cleaned.slice(0, SYNOPSIS_MAX_LENGTH).trimEnd()}\u2026`;
}

function extractReadUrl(media) {
  const READING_SITES = [
    "Webtoon",
    "MangaPlus",
    "Tapas",
    "Tappytoon",
    "Pocket Comics",
    "Lezhin",
    "MangaDex",
    "NovelUpdates",
  ];
  let readUrl = null;
  if (media.externalLinks?.length) {
    for (const site of READING_SITES) {
      const link = media.externalLinks.find(link =>
        link.site?.toLowerCase().includes(site.toLowerCase())
      );
      if (link?.url) {
        readUrl = link.url;
        break;
      }
    }
  }
  return readUrl;
}

function buildSearchReadUrl(title, type) {
  const q = encodeURIComponent(title);
  if (type === "Light Novel") {
    return `https://www.google.com/search?q=site:freewebnovel.com+${q}`;
  }
  return `https://www.google.com/search?q=site:mangabuddy.com+${q}`;
}

function transformAniListMedia(media) {
  if (!media) return null;
  const title =
    media.title.english ||
    media.title.romaji ||
    media.title.native ||
    "Unknown Title";
  const type = deriveType(media);
  const directReadUrl = extractReadUrl(media);
  const isDirectLink = Boolean(directReadUrl);
  const readUrl = directReadUrl || buildSearchReadUrl(title, type);

  return {
    title,
    type,
    // The FULL canonical genre list must survive. Truncating here silently
    // dropped the 5th+ genre, so a title the user legitimately matched (e.g. a
    // 6-genre manga whose only "Sports" tag was last) failed verification and
    // was discarded. Clients already trim for display.
    genre: [...(media.genres || [])],
    synopsis: cleanSynopsis(media.description) || "Immerse in this celebrated series.",
    status: STATUS_MAP[media.status] || media.status || "Ongoing",
    rating: media.averageScore ? (media.averageScore / 10).toFixed(1) : "8.0",
    coverImage: media.coverImage?.large || media.coverImage?.medium || null,
    coverHint: null,
    anilistUrl: media.siteUrl || null,
    readUrl,
    isDirectLink,
  };
}

/**
 * Runs a cached AniList GraphQL query.
 *
 * Every AniList call in this module goes through here so the three behaviours
 * that matter are impossible to forget: an identical query is served from
 * cache, a 429 is backed off and retried once, and no failure mode can throw out
 * of the handler.
 */
async function runCachedAnilistQuery(cacheKey, query, variables, budget) {
  const cached = getCachedValue(anilistQueryCache, cacheKey);
  if (cached) return cached;

  for (let attempt = 0; attempt <= ANILIST_RETRIES; attempt++) {
    // No point starting an attempt the request cannot afford to finish.
    if (budget && budget.remaining() < MIN_QUERY_BUDGET_MS) break;
    // A spent deadline means every remaining fetch would abort anyway.
    if (budget?.deadline?.expired()) break;

    let res;
    try {
      res = await fetchWithTimeout(
        "https://graphql.anilist.co",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ query, variables }),
          signal: budget?.deadline?.signal,
        },
        clampTimeout(ANILIST_TIMEOUT_MS, budget)
      );
    } catch {
      // Timeout, DNS failure, abort — retrying inside a spent budget only
      // delays the response.
      break;
    }

    if (res.status === 429) {
      await sleep(400);
      continue;
    }
    if (!res.ok) break;

    let json;
    try {
      json = await res.json();
    } catch {
      break;
    }

    const media = json?.data?.Page?.media || [];
    // Only successful, well-formed answers are cached; a failure is retried on
    // the next real request rather than remembered for ten minutes.
    setCachedValue(anilistQueryCache, cacheKey, media);
    return media;
  }

  // Everything below here failed: a timeout, a 429 that outlasted its retries, a
  // non-JSON body, or a budget too spent to issue the call.
  //
  // Marked on the budget so the handler can tell "AniList has nothing matching
  // this" apart from "AniList never answered". Both produce an empty array, and
  // reporting the first as the second tells a user their query is wrong when the
  // upstream is actually down.
  if (budget) budget.anilistFailed = true;
  return [];
}

function runSearchWithRecsQuery(cleanSearch, budget) {
  return runCachedAnilistQuery(
    JSON.stringify(["search", cleanSearch]),
    ANILIST_SEARCH_WITH_RECS_QUERY,
    { search: cleanSearch },
    budget
  );
}

function runDiscoveryQuery(variables, budget) {
  return runCachedAnilistQuery(
    JSON.stringify(["discover", variables]),
    ANILIST_DISCOVER_QUERY,
    variables,
    budget
  );
}

async function fetchAnilistData(title, desiredTypes = null, budget = null) {
  const cacheKey = JSON.stringify({ title, desiredTypes });

  // AniList's "no exact match" answer is stable, so negative results are
  // cached too. Previously they were refetched every time, which burned the
  // request's whole budget on the slowest titles in the batch.
  const entry = anilistCache.get(cacheKey);
  if (entry) {
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) anilistCache.delete(cacheKey);
    else return entry.value;
  }

  const candidates = await runCachedAnilistQuery(
    JSON.stringify(["single", { search: title }]),
    ANILIST_SINGLE_QUERY,
    { search: title },
    budget
  );
  if (budget?.deadline?.expired()) return null;
  if (!candidates.length) {
    setCachedValue(anilistCache, cacheKey, null);
    return null;
  }

  let media = candidates[0];
  if (desiredTypes?.length) {
    const match = candidates.find(candidate =>
      desiredTypes.includes(deriveType(candidate))
    );
    if (match) media = match;
  }

  const result = transformAniListMedia(media);
  setCachedValue(anilistCache, cacheKey, result);
  return result;
}

// Returns the first balanced JSON array/object found in `text`, discarding any
// surrounding prose. Returns the whole remainder when the payload never closes
// (a token-truncated response), leaving the repair step to close it.
function extractJsonSlice(text) {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const stack = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }
    if (char === "}" || char === "]") {
      stack.pop();
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/**
 * A tolerant JSON reader for LLM output. Models routinely wrap the payload in a
 * ```json fence, prepend a sentence of prose, return a bare object instead of
 * an array, or get cut off mid-array by the token limit. A plain
 * `JSON.parse` threw on every one of those and the whole request silently fell
 * through to the fallback.
 */
function parseModelJson(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;

  const withoutFence = raw.replace(/```(?:json)?/gi, "").trim();
  const attempts = [withoutFence];

  const slice = extractJsonSlice(withoutFence);
  if (slice && slice !== withoutFence) attempts.push(slice);

  for (const attempt of attempts) {
    const candidates = [attempt, repairTruncatedJson(attempt)];
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed;
        // Some models wrap the array: { "recommendations": [...] }
        if (parsed && typeof parsed === "object") {
          const nested = Object.values(parsed).find(value =>
            Array.isArray(value)
          );
          if (nested) return nested;
        }
      } catch {
        // Try the next candidate.
      }
    }
  }

  return null;
}

// Closes the dangling quotes/brackets of a JSON payload that ran out of tokens.
function repairTruncatedJson(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  const stack = [];

  for (const char of text) {
    // Escapes are only meaningful INSIDE a string. In structural position a
    // backslash is an ordinary character in JSON; treating it as an escape made
    // this function disagree with every other JSON reader about whether the
    // bracket after it is structural.
    if (inString && escaped) {
      escaped = false;
      out += char;
      continue;
    }
    if (inString && char === "\\") {
      escaped = true;
      out += char;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }
    if (inString) {
      out += char;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char);
    if (char === "}" || char === "]") {
      // A closer only counts if something is actually open. A stray closer, or
      // one that does not match the current opener (`[{]`, `[]]`), is noise: no
      // amount of appending repairs it, and pretending otherwise hands a caller
      // a string that still cannot be parsed.
      const open = stack[stack.length - 1];
      if (open !== "{" && open !== "[") continue;
      stack.pop();
    }
    out += char;
  }

  if (inString) {
    // A string that ends on an escaped backslash (`"...\`) still needs its
    // closing quote. The escape flag must be cleared first, otherwise the
    // appended quote is consumed as an escaped character and the string never
    // closes — leaving brackets after it permanently "inside" a string.
    if (escaped) out += "\\";
    out += '"';
  }
  // A trailing comma before a closing bracket is invalid JSON.
  out = out.replace(/,\s*$/, "").replace(/,\s*([}\]])/g, "$1");
  while (stack.length) out += stack.pop() === "{" ? "}" : "]";
  return out;
}

// ── Direct AniList Engine Fallback ─────────────────────────────────────────
const DISCOVERY_RESULT_LIMIT = 12;

/**
 * AniList ANDs every filter it is given. Combining `genre_in` + `tag_in` +
 * `countryOfOrigin` + a free-text `search` is so restrictive that a saved
 * preset (which always ships a prose prompt) reliably returns zero rows. These
 * attempts list the droppable constraints in the order we are willing to give
 * them up. `genre_in` is deliberately absent — selected genres are never
 * relaxed (see ANILIST_GENRES).
 */
function buildDiscoveryAttempts({
  validGenres,
  rawTags,
  formats,
  customInput,
  page,
}) {
  const attempts = [];

  const withGenres = { page };
  if (validGenres.length) withGenres.genre_in = validGenres;

  const withFormat = { ...withGenres };
  if (formats?.includes("Light Novel")) {
    withFormat.format_in = ["NOVEL"];
  } else if (formats?.includes("Manhwa")) {
    withFormat.countryOfOrigin = "KR";
  } else if (formats?.includes("Manhua")) {
    withFormat.countryOfOrigin = "CN";
  } else if (formats?.includes("Manga")) {
    withFormat.countryOfOrigin = "JP";
  }

  // AniList's `search` is a literal-ish title match, so a prose prompt such as
  // "Tower climbing with unique awakening and system quests" can never match.
  // It is therefore the FIRST constraint we drop, not the last.
  const search = customInput ? sanitizeText(customInput, 40) : "";

  // 1. Everything the user asked for.
  attempts.push({
    ...withFormat,
    ...(rawTags.length ? { tag_in: [rawTags[0]] } : {}),
    ...(search ? { search } : {}),
  });
  // 2. Same, minus the free-text prompt.
  if (search) {
    attempts.push({
      ...withFormat,
      ...(rawTags.length ? { tag_in: [rawTags[0]] } : {}),
    });
  }
  // 3. Same, minus the trope tag.
  attempts.push(withFormat);
  // 4. Genres + free text (user picked tags but no recognised genre).
  if (search) attempts.push({ ...withGenres, search });
  // 5. Genres only.
  attempts.push(withGenres);

  // De-duplicate structurally identical attempts.
  const seen = new Set();
  return attempts.filter(attempt => {
    const key = JSON.stringify(attempt);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchDirectAnilistRecommendations({
  mode,
  searchInput,
  genres,
  tags,
  formats,
  customInput,
  exclude,
  page = 1,
  budget = null,
}) {
  const seenTitles = new Set(
    (exclude || []).filter(Boolean).map(title => title.toLowerCase())
  );

  try {
    if (mode === "search") {
      const cleanSearch = sanitizeText(
        (searchInput || "").replace(
          /^(something like|similar to|like|recommend me)\s+/i,
          ""
        ),
        80
      );
      if (!cleanSearch) return [];

      const primaryList = await runSearchWithRecsQuery(cleanSearch, budget);
      if (!primaryList.length) return [];

      const results = [];
      for (const primary of primaryList) {
        const item = transformAniListMedia(primary);
        if (item && !seenTitles.has(item.title.toLowerCase())) {
          seenTitles.add(item.title.toLowerCase());
          results.push(item);
        }

        const recNodes = primary.recommendations?.nodes || [];
        for (const recNode of recNodes) {
          const recMedia = recNode.mediaRecommendation;
          if (recMedia) {
            const recItem = transformAniListMedia(recMedia);
            if (recItem && !seenTitles.has(recItem.title.toLowerCase())) {
              seenTitles.add(recItem.title.toLowerCase());
              results.push(recItem);
            }
          }
          if (results.length >= 10) break;
        }
        if (results.length >= 10) break;
      }

      return results;
    }

    // ── Discover Mode ──────────────────────────────────────────────────
    const validGenres = (genres || []).filter(genre =>
      ANILIST_GENRES.has(genre)
    );
    // Genres the UI offers that aren't in AniList's canonical list
    // ("Historical", "Martial Arts") are treated as themes/tags instead of
    // being silently dropped.
    const genreTags = (genres || []).filter(
      genre => !ANILIST_GENRES.has(genre)
    );
    const rawTags = [
      ...new Set([...genreTags, ...(tags || [])].map(mapTag).filter(Boolean)),
    ];

    const attempts = buildDiscoveryAttempts({
      validGenres,
      rawTags,
      formats,
      customInput,
      page,
    });

    const results = [];
    const attemptedQueries = new Set();

    for (const variables of attempts) {
      if (results.length >= DISCOVERY_RESULT_LIMIT) break;
      // One query must be able to complete before another is started. Anything
      // less and the request is guaranteed to overrun its budget.
      if (budget && budget.remaining() < MIN_QUERY_BUDGET_MS) break;
      if (budget?.deadline?.expired()) break;

      const key = JSON.stringify(variables);
      if (attemptedQueries.has(key)) continue;
      attemptedQueries.add(key);

      // Walk AniList's pagination forward. The discovery query is sorted by
      // POPULARITY_DESC and is therefore completely deterministic, so page 2
      // of the previous request would otherwise hand back the exact same
      // twelve titles and "Load More" would return nothing.
      for (let anilistPage = page; ; anilistPage++) {
        if (results.length >= DISCOVERY_RESULT_LIMIT) break;
        if (budget && budget.remaining() < MIN_QUERY_BUDGET_MS) break;
        if (budget?.deadline?.expired()) break;

        const list = await runDiscoveryQuery(
          { ...variables, page: anilistPage },
          budget
        );
        // End of this attempt's result set.
        if (list.length === 0) break;

        let addedFromPage = 0;
        for (const media of list) {
          if (results.length >= DISCOVERY_RESULT_LIMIT) break;
          const item = transformAniListMedia(media);
          if (!item) continue;
          const titleKey = item.title.toLowerCase();
          if (seenTitles.has(titleKey)) continue;
          // Deterministic genre enforcement — never relaxed.
          if (!matchesRequestedGenres(item.genre, validGenres)) continue;
          // Deterministic format enforcement.
          if (!matchesRequestedFormats(item.type, formats)) continue;
          seenTitles.add(titleKey);
          results.push(item);
          addedFromPage++;
        }

        // This attempt produced fresh titles, so there is no reason to keep
        // paging deeper into it. If it produced none, keep paging: every row
        // was either already shown or filtered out.
        if (addedFromPage > 0) break;
      }

      // Relaxation only exists to rescue a zero-result query. As soon as an
      // attempt yields anything we are done.
      if (results.length > 0) break;
    }

    return results;
  } catch (err) {
    console.error("AniList fallback error:", err.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  // ── Rate limit ────────────────────────────────────────────────────────
  const now = Date.now();
  pruneRateLimits(now);
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({
      error:
        "Too many requests — please slow down and try again in a minute.",
    });
  }

  const budget = createBudget();
  budget.deadline = createDeadline(budget);

  // Every stage after this point is wrapped so the deadline is always released,
  // even on an unexpected throw.
  try {
    return await routeRequest({ req, res, budget });
  } finally {
    budget.deadline.dispose();
  }
}

async function routeRequest({ req, res, budget }) {
  // A missing / unparseable body used to throw a TypeError on the very next
  // line and surface as an opaque 500.
  const body =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};

  const mode = body.mode === "search" ? "search" : "discover";
  const genres = sanitizeList(body.genres);
  const tags = sanitizeList(body.tags);
  // Only the four formats the UI can actually produce are accepted; anything
  // else would make `matchesRequestedFormats` reject every result.
  const formats = sanitizeList(body.formats).filter(format =>
    VALID_FORMATS.has(format)
  );
  const customInput = sanitizeText(body.customInput);
  const searchInput = sanitizeText(body.searchInput);
  // How many already-seen titles the client sends, and how many of those the
  // prompt can actually carry. The client used to send 25 while the prompt only
  // ever mentioned the last 20, so the two lists silently disagreed.
  // The client sends oldest-first, so the *tail* is what is most recent.
  const exclude = sanitizeList(body.exclude, 120, MAX_EXCLUDE_TOTAL);
  // Explicit opt-in from the client's mode tabs ("exact" / "similar").
  const searchMode =
    body.searchMode === "exact" || body.searchMode === "similar"
      ? body.searchMode
      : "auto";
  const page = Math.min(Math.max(parseInt(body.page, 10) || 1, 1), 50);

  const requestedGenres = genres.filter(genre => ANILIST_GENRES.has(genre));

  let prompt = "";
  let isExact = false;

  // ── Search Mode ──────────────────────────────────────────────────────
  if (mode === "search") {
    if (!searchInput) {
      return res.status(400).json({
        error: "Search input is required.",
      });
    }

    // The bare `like ` alternative matched any title containing the word "like"
    // ("The Girl I Like Forgot Her Glasses"), silently turning exact title
    // searches into 10-result similarity searches. Every alternative now
    // requires a word boundary and the phrase must actually appear.
    const isVague =
      searchMode === "similar" ||
      (searchMode === "auto" &&
        /\b(something\s+like|similar\s+to|in\s+the\s+style\s+of|remind\s+me\s+of|feels\s+like|like\s+the\s+(?:vibe|style|tone)|i\s+like)\b/i.test(
          searchInput
        ));
    isExact = !isVague;

    // Quotes are stripped only for the prompt; AniList still receives the
    // verbatim title.
    const promptQuery = sanitizeForPrompt(searchInput);

    if (isExact) {
      prompt = `You are Kindoku, an expert on Manga, Manhwa, Manhua, and Light Novels.
The user is searching for the exact title: "${promptQuery}"

Return ONLY a valid JSON array (no markdown, no backticks) with exactly 1 result for that specific title.
If the title doesn't exist or you're unsure, return the closest match.
Each object must have:
{
  "title": "Exact title",
  "type": "Manga" | "Manhwa" | "Manhua" | "Light Novel",
  "genre": ["genre1", "genre2"],
  "synopsis": "2-3 sentence synopsis",
  "status": "Ongoing" | "Completed",
  "rating": "number like 8.5",
  "coverHint": "brief visual description of art style"
}
Only return the JSON array. No other text.`;
    } else {
      prompt = `You are Kindoku, an expert on Manga, Manhwa, Manhua, and Light Novels.
The user wants recommendations similar to: "${promptQuery}"

Return ONLY a valid JSON array (no markdown, no backticks) with exactly 10 recommendations similar in theme, tone, and style.
Mix Manga, Manhwa, Manhua, and Light Novels naturally.
Each object must have:
{
  "title": "Title",
  "type": "Manga" | "Manhwa" | "Manhua" | "Light Novel",
  "genre": ["genre1", "genre2"],
  "synopsis": "2-3 sentence synopsis",
  "status": "Ongoing" | "Completed",
  "rating": "number like 8.5",
  "coverHint": "brief visual description of art style"
}
Only return the JSON array. No other text.`;
    }
  } else {
    // ── Discover Mode ──────────────────────────────────────────────────
    if (!genres.length && !tags.length && !customInput && !formats.length) {
      return res.status(400).json({
        error: "Please select a genre, tag, format, or describe what you want.",
      });
    }

    const userQuery = [...formats, ...genres, ...tags, customInput]
      .filter(Boolean)
      .map(part => sanitizeForPrompt(part))
      .filter(Boolean)
      .join(", ");

    const formatClause = formats.length
      ? `
CRITICAL FORMAT RULE:
You MUST only recommend ${formats.join(" and ")}.
Do NOT include any other format.
Every result must be ${formats.join(" or ")} only.`
      : "";

    const genreClause = requestedGenres.length
      ? `
CRITICAL GENRE RULE:
The selected genres are:
${requestedGenres.join(", ")}
A recommendation is valid ONLY if its canonical AniList genre metadata contains EVERY selected genre.
Do NOT infer or invent a genre from:
supernatural abilities
scientifically impossible events
superhuman powers
biological experiments
futuristic-looking elements
technology alone
aliens alone
magic
fantasy concepts
scientific explanations for supernatural phenomena
IMPORTANT:
Something being scientifically impossible does NOT automatically make it Sci-Fi.
For example, an anime containing superhuman or experimentally-created characters is NOT automatically Sci-Fi.
AniList's canonical genre metadata is the source of truth.`
      : "";

    const excludeClause = exclude.length
      ? `
Do NOT recommend these titles (already shown):
${exclude
  .slice(-MAX_EXCLUDE_IN_PROMPT)
  .map(title => sanitizeForPrompt(title))
  .filter(Boolean)
  .join(", ")}`
      : "";

    prompt = `You are Kindoku, an expert recommender of Manga, Manhwa, Manhua, and Light Novels.
A user is looking for recommendations based on:
"${userQuery}"
${formatClause}
${genreClause}
${excludeClause}

The AI is responsible for discovering good candidate titles.
The AI is NOT the authority on genre classification.
Do not label a title as Sci-Fi merely because its premise contains impossible science, superhuman abilities, experiments, advanced technology, aliens, or other unusual phenomena.

Return ONLY a valid JSON array (no markdown, no backticks) with exactly 10 recommendations.
Each object must have:
{
  "title": "Title",
  "type": "Manga" | "Manhwa" | "Manhua" | "Light Novel",
  "genre": ["genre1", "genre2"],
  "synopsis": "2-3 sentence synopsis",
  "status": "Ongoing" | "Completed",
  "rating": "number like 8.5",
  "coverHint": "brief visual description of art style"
}
Only return the JSON array. No other text.`;
  }

  // ── Groq Models ──────────────────────────────────────────────────────
  // Ordered best-first. `llama3-70b-8192` and `gemma2-9b-it` were retired from
  // the Groq API: keeping them here only added two guaranteed 404 round-trips
  // (plus 2.4s of sleeps) to every failed request.
  // Groq retired llama-3.3-70b-versatile and llama-3.1-8b-instant on 2026-08-16
  // for free and developer-tier keys; both are now Enterprise-only. A free key
  // asking for either gets model_not_found immediately, which is why the whole
  // AI stage silently fell back to AniList for weeks.
  //
  // Ordered fastest first. 20B runs at ~1000 tok/s against 120B's ~500, and the
  // request budget is 7s, so the faster model is the one that can actually
  // finish; 120B is the quality fallback. Candidates are verified against
  // AniList either way, so a hallucinated title is dropped rather than shown.
  const GROQ_MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];

  const cacheKey = JSON.stringify({
    mode,
    prompt,
    genres,
    tags,
    formats,
    exclude,
    customInput,
    searchInput,
    // Without this, page 2 and page 3 of a "Load More" sequence that arrives
    // with the same exclude list share one entry, and the second page re-serves
    // the first page's candidates — the exact repeat-forever bug pagination
    // exists to fix. It only stayed hidden because the client grows `exclude`
    // on every page, so keys happened to differ anyway.
    page,
  });

  const cachedAi = getCachedValue(aiRecommendationCache, cacheKey);
  let aiRecs = Array.isArray(cachedAi) ? cachedAi : null;
  let usedModel = aiRecs ? "cached" : null;

  const hasGroqKey = Boolean(
    process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 5
  );

  // The deterministic AniList query is started here, in parallel with the Groq
  // call below, instead of after it.
  //
  // It used to run only as a fallback. That was fine while Groq was dead and
  // failed in 80ms, but a *working* Groq spends up to GROQ_TIMEOUT_MS before the
  // fallback is even attempted, and by then the 7s budget has nothing left for
  // the query. The result was an empty page for queries AniList can answer in
  // 200ms — a live AI stage made the app strictly worse.
  //
  // Both calls start at the same instant, so this costs no extra wall clock, and
  // the result is still cached, so the recovery path in step 5 resolves from
  // cache instead of spending a second round trip. The rejection is swallowed
  // here and reported by whoever awaits it.
  const directPromise = fetchDirectAnilistRecommendations({
    mode,
    searchInput,
    genres,
    tags,
    formats,
    customInput,
    exclude,
    page,
    budget,
  }).catch(() => []);

  // ── Diagnostics ────────────────────────────────────────────────────────────
// The AI path failing is invisible by design: the handler falls back to the
// direct AniList engine, which is fully functional, so a permanently broken
// Groq integration looks exactly like a healthy one from the user's side.
//
// Everything the fallback swallows is logged here so it is visible in the Vercel
// logs. The API key is never included, and the upstream body is truncated
// because it can echo the request back.
function logUpstreamFailure(service, model, detail) {
  console.warn(
    `[kindoku] ${service} failed`,
    JSON.stringify({ service, model, ...detail })
  );
}

function describeResponse(status, body) {
  // Groq and AniList both return `{ error: { message, code } }`; the code is
  // what distinguishes "bad key" from "retired model" from "out of quota".
  const code = body?.error?.code || body?.error?.type;
  const message = body?.error?.message;
  return {
    status,
    code: code || null,
    message: typeof message === 'string' ? message.slice(0, 200) : null,
  };
}

// ── Step 1: AI Candidate Generation ──────────────────────────────────
  if (!aiRecs && hasGroqKey) {
    const failures = [];

    for (let i = 0; i < GROQ_MODELS.length; i++) {
      const model = GROQ_MODELS[i];

      // Stop before the budget is gone. Once there isn't room for a realistic
      // attempt the remaining models can only burn the request's remaining
      // time and delay the AniList fallback that actually produces results.
      if (budget.remaining() < MIN_ATTEMPT_BUDGET_MS) break;
      if (budget.deadline.expired()) break;

      if (i > 0) {
        await sleep(300);
      }

      let response;
      try {
        response = await fetchWithTimeout(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: "user",
                  content: prompt,
                },
              ],
              temperature: 0.8,
              // Reasoning tokens count against this budget, so it needs
              // headroom over the ~1500 the JSON answer needs. Cutting it off
              // yields empty content rather than a short list.
              max_tokens: 3000,
              // GPT-OSS reasons before answering and the default effort burns
              // enough of the budget above to truncate the answer. "low" is the
              // smallest setting Groq offers for these models.
              reasoning_effort: "low",
              // The reasoning trace is not used and can be longer than the
              // answer, so do not pay to transfer it.
              include_reasoning: false,
            }),
            signal: budget.deadline.signal,
          },
          clampTimeout(GROQ_TIMEOUT_MS, budget)
        );
      } catch (err) {
        failures.push({ model, reason: `network: ${err.name || err.message}` });
        continue;
      }

      if (response.status === 429) {
        failures.push({ model, status: 429, reason: "rate limited or out of quota" });
        await sleep(400);
        continue;
      }

      if (!response.ok) {
        let body = null;
        try {
          body = await response.json();
        } catch {
          // The body is not JSON; the status alone is the signal, so leave
          // `body` null and let describeResponse report what it can.
          body = null;
        }
        failures.push({ model, reason: "http error", ...describeResponse(response.status, body) });
        continue;
      }

      let data;
      try {
        data = await response.json();
      } catch (err) {
        failures.push({ model, reason: `unparseable body: ${err.message}` });
        continue;
      }

      const raw = data?.choices?.[0]?.message?.content;
      if (!raw) {
        // On a reasoning model every emitted token, reasoning included, counts
        // against max_tokens. Running out mid-answer yields an empty content
        // field and finish_reason "length", which looks identical to a refusal
        // unless the usage is reported alongside it.
        const choice = data?.choices?.[0];
        failures.push({
          model,
          reason: choice?.message?.reasoning
            ? "reasoning consumed the whole token budget; the answer was cut off"
            : "no content in the choice",
          finishReason: choice?.finish_reason || null,
          completionTokens: data?.usage?.completion_tokens ?? null,
        });
        continue;
      }

      const parsed = parseModelJson(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        failures.push({ model, reason: "output was not a usable JSON array" });
        continue;
      }

      // Keep only the shape the rest of the pipeline understands.
      aiRecs = parsed
        .filter(rec => rec && typeof rec === "object" && rec.title)
        .map(rec => ({
          title: sanitizeText(rec.title, 120),
          type: VALID_FORMATS.has(rec.type) ? rec.type : undefined,
          genre: sanitizeList(rec.genre, 40, 8),
          synopsis: sanitizeText(rec.synopsis, 600),
          status: sanitizeText(rec.status, 40),
          rating: sanitizeText(rec.rating, 8),
          coverHint: sanitizeText(rec.coverHint, 160),
        }));
      if (aiRecs.length === 0) {
        failures.push({ model, reason: "every candidate lacked a title" });
        continue;
      }

      usedModel = `Groq (${model})`;
      setCachedValue(aiRecommendationCache, cacheKey, aiRecs);
      break;
    }

    // If nothing worked, say so once and loudly. Without this the request
    // falls through to the AniList engine and the failure is invisible.
    if (!aiRecs && failures.length) {
      logUpstreamFailure("groq", GROQ_MODELS.join(","), {
        reason: "all models failed; falling back to AniList",
        attempts: failures,
        hint: failures.every(f => f.code === "invalid_api_key" || /401/.test(String(f.status)))
          ? "GROQ_API_KEY is missing, malformed or revoked"
          : failures.some(f => /model/.test(String(f.message || "")))
          ? "a model name is no longer served by Groq; update GROQ_MODELS"
          : failures.some(f => f.status === 429)
          ? "the key's rate limit or quota is exhausted"
          : "inspect the attempts array",
      });
    }
  } else if (!hasGroqKey && !aiRecs) {
    logUpstreamFailure("groq", null, {
      reason: "GROQ_API_KEY is not set on this deployment; using AniList only",
      hint: "add GROQ_API_KEY as an environment variable in the Vercel project",
    });
  }

  // ── Step 2: Direct AniList Fallback ──────────────────────────────────
  if (!aiRecs || aiRecs.length === 0) {
    // Already in flight, and almost always already resolved.
    const directRecs = await directPromise;

    if (directRecs.length > 0) {
      return res.status(200).json({
        recommendations: directRecs,
        model: "AniList Direct Engine",
        isExact,
      });
    }

    // "No title matches these filters" is a user-input outcome, not a server
    // fault. Returning 500 made a legitimate empty result indistinguishable
    // from a crash in every error tracker, and pushed the browser into the
    // generic "request failed" path instead of the empty-state UI.
    //
    // `degraded` separates the two ways this can come up empty. Without it the
    // client tells the user nothing matches their filters when the truth is that
    // AniList was unreachable and the question was never really asked.
    return res.status(200).json({
      recommendations: [],
      model: "AniList Direct Engine",
      isExact,
      exhausted: true,
      degraded: Boolean(budget.anilistFailed),
    });
  }

  // ── Step 3: Verify AI Picks Against AniList ───────────────────────────
  // Titles the client has already been shown. The prompt asks the model to
  // avoid them, but a language model is not a filter: without this check the
  // second page of "Load More" came back full of cards already on screen.
  const alreadyShown = new Set(exclude.map(title => title.toLowerCase()));

  const enriched = (
    await mapWithConcurrency(
      aiRecs,
      ENRICHMENT_CONCURRENCY,
      async rec => {
        const aniData = await fetchAnilistData(rec.title, formats, budget);

        // In Discover mode, selected genres are mandatory.
        // An AI-only result cannot bypass AniList verification.
        if (mode !== "search" && requestedGenres.length && !aniData) {
          return null;
        }

        const finalType = aniData?.type || rec.type || "Manga";
        const finalTitle = aniData?.title || rec.title;
        // `aniData.readUrl` is ALWAYS populated — transformAniListMedia falls
        // back to a Google `site:` search when AniList has no reading link.
        // Testing it therefore marked every title as embeddable and sent the
        // in-app reader a Google search page inside the iframe.
        const isDirectLink = Boolean(aniData?.isDirectLink);
        const readUrl =
          aniData?.readUrl || buildSearchReadUrl(finalTitle, finalType);

        // ── Canonical genre enforcement ────────────────
        const canonicalGenres = aniData?.genre?.length ? aniData.genre : [];
        if (
          mode !== "search" &&
          requestedGenres.length &&
          !matchesRequestedGenres(canonicalGenres, requestedGenres)
        ) {
          return null;
        }

        // ── Canonical format enforcement ───────────────
        if (
          mode !== "search" &&
          !matchesRequestedFormats(finalType, formats)
        ) {
          return null;
        }

        // If AniList could not verify the title,
        // don't let AI metadata through for a filtered Discover request.
        if (mode !== "search" && !aniData) {
          return null;
        }

        if (!aniData) {
          return {
            ...rec,
            readUrl,
            isDirectLink,
          };
        }

        return {
          title: finalTitle,
          type: finalType,
          // IMPORTANT: Always use AniList genres when available.
          genre: canonicalGenres,
          synopsis: aniData.synopsis || rec.synopsis,
          status: aniData.status || rec.status,
          rating: aniData.rating || rec.rating,
          coverImage: aniData.coverImage,
          coverHint: aniData.coverImage ? null : rec.coverHint,
          anilistUrl: aniData.anilistUrl,
          readUrl,
          isDirectLink,
        };
      },
      null
    )
  ).filter(Boolean);

  // ── Step 4: Final deterministic filtering ─────────────────────────────
  let finalRecs = enriched;
  if (mode !== "search") {
    finalRecs = enriched.filter(
      rec =>
        matchesRequestedGenres(rec.genre, requestedGenres) &&
        matchesRequestedFormats(rec.type, formats)
    );
  }

  // Never hand back a title the user is already looking at, and never hand
  // back the same title twice within one response.
  const emitted = new Set(alreadyShown);
  finalRecs = finalRecs.filter(rec => {
    const key = rec.title.toLowerCase();
    if (emitted.has(key)) return false;
    emitted.add(key);
    return true;
  });

  // ── Step 5: Top up from AniList ────────────────────────────────────────
  // Never relax the user's selected genre.
  //
  // This started as a recovery path that only ran when the AI stage returned
  // nothing, and that was not enough. A live model proposes a handful of titles
  // for a genre-and-format combination, verification keeps the few that AniList
  // actually has, and the page came back with one card where the direct engine
  // returns twelve. Measured across repeated cold requests: 1 result from the AI
  // stage against 12 from the deterministic query, for the same query.
  //
  // So the AI picks lead — they are the curated ones — and the deterministic
  // results fill the rest of the grid. The user's genres and formats are applied
  // to the top-up exactly as they are to the AI results, and `emitted` keeps a
  // title from appearing twice.
  if (mode !== "search") {
    // The same query already started in parallel at the top of the request, so
    // this resolves without another round trip and without needing budget that
    // the Groq call has already spent.
    const directRecs = (await directPromise).filter(
      rec =>
        matchesRequestedGenres(rec.genre, requestedGenres) &&
        matchesRequestedFormats(rec.type, formats)
    );

    for (const rec of directRecs) {
      if (finalRecs.length >= RESULT_PAGE_SIZE) break;
      const key = rec.title.toLowerCase();
      if (emitted.has(key)) continue;
      emitted.add(key);
      finalRecs.push(rec);
    }
  }

  return res.status(200).json({
    recommendations: finalRecs,
    model: usedModel,
    isExact,
  });
}

// Named constants the deployment budget depends on. `tests/budget.test.mjs`
// asserts these line up with `vercel.json`, so the two cannot drift apart.
const TIMING = {
  TOTAL_BUDGET_MS,
  GROQ_TIMEOUT_MS,
  MIN_ATTEMPT_BUDGET_MS,
  ANILIST_TIMEOUT_MS,
  ANILIST_RETRIES,
  MIN_USEFUL_TIMEOUT_MS,
  ENRICHMENT_CONCURRENCY,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
  CACHE_TTL_MS,
  MAX_CACHE_ENTRIES,
  MAX_EXCLUDE_TOTAL,
  MAX_EXCLUDE_IN_PROMPT,
  DISCOVERY_RESULT_LIMIT,
};

// Named exports of the pure helpers. The default export above is the only
// thing Vercel invokes; these exist so `tests/` can exercise the decision logic
// (genre/format matching, sanitising, synopsis cleanup, JSON repair) without
// reaching the network.
export {
  ANILIST_GENRES,
  DEAD_TAGS,
  VALID_FORMATS,
  TIMING,
  buildDiscoveryAttempts,
  cleanSynopsis,
  clampTimeout,
  createBudget,
  createDeadline,
  anySignal,
  deriveType,
  extractJsonSlice,
  extractReadUrl,
  mapTag,
  mapWithConcurrency,
  matchesRequestedFormats,
  matchesRequestedGenres,
  normalizeGenre,
  parseModelJson,
  repairTruncatedJson,
  sanitizeForPrompt,
  sanitizeList,
  sanitizeText,
  transformAniListMedia,
};