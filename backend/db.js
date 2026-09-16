// backend/db.js
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

// warm up the pool, but keep serving: a slow first connect must not kill the process
pool.connect((err, client, release) => {
  if (err) {
    console.error("Initial database connection failed:", err.message);
    return;
  }
  release();
  console.log("Connected to Supabase PostgreSQL");
});

module.exports = pool;