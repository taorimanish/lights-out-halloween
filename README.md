# Lights Out! — Barron's Halloween Challenge 🎃⚡

A challenging **45-second reaction game** for a one-day office event at Barron Lighting Group.
Static frontend (plain HTML/CSS/JS) + a **hosted Supabase** database for the shared leaderboard.
No server to run, no login, no passwords.

---

## What it does

- Welcome → Instructions → Game → Results → Play Again → Leaderboard.
- Captures a player's **name + email** once and remembers them for instant replay.
- Anyone can play unlimited times.
- Only **`@barronltg.com`** emails appear on the shared leaderboard; each qualifying email keeps its **single best** performance.
- Haunted lighting-control-panel theme: glowing bulbs, pumpkins, cobwebs. Mouse + touch.

### Scoring
| Target | Symbol | Points |
|---|---|---|
| Yellow bulb | ☀ | +100 |
| Pumpkin bulb | 🎃 | +250 |
| Haunted bulb (decoy) | 💀 | −100 |
| Empty socket (clicked) | · | −10 |

- **Speed bonus** 0–99 per correct hit, based on % of the bulb's visible time remaining.
- **+50** every 5 consecutive correct hits. Wrong clicks or missed scoring bulbs reset the streak.
- Each bulb scores only once.

### Difficulty ramp
| Time | Visible | Max active |
|---|---|---|
| 0–10s | ~1300 ms | 2 |
| 10–25s | ~950 ms | 3 |
| 25–35s | ~800 ms | 3 |
| 35–45s | ~650 ms | 3 (more red decoys) |

> Tuned for an **easier, more forgiving** experience: longer visible times, fewer
> simultaneous targets, fewer red decoys, softer penalties, and a gentler speed-bonus curve.

### Unique leaderboard ordering (no shared ranks)
Performances are ranked strictly by, in order:
1. Higher total points
2. Higher accuracy (correct ÷ all clicks)
3. Faster average reaction time (ms)
4. More hits in the final 10 seconds
5. Earlier submission timestamp
6. Unique submission id (deterministic final tie-breaker)

Because the last key is a unique id, every performance gets a **distinct** rank. The same rules pick each email's personal best. The leaderboard shows **names, never emails**.

---

## Setup (≈5 minutes)

### 1. Create the hosted database (Supabase — free)
1. Go to <https://supabase.com> and create a free project.
2. Open **SQL Editor → New query**, paste the contents of [`supabase-setup.sql`](./supabase-setup.sql), and **Run**.
   This creates the `scores` table and Row Level Security policies:
   - public **read** (leaderboard is visible to all),
   - public **insert** limited to `@barronltg.com` with sane value bounds,
   - **no** update/delete from the browser (table is append-only).

### 2. Add your keys
In **Dashboard → Settings → API**, copy your **Project URL** and **anon public key**, then paste them into
[`config.js`](./config.js):

```js
SUPABASE_URL:      "https://YOUR-PROJECT.supabase.co",
SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
```

> The anon key is **safe to ship in the browser** — access is controlled by the RLS policies above, not by hiding the key.
> If you leave these blank, the game still runs in **local mode** (leaderboard stored only in that one browser) — handy for testing.

### 3. Run it
It's just static files at the repo root. Any of these works:

```bash
# Option A: quick local preview
npm start            # serves the site at http://localhost:3000

# Option B: open directly
# open index.html in a browser (local mode is fine without keys)
```

### 4. Deploy (pick one)
Host the site files on any static host:
- **GitHub Pages:** Settings → Pages → Deploy from a branch → `main` / `/ (root)`.
- **Netlify / Vercel / Cloudflare Pages:** connect the repo (publish directory = root).

Share the URL with the office. Done. 🎉

---

## Notes
- No admin dashboard, no complex anti-cheat, no reward integration — **Lumens are awarded manually.**
- The RLS insert check and value bounds are a light guard, not a full anti-cheat system.
- Positions are randomized every attempt, but each attempt gets an equivalent spawn budget and type mix per phase, so difficulty and scoring opportunity stay comparable.

## File map
```
lights-out/
├── index.html           # all 5 screens
├── styles.css           # haunted control-panel theme
├── config.js            # YOUR Supabase URL + anon key + domain
├── leaderboard.js       # ranking rules + Supabase/local store
├── game.js              # game engine (spawn, scoring, difficulty, timing)
├── app.js               # screen flow, player memory, submit + render
├── supabase-setup.sql   # run once in Supabase
├── package.json
└── README.md
```
