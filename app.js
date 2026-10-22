// =============================================================
// Lights Out! — App controller
// Wires screens together, captures/remembers the player, runs a game,
// submits qualifying scores, and renders the shared leaderboard.
// =============================================================

(function () {
  "use strict";

  const CFG = window.LIGHTS_OUT_CONFIG || {};
  const LB = window.LO_LEADERBOARD;
  const DOMAIN = (CFG.QUALIFYING_DOMAIN || "@barronltg.com").toLowerCase();

  // ---- Screen management -------------------------------------
  const screens = {
    welcome: document.getElementById("screen-welcome"),
    instructions: document.getElementById("screen-instructions"),
    game: document.getElementById("screen-game"),
    results: document.getElementById("screen-results"),
    leaderboard: document.getElementById("screen-leaderboard"),
  };

  function show(name) {
    for (const k of Object.keys(screens)) {
      screens[k].classList.toggle("active", k === name);
    }
    window.scrollTo(0, 0);
  }

  // ---- Remember the player (easy replay) ----------------------
  const PLAYER_KEY = "lo_player";
  function savePlayer(p) {
    try { localStorage.setItem(PLAYER_KEY, JSON.stringify(p)); } catch {}
  }
  function loadPlayer() {
    try { return JSON.parse(localStorage.getItem(PLAYER_KEY) || "null"); }
    catch { return null; }
  }

  let player = loadPlayer() || { name: "", email: "" };

  // ---- Local plays counter (per email, this browser) ----------
  // Counts completed games so every player — even non-qualifying ones —
  // sees how many times they've played. Qualifying players also get an
  // authoritative count from the shared DB on the leaderboard.
  const PLAYS_KEY = "lo_plays";
  function loadPlays() {
    try { return JSON.parse(localStorage.getItem(PLAYS_KEY) || "{}"); }
    catch { return {}; }
  }
  function bumpPlays(email) {
    const key = (email || "").trim().toLowerCase();
    const all = loadPlays();
    all[key] = (all[key] || 0) + 1;
    try { localStorage.setItem(PLAYS_KEY, JSON.stringify(all)); } catch {}
    return all[key];
  }

  // ---- Elements ----------------------------------------------
  const nameInput = document.getElementById("inp-name");
  const emailInput = document.getElementById("inp-email");
  const formError = document.getElementById("form-error");
  const qualifyNote = document.getElementById("qualify-note");

  nameInput.value = player.name || "";
  emailInput.value = player.email || "";

  // Live hint about leaderboard qualification.
  function updateQualifyNote() {
    const email = emailInput.value.trim().toLowerCase();
    if (!email) { qualifyNote.textContent = ""; return; }
    if (LB.isQualifying(email)) {
      qualifyNote.textContent = "✓ This email qualifies for the shared leaderboard.";
      qualifyNote.className = "note ok";
    } else {
      qualifyNote.textContent =
        "This email can play, but only " + DOMAIN + " emails appear on the shared leaderboard.";
      qualifyNote.className = "note warn";
    }
  }
  emailInput.addEventListener("input", updateQualifyNote);
  updateQualifyNote();

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  // ---- HUD refs ----------------------------------------------
  const hud = {
    score: document.getElementById("hud-score"),
    time: document.getElementById("hud-time"),
    streak: document.getElementById("hud-streak"),
    accuracy: document.getElementById("hud-accuracy"),
  };

  const gridEl = document.getElementById("grid");
  let game = new window.LO_GAME.Game(gridEl, hud, onGameEnd);
  let lastResult = null;

  // ---- Countdown then start ----------------------------------
  let countdownTimer = null;
  let goTimer = null;

  function startGameFlow() {
    hideQuitConfirm();
    show("game");
    const overlay = document.getElementById("countdown");
    overlay.classList.add("show");
    let n = 3;
    overlay.textContent = n;
    countdownTimer = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        overlay.textContent = "GO!";
        goTimer = setTimeout(() => {
          overlay.classList.remove("show");
          game.start();
        }, 450);
      } else {
        overlay.textContent = n;
      }
    }, 700);
  }

  // Fully stop a round/countdown without saving (used by "Menu").
  function abortGame() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (goTimer) { clearTimeout(goTimer); goTimer = null; }
    game.stop();
    const overlay = document.getElementById("countdown");
    if (overlay) overlay.classList.remove("show");
    hideQuitConfirm();
  }

  // ---- Quit / back-to-menu confirm ---------------------------
  function showQuitConfirm() {
    const el = document.getElementById("quit-confirm");
    if (el) el.classList.add("show");
  }
  function hideQuitConfirm() {
    const el = document.getElementById("quit-confirm");
    if (el) el.classList.remove("show");
  }

  // ---- Game end -> compute, submit, show results --------------
  async function onGameEnd(result) {
    lastResult = result;

    // A completed game counts as one play for this player.
    const myPlays = bumpPlays(player.email);
    const attemptEl = document.getElementById("res-attempt");
    if (attemptEl) {
      attemptEl.textContent =
        "Attempt #" + myPlays + (myPlays === 1 ? " — welcome!" : "");
    }

    // Fill results screen.
    document.getElementById("res-points").textContent = result.points;
    document.getElementById("res-accuracy").textContent =
      Math.round(result.accuracy * 100) + "%";
    document.getElementById("res-reaction").textContent =
      result.avgReactionMs ? result.avgReactionMs.toFixed(1) + " ms" : "—";
    document.getElementById("res-final10").textContent = result.final10Hits;
    document.getElementById("res-hits").textContent =
      result.correctClicks + " / " + result.totalClicks;

    const rankLine = document.getElementById("res-rank");
    const qualifies = LB.isQualifying(player.email);

    show("results");

    if (!qualifies) {
      rankLine.innerHTML =
        "<span class='warn'>Not on the shared leaderboard — " +
        DOMAIN + " emails only. Your score still counted for fun!</span>";
      return;
    }

    rankLine.textContent = "Saving your score…";

    const record = {
      player_name: player.name,
      email: player.email,
      points: result.points,
      correct_clicks: result.correctClicks,
      total_clicks: result.totalClicks,
      accuracy: result.accuracy,
      avg_reaction_ms: result.avgReactionMs,
      final10_hits: result.final10Hits,
      submitted_at: new Date().toISOString(),
    };

    try {
      await LB.store.submit(record);
      const rows = await LB.store.fetchAll();
      const board = LB.buildLeaderboard(rows);
      const rank = LB.findRank(board, player.email);
      rankLine.innerHTML =
        "Your unique leaderboard rank: <strong>#" + rank + "</strong>" +
        " of " + board.length + " players";
    } catch (e) {
      console.error(e);
      rankLine.innerHTML =
        "<span class='warn'>Couldn't reach the leaderboard. Your score is saved locally.</span>";
    }
  }

  // ---- Render leaderboard ------------------------------------
  async function renderLeaderboard() {
    const body = document.getElementById("lb-body");
    const status = document.getElementById("lb-status");
    body.innerHTML = "";
    status.textContent = "Loading…";

    try {
      const rows = await LB.store.fetchAll();
      const board = LB.buildLeaderboard(rows);
      const plays = LB.playCounts(rows);

      if (!board.length) {
        status.textContent = "No qualifying scores yet. Be the first!";
        return;
      }
      status.textContent = LB.store.usingSupabase
        ? "Shared leaderboard — " + board.length + " players"
        : "Local leaderboard (this browser) — add Supabase keys for shared play";

      const myKey = (player.email || "").trim().toLowerCase();

      for (const r of board) {
        const tr = document.createElement("tr");
        if ((r.email || "").trim().toLowerCase() === myKey) {
          tr.className = "me";
        }
        const key = (r.email || "").trim().toLowerCase();
        const nPlays = plays.get(key) || 1;
        tr.innerHTML =
          "<td>#" + r.rank + "</td>" +
          "<td>" + escapeHtml(r.player_name) + "</td>" +
          "<td>" + r.points + "</td>" +
          "<td>" + Math.round(r.accuracy * 100) + "%</td>" +
          "<td>" + (r.avg_reaction_ms ? r.avg_reaction_ms.toFixed(1) + " ms" : "—") + "</td>" +
          "<td>" + nPlays + "</td>";
        body.appendChild(tr);
      }
    } catch (e) {
      console.error(e);
      status.textContent = "Couldn't load the leaderboard.";
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---- Button wiring -----------------------------------------
  document.getElementById("btn-play").addEventListener("click", () => {
    formError.textContent = "";
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    if (!name) { formError.textContent = "Please enter your name."; return; }
    if (!validEmail(email)) { formError.textContent = "Please enter a valid email."; return; }
    player = { name, email };
    savePlayer(player);
    show("instructions");
  });

  // In-game "Menu" button -> confirm, then abort to welcome.
  document.getElementById("btn-quit").addEventListener("click", showQuitConfirm);
  document.getElementById("btn-quit-no").addEventListener("click", hideQuitConfirm);
  document.getElementById("btn-quit-yes").addEventListener("click", () => {
    abortGame();
    show("welcome");
  });

  document.getElementById("btn-how").addEventListener("click", () => show("instructions"));
  document.getElementById("btn-start").addEventListener("click", startGameFlow);
  document.getElementById("btn-back-welcome").addEventListener("click", () => show("welcome"));

  document.getElementById("btn-play-again").addEventListener("click", () => {
    // Remembered player -> instant replay.
    startGameFlow();
  });
  document.getElementById("btn-view-lb").addEventListener("click", () => {
    show("leaderboard");
    renderLeaderboard();
  });
  document.getElementById("btn-lb-again").addEventListener("click", startGameFlow);
  document.getElementById("btn-lb-home").addEventListener("click", () => show("welcome"));
  document.getElementById("btn-welcome-lb").addEventListener("click", () => {
    show("leaderboard");
    renderLeaderboard();
  });

  document.getElementById("btn-change-player").addEventListener("click", () => {
    show("welcome");
  });

  // ---- Boot --------------------------------------------------
  const usingSupabase = LB.store.init();
  const modeBadge = document.getElementById("mode-badge");
  if (modeBadge) {
    modeBadge.textContent = usingSupabase ? "Shared leaderboard: ON" : "Local mode (set Supabase keys)";
    modeBadge.className = "mode-badge " + (usingSupabase ? "on" : "off");
  }

  // Greet a remembered player.
  if (player.name) {
    const greet = document.getElementById("welcome-greet");
    if (greet) greet.textContent = "Welcome back, " + player.name + "!";
  }

  show("welcome");
})();
