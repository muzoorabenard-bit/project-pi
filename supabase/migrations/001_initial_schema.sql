-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── matches ────────────────────────────────────────────────────────────────
create table if not exists matches (
  id            uuid primary key default gen_random_uuid(),
  fixture_id    integer not null unique,
  home_team     text not null,
  away_team     text not null,
  league        text not null,
  kickoff_time  timestamptz not null,
  status        text not null default 'scheduled',
  home_odds     numeric,
  draw_odds     numeric,
  away_odds     numeric,
  created_at    timestamptz not null default now()
);

-- ─── team_stats ─────────────────────────────────────────────────────────────
create table if not exists team_stats (
  id                  uuid primary key default gen_random_uuid(),
  team_id             integer not null,
  team_name           text not null,
  league              text not null,
  form                text,          -- e.g. "WWDLW"
  goals_scored_avg    numeric,
  goals_conceded_avg  numeric,
  btts_rate           numeric,       -- 0.0 – 1.0
  over25_rate         numeric,       -- 0.0 – 1.0
  updated_at          timestamptz not null default now(),
  unique (team_id, league)
);

-- ─── recommendations ────────────────────────────────────────────────────────
create table if not exists recommendations (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches(id) on delete cascade,
  bet_type      text not null,   -- '1X2' | 'BTTS' | 'Over-Under'
  pick          text not null,   -- e.g. 'Home Win', 'BTTS Yes', 'Over 2.5'
  confidence    text not null,   -- 'High' | 'Medium' | 'Low'
  reasoning     text not null,
  stat_summary  jsonb,
  result        text,            -- null | 'Win' | 'Loss' | 'Void'
  created_at    timestamptz not null default now()
);

-- ─── RLS (read-only public access for the web dashboard) ────────────────────
alter table matches        enable row level security;
alter table team_stats     enable row level security;
alter table recommendations enable row level security;

create policy "public read matches"         on matches         for select using (true);
create policy "public read team_stats"      on team_stats      for select using (true);
create policy "public read recommendations" on recommendations  for select using (true);

-- Edge functions write via service_role key, bypassing RLS — no insert policy needed.
