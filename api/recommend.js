export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { genres, tags, customInput, exclude } = req.body;

  if (!genres?.length && !tags?.length && !customInput) {
    return res.status(400).json({ error: "Please select a genre, tag, or describe what you want." });
  }

  const userQuery = [...(genres || []), ...(tags || []), customInput]
    .filter(Boolean).join(", ");

  const excludeClause = exclude?.length
    ? `\nDo NOT recommend any of these titles (already shown): ${exclude.join(", ")}.`
    : "";

  const prompt = `You are Kindoku, an expert recommender of Manga, Manhwa, Manhua, and Light Novels.
A user is looking for recommendations based on: "${userQuery}"
${excludeClause}

Return ONLY a valid JSON array (no markdown, no explanation, no backticks) with exactly 20 recommendations.
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

  const GROQ_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "mixtral-8x7b-32768",
    "gemma2-9b-it",
  ];

  let lastError = null;

  for (const model of GROQ_MODELS) {
    try {
      console.log(`Trying Groq model: ${model}`);

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

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content;

      if (!raw) {
        console.warn(`Model ${model} returned no content, trying next...`);
        lastError = "No content returned";
        continue;
      }

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

  console.error("All Groq models failed. Last error:", lastError);
  return res.status(500).json({ error: "All AI models are currently unavailable. Please try again shortly." });
}