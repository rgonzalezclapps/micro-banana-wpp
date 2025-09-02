-- ============================================================================
-- 🚨 EMERGENCY NULL CLEANUP - Execute BEFORE server restart
-- ============================================================================
-- 
-- Problem: participantId column exists but contains NULL values
-- Sequelize cannot apply NOT NULL constraint
-- 
-- CRITICAL: Run this IMMEDIATELY before attempting server restart
-- ============================================================================

-- ✅ EMERGENCY: Populate NULL participantId from metadata
UPDATE "Payments" 
SET "participantId" = CAST(metadata->>'participant_id' AS INTEGER)
WHERE "participantId" IS NULL 
AND metadata->>'participant_id' IS NOT NULL;

-- ✅ EMERGENCY: For any remaining NULLs, use participant 27 (R.- from logs)
UPDATE "Payments" 
SET "participantId" = 27
WHERE "participantId" IS NULL;

-- ✅ EMERGENCY: Add missing Participants timestamps if needed
DO $$ 
BEGIN
    -- Add createdAt if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'Participants' 
                   AND column_name = 'createdAt') THEN
        ALTER TABLE "Participants" ADD COLUMN "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
        ALTER TABLE "Participants" ADD COLUMN "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
        
        UPDATE "Participants" 
        SET "createdAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP;
        
        ALTER TABLE "Participants" ALTER COLUMN "createdAt" SET NOT NULL;
        ALTER TABLE "Participants" ALTER COLUMN "updatedAt" SET NOT NULL;
    END IF;
END $$;

-- ============================================================================
-- ✅ VERIFICATION BEFORE RESTART
-- ============================================================================

-- Check that NO participantId is NULL
SELECT 
    COUNT(*) as total_payments,
    COUNT("participantId") as not_null_count,
    COUNT(*) - COUNT("participantId") as null_count
FROM "Payments";

-- Should return: null_count = 0

-- Check Participants schema
SELECT column_name, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'Participants' 
AND column_name IN ('phoneNumber', 'creditBalance', 'createdAt', 'updatedAt');

-- Final verification
SELECT '🚨 EMERGENCY CLEANUP COMPLETED - READY FOR SERVER RESTART' as status;
