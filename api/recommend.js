const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── AniList GraphQL query ──────────────────────────────────────────────────
const ANILIST_QUERY = `
query ($search: String) {
  Page(perPage: 1) {
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

async function fetchAnilistData(title) {
  try {
    const res = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: ANILIST_QUERY, variables: { search: title } }),
    });

    if (!res.ok) return null;
    const json = await res.json();
    const media = json?.data?.Page?.media?.[0];
    if (!media) return null;

    const statusMap = {
      FINISHED: "Completed",
      RELEASING: "Ongoing",
      NOT_YET_RELEASED: "Upcoming",
      CANCELLED: "Cancelled",
      HIATUS: "On Hiatus",
    };

    const formatMap = {
      MANGA: "Manga",
      NOVEL: "Light Novel",
      ONE_SHOT: "Manga",
    };

    let type = formatMap[media.format] || "Manga";
    if (media.format === "MANGA" || !media.format) {
      const country = media.countryOfOrigin;
      if (country === "KR") type = "Manhwa";
      else if (country === "CN" || country === "TW") type = "Manhua";
      else type = "Manga";
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
    // Priority order: fast no-verification sites first, MangaDex/NovelUpdates last.
    const READING_SITES = [
      "MangaFire",
      "Webtoon", "MangaPlus",
      "Tapas", "Tappytoon", "Pocket Comics", "Lezhin",
      "MangaDex",      // deprioritised — Cloudflare wall
      "NovelUpdates",  // deprioritised — long verification loop
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
      status: statusMap[media.status] || media.status || "Ongoing",
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
// Sites chosen for: no Cloudflare verification wall, no long captcha on tab-return,
// fast load, free access.
//
// AVOIDED:
//   MangaDex     → Cloudflare wall, slow cold loads
//   NovelUpdates → Long Cloudflare verification loop on tab re-focus
//   Webtoons     → Official only, misses most manhwa scans
//
// USED INSTEAD:
//   MangaFire (mangafire.to)       → Fast, clean, no-verification, manga+manhwa+manhua
//   MangaKakalot (mangakakalot.gg) → Fast daily updates, no verification, broad library
//   LightNovelWorld                → Clean LN reader, no Cloudflare wall
//   FreeWebNovel                   → Good fallback for LNs, no verification

function buildSearchReadUrl(title, type) {
  const q = encodeURIComponent(title);

  if (type === "Light Novel") {
    // LightNovelWorld: clean, fast, no verification wall
    return `https://www.lightnovelworld.com/search?title=${q}`;
  }
  if (type === "Manhwa" || type === "Manhua") {
    // MangaFire: handles manhwa + manhua well, no Cloudflare annoyance
    return `https://mangafire.to/filter?keyword=${q}`;
  }
  // Manga default → MangaFire covers it cleanly too
  return `https://mangafire.to/filter?keyword=${q}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
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
      const aniData = await fetchAnilistData(rec.title);

      // Determine final type (needed for search URL fallback)
      const finalType = aniData?.type || rec.type || "Manga";
      const finalTitle = aniData?.title || rec.title;

      // Read URL priority:
      // 1. Real link from AniList externalLinks
      // 2. Search URL built from the real title + type (always works)
      const readUrl = aniData?.readUrl || buildSearchReadUrl(finalTitle, finalType);

      if (!aniData) {
        return {
          ...rec,
          readUrl,
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
      };
    })
  );

  return res.status(200).json({ recommendations: enriched, model: usedModel, isExact });
}