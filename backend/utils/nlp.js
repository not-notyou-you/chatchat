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

const tokenize = (text) =>
  silenced(() => stemmer.stem(text.toLowerCase()))
    .split(" ")
    .filter(Boolean);

const similarity = (a, b) => {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (!tokA.length || !tokB.length) return 0;
  const setB = new Set(tokB);
  const matches = tokA.filter((w) => setB.has(w)).length;
  return matches / Math.max(tokA.length, tokB.length);
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

module.exports = { similarity, findTopMatches };