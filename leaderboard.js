// =============================================================
// Lights Out! — Ranking + Leaderboard data layer
//
// Implements the EXACT deterministic ordering from the spec:
//   1. Higher total points
//   2. Higher accuracy (correct / all clicks)
//   3. Faster average reaction time (ms precision)
//   4. More successful hits in the final 10 seconds
//   5. Earlier submission timestamp
//   6. Unique submission id (final deterministic tie-breaker)
//
// No shared ranks are ever produced: because rule 6 is a unique id,
// the comparator is a strict total order -> every performance gets a
// distinct rank.
//
// This same comparator selects each email's personal best.
// =============================================================

(function () {
  "use strict";

  const CFG = window.LIGHTS_OUT_CONFIG || {};
  const DOMAIN = (CFG.QUALIFYING_DOMAIN || "@barronltg.com").toLowerCase();

  // ---- Core comparator ---------------------------------------
  // Returns < 0 if A ranks ABOVE B (A is "better"), > 0 if below.
  // Sorting ascending with this puts the best performance first.
  function compareScores(a, b) {
    // 1. Higher total points first
    if (a.points !== b.points) return b.points - a.points;

    // 2. Higher accuracy first
    if (a.accuracy !== b.accuracy) return b.accuracy - a.accuracy;

    // 3. Faster (lower) average reaction time first
    if (a.avg_reaction_ms !== b.avg_reaction_ms) {
      return a.avg_reaction_ms - b.avg_reaction_ms;
    }

    // 4. More final-10-second hits first
    if (a.final10_hits !== b.final10_hits) {
      return b.final10_hits - a.final10_hits;
    }

    // 5. Earlier submission timestamp first
    const ta = new Date(a.submitted_at).getTime();
    const tb = new Date(b.submitted_at).getTime();
    if (ta !== tb) return ta - tb;

    // 6. Unique submission id — deterministic final tie-breaker
    //    (string compare gives a stable, total ordering)
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  }

  function isQualifying(email) {
    return typeof email === "string" &&
      email.trim().toLowerCase().endsWith(DOMAIN);
  }

  // ---- Reduce many submissions to one "best per email" --------
  function bestPerEmail(rows) {
    const byEmail = new Map();
    for (const r of rows) {
      const key = (r.email || "").trim().toLowerCase();
      const existing = byEmail.get(key);
      if (!existing || compareScores(r, existing) < 0) {
        byEmail.set(key, r);
      }
    }
    return Array.from(byEmail.values());
  }

  // ---- Build the ranked, unique-position leaderboard ----------
  // Input: raw submission rows. Output: sorted best-per-email with a
  // unique `rank` (1-based, strictly increasing, never shared).
  function buildLeaderboard(rows) {
    const best = bestPerEmail(rows.filter((r) => isQualifying(r.email)));
    best.sort(compareScores);
    return best.map((row, i) => Object.assign({}, row, { rank: i + 1 }));
  }

  // Count how many times each qualifying email has played
  // (one submitted row = one completed play). Returns a Map keyed by
  // lowercased email -> integer count.
  function playCounts(rows) {
    const counts = new Map();
    for (const r of rows) {
      if (!isQualifying(r.email)) continue;
      const key = (r.email || "").trim().toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  // Find a specific email's unique rank within the full leaderboard.
  function findRank(leaderboard, email) {
    const key = (email || "").trim().toLowerCase();
    const entry = leaderboard.find(
      (r) => (r.email || "").trim().toLowerCase() === key
    );
    return entry ? entry.rank : null;
  }

  // ---- Supabase-backed store with local fallback --------------
  const store = {
    client: null,
    usingSupabase: false,

    init() {
      const url = CFG.SUPABASE_URL;
      const key = CFG.SUPABASE_ANON_KEY;
      if (url && key && window.supabase && window.supabase.createClient) {
        try {
          this.client = window.supabase.createClient(url, key);
          this.usingSupabase = true;
        } catch (e) {
          console.warn("Supabase init failed, using local store.", e);
          this.usingSupabase = false;
        }
      }
      return this.usingSupabase;
    },

    // Insert one submission (append-only). Returns the stored row.
    async submit(record) {
      if (this.usingSupabase) {
        const { data, error } = await this.client
          .from("scores")
          .insert(record)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      // Local fallback (this browser only)
      const row = Object.assign(
        { id: cryptoRandomId(), submitted_at: new Date().toISOString() },
        record
      );
      const all = this._localAll();
      all.push(row);
      localStorage.setItem("lo_scores", JSON.stringify(all));
      return row;
    },

    // Fetch all submissions for leaderboard computation.
    async fetchAll() {
      if (this.usingSupabase) {
        const { data, error } = await this.client
          .from("scores")
          .select("*");
        if (error) throw error;
        return data || [];
      }
      return this._localAll();
    },

    _localAll() {
      try {
        return JSON.parse(localStorage.getItem("lo_scores") || "[]");
      } catch {
        return [];
      }
    },
  };

  function cryptoRandomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "local-" + Math.random().toString(36).slice(2) + Date.now();
  }

  // ---- Export -------------------------------------------------
  window.LO_LEADERBOARD = {
    compareScores,
    isQualifying,
    bestPerEmail,
    buildLeaderboard,
    playCounts,
    findRank,
    store,
    cryptoRandomId,
  };
})();
