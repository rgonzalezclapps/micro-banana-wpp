-- ============================================================================
-- COMPLETE PARTICIPANTS TABLE SCHEMA FIX
-- ============================================================================
-- 
-- Problem: Participants table is missing multiple required columns:
-- - phoneNumber (fixed but maybe not applied)
-- - createdAt, updatedAt (timestamps)
-- 
-- Solution: Add ALL missing columns safely with proper data population
-- ============================================================================

-- ✅ STEP 1: Add phoneNumber column (if not already added)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'Participants' 
                   AND column_name = 'phoneNumber') THEN
        ALTER TABLE "Participants" ADD COLUMN "phoneNumber" VARCHAR(255);
    END IF;
END $$;

-- ✅ STEP 2: Add timestamp columns as NULLABLE first
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'Participants' 
                   AND column_name = 'createdAt') THEN
        ALTER TABLE "Participants" ADD COLUMN "createdAt" TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'Participants' 
                   AND column_name = 'updatedAt') THEN
        ALTER TABLE "Participants" ADD COLUMN "updatedAt" TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- ✅ STEP 3: Populate phoneNumber data for existing records
UPDATE "Participants" 
SET "phoneNumber" = '5491123500639' 
WHERE id = 27 AND ("phoneNumber" IS NULL OR "phoneNumber" = '');

-- Set placeholder for other unknown participants
UPDATE "Participants" 
SET "phoneNumber" = 'temp_phone_' || id::text 
WHERE "phoneNumber" IS NULL OR "phoneNumber" = '';

-- ✅ STEP 4: Populate timestamp data for existing records
UPDATE "Participants" 
SET "createdAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "createdAt" IS NULL;

-- ✅ STEP 5: Now set NOT NULL constraints
ALTER TABLE "Participants" 
ALTER COLUMN "phoneNumber" SET NOT NULL;

ALTER TABLE "Participants" 
ALTER COLUMN "createdAt" SET NOT NULL;

ALTER TABLE "Participants" 
ALTER COLUMN "updatedAt" SET NOT NULL;

-- ✅ STEP 6: Add UNIQUE constraint for phoneNumber
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE table_name = 'Participants' 
                   AND constraint_name = 'Participants_phoneNumber_unique') THEN
        ALTER TABLE "Participants" 
        ADD CONSTRAINT "Participants_phoneNumber_unique" UNIQUE ("phoneNumber");
    END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check final schema
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'Participants' 
ORDER BY ordinal_position;

-- Check data
SELECT id, name, "phoneNumber", "creditBalance", "createdAt", "updatedAt" 
FROM "Participants" 
ORDER BY id;

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================
SELECT 'Participants schema migration completed successfully!' as status;
