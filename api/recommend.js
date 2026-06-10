const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { mode, genres, tags, formats, customInput, searchInput, exclude } = req.body;

  let prompt = "";
  let isExact = false;

  if (mode === "search") {
    if (!searchInput) return res.status(400).json({ error: "Search input is required." });

    // Detect if it's an exact title or a "something like" request
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
  "readUrl": "direct URL on MangaDex, Webtoon, MangaPlus, or NovelUpdates",
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
  "readUrl": "direct URL on MangaDex, Webtoon, MangaPlus, or NovelUpdates",
  "coverHint": "brief visual description of art style"
}
Only return the JSON array. No other text.`;
    }

  } else {
    // Discover mode
    if (!genres?.length && !tags?.length && !customInput) {
      return res.status(400).json({ error: "Please select a genre, tag, or describe what you want." });
    }

    const userQuery = [...(genres || []), ...(tags || []), customInput].filter(Boolean).join(", ");
    const formatClause = formats?.length ? `\nOnly recommend these formats: ${formats.join(", ")}.` : "";
    const excludeClause = exclude?.length ? `\nDo NOT recommend these titles (already shown): ${exclude.join(", ")}.` : "";

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
  "readUrl": "direct URL on MangaDex, Webtoon, MangaPlus, or NovelUpdates",
  "coverHint": "brief visual description of art style"
}
Only return the JSON array. No other text.`;
  }

  const GROQ_MODELS = [
    "llama-3.1-8b-instant",
    "gemma2-9b-it",
    "mixtral-8x7b-32768",
    "llama-3.3-70b-versatile",
  ];

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
      const recommendations = JSON.parse(cleaned);

      console.log(`Success with model: ${model}`);
      return res.status(200).json({ recommendations, model, isExact });

    } catch (err) {
      console.warn(`Model ${model} failed: ${err.message}`);
      lastError = err.message;
      continue;
    }
  }

  return res.status(500).json({ error: "All AI models are currently unavailable. Please try again shortly." });
}