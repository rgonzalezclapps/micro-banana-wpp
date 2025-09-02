-- ============================================================================
-- 🚨 CRITICAL SCHEMA REPAIR - EMERGENCY DATABASE FIX
-- ============================================================================
-- 
-- DISASTER: Payments table missing participantId column but has data
-- Multiple duplicate constraints from failed Sequelize sync attempts
-- 
-- SOLUTION: Safe migration with data preservation
-- ============================================================================

-- ✅ STEP 1: Add participantId column as NULLABLE first
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'Payments' 
                   AND column_name = 'participantId') THEN
        ALTER TABLE "Payments" ADD COLUMN "participantId" INTEGER;
        RAISE NOTICE 'Added participantId column to Payments table';
    ELSE
        RAISE NOTICE 'participantId column already exists in Payments table';
    END IF;
END $$;

-- ✅ STEP 2: Extract participantId from metadata JSON and populate column
UPDATE "Payments" 
SET "participantId" = CAST(metadata->>'participant_id' AS INTEGER)
WHERE metadata->>'participant_id' IS NOT NULL 
AND "participantId" IS NULL;

-- ✅ STEP 3: Add missing timestamps to Participants if needed
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'Participants' 
                   AND column_name = 'createdAt') THEN
        ALTER TABLE "Participants" ADD COLUMN "createdAt" TIMESTAMP WITH TIME ZONE;
        ALTER TABLE "Participants" ADD COLUMN "updatedAt" TIMESTAMP WITH TIME ZONE;
        
        -- Populate with current timestamp
        UPDATE "Participants" 
        SET "createdAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "createdAt" IS NULL;
        
        -- Set NOT NULL
        ALTER TABLE "Participants" ALTER COLUMN "createdAt" SET NOT NULL;
        ALTER TABLE "Participants" ALTER COLUMN "updatedAt" SET NOT NULL;
        
        RAISE NOTICE 'Added timestamp columns to Participants table';
    END IF;
END $$;

-- ✅ STEP 4: Now set participantId as NOT NULL (after data is populated)
ALTER TABLE "Payments" 
ALTER COLUMN "participantId" SET NOT NULL;

-- ✅ STEP 5: Add foreign key constraint (clean way)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                   WHERE constraint_name = 'fk_payments_participant' 
                   AND table_name = 'Payments') THEN
        ALTER TABLE "Payments" 
        ADD CONSTRAINT "fk_payments_participant" 
        FOREIGN KEY ("participantId") 
        REFERENCES "Participants" ("id") 
        ON DELETE CASCADE;
        
        RAISE NOTICE 'Added foreign key constraint for participantId';
    END IF;
END $$;

-- ============================================================================
-- 🧹 CONSTRAINT CLEANUP - Remove duplicate constraints
-- ============================================================================

-- Remove all duplicate external_reference constraints (keep only one)
DO $$
DECLARE
    constraint_rec RECORD;
BEGIN
    FOR constraint_rec IN 
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'Payments' 
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE 'Payments_external_reference_key%'
        AND constraint_name != 'Payments_external_reference_key'
    LOOP
        EXECUTE 'ALTER TABLE "Payments" DROP CONSTRAINT "' || constraint_rec.constraint_name || '"';
        RAISE NOTICE 'Dropped duplicate constraint: %', constraint_rec.constraint_name;
    END LOOP;
END $$;

-- Remove all duplicate idempotency_key constraints (keep only one)
DO $$
DECLARE
    constraint_rec RECORD;
BEGIN
    FOR constraint_rec IN 
        SELECT constraint_name 
        FROM information_schema.table_constraints 
        WHERE table_name = 'Payments' 
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE 'Payments_idempotency_key_key%'
        AND constraint_name != 'Payments_idempotency_key_key'
    LOOP
        EXECUTE 'ALTER TABLE "Payments" DROP CONSTRAINT "' || constraint_rec.constraint_name || '"';
        RAISE NOTICE 'Dropped duplicate constraint: %', constraint_rec.constraint_name;
    END LOOP;
END $$;

-- ============================================================================
-- ✅ VERIFICATION & SUCCESS CHECK
-- ============================================================================

-- Verify final schema structure
SELECT 'PAYMENTS SCHEMA:' as check_type, column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'Payments' 
AND column_name IN ('id', 'participantId', 'amount', 'credits', 'createdAt', 'updatedAt')
ORDER BY ordinal_position;

-- Verify data integrity
SELECT 'DATA INTEGRITY:' as check_type, 
       COUNT(*) as total_payments,
       COUNT("participantId") as with_participant_id,
       COUNT(*) - COUNT("participantId") as null_participant_ids
FROM "Payments";

-- Verify foreign key relationships
SELECT 'FOREIGN KEY CHECK:' as check_type,
       p.id as payment_id,
       p."participantId",
       part.name as participant_name,
       CASE WHEN part.id IS NULL THEN 'BROKEN' ELSE 'OK' END as fk_status
FROM "Payments" p 
LEFT JOIN "Participants" part ON p."participantId" = part.id
LIMIT 5;

-- Final success message
SELECT '🎉 CRITICAL SCHEMA REPAIR COMPLETED SUCCESSFULLY!' as status,
       'Ready to restart server' as next_step;
