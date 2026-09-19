// backend/evalThreshold.js
// Memutar ulang riwayat chat_logs dengan algoritma pencocokan saat ini, lalu
// melaporkan berapa pertanyaan yang tertangkap DB di tiap kandidat threshold.
require("dotenv").config();

const { dbQuery } = require("./utils/asyncDb");
const { similarity, buildIdf } = require("./utils/nlp");

const CANDIDATES = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];

(async () => {
  const questions = await dbQuery(`
    SELECT q.question, q.intent_id, i.response
    FROM questions q
    LEFT JOIN intents i ON q.intent_id = i.id
  `);

  buildIdf(questions.map((q) => q.question || ""));

  const logs = await dbQuery(`
    SELECT user_message, confidence_score
    FROM chat_logs
    WHERE user_message IS NOT NULL AND user_message <> ''
    ORDER BY created_at DESC
    LIMIT 500
  `);

  if (!logs.length) {
    console.log("Tidak ada data di chat_logs. Jalankan chatbot dulu untuk mengumpulkan riwayat.");
    process.exit(0);
  }

  const scored = logs.map((log) => {
    let bestScore = 0;
    let best = null;

    for (const row of questions) {
      const score = similarity(log.user_message, row.question || "");
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }

    return {
      input: log.user_message,
      oldScore: Number(log.confidence_score) || 0,
      newScore: bestScore,
      matched: best?.question ?? null,
    };
  });

  console.log(`\nTotal log diuji: ${scored.length}\n`);
  console.log("Threshold | Terjawab DB | Lari ke Gemini");
  console.log("----------|-------------|---------------");
  for (const t of CANDIDATES) {
    const hit = scored.filter((s) => s.newScore >= t).length;
    console.log(
      `   ${t.toFixed(2)}   |   ${String(hit).padStart(6)}    |   ${String(scored.length - hit).padStart(6)}`
    );
  }

  const improved = scored
    .filter((s) => s.newScore > s.oldScore + 0.01)
    .sort((a, b) => b.newScore - a.newScore);

  console.log(`\n${improved.length} pertanyaan naik skornya dibanding algoritma lama.`);
  console.log("\n20 kenaikan terbesar (skor lama -> skor baru):");
  for (const s of improved.slice(0, 20)) {
    console.log(`  ${s.oldScore.toFixed(2)} -> ${s.newScore.toFixed(2)}  "${s.input}"`);
    console.log(`         cocok dengan: "${s.matched}"`);
  }

  const stillMissing = scored
    .filter((s) => s.newScore < 0.5)
    .sort((a, b) => b.newScore - a.newScore);

  console.log(`\n${stillMissing.length} pertanyaan masih di bawah 0.5 (kandidat tambah data/sinonim).`);
  console.log("\n20 yang paling mendekati:");
  for (const s of stillMissing.slice(0, 20)) {
    console.log(`  ${s.newScore.toFixed(2)}  "${s.input}"`);
    console.log(`         terdekat: "${s.matched}"`);
  }

  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
