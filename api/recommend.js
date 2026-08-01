const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Basic rate limiting ─────────────────────────────────────────────────────
// NOTE: this is in-memory, so it only protects a single warm serverless
// instance — Vercel can spin up multiple instances under load, and this
// map resets on cold start. It's a cheap first line of defense against
// casual abuse/runaway Groq costs, not a hard guarantee. For real
// production-grade limiting, swap this for Vercel KV or Upstash Redis
// (shared state across instances).
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitMap = new Map();

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

// ── AniList GraphQL query ──────────────────────────────────────────────────
const ANILIST_QUERY = `
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

// Derive our internal type (Manga / Manhwa / Manhua / Light Novel) from a
// single AniList media object.
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

// `desiredTypes` (e.g. ["Light Novel"]) lets us bias the pick toward what
// the user actually asked for. AniList's SEARCH_MATCH sort returns the
// *most popular* adaptation of a title first — for a well-known franchise
// that's almost always the manga/manhwa version, even if the user wants
// the light novel. Without this, enrichment silently overwrites the
// correct format with whatever's most popular, which made the format
// filter look broken (it was being defeated before it ever ran).
async function fetchAnilistData(title, desiredTypes = null) {
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: title } }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const candidates = json?.data?.Page?.media || [];
    if (!candidates.length) return null;

    // Pick the first candidate matching a requested format; fall back to
    // the top (most popular) match if none of them do.
    let media = candidates[0];
    let type = deriveType(media);

    if (desiredTypes?.length) {
      const match = candidates.find(c => desiredTypes.includes(deriveType(c)));
      if (match) {
        media = match;
        type = deriveType(media);
      }
    }

    const rawDesc = media.description || "";
    const synopsis = rawDesc
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#039;/g, "'")
      .replace(/&quot;/g, '"')
      .trim()
      .slice(0, 400) + (rawDesc.length > 400 ? "…" : "");

    // Pull a real reading link from AniList's externalLinks.
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

    return {
      title: media.title.english || media.title.romaji || title,
      type,
      genre: media.genres?.slice(0, 4) || [],
      synopsis: synopsis || null,
      status: STATUS_MAP[media.status] || media.status || "Ongoing",
      rating: media.averageScore ? (media.averageScore / 10).toFixed(1) : null,
      coverImage: media.coverImage?.large || media.coverImage?.medium || null,
      anilistUrl: media.siteUrl || null,
      readUrl,   // real link or null — will fall back below
    };
  } catch {
    return null;
  }
}

// ── Build a reliable search-based read URL from the title + type ───────────
// Strategy: route through Google site-search (always loads, no Cloudflare
// wall, no JS-dependent search forms) scoped to a no-signup target site.
//
// AVOIDED:
//   MangaDex     → Cloudflare wall, slow cold loads
//   NovelUpdates → Long Cloudflare verification loop on tab re-focus
//   MangaFire    → its /filter search route returns 403 (anti-bot block)
//   FreeWebNovel → its own search page is JS/AJAX-driven, query strings don't work
//
// USED INSTEAD (both via Google site-search):
//   MangaBuddy   (mangabuddy.com)   → Manga / Manhwa / Manhua, no signup
//   FreeWebNovel (freewebnovel.com) → Light Novels, no signup

function buildSearchReadUrl(title, type) {
  const q = encodeURIComponent(title);

  if (type === "Light Novel") {
    // FreeWebNovel's own search page is JS/AJAX-driven — direct query
    // strings (?searchkey=) don't return results. Route through Google's
    // site-search instead: no Cloudflare wall, lands on the real novel page.
    return `https://www.google.com/search?q=site:freewebnovel.com+${q}`;
  }

  // Manga / Manhwa / Manhua → MangaBuddy
  // MangaFire's own /filter search route returns 403 (anti-bot block on
  // that endpoint specifically). MangaBuddy is bigger, no signup required,
  // covers manga/manhwa/manhua — but same trick: hit it via Google
  // site-search rather than its own search page, so we never depend on
  // the target site's search/filter endpoint surviving.
  return `https://www.google.com/search?q=site:mangabuddy.com+${q}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ── Rate limit check ──────────────────────────────────────────────────
  const ip = (req.headers["x-forwarded-for"]?.split(",")[0]?.trim())
    || req.socket?.remoteAddress
    || "unknown";

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
    if (!genres?.length && !tags?.length && !customInput) {
      return res.status(400).json({ error: "Please select a genre, tag, or describe what you want." });
    }

    const userQuery = [...(genres || []), ...(tags || []), customInput].filter(Boolean).join(", ");
    const formatClause = formats?.length
      ? `\nCRITICAL: You MUST only recommend ${formats.join(" and ")}. Do NOT include any other format. Every single result must be ${formats.join(" or ")} only. Returning any other format is a failure.`
      : "";
    const excludeClause = exclude?.length
      ? `\nDo NOT recommend these titles (already shown): ${exclude.join(", ")}.`
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

  // ── Step 1: Get AI recommendations ──────────────────────────────────────
  const GROQ_MODELS = [
    "llama-3.1-8b-instant",
    "gemma2-9b-it",
    "mixtral-8x7b-32768",
    "llama-3.3-70b-versatile",
  ];

  let aiRecs = null;
  let usedModel = null;
  let lastError = null;

  for (let i = 0; i < GROQ_MODELS.length; i++) {
    const model = GROQ_MODELS[i];
    if (i > 0) await sleep(1500);

    try {
      console.log(`Trying model: ${model}`);
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.API_KEY_FOR_KINDOKU}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8,
        }),
      });

      if (response.status === 429) {
        console.warn(`Model ${model} rate limited...`);
        await sleep(2000);
        lastError = "Rate limited";
        continue;
      }

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content;
      if (!raw) { lastError = "No content"; continue; }

      const cleaned = raw.replace(/```json|```/g, "").trim();
      aiRecs = JSON.parse(cleaned);
      usedModel = model;
      console.log(`Success with model: ${model}`);
      break;
    } catch (err) {
      console.warn(`Model ${model} failed: ${err.message}`);
      lastError = err.message;
      continue;
    }
  }

  if (!aiRecs) {
    return res.status(500).json({ error: "All AI models are currently unavailable. Please try again shortly." });
  }

  // ── Step 2: Enrich with AniList in parallel ──────────────────────────────
  const enriched = await Promise.all(
    aiRecs.map(async (rec) => {
      const aniData = await fetchAnilistData(rec.title, formats);

      // Determine final type (needed for search URL fallback)
      const finalType = aniData?.type || rec.type || "Manga";
      const finalTitle = aniData?.title || rec.title;

      // Read URL priority:
      // 1. Real link from AniList externalLinks — worth trying in the
      //    in-app reader, some of these (Webtoon, MangaDex, etc.) allow
      //    being embedded.
      // 2. Search URL fallback (Google site-search) — this NEVER allows
      //    embedding, so it's flagged as not a direct link and the
      //    frontend should just open it in a new tab.
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

  // ── Step 3: Enforce requested formats ─────────────────────────────────
  // The prompt already tells the model to only return the requested
  // format(s), but that's an instruction, not a guarantee — AniList
  // enrichment can also override `type` in a way that no longer matches
  // what was asked for. Filter after the fact so the response actually
  // respects the user's format selection.
  //
  // If nothing matches, don't fall back to showing unfiltered results —
  // that defeats the point of the filter. Tell the user plainly instead.
  let finalRecs = enriched;
  if (formats?.length) {
    finalRecs = enriched.filter(r => formats.includes(r.type));

    if (finalRecs.length === 0) {
      return res.status(200).json({
        error: `No ${formats.join(" or ")} recommendations found for that search. Try a different filter or search term.`,
      });
    }
  }

  return res.status(200).json({ recommendations: finalRecs, model: usedModel, isExact });
}