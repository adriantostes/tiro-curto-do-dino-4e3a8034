-- CORREÇÃO CRÍTICA: Prevenir cobrança duplicada entre sistema legado e novo

-- 1. Criar índice único para payment_items (participant + round)
CREATE UNIQUE INDEX IF NOT EXISTS payment_items_participant_round_unique 
ON payment_items(participant_id, round_number);

-- 2. Migrar pagamentos legados aprovados para payment_items (se ainda não existir)
-- Usa o índice único criado acima para evitar duplicatas
INSERT INTO payment_items (payment_id, participant_id, round_number)
SELECT 
  p.id,
  p.participant_id,
  p.round_number
FROM payments p
WHERE p.participant_id IS NOT NULL
  AND p.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM payment_items pi 
    WHERE pi.participant_id = p.participant_id
      AND pi.round_number = p.round_number
  )
ON CONFLICT (participant_id, round_number) DO NOTHING;

-- 3. Criar constraint para evitar que participant_id seja usado em NOVOS payments
-- (forçar uso apenas do payment_items daqui pra frente)
ALTER TABLE payments 
  ADD CONSTRAINT payments_no_new_participant_id_check 
  CHECK (
    participant_id IS NULL 
    OR created_at < NOW()
  );

COMMENT ON CONSTRAINT payments_no_new_participant_id_check ON payments IS 
'Previne uso do campo legado participant_id em novos registros. Use payment_items.';