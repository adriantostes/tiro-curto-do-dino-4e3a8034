-- Team reservations (10 min) to avoid permanently locking a team before payment

-- 1) Payments: store expiration timestamp
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS payments_expires_at_idx
  ON public.payments(expires_at);

-- 2) Team reservations
CREATE TABLE IF NOT EXISTS public.team_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  cartola_team_id bigint NOT NULL,
  team_name text NOT NULL,
  team_slug text,
  team_shield_url text,
  payment_id uuid NULL REFERENCES public.payments(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, cartola_team_id)
);

CREATE INDEX IF NOT EXISTS team_reservations_user_id_idx
  ON public.team_reservations(user_id);

CREATE INDEX IF NOT EXISTS team_reservations_league_expires_idx
  ON public.team_reservations(league_id, expires_at);

ALTER TABLE public.team_reservations ENABLE ROW LEVEL SECURITY;

-- Users can read own reservations
DO $$ BEGIN
  CREATE POLICY "Team reservations: users can read own"
  ON public.team_reservations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users can create own reservations
DO $$ BEGIN
  CREATE POLICY "Team reservations: users can insert own"
  ON public.team_reservations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users can delete own reservations
DO $$ BEGIN
  CREATE POLICY "Team reservations: users can delete own"
  ON public.team_reservations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service role can do anything (cleanup/finalize)
DO $$ BEGIN
  CREATE POLICY "Team reservations: service role can write"
  ON public.team_reservations
  FOR ALL
  TO authenticated
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- updated_at trigger
DO $$ BEGIN
  CREATE TRIGGER update_team_reservations_updated_at
  BEFORE UPDATE ON public.team_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

