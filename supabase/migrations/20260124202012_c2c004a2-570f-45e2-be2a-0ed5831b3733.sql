-- Core tables for Liga do Dino

-- 1) Timestamp helper
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2) Profiles (app-level user data)
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles: users can read own"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

create policy "Profiles: users can insert own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Profiles: users can update own"
on public.profiles
for update
to authenticated
using (auth.uid() = user_id);

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.update_updated_at_column();

-- 3) Teams linked to a user (Cartola team)
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  cartola_team_id bigint not null,
  team_name text not null,
  shield_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cartola_team_id),
  unique (user_id, cartola_team_id)
);

create index if not exists idx_teams_user_id on public.teams(user_id);

alter table public.teams enable row level security;

create policy "Teams: users can read own"
on public.teams
for select
to authenticated
using (auth.uid() = user_id);

create policy "Teams: users can insert own"
on public.teams
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Teams: users can update own"
on public.teams
for update
to authenticated
using (auth.uid() = user_id);

create policy "Teams: users can delete own"
on public.teams
for delete
to authenticated
using (auth.uid() = user_id);

create trigger trg_teams_updated_at
before update on public.teams
for each row execute function public.update_updated_at_column();

-- 4) Payments (Pix)
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  team_id uuid null references public.teams(id) on delete set null,
  round_number integer not null,
  status text not null default 'pending',
  transaction_id text,
  pix_qr_code text,
  pix_copy_paste text,
  amount_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payments_user_id on public.payments(user_id);
create index if not exists idx_payments_round_status on public.payments(round_number, status);

alter table public.payments enable row level security;

create policy "Payments: users can read own"
on public.payments
for select
to authenticated
using (auth.uid() = user_id);

create policy "Payments: users can create own"
on public.payments
for insert
to authenticated
with check (auth.uid() = user_id);

create trigger trg_payments_updated_at
before update on public.payments
for each row execute function public.update_updated_at_column();

-- 5) Round entries (scores per round)
create table if not exists public.round_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  round_number integer not null,
  points numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, round_number)
);

create index if not exists idx_round_entries_round_points on public.round_entries(round_number, points desc);
create index if not exists idx_round_entries_user_id on public.round_entries(user_id);

alter table public.round_entries enable row level security;

create trigger trg_round_entries_updated_at
before update on public.round_entries
for each row execute function public.update_updated_at_column();

-- Helper: is a user paid for a given round?
create or replace function public.is_paid_user_for_round(_user_id uuid, _round integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.payments p
    where p.user_id = _user_id
      and p.round_number = _round
      and p.status = 'approved'
  );
$$;

-- Helper: can the current user view a leaderboard entry?
create or replace function public.can_view_leaderboard_entry(_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.round_entries re
    join public.teams t on t.id = re.team_id
    where re.id = _entry_id
      and public.is_paid_user_for_round(auth.uid(), re.round_number)
      and public.is_paid_user_for_round(t.user_id, re.round_number)
  );
$$;

-- Policies: paid users can see paid leaderboard entries for the same round
create policy "Round entries: paid users can view paid leaderboard"
on public.round_entries
for select
to authenticated
using (public.can_view_leaderboard_entry(id));

-- Allow only service role to write scores (via backend jobs/functions)
create policy "Round entries: service role can insert"
on public.round_entries
for insert
to authenticated
with check (auth.role() = 'service_role');

create policy "Round entries: service role can update"
on public.round_entries
for update
to authenticated
using (auth.role() = 'service_role');

-- 6) View for leaderboard
create or replace view public.live_leaderboard_entries as
select
  re.id,
  re.round_number,
  re.points,
  t.cartola_team_id,
  t.team_name,
  t.shield_url,
  t.user_id as owner_user_id
from public.round_entries re
join public.teams t on t.id = re.team_id
where public.is_paid_user_for_round(t.user_id, re.round_number);
