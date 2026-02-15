-- Store Mercado Pago external_reference for safer webhook reconciliation

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS external_reference TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_external_reference
  ON public.payments(external_reference);
