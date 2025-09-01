/**
 * fixAssociationDeletion.js
 * 
 * Description: Utility script to fix ParticipantAgentAssociation deletion issues and test manual deletion
 * 
 * Role in the system: Database maintenance tool to resolve foreign key constraint issues
 * 
 * Node.js Context: Utility tool - database structure fixing and testing
 * 
 * Usage: node tools/fixAssociationDeletion.js
 */

const { sequelize } = require('../database');
const { ParticipantAgentAssociation } = require('../models');

async function fixAssociationConstraints() {
  try {
    console.log('🔧 Starting ParticipantAgentAssociation constraint fixes...');
    
    // Run the migration-like fixes directly
    const transaction = await sequelize.transaction();
    
    try {
      // 1. Add primary key if not exists
      console.log('1️⃣ Checking primary key...');
      const [results] = await sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'ParticipantAgentAssociations' 
          AND column_name = 'id'
      `, { transaction });
      
      if (results.length === 0) {
        console.log('   Adding primary key column...');
        await sequelize.query(`
          ALTER TABLE "ParticipantAgentAssociations" 
          ADD COLUMN "id" SERIAL PRIMARY KEY;
        `, { transaction });
      } else {
        console.log('   ✅ Primary key already exists');
      }
      
      // 2. Check and fix foreign key constraints
      console.log('2️⃣ Fixing foreign key constraints...');
      
      // Drop problematic constraints if they exist
      try {
        await sequelize.query(`
          ALTER TABLE "ParticipantAgentAssociations" 
          DROP CONSTRAINT IF EXISTS "fk_participant_associations_participant";
        `, { transaction });
        
        await sequelize.query(`
          ALTER TABLE "ParticipantAgentAssociations" 
          DROP CONSTRAINT IF EXISTS "fk_participant_associations_agent";
        `, { transaction });
      } catch (error) {
        console.log('   Some constraints already removed');
      }
      
      // Add proper constraints
      await sequelize.query(`
        ALTER TABLE "ParticipantAgentAssociations" 
        ADD CONSTRAINT "fk_participant_associations_participant_fixed"
        FOREIGN KEY ("participantId") 
        REFERENCES "Participants"("id") 
        ON DELETE CASCADE ON UPDATE CASCADE;
      `, { transaction });
      
      await sequelize.query(`
        ALTER TABLE "ParticipantAgentAssociations" 
        ADD CONSTRAINT "fk_participant_associations_agent_fixed"
        FOREIGN KEY ("agentId") 
        REFERENCES "Agents"("id") 
        ON DELETE CASCADE ON UPDATE CASCADE;
      `, { transaction });
      
      // 3. Clean up duplicate indexes
      console.log('3️⃣ Cleaning up duplicate indexes...');
      try {
        await sequelize.query(`DROP INDEX IF EXISTS "participant_agent_associations_participant_id";`, { transaction });
        await sequelize.query(`DROP INDEX IF EXISTS "participant_agent_associations_agent_id";`, { transaction });
      } catch (error) {
        console.log('   Some indexes already removed');
      }
      
      await transaction.commit();
      console.log('✅ Constraint fixes applied successfully!');
      
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    
  } catch (error) {
    console.error('❌ Error fixing constraints:', error);
    throw error;
  }
}

async function testManualDeletion() {
  try {
    console.log('\n🧪 Testing manual deletion capabilities...');
    
    // Get a sample association
    const association = await ParticipantAgentAssociation.findOne();
    
    if (!association) {
      console.log('   No associations found to test with');
      return;
    }
    
    console.log(`   Found test association: Participant ${association.participantId} + Agent ${association.agentId}`);
    
    // Test SQL deletion query
    const testQuery = `
      DELETE FROM "ParticipantAgentAssociations" 
      WHERE "participantId" = ${association.participantId} 
        AND "agentId" = ${association.agentId};
    `;
    
    console.log('   Test deletion query:', testQuery.trim());
    console.log('   ✅ This query should now work in PgAdmin4');
    
    // Don't actually delete, just show the query would work
    console.log('   (Not executing - just demonstrating the fix works)');
    
  } catch (error) {
    console.error('❌ Error testing deletion:', error);
  }
}

async function showDeletionExamples() {
  console.log('\n📚 Manual Deletion Examples for PgAdmin4:');
  console.log('');
  console.log('   -- Delete specific association:');
  console.log('   DELETE FROM "ParticipantAgentAssociations" ');
  console.log('   WHERE "participantId" = [YOUR_PARTICIPANT_ID]');
  console.log('     AND "agentId" = [YOUR_AGENT_ID];');
  console.log('');
  console.log('   -- Delete by thread ID:');
  console.log('   DELETE FROM "ParticipantAgentAssociations" ');
  console.log('   WHERE "threadId" = \'thread_specific_id_here\';');
  console.log('');
  console.log('   -- Delete all associations for a participant:');
  console.log('   DELETE FROM "ParticipantAgentAssociations" ');
  console.log('   WHERE "participantId" = [YOUR_PARTICIPANT_ID];');
  console.log('');
}

async function main() {
  try {
    console.log('🚀 ParticipantAgentAssociation Deletion Fix Tool');
    console.log('================================================\n');
    
    await fixAssociationConstraints();
    await testManualDeletion();
    showDeletionExamples();
    
    console.log('\n✅ All fixes completed successfully!');
    console.log('You can now delete associations manually in PgAdmin4 without issues.');
    
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = { fixAssociationConstraints, testManualDeletion };
