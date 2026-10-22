-- =============================================================
-- Lights Out! — Barron's Halloween Challenge
-- Supabase schema + Row Level Security setup
-- Run this ONCE in your Supabase project:
--   Dashboard -> SQL Editor -> New query -> paste -> Run
-- =============================================================

-- ---- Table -------------------------------------------------
-- Append-only table of every qualifying submission.
-- We never update/delete from the browser; "personal best" and
-- ranking are computed client-side from all rows.
create table if not exists public.scores (
  id             uuid primary key default gen_random_uuid(),
  player_name    text        not null,
  email          text        not null,
  points         integer     not null,
  correct_clicks integer     not null,
  total_clicks   integer     not null,
  accuracy       double precision not null,         -- correct / total (0..1)
  avg_reaction_ms double precision not null,         -- average reaction time (ms)
  final10_hits   integer     not null,               -- successful hits in final 10s
  submitted_at   timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- Helpful index for leaderboard reads (fast first-pass ordering).
create index if not exists scores_rank_idx
  on public.scores (points desc, accuracy desc, avg_reaction_ms asc, final10_hits desc, submitted_at asc, id asc);

-- ---- Row Level Security ------------------------------------
alter table public.scores enable row level security;

-- Anyone (anon) may READ the leaderboard.
drop policy if exists "public read scores" on public.scores;
create policy "public read scores"
  on public.scores
  for select
  to anon, authenticated
  using (true);

-- Anyone (anon) may INSERT a new score, but only for the
-- Barron domain and only sane, bounded values. This is a light
-- guard, not a full anti-cheat system (we award Lumens manually).
drop policy if exists "public insert barron scores" on public.scores;
create policy "public insert barron scores"
  on public.scores
  for insert
  to anon, authenticated
  with check (
    -- Case-insensitive + whitespace-tolerant so mobile auto-capitalized
    -- emails (e.g. "@Barronltg.com") are still accepted.
    lower(btrim(email)) like '%@barronltg.com'
    and char_length(player_name) between 1 and 80
    and total_clicks >= 0
    and correct_clicks >= 0
    and correct_clicks <= total_clicks
    and accuracy >= 0 and accuracy <= 1
    and avg_reaction_ms >= 0 and avg_reaction_ms <= 60000
    and final10_hits >= 0
    and points >= -100000 and points <= 1000000
  );

-- NOTE: No UPDATE or DELETE policies exist, so the browser (anon)
-- cannot modify or remove rows. The table is effectively append-only.
