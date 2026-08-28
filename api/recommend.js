const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const REQUEST_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const rateLimitMap = new Map();
const aiRecommendationCache = new Map();
const anilistCache = new Map();

const ANILIST_GENRES = new Set([
  "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror",
  "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance",
  "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"
]);

const TAG_MAP = {
  "murim": "Martial Arts",
  "op mc": "Overpowered Main Character",
  "villainess": "Otome Game",
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
  "survival": "Survival",
  "revenge": "Revenge",
  "cultivation": "Cultivation",
};

function mapTag(tag) {
  if (!tag) return null;
  const lower = tag.toLowerCase().trim();
  return TAG_MAP[lower] || tag;
}

function getClientIp(req) {
  return (req.headers["x-forwarded-for"]?.split(",")[0]?.trim())
    || req.headers["x-real-ip"]
    || req.socket?.remoteAddress
    || "unknown";
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

function setCachedValue(cache, key, value) {
  cache.set(key, {
    value,
    timestamp: Date.now(),
  });
}

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }

  record.count += 1;
  return record.count > RATE_LIMIT_MAX_REQUESTS;
}

async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
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
query ($genre_in: [String], $tag_in: [String], $format_in: [MediaFormat], $countryOfOrigin: CountryCode, $search: String) {
  Page(perPage: 12) {
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

function deriveType(media) {
  let type = FORMAT_MAP[media.format] || "Manga";
  if (media.format === "MANGA" || !media.format) {
    const country = media.countryOfOrigin;
    if (country === "KR") type = "Manhwa";
    else if (country === "CN" || country === "TW") type = "Manhua";
    else type = "Manga";
  }
  return type;
}

function cleanSynopsis(rawDesc) {
  if (!rawDesc) return null;
  return rawDesc
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .trim()
    .slice(0, 400) + (rawDesc.length > 400 ? "…" : "");
}

function extractReadUrl(media) {
  const READING_SITES = [
    "Webtoon", "MangaPlus",
    "Tapas", "Tappytoon", "Pocket Comics", "Lezhin",
    "MangaDex",
    "NovelUpdates",
  ];
  let readUrl = null;
  if (media.externalLinks?.length) {
    for (const site of READING_SITES) {
      const link = media.externalLinks.find(
        l => l.site?.toLowerCase().includes(site.toLowerCase())
      );
      if (link?.url) { readUrl = link.url; break; }
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
  const title = media.title.english || media.title.romaji || media.title.native || "Unknown Title";
  const type = deriveType(media);
  const directReadUrl = extractReadUrl(media);
  const isDirectLink = Boolean(directReadUrl);
  const readUrl = directReadUrl || buildSearchReadUrl(title, type);

  return {
    title,
    type,
    genre: media.genres?.slice(0, 4) || [],
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

async function fetchAnilistData(title, desiredTypes = null) {
  const cacheKey = JSON.stringify({ title, desiredTypes });
  const cached = getCachedValue(anilistCache, cacheKey);
  if (cached) return cached;

  try {
    const res = await fetchWithTimeout("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: ANILIST_SINGLE_QUERY, variables: { search: title } }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const candidates = json?.data?.Page?.media || [];
    if (!candidates.length) return null;

    let media = candidates[0];
    if (desiredTypes?.length) {
      const match = candidates.find(c => desiredTypes.includes(deriveType(c)));
      if (match) media = match;
    }

    const result = transformAniListMedia(media);
    setCachedValue(anilistCache, cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

// ── Direct AniList Engine Fallback (Zero API Key Requirement) ──────────────
async function fetchDirectAnilistRecommendations({ mode, searchInput, genres, tags, formats, customInput, exclude }) {
  try {
    if (mode === "search") {
      const cleanSearch = (searchInput || "").replace(/^(something like|similar to|like|recommend me)\s+/i, "").trim();

      const res = await fetchWithTimeout("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: ANILIST_SEARCH_WITH_RECS_QUERY, variables: { search: cleanSearch } }),
      });

      if (!res.ok) return [];
      const json = await res.json();
      const primaryList = json?.data?.Page?.media || [];
      if (!primaryList.length) return [];

      const results = [];
      const seenTitles = new Set((exclude || []).map(t => t.toLowerCase()));

      for (const primary of primaryList) {
        const item = transformAniListMedia(primary);
        if (item && !seenTitles.has(item.title.toLowerCase())) {
          seenTitles.add(item.title.toLowerCase());
          results.push(item);
        }

        // Add direct AniList recommendations
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
    } else {
      // Discover Mode
      const validGenres = (genres || []).filter(g => ANILIST_GENRES.has(g));
      const genreTags = (genres || []).filter(g => !ANILIST_GENRES.has(g));
      const rawTags = [...genreTags, ...(tags || [])].map(mapTag).filter(Boolean);

      let variables = {};
      if (validGenres.length) variables.genre_in = validGenres;
      if (rawTags.length) variables.tag_in = [rawTags[0]];
      if (customInput) variables.search = customInput.slice(0, 40);

      // Map formats
      if (formats?.includes("Light Novel")) variables.format_in = ["NOVEL"];
      else if (formats?.includes("Manhwa")) variables.countryOfOrigin = "KR";
      else if (formats?.includes("Manhua")) variables.countryOfOrigin = "CN";
      else if (formats?.includes("Manga")) variables.countryOfOrigin = "JP";

      let res = await fetchWithTimeout("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: ANILIST_DISCOVER_QUERY, variables }),
      });

      if (!res.ok) return [];
      let json = await res.json();
      let list = json?.data?.Page?.media || [];

      // If initial strict tag query produced 0, retry without tag constraint
      if (list.length === 0 && variables.tag_in) {
        delete variables.tag_in;
        res = await fetchWithTimeout("https://graphql.anilist.co", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query: ANILIST_DISCOVER_QUERY, variables }),
        });
        if (res.ok) {
          json = await res.json();
          list = json?.data?.Page?.media || [];
        }
      }

      const seenTitles = new Set((exclude || []).map(t => t.toLowerCase()));
      const results = [];
      for (const m of list) {
        const item = transformAniListMedia(m);
        if (item && !seenTitles.has(item.title.toLowerCase())) {
          seenTitles.add(item.title.toLowerCase());
          results.push(item);
        }
      }

      return results;
    }
  } catch (err) {
    console.error("AniList fallback error:", err.message);
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Rate limit check ──────────────────────────────────────────────────
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests — please slow down and try again in a minute." });
  }

  const { mode, genres, tags, formats, customInput, searchInput, exclude } = req.body;

  let prompt = "";
  let isExact = false;

  if (mode === "search") {
    if (!searchInput) return res.status(400).json({ error: "Search input is required." });

    const isVague = /something like|similar to|like |remind me of|feels like/i.test(searchInput);
    isExact = !isVague;

    if (isExact) {
      prompt = `You are Kindoku, an expert on Manga, Manhwa, Manhua, and Light Novels.
The user is searching for the exact title: "${searchInput}"

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
The user wants recommendations similar to: "${searchInput}"

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
    if (!genres?.length && !tags?.length && !customInput && !formats?.length) {
      return res.status(400).json({ error: "Please select a genre, tag, format, or describe what you want." });
    }

    const userQuery = [...(formats || []), ...(genres || []), ...(tags || []), customInput].filter(Boolean).join(", ");
    const formatClause = formats?.length
      ? `\nCRITICAL: You MUST only recommend ${formats.join(" and ")}. Do NOT include any other format. Every single result must be ${formats.join(" or ")} only. Returning any other format is a failure.`
      : "";
    const excludeClause = exclude?.length
      ? `\nDo NOT recommend these titles (already shown): ${exclude.slice(-20).join(", ")}. IMPORTANT: You must still strictly follow all genre, tag, and format requirements above regardless of the exclude list.`
      : "";

    prompt = `You are Kindoku, an expert recommender of Manga, Manhwa, Manhua, and Light Novels.
A user is looking for recommendations based on: "${userQuery}"
${formatClause}
${excludeClause}

Return ONLY a valid JSON array (no markdown, no backticks) with exactly 10 recommendations.
Mix Manga, Manhwa, Manhua, and occasionally Light Novels naturally.
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

  // ── Step 1: Get AI recommendations (or AniList Direct Fallback) ──────────
  const GROQ_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "gemma2-9b-it",
  ];

  const cacheKey = JSON.stringify({ mode, prompt, genres, tags, formats, exclude, customInput, searchInput });
  const cachedAi = getCachedValue(aiRecommendationCache, cacheKey);
  let aiRecs = cachedAi || null;
  let usedModel = cachedAi ? "cached" : null;

  const hasGroqKey = Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 5);

  if (!aiRecs && hasGroqKey) {
    for (let i = 0; i < GROQ_MODELS.length; i++) {
      const model = GROQ_MODELS[i];
      if (i > 0) await sleep(1200);

      try {
        const response = await fetchWithTimeout(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.8,
              max_tokens: 2500,
            }),
          }
        );

        if (response.status === 429) {
          await sleep(1500);
          continue;
        }

        if (!response.ok) {
          continue;
        }

        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content;
        if (!raw) continue;

        const cleaned = raw.replace(/```json|```/g, "").trim();
        aiRecs = JSON.parse(cleaned);
        usedModel = `Groq (${model})`;
        setCachedValue(aiRecommendationCache, cacheKey, aiRecs);
        break;
      } catch {
        continue;
      }
    }
  }

  // ── Step 2: Fallback to Direct AniList Query if AI is Unavailable ────────
  if (!aiRecs || !Array.isArray(aiRecs) || aiRecs.length === 0) {
    console.log("Using direct AniList recommendations engine fallback...");
    const directRecs = await fetchDirectAnilistRecommendations({
      mode,
      searchInput,
      genres,
      tags,
      formats,
      customInput,
      exclude,
    });

    if (directRecs && directRecs.length > 0) {
      let finalDirect = directRecs;
      if (formats?.length) {
        finalDirect = directRecs.filter(r => formats.includes(r.type));
        if (!finalDirect.length) finalDirect = directRecs;
      }
      return res.status(200).json({ recommendations: finalDirect, model: "AniList Direct Engine", isExact });
    }

    return res.status(500).json({
      error: "Unable to reach recommendation services. Please check your network or try again in a moment.",
    });
  }

  // ── Step 3: Enrich AI picks with AniList in Parallel ─────────────────────
  const enriched = await Promise.all(
    aiRecs.map(async (rec) => {
      const aniData = await fetchAnilistData(rec.title, formats);

      const finalType = aniData?.type || rec.type || "Manga";
      const finalTitle = aniData?.title || rec.title;

      const isDirectLink = Boolean(aniData?.readUrl);
      const readUrl = aniData?.readUrl || buildSearchReadUrl(finalTitle, finalType);

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
        genre: aniData.genre?.length ? aniData.genre : rec.genre,
        synopsis: aniData.synopsis || rec.synopsis,
        status: aniData.status || rec.status,
        rating: aniData.rating || rec.rating,
        coverImage: aniData.coverImage,
        coverHint: aniData.coverImage ? null : rec.coverHint,
        readUrl,
        isDirectLink,
      };
    })
  );

  // ── Step 4: Enforce requested formats ───────────────────────────────────
  let finalRecs = enriched;
  if (formats?.length) {
    finalRecs = enriched.filter(r => formats.includes(r.type));
    if (finalRecs.length === 0) {
      finalRecs = enriched;
    }
  }

  return res.status(200).json({ recommendations: finalRecs, model: usedModel, isExact });
}