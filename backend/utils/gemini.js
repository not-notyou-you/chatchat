// backend/utils/gemini.js
require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { dbGet, dbRun } = require("./asyncDb");

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  console.warn("[Gemini] GEMINI_API_KEY tidak diset — semua panggilan akan gagal.");
} else if (!API_KEY.startsWith("AIza")) {
  console.warn(
    `[Gemini] GEMINI_API_KEY diawali "${API_KEY.slice(0, 3)}", bukan "AIza". ` +
      "Token sementara (ephemeral) akan kedaluwarsa; pakai API key dari Google AI Studio."
  );
}

const genAI = new GoogleGenerativeAI(API_KEY);

// primary model first, then fallbacks used when Google reports the model as overloaded
const MODELS = [
  process.env.GEMINI_MODEL || "gemini-2.5-flash",
  ...(process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
].filter((m, i, all) => all.indexOf(m) === i);

const RETRY_STATUSES = [429, 500, 502, 503, 504];
const RETRIES_PER_MODEL = 2;
const RETRY_DELAY_MS = 800;

const RATE_LIMIT = parseInt(process.env.GEMINI_RATE_LIMIT_PER_MINUTE) || 60;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRateLimitRecord = async () => {
  const record = await dbGet("SELECT * FROM gemini_rate_limit WHERE id = 1");
  return record;
};

const isRateLimited = async () => {
  const record = await getRateLimitRecord();
  if (!record) return false;

  const now = new Date();
  const resetAt = new Date(record.reset_at);

  if (now > resetAt) {
    await dbRun(
      "UPDATE gemini_rate_limit SET api_calls = 1, reset_at = $1, updated_at = NOW() WHERE id = 1",
      [new Date(now.getTime() + 60000)]
    );
    return false;
  }

  if (record.api_calls >= RATE_LIMIT) return true;

  await dbRun(
    "UPDATE gemini_rate_limit SET api_calls = api_calls + 1, updated_at = NOW() WHERE id = 1"
  );
  return false;
};

const buildPrompt = (userInput, topMatches) => {
  const context = topMatches
    .map((m, i) => `Q${i + 1}: ${m.question}\nA${i + 1}: ${m.response}`)
    .join("\n\n");

  return `Kamu adalah asisten chatbot mentoring mahasiswa baru UMN yang helpful dan ramah.
Gunakan referensi berikut untuk menjawab pertanyaan user. Jawab dalam Bahasa Indonesia yang natural dan sopan.
Jika pertanyaan tidak relevan dengan referensi yang diberikan, katakan bahwa kamu belum memiliki informasi tersebut.
Jangan mengarang informasi di luar referensi yang diberikan.

REFERENSI:
${context}

PERTANYAAN USER: ${userInput}

JAWABAN:`;
};

const callGemini = async (userInput, topMatches) => {
  const limited = await isRateLimited();
  if (limited) {
    return {
      response: "Maaf, asisten sedang sibuk. Silakan coba beberapa saat lagi.",
      rateLimited: true,
    };
  }

  const prompt = buildPrompt(userInput, topMatches);
  let lastError;

  for (const name of MODELS) {
    const model = genAI.getGenerativeModel({ model: name });

    for (let attempt = 0; attempt <= RETRIES_PER_MODEL; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();
        if (name !== MODELS[0]) console.warn(`[Gemini] fallback model used: ${name}`);
        return { response: text, rateLimited: false, model: name };
      } catch (err) {
        lastError = err;
        if (!RETRY_STATUSES.includes(err.status)) break;
        console.warn(`[Gemini] ${name} returned ${err.status}, attempt ${attempt + 1}`);
        if (attempt < RETRIES_PER_MODEL) await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  throw lastError;
};

module.exports = { callGemini };