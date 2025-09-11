-- MIGRATION: Remove Client table and clientId column from Agents
-- REASON: Refactoring to a clientless architecture, agent configs moved to MongoDB.
-- DATE: Current Date

\c fotoproducto;

-- Step 1: Drop the foreign key constraint from the "Agents" table
ALTER TABLE "Agents" DROP CONSTRAINT "Agents_clientId_fkey";

-- Step 2: Drop the "clientId" column from the "Agents" table
ALTER TABLE "Agents" DROP COLUMN "clientId";

-- Step 3: Drop the "Clients" table
DROP TABLE "Clients";

-- Verification
\echo "Verifying changes..."
\echo "Agents table schema:"
\d "Agents"
\echo "\nChecking if Clients table exists (should not exist):"
\dt "Clients"

SELECT 'Migration to remove Client concept completed successfully!' AS status;
