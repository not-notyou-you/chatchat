// backend/utils/nlp.js
// sastrawijs leaves debug console.log calls in its stemmer; mute them while it runs
const silenced = (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
  }
};

const Sastrawi = silenced(() => require("sastrawijs"));

const stemmer = silenced(() => new Sastrawi.Stemmer());

// Kata sapaan/pengisi yang tidak membawa makna pertanyaan. Dibuang agar
// kalimat panjang tidak dihukum oleh penyebut skor.
const STOPWORDS = new Set([
  "yang", "yg", "dan", "atau", "itu", "ini", "sih", "dong", "ya", "yaa", "deh",
  "kok", "nih", "loh", "lho", "kan", "aja", "saja", "juga", "pun", "tuh",
  "kak", "kakak", "min", "admin", "bang", "bu", "pak", "mas", "mbak",
  "halo", "hai", "permisi", "maaf", "tolong", "mohon", "terima", "kasih",
  "saya", "aku", "gua", "gue", "ane", "kami", "anda", "kamu", "kalian",
  "di", "ke", "dari", "pada", "untuk", "dengan", "adalah", "ada",
  "nya", "the", "a", "an",
]);

// Levenshtein tidak bisa menjembatani kata yang ejaannya jauh tapi maknanya sama
// (gimana vs bagaimana), jadi disamakan lebih dulu di sini.
const SYNONYMS = new Map(Object.entries({
  gimana: "bagaimana", gmn: "bagaimana", bgmn: "bagaimana", gmna: "bagaimana",
  caranya: "cara", carany: "cara",
  brp: "berapa", brapa: "berapa", berapakah: "berapa",
  kpn: "kapan", kapankah: "kapan",
  dmn: "dimana", dmna: "dimana", mana: "dimana",
  knp: "kenapa", kenapakah: "kenapa", mengapa: "kenapa", napa: "kenapa",
  apakah: "apa", apaan: "apa", ap: "apa",
  ga: "tidak", gak: "tidak", nggak: "tidak", enggak: "tidak", tak: "tidak",
  gk: "tidak", ndak: "tidak", tdk: "tidak",
  bisa: "dapat", bs: "dapat", boleh: "dapat",
  syarat: "persyaratan", syaratnya: "persyaratan",
  daftar: "pendaftaran", mendaftar: "pendaftaran", regist: "pendaftaran",
  registrasi: "pendaftaran", daftarin: "pendaftaran",
  bayar: "pembayaran", byr: "pembayaran", membayar: "pembayaran",
  bayaran: "pembayaran", biaya: "pembayaran", tagihan: "pembayaran",
  kul: "kuliah", kulyah: "kuliah",
  dosen: "dosen", dsn: "dosen",
  jdwl: "jadwal", jadwalnya: "jadwal",
  skripsi: "skripsi", skrispi: "skripsi",
  smt: "semester", semesteran: "semester",
  info: "informasi", infonya: "informasi",
  n: "dan", utk: "untuk", dgn: "dengan", yg: "yang", sy: "saya",
}));

const normalizeWord = (word) => SYNONYMS.get(word) ?? word;

// Kata pendek terlalu berisiko untuk fuzzy: "ada" vs "apa" hanya beda 1 huruf
// tapi maknanya berbeda total.
const MIN_FUZZY_LENGTH = 4;

// Damerau-Levenshtein: huruf tertukar ("kulaih" / "kuliah") dihitung 1 langkah,
// bukan 2 seperti Levenshtein biasa. Salah ketik semacam itu sangat umum.
const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prevPrev = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const curr = new Array(b.length + 1);
    curr[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j], prevPrev[j - 2] + 1);
      }
    }

    prevPrev = prev;
    prev = curr;
  }

  return prev[b.length];
};

