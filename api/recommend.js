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

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.API_KEY_FOR_KINDOKU}`,
        "HTTP-Referer": "https://kindoku.vercel.app",
        "X-Title": "Kindoku",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.3-8b-instruct:free",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
      }),
    });

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;

    if (!raw) {
      return res.status(500).json({ error: "No response from AI" });
    }

    // Strip any accidental markdown fences
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const recommendations = JSON.parse(cleaned);

    return res.status(200).json({ recommendations });
  } catch (err) {
    console.error("Kindoku API error:", err);
    return res.status(500).json({ error: "Failed to fetch recommendations" });
  }
}