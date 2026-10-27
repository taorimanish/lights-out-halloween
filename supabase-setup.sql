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

-- Anyone (anon) may INSERT a new score, but only for the Barron domain
-- and only PLAUSIBLE, bounded values. This is a plausibility guard that
-- rejects fabricated submissions (e.g. a hand-crafted 1,000,000-point row).
-- It is not a cryptographic anti-cheat system — Lumens are awarded manually,
-- so blatant outliers can also just be disqualified by a human.
--
-- Bounds are derived from real play data (415 legitimate rows): the best
-- genuine score was ~19,139 pts, max 77 correct hits, max 25 final-10 hits.
-- The limits below sit well above real play but far below fabricated values.
-- ---- Banned emails ----------------------------------------
-- A simple blocklist. To ban someone, insert their (lowercased) email;
-- to un-ban, delete the row. The insert policy below rejects any score
-- whose email is present here. Anon cannot read/modify this table.
create table if not exists public.banned_emails (
  email      text primary key,   -- store lowercased, no spaces
  reason     text,
  banned_at  timestamptz not null default now()
);
alter table public.banned_emails enable row level security;
-- No policies for anon/authenticated => the browser cannot read, insert,
-- update, or delete this table. Manage it from the dashboard / SQL editor.

-- Ban the known cheater.
insert into public.banned_emails (email, reason)
values ('mahdi.ghaleb@barronltg.com', 'fabricated scores')
on conflict (email) do nothing;

-- Helper that checks the banlist with elevated rights, so the insert
-- policy can consult it even though anon has NO read access to the table.
-- SECURITY DEFINER runs as the function owner (bypassing RLS on banned_emails).
create or replace function public.is_email_banned(addr text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.banned_emails b
    where b.email = lower(btrim(addr))
  );
$$;

drop policy if exists "public insert barron scores" on public.scores;
create policy "public insert barron scores"
  on public.scores
  for insert
  to anon, authenticated
  with check (
    -- Case-insensitive + whitespace-tolerant so mobile auto-capitalized
    -- emails (e.g. "@Barronltg.com") are still accepted.
    lower(btrim(email)) like '%@barronltg.com'
    -- Reject banned emails outright (checked via SECURITY DEFINER helper).
    and not public.is_email_banned(email)
    and char_length(btrim(player_name)) between 1 and 60

    -- Click/accuracy sanity.
    and total_clicks between 0 and 400
    and correct_clicks >= 0
    and correct_clicks <= total_clicks
    -- A 45s game cannot physically yield this many scoring hits (real max 77).
    and correct_clicks <= 90
    and accuracy >= 0 and accuracy <= 1
    -- accuracy must actually equal correct/total (within rounding),
    -- blocking mismatched hand-typed values. (total=0 => accuracy 0.)
    and (
      (total_clicks = 0 and accuracy = 0)
      or abs(accuracy - (correct_clicks::float / nullif(total_clicks, 0))) <= 0.02
    )

    -- Reaction time: a real average is a positive, non-trivial number of ms.
    -- Reject the impossibly-perfect tiny values used in fabricated rows,
    -- unless there were simply no correct hits (then it's 0).
    and avg_reaction_ms >= 0 and avg_reaction_ms <= 5000
    and (correct_clicks = 0 or avg_reaction_ms >= 120)

    -- Final-10 hits can't exceed total correct hits, and are bounded.
    and final10_hits >= 0
    and final10_hits <= correct_clicks
    and final10_hits <= 40

    -- Points: generous headroom over the real record (~19k) but far below
    -- the million-point fakes.
    and points >= -5000 and points <= 40000
    -- Points can't exceed the theoretical max per correct hit
    -- (250 pumpkin + 99 speed + 50 streak = 399), plus a small buffer.
    and points <= correct_clicks * 399 + 50

    -- Keep the submission time within a sane window of server time.
    -- (A hand-crafted far-past/future timestamp is rejected; we don't
    -- block round-millisecond values to avoid rare false positives on
    -- genuine play — the other checks already catch fabricated rows.)
    and submitted_at <= now() + interval '2 minutes'
    and submitted_at >= now() - interval '1 day'
  );

-- NOTE: No UPDATE or DELETE policies exist, so the browser (anon)
-- cannot modify or remove rows. The table is effectively append-only.
