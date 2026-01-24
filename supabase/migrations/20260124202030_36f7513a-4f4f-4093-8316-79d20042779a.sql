-- Fix linter: ensure leaderboard view is security invoker (not security definer)

drop view if exists public.live_leaderboard_entries;

create view public.live_leaderboard_entries
with (security_invoker = true)
as
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