// 1 untuk kata identik, 0 untuk kata yang dianggap tidak cocok sama sekali.
const wordSimilarity = (a, b) => {
  if (a === b) return 1;

  const shorter = Math.min(a.length, b.length);
  if (shorter < MIN_FUZZY_LENGTH) return 0;

  // Batasi jumlah salah ketik yang ditoleransi menurut panjang kata.
  const maxDistance = shorter >= 8 ? 2 : 1;
  if (Math.abs(a.length - b.length) > maxDistance) return 0;

  // Pada kata pendek, satu huruf yang ditukar biasanya kata lain sama sekali
  // ("makan"/"makin", "pagi"/"padi"). Huruf kurang/lebih dan huruf tertukar
  // tetap ditoleransi karena itu pola salah ketik yang sesungguhnya.
  if (shorter < 6 && a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    if (diff === 1) return 0;
  }

  const distance = levenshtein(a, b);
  if (distance > maxDistance) return 0;

  // Bobot < 1 supaya kecocokan persis selalu menang saat memilih pasangan.
  return 1 - distance / Math.max(a.length, b.length);
};

const tokenCache = new Map();

const tokenize = (text) => {
  const cached = tokenCache.get(text);
  if (cached) return cached;

  const cleaned = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");

  const stemmed = silenced(() => stemmer.stem(cleaned));

  const tokens = stemmed
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeWord)
    .filter((w) => !STOPWORDS.has(w));

  // Jangan sampai kalimat yang seluruhnya stopword ("halo kak") jadi kosong
  // dan otomatis berskor 0 terhadap apa pun.
  const result = tokens.length ? tokens : stemmed.split(/\s+/).filter(Boolean);

  if (tokenCache.size < 5000) tokenCache.set(text, result);
  return result;
};

// Bobot IDF: kata yang muncul di hampir semua pertanyaan ("apa", "cara",
// "bagaimana") nyaris tidak membedakan apa pun, jadi tidak boleh dihitung
// sekuat kata kunci khas ("mentoring", "wisuda", "ukt"). Tanpa ini, "apa itu
// mentoring" bisa berskor tinggi terhadap "apakah mentoring memorable".
let idf = null;

const buildIdf = (questions) => {
  const df = new Map();
  const total = questions.length;

  for (const q of questions) {
    for (const token of new Set(tokenize(q))) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }

  idf = { df, total };
};

const weightOf = (token) => {
  if (!idf || !idf.total) return 1;
  const df = idf.df.get(token) ?? 0;
  return Math.log(1 + idf.total / (1 + df));
};

const sumWeights = (tokens) => tokens.reduce((acc, t) => acc + weightOf(t), 0);

// Setiap token hanya boleh dipasangkan sekali, supaya skor tidak menggelembung
// ketika sebuah kata mirip dengan beberapa kata sekaligus.
const matchScore = (tokA, tokB) => {
  const used = new Array(tokB.length).fill(false);
  let total = 0;

  for (const a of tokA) {
    let bestIdx = -1;
    let bestSim = 0;

    for (let j = 0; j < tokB.length; j++) {
      if (used[j]) continue;
      const sim = wordSimilarity(a, tokB[j]);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = j;
      }
      if (bestSim === 1) break;
    }

    if (bestIdx !== -1) {
      used[bestIdx] = true;
      total += bestSim * ((weightOf(a) + weightOf(tokB[bestIdx])) / 2);
    }
  }

  return total;
};

// Dice coefficient berbobot: lebih toleran terhadap selisih panjang kalimat
// dibanding pembagian dengan panjang terpanjang.
const similarity = (a, b) => {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (!tokA.length || !tokB.length) return 0;

  const denom = sumWeights(tokA) + sumWeights(tokB);
  if (!denom) return 0;

  return (2 * matchScore(tokA, tokB)) / denom;
};

const findTopMatches = (input, rows, topN = 5) => {
  return rows
    .map((row) => ({
      ...row,
      score: similarity(input, row.question || ""),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
};

module.exports = { similarity, findTopMatches, buildIdf, tokenize, wordSimilarity, levenshtein };
