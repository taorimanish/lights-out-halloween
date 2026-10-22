// =============================================================
// Lights Out! — Barron's Halloween Challenge
// Configuration
//
// 1) Create a free project at https://supabase.com
// 2) Run supabase-setup.sql in the SQL Editor
// 3) Dashboard -> Settings -> API, copy the two values below:
//      - Project URL   (e.g. https://abcdefgh.supabase.co)
//      - anon public key (safe to ship in the browser; respects RLS)
// 4) Paste them here and save.
//
// The game still runs WITHOUT these values — it just falls back to a
// local-only leaderboard (this browser only). Fill them in to enable
// the shared, hosted leaderboard.
// =============================================================

window.LIGHTS_OUT_CONFIG = {
  // Barron email domain that qualifies for the shared leaderboard.
  QUALIFYING_DOMAIN: "@barronltg.com",

  // --- Supabase (hosted DB) ---
  SUPABASE_URL: "https://opakrjkllayrlawcwqdt.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wYWtyamtsbGF5cmxhd2N3cWR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTI0MzYsImV4cCI6MjEwODI2ODQzNn0.PULazQT7rJo-TSbdRnJFQUXDk_sKrCYGGptLphZYkEM",

  // Game tuning (seconds)
  GAME_DURATION_SEC: 45,
};
