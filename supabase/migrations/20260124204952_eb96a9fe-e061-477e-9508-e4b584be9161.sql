-- 1) Leagues table
CREATE TABLE IF NOT EXISTS public.leagues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_round INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;

-- Everyone logged in can read leagues
DO $$ BEGIN
  CREATE POLICY "Leagues: authenticated can read"
  ON public.leagues
  FOR SELECT
  TO authenticated
  USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Writes restricted to service role for now
DO $$ BEGIN
  CREATE POLICY "Leagues: service role can write"
  ON public.leagues
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Participants table
CREATE TABLE IF NOT EXISTS public.participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
  team_name TEXT NOT NULL,
  team_slug TEXT,
  cartola_team_id BIGINT NOT NULL,
  team_shield_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (league_id, cartola_team_id)
);

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Participants: users can read own"
  ON public.participants
  FOR SELECT
  USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Participants: users can insert own"
  ON public.participants
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Participants: users can update own"
  ON public.participants
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Participants: users can delete own"
  ON public.participants
  FOR DELETE
  USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Payments: link to participants (keep existing columns to avoid breaking)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS participant_id UUID;

DO $$ BEGIN
  ALTER TABLE public.payments
    ADD CONSTRAINT payments_participant_id_fkey
    FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_payments_participant_id ON public.payments(participant_id);
CREATE INDEX IF NOT EXISTS idx_payments_status_round ON public.payments(status, round_number);

-- 4) updated_at triggers
DO $$ BEGIN
  CREATE TRIGGER update_leagues_updated_at
  BEFORE UPDATE ON public.leagues
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER update_participants_updated_at
  BEFORE UPDATE ON public.participants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;