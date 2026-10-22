// =============================================================
// Lights Out! — Game engine
//
// 45-second reaction game on a 4x4 grid. Players click/tap lit bulbs
// before they vanish.
//
// Scoring:
//   Yellow bulb (☀)        : +100
//   Orange pumpkin (🎃)    : +250
//   Red haunted (💀)       : -200   (decoy — DON'T click)
//   Click an unlit cell    : -25
//   Every 5 consecutive correct hits : +50 bonus
//   Speed bonus 0..99 per correct hit, by % of visible time remaining
//   Each bulb scores only once
//   Wrong click OR a missed *scoring* bulb resets the streak
//
// Difficulty by elapsed time:
//   0-10s : ~1000ms visible, up to 2 active
//   10-25s: ~700ms,  up to 3 active
//   25-35s: ~450ms,  up to 4 active
//   35-45s: ~300ms,  up to 5 active, more red decoys
//
// Positions are randomized but each attempt gets an equivalent spawn
// budget / type mix per phase, so difficulty & scoring opportunity are
// comparable across attempts.
// =============================================================

(function () {
  "use strict";

  const GRID = 16; // 4x4

  // Bulb type definitions
  const TYPES = {
    yellow:  { points: 100,  symbol: "☀",  cls: "bulb-yellow",  scoring: true,  label: "Yellow bulb" },
    pumpkin: { points: 250,  symbol: "🎃", cls: "bulb-pumpkin", scoring: true,  label: "Pumpkin bulb" },
    red:     { points: -100, symbol: "💀", cls: "bulb-red",     scoring: false, label: "Haunted bulb" },
  };

  // Phase config: [startSec, endSec, visibleMs, maxActive, weights]
  // weights decide the chance of each spawned bulb's type.
  // Easier tuning: longer visible times, fewer simultaneous targets,
  // and fewer red decoys than the original challenge settings.
  const PHASES = [
    { start: 0,  end: 10, visibleMs: 1300, maxActive: 2, w: { yellow: 0.65, pumpkin: 0.27, red: 0.08 } },
    { start: 10, end: 25, visibleMs: 950,  maxActive: 3, w: { yellow: 0.62, pumpkin: 0.26, red: 0.12 } },
    // Last 20 seconds slowed further per feedback: the 25-35s and
    // 35-45s phases now stay visible noticeably longer so the back
    // half of the game doesn't feel rushed.
    { start: 25, end: 35, visibleMs: 950,  maxActive: 3, w: { yellow: 0.58, pumpkin: 0.24, red: 0.18 } },
    { start: 35, end: 45, visibleMs: 850,  maxActive: 3, w: { yellow: 0.56, pumpkin: 0.22, red: 0.22 } },
  ];

  function phaseForElapsed(sec) {
    for (const p of PHASES) if (sec >= p.start && sec < p.end) return p;
    return PHASES[PHASES.length - 1];
  }

  // Jitter a base duration by +/-10% so it "stays visible approximately".
  function jitter(ms) {
    const d = ms * 0.1;
    return Math.round(ms - d + Math.random() * 2 * d);
  }

  function weightedType(weights) {
    const r = Math.random();
    let acc = 0;
    for (const k of Object.keys(weights)) {
      acc += weights[k];
      if (r <= acc) return k;
    }
    return "yellow";
  }

  // ---- Game class --------------------------------------------
  class Game {
    constructor(gridEl, hud, onEnd) {
      this.gridEl = gridEl;
      this.hud = hud;              // { score, time, streak, accuracy }
      this.onEnd = onEnd;
      this.cells = [];            // 16 cell DOM elements
      this.active = new Map();    // cellIndex -> bulb state
      this.running = false;
      this._buildGrid();
    }

    _buildGrid() {
      this.gridEl.innerHTML = "";
      this.cells = [];
      for (let i = 0; i < GRID; i++) {
        const cell = document.createElement("button");
        cell.className = "cell";
        cell.type = "button";
        cell.setAttribute("aria-label", "empty socket");
        cell.dataset.index = String(i);
        // Pointer events support both mouse and touch.
        cell.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          this._handleClick(i);
        });
        this.gridEl.appendChild(cell);
        this.cells.push(cell);
      }
    }

    start() {
      // Reset state
      this.running = true;
      this.startTime = performance.now();
      this.duration = (window.LIGHTS_OUT_CONFIG?.GAME_DURATION_SEC || 45) * 1000;

      this.points = 0;
      this.correctClicks = 0;
      this.totalClicks = 0;
      this.streak = 0;
      this.reactionTimes = [];   // ms, for correct hits
      this.final10Hits = 0;
      this.bulbSeq = 0;

      this.active.clear();
      for (const c of this.cells) this._clearCell(c);

      this._updateHud();

      // Main loop via rAF for smooth timing + a spawn scheduler.
      this._lastSpawn = 0;
      this._spawnGap = 450; // ms between spawn attempts, adjusts per phase
      this._loop = this._loop.bind(this);
      this._raf = requestAnimationFrame(this._loop);
    }

    _elapsedSec() {
      return (performance.now() - this.startTime) / 1000;
    }

    _loop(now) {
      if (!this.running) return;
      const elapsedMs = performance.now() - this.startTime;

      if (elapsedMs >= this.duration) {
        this._end();
        return;
      }

      const sec = elapsedMs / 1000;
      const phase = phaseForElapsed(sec);

      // Spawn gap scales with phase: busier phases spawn faster.
      // Eased: larger factor -> slightly slower, calmer spawn pace.
      this._spawnGap = phase.visibleMs * 0.7;

      if (elapsedMs - this._lastSpawn >= this._spawnGap) {
        this._lastSpawn = elapsedMs;
        this._trySpawn(phase);
      }

      // Expire bulbs whose time is up.
      for (const [idx, b] of Array.from(this.active.entries())) {
        if (performance.now() >= b.expiresAt) {
          this._expire(idx, b);
        }
      }

      // Live HUD time (count down).
      this.hud.time.textContent = Math.max(
        0,
        Math.ceil((this.duration - elapsedMs) / 1000)
      );

      this._raf = requestAnimationFrame(this._loop);
    }

    _emptyCells() {
      const empty = [];
      for (let i = 0; i < GRID; i++) if (!this.active.has(i)) empty.push(i);
      return empty;
    }

    _trySpawn(phase) {
      if (this.active.size >= phase.maxActive) return;
      const empty = this._emptyCells();
      if (!empty.length) return;

      // Occasionally spawn two at once to create overlapping targets.
      // Eased: lower burst chance so overlaps are less frequent.
      const burst = Math.random() < 0.2 && empty.length > 1 &&
        this.active.size + 2 <= phase.maxActive ? 2 : 1;

      for (let n = 0; n < burst; n++) {
        const pool = this._emptyCells();
        if (!pool.length || this.active.size >= phase.maxActive) break;
        const idx = pool[Math.floor(Math.random() * pool.length)];
        const typeKey = weightedType(phase.w);
        this._spawn(idx, typeKey, phase.visibleMs);
      }
    }

    _spawn(idx, typeKey, baseMs) {
      const t = TYPES[typeKey];
      const cell = this.cells[idx];
      const visibleMs = jitter(baseMs);
      const bulb = {
        id: ++this.bulbSeq,
        typeKey,
        scoring: t.scoring,
        spawnedAt: performance.now(),
        visibleMs,
        expiresAt: performance.now() + visibleMs,
        scored: false,
      };
      this.active.set(idx, bulb);

      cell.classList.add("lit", t.cls);
      cell.textContent = t.symbol;
      cell.setAttribute("aria-label", t.label);
      cell.style.setProperty("--life", visibleMs + "ms");
      // Restart the shrinking life-bar animation.
      cell.classList.remove("ticking");
      void cell.offsetWidth; // reflow to retrigger animation
      cell.classList.add("ticking");
    }

    _clearCell(cell) {
      cell.className = "cell";
      cell.textContent = "";
      cell.setAttribute("aria-label", "empty socket");
      cell.style.removeProperty("--life");
    }

    _expire(idx, bulb) {
      // A *scoring* bulb that was never clicked = a miss -> reset streak.
      if (bulb.scoring && !bulb.scored) {
        this.streak = 0;
      }
      this.active.delete(idx);
      this._clearCell(this.cells[idx]);
      this._updateHud();
    }

    _handleClick(idx) {
      if (!this.running) return;
      this.totalClicks++;

      const bulb = this.active.get(idx);
      const cell = this.cells[idx];
      const inFinal10 = this._elapsedSec() >= (this.duration / 1000 - 10);

      if (!bulb) {
        // Clicked an unlit socket. (Eased penalty.)
        this.points -= 10;
        this.streak = 0;
        this._flash(cell, "miss");
        this._float(cell, "-10");
        this._updateHud();
        return;
      }

      if (bulb.scored) {
        // Each bulb scores once; extra taps count as a click but no score.
        this._updateHud();
        return;
      }

      const t = TYPES[bulb.typeKey];

      if (!t.scoring) {
        // Red haunted decoy clicked -> penalty, resets streak.
        bulb.scored = true;
        this.points += t.points; // -100 (eased)
        this.streak = 0;
        this._flash(cell, "bad");
        this._float(cell, String(t.points));
        this._consume(idx);
        this._updateHud();
        return;
      }

      // Correct hit on a scoring bulb.
      bulb.scored = true;
      this.correctClicks++;

      const reaction = performance.now() - bulb.spawnedAt;
      this.reactionTimes.push(reaction);
      if (inFinal10) this.final10Hits++;

      // Speed bonus 0..99 by % of visible time remaining.
      // Eased: a square-root curve rewards even not-lightning-fast hits
      // (e.g. 50% time left -> ~70 bonus instead of ~50), still 0..99.
      const remaining = Math.max(0, bulb.expiresAt - performance.now());
      const pct = remaining / bulb.visibleMs; // 0..1
      const speedBonus = Math.max(0, Math.min(99, Math.round(Math.sqrt(pct) * 99)));

      let gained = t.points + speedBonus;

      // Streak + every-5 bonus.
      this.streak++;
      let bonusMsg = "";
      if (this.streak % 5 === 0) {
        gained += 50;
        bonusMsg = " +50🔥";
      }

      this.points += gained;
      this._flash(cell, "good");
      this._float(cell, "+" + gained + bonusMsg);
      this._consume(idx);
      this._updateHud();
    }

    _consume(idx) {
      this.active.delete(idx);
      this._clearCell(this.cells[idx]);
    }

    _flash(cell, kind) {
      cell.classList.add("fx-" + kind);
      setTimeout(() => cell.classList.remove("fx-" + kind), 220);
    }

    _float(cell, text) {
      const f = document.createElement("span");
      f.className = "floater";
      f.textContent = text;
      cell.appendChild(f);
      setTimeout(() => f.remove(), 650);
    }

    _accuracy() {
      return this.totalClicks > 0 ? this.correctClicks / this.totalClicks : 0;
    }

    _avgReaction() {
      if (!this.reactionTimes.length) return 0;
      const sum = this.reactionTimes.reduce((a, b) => a + b, 0);
      return sum / this.reactionTimes.length;
    }

    _updateHud() {
      this.hud.score.textContent = this.points;
      this.hud.streak.textContent = this.streak;
      this.hud.accuracy.textContent =
        Math.round(this._accuracy() * 100) + "%";
    }

    _end() {
      this.running = false;
      cancelAnimationFrame(this._raf);
      // Clear any leftover lit bulbs (count unclicked scoring as misses).
      for (const [idx, b] of Array.from(this.active.entries())) {
        if (b.scoring && !b.scored) this.streak = 0;
        this._clearCell(this.cells[idx]);
      }
      this.active.clear();

      const result = {
        points: this.points,
        correctClicks: this.correctClicks,
        totalClicks: this.totalClicks,
        accuracy: this._accuracy(),
        avgReactionMs: this._avgReaction(),
        final10Hits: this.final10Hits,
      };
      this.onEnd(result);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this._raf);
    }
  }

  window.LO_GAME = { Game, TYPES };
})();
