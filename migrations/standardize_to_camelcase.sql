-- ============================================================================
-- DATABASE STANDARDIZATION TO CAMELCASE
-- ============================================================================
-- 
-- Description: Renombra todas las columnas snake_case a camelCase para 
--              consistencia total en la base de datos
-- 
-- Context: Se descubrió inconsistencia en el schema - algunos campos estaban
--          en camelCase (Agents) y otros en snake_case (Participants, Payments)
--
-- Target: Estandarizar TODO a camelCase matching Sequelize models
-- 
-- CRÍTICO: Ejecutar estos comandos en PgAdmin4 ANTES de reiniciar la aplicación
-- ============================================================================

-- 🔧 PARTICIPANTS TABLE
-- Renombrar credit_balance → creditBalance
ALTER TABLE "Participants" 
RENAME COLUMN credit_balance TO "creditBalance";

-- 🔧 PAYMENTS TABLE  
-- Renombrar campos MercadoPago a camelCase
ALTER TABLE "Payments" 
RENAME COLUMN mp_payment_id TO "mpPaymentId";

ALTER TABLE "Payments" 
RENAME COLUMN mp_preference_id TO "mpPreferenceId";

ALTER TABLE "Payments" 
RENAME COLUMN external_reference TO "externalReference";

ALTER TABLE "Payments" 
RENAME COLUMN idempotency_key TO "idempotencyKey";

-- Renombrar timestamps a camelCase
ALTER TABLE "Payments" 
RENAME COLUMN approved_at TO "approvedAt";

ALTER TABLE "Payments" 
RENAME COLUMN credited_at TO "creditedAt";

-- ============================================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================

-- ✅ Verificar estructura final de Participants
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'Participants' 
ORDER BY ordinal_position;

-- ✅ Verificar estructura final de Payments  
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'Payments'
ORDER BY ordinal_position;

-- ✅ Test query - verificar que creditBalance funciona
SELECT id, name, "phoneNumber", "creditBalance" 
FROM "Participants" 
LIMIT 3;

-- ✅ Test query - verificar que campos Payment funcionan
SELECT id, "participantId", amount, credits, status, 
       "mpPaymentId", "externalReference", "idempotencyKey"
FROM "Payments" 
LIMIT 3;

-- ============================================================================
-- ROLLBACK PLAN (solo si necesario)
-- ============================================================================
-- 
-- Si algo sale mal, ejecutar estos comandos para revertir:
--
-- ALTER TABLE "Participants" RENAME COLUMN "creditBalance" TO credit_balance;
-- ALTER TABLE "Payments" RENAME COLUMN "mpPaymentId" TO mp_payment_id;
-- ALTER TABLE "Payments" RENAME COLUMN "mpPreferenceId" TO mp_preference_id;
-- ALTER TABLE "Payments" RENAME COLUMN "externalReference" TO external_reference;
-- ALTER TABLE "Payments" RENAME COLUMN "idempotencyKey" TO idempotency_key;
-- ALTER TABLE "Payments" RENAME COLUMN "approvedAt" TO approved_at;
-- ALTER TABLE "Payments" RENAME COLUMN "creditedAt" TO credited_at;
-- ============================================================================
