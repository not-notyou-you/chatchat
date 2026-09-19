// backend/routes/chat.js
const { Router } = require("express");
const { dbQuery, dbRun } = require("../utils/asyncDb");
const { similarity, findTopMatches, buildIdf } = require("../utils/nlp");
const { callGemini } = require("../utils/gemini");

const router = Router();

// Di atas SCORE_THRESHOLD jawaban dianggap pasti dan langsung dikirim.
// Antara SUGGEST_THRESHOLD dan SCORE_THRESHOLD kecocokan benar dan salah
// bercampur di skor yang sama, jadi daripada menebak, tawarkan pilihan.
const SCORE_THRESHOLD = Number(process.env.SCORE_THRESHOLD) || 0.5;
const SUGGEST_THRESHOLD = Number(process.env.SUGGEST_THRESHOLD) || 0.4;
const DEFAULT_RESPONSE = "Maaf, saya belum memahami pertanyaan Anda.";
const GEMINI_ERROR_RESPONSE = "Maaf, asisten sedang tidak tersedia. Silakan coba lagi nanti.";

let idfRowCount = 0;

router.post("/", async (req, res) => {
  const userInput = (req.body.message || "").toLowerCase().trim();
  const createdAt = new Date().toISOString();

  try {
    const badWords = await dbQuery("SELECT word FROM bad_words");
    const isBad = badWords.some((r) => userInput.includes(r.word.toLowerCase()));

    if (isBad) {
      await saveLog(null, "Saya mendeteksi kata yang tidak pantas.", 1, "angry", userInput, createdAt);
      return res.json({
        response: "Saya mendeteksi kata yang tidak pantas.",
        score: 1,
        emotion: "angry",
        source: "filter",
      });
    }

    const rows = await dbQuery(`
      SELECT q.question, q.intent_id, i.response, i.emotion
      FROM questions q
      LEFT JOIN intents i ON q.intent_id = i.id
    `);

    // Bobot IDF ikut berubah kalau daftar pertanyaan di DB berubah.
    if (rows.length !== idfRowCount) {
      buildIdf(rows.map((r) => r.question || ""));
      idfRowCount = rows.length;
    }

    let bestScore = 0;
    let best = null;

    for (const row of rows) {
      const score = similarity(userInput, row.question || "");
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }

    if (bestScore >= SCORE_THRESHOLD && best) {
      await saveLog(best.intent_id, best.response, bestScore, best.emotion, userInput, createdAt);
      return res.json({
        response: best.response,
        score: Number(bestScore.toFixed(2)),
        emotion: best.emotion,
        source: "database",
      });
    }

    const topMatches = findTopMatches(userInput, rows, 5);

    if (bestScore >= SUGGEST_THRESHOLD) {
      const suggested = buildSuggestion(topMatches);

      if (suggested) {
        await saveLog(null, suggested.response, bestScore, "shy", userInput, createdAt);
        return res.json({
          ...suggested,
          score: Number(bestScore.toFixed(2)),
          emotion: "shy",
          source: "suggestion",
        });
      }
    }

    if (topMatches.length === 0) {
      await saveLog(null, DEFAULT_RESPONSE, 0, "shy", userInput, createdAt);
      return res.json({
        response: DEFAULT_RESPONSE,
        score: 0,
        emotion: "shy",
        source: "none",
      });
    }

    let response, source, emotion;

    try {
      const geminiResult = await callGemini(userInput, topMatches);
      response = geminiResult.response;
      source = geminiResult.rateLimited ? "rate_limited" : "gemini";
      emotion = geminiResult.rateLimited ? "shy" : "neutral";
    } catch (geminiErr) {
      console.error("[Gemini Error]", geminiErr.status ?? "", geminiErr.message);

      // Gemini mati bukan alasan untuk tidak menjawab: kita masih punya
      // kecocokan terdekat dari database, jauh lebih berguna daripada pesan error.
      const fallback = buildSuggestion(topMatches);
      response = fallback ? fallback.response : GEMINI_ERROR_RESPONSE;
      source = fallback ? "suggestion" : "error";
      emotion = "shy";
    }

    await saveLog(null, response, bestScore, emotion, userInput, createdAt);

    return res.json({
      response,
      score: Number(bestScore.toFixed(2)),
      emotion,
      source,
    });
  } catch (err) {
    console.error("[/chat]", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function buildSuggestion(topMatches) {
  const suggestions = pickDistinctIntents(topMatches, 3);
  if (!suggestions.length) return null;

  return {
    response:
      "Maksud Anda salah satu ini?\n" +
      suggestions.map((s, i) => `${i + 1}. ${s.question}`).join("\n"),
    suggestions: suggestions.map((s) => s.question),
  };
}

// Beberapa pertanyaan berbeda bisa menunjuk intent yang sama; saran yang
// ditampilkan harus benar-benar berbeda pilihannya.
function pickDistinctIntents(matches, limit) {
  const seen = new Set();
  const picked = [];

  for (const match of matches) {
    if (seen.has(match.intent_id)) continue;
    seen.add(match.intent_id);
    picked.push(match);
    if (picked.length === limit) break;
  }

  return picked;
}

async function saveLog(intentId, response, score, emotion, userInput, createdAt) {
  await dbRun(
    `INSERT INTO chat_logs (user_message, bot_response, matched_intent_id, confidence_score, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userInput, response, intentId ?? null, score, createdAt]
  );
}

module.exports = router;