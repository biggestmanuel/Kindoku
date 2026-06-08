export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { genre, customInput } = req.body;

  if (!genre && !customInput) {
    return res.status(400).json({ error: "Genre or custom input is required" });
  }

  const userQuery = customInput || genre;

  const prompt = `You are Kindoku, an expert recommender of Manga, Manhwa, Manhua, and Light Novels. 
A user is looking for recommendations based on: "${userQuery}"

Return ONLY a valid JSON array (no markdown, no explanation, no backticks) with exactly 8 recommendations.
Mix between Manga, Manhwa, Manhua, and occasionally Light Novels naturally.
Each object must have these exact fields:
{
  "title": "Title of the work",
  "type": "Manga" | "Manhwa" | "Manhua" | "Light Novel",
  "genre": ["genre1", "genre2"],
  "synopsis": "2-3 sentence synopsis that sells it without spoiling",
  "status": "Ongoing" | "Completed",
  "rating": "a number like 8.5 out of 10 based on community reception",
  "readUrl": "direct URL to read on MangaDex, Webtoon, MangaPlus, or NovelUpdates — use real links only",
  "coverHint": "brief visual description of the art style e.g. dark gritty linework, vibrant color webtoon style"
}

Only return the JSON array. No other text.`;

  const FREE_MODELS = [
    "meta-llama/llama-3.3-8b-instruct:free",
    "mistralai/mistral-7b-instruct:free",
    "meta-llama/llama-3.1-8b-instruct:free",
    "qwen/qwen-2.5-7b-instruct:free",
    "google/gemma-3-4b-it:free",
    "deepseek/deepseek-r1-0528:free",
  ];

  let lastError = null;

  for (const model of FREE_MODELS) {
    try {
      console.log(`Trying model: ${model}`);

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.API_KEY_FOR_KINDOKU}`,
          "HTTP-Referer": "https://kindoku.vercel.app",
          "X-Title": "Kindoku",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8,
        }),
      });

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content;

      if (!raw) {
        console.warn(`Model ${model} returned no content, trying next...`);
        lastError = "No content returned";
        continue;
      }

      // Strip any accidental markdown fences
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const recommendations = JSON.parse(cleaned);

      console.log(`Success with model: ${model}`);
      return res.status(200).json({ recommendations, model });

    } catch (err) {
      console.warn(`Model ${model} failed: ${err.message}`);
      lastError = err.message;
      continue;
    }
  }

  // All models failed
  console.error("All models failed. Last error:", lastError);
  return res.status(500).json({ error: "All AI models are currently unavailable. Please try again shortly." });
}