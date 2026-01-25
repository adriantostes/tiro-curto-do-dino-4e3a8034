-- Carrinho/checkout: relacionar um pagamento a múltiplos participantes (times)

CREATE TABLE IF NOT EXISTS public.payment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Evita cobrar duas vezes o mesmo participante na mesma rodada
CREATE UNIQUE INDEX IF NOT EXISTS payment_items_unique_participant_round
  ON public.payment_items(participant_id, round_number);

CREATE INDEX IF NOT EXISTS payment_items_payment_id_idx
  ON public.payment_items(payment_id);

ALTER TABLE public.payment_items ENABLE ROW LEVEL SECURITY;

-- Usuário pode ler itens de pagamento que pertencem a pagamentos dele
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_items'
      AND policyname = 'Payment items: users can read own via payment'
  ) THEN
    CREATE POLICY "Payment items: users can read own via payment"
    ON public.payment_items
    FOR SELECT
    TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.payments p
        WHERE p.id = payment_items.payment_id
          AND p.user_id = auth.uid()
      )
    );
  END IF;
END $$;

-- Somente service role escreve (Edge Functions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'payment_items'
      AND policyname = 'Payment items: service role can write'
  ) THEN
    CREATE POLICY "Payment items: service role can write"
    ON public.payment_items
    FOR ALL
    TO authenticated
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
