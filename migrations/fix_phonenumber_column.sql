-- ============================================================================
-- FIX PHONENUMBER COLUMN ISSUE - CRITICAL DATABASE REPAIR
-- ============================================================================
-- 
-- Problem: Participants table exists with data but missing phoneNumber column
-- Sequelize tries to add phoneNumber as NOT NULL and fails
-- 
-- Solution: Add column as nullable first, populate data, then set NOT NULL
-- ============================================================================

-- ✅ STEP 1: Add phoneNumber column as NULLABLE first
ALTER TABLE "Participants" 
ADD COLUMN "phoneNumber" VARCHAR(255);

-- ✅ STEP 2: Populate existing records with known phone numbers
-- Based on conversation logs and system records
UPDATE "Participants" 
SET "phoneNumber" = '5491123500639' 
WHERE id = 27; -- R.- from logs

-- Set placeholder for unknown participants
UPDATE "Participants" 
SET "phoneNumber" = 'temp_phone_' || id::text 
WHERE "phoneNumber" IS NULL;

-- ✅ STEP 3: Now we can safely set it as NOT NULL and UNIQUE
ALTER TABLE "Participants" 
ALTER COLUMN "phoneNumber" SET NOT NULL;

ALTER TABLE "Participants" 
ADD CONSTRAINT "Participants_phoneNumber_unique" UNIQUE ("phoneNumber");

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check the result
SELECT id, name, "phoneNumber", "creditBalance", status 
FROM "Participants" 
ORDER BY id;

-- Verify schema
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'Participants' 
ORDER BY ordinal_position;

-- ============================================================================
-- IMPORTANT: Update real phone numbers after this migration
-- ============================================================================
-- 
-- The placeholder phone numbers need to be replaced with real ones:
-- UPDATE "Participants" SET "phoneNumber" = 'real_phone' WHERE id = X;
-- 
-- ============================================================================
