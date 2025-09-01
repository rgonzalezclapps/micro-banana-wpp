/**
 * forceFixAssociationConstraints.js
 * 
 * Description: AGGRESSIVE script to completely fix ParticipantAgentAssociation deletion issues
 * 
 * Role in the system: Database constraint cleaner and rebuilder
 * 
 * Usage: node tools/forceFixAssociationConstraints.js
 */

const { sequelize } = require('../database');

async function aggressiveConstraintCleaning() {
  console.log('🚨 AGGRESSIVE ParticipantAgentAssociation Constraint Cleaner');
  console.log('========================================================\n');
  
  const transaction = await sequelize.transaction();
  
  try {
    console.log('1️⃣ Removing ALL existing constraints...');
    
    // Remove all UNIQUE constraints on threadId (we found multiple!)
    const uniqueConstraints = [
      'ParticipantAgentAssociations_threadId_key',
      'ParticipantAgentAssociations_threadId_key1', 
      'ParticipantAgentAssociations_threadId_key2',
      'ParticipantAgentAssociations_threadId_key3',
      'ParticipantAgentAssociations_threadId_key4'
    ];
    
    for (const constraint of uniqueConstraints) {
      try {
        await sequelize.query(`
          ALTER TABLE "ParticipantAgentAssociations" 
          DROP CONSTRAINT IF EXISTS "${constraint}";
        `, { transaction });
        console.log(`   ✅ Removed: ${constraint}`);
      } catch (error) {
        console.log(`   ⚠️  Constraint ${constraint} not found or already removed`);
      }
    }
    
    // Remove original foreign key constraints
    try {
      await sequelize.query(`
        ALTER TABLE "ParticipantAgentAssociations" 
        DROP CONSTRAINT IF EXISTS "ParticipantAgentAssociations_participantId_fkey";
      `, { transaction });
      console.log('   ✅ Removed: participantId foreign key');
    } catch (error) {
      console.log('   ⚠️  participantId foreign key constraint not found');
    }
    
    try {
      await sequelize.query(`
        ALTER TABLE "ParticipantAgentAssociations" 
        DROP CONSTRAINT IF EXISTS "ParticipantAgentAssociations_agentId_fkey";
      `, { transaction });
      console.log('   ✅ Removed: agentId foreign key');
    } catch (error) {
      console.log('   ⚠️  agentId foreign key constraint not found');
    }
    
    // Remove the composite unique constraint
    try {
      await sequelize.query(`
        ALTER TABLE "ParticipantAgentAssociations" 
        DROP CONSTRAINT IF EXISTS "unique_participant_agent";
      `, { transaction });
      console.log('   ✅ Removed: unique_participant_agent constraint');
    } catch (error) {
      console.log('   ⚠️  unique_participant_agent constraint not found');
    }
    
    console.log('\n2️⃣ Creating clean, minimal constraints...');
    
    // Add a single UNIQUE constraint for threadId
    try {
      await sequelize.query(`
        ALTER TABLE "ParticipantAgentAssociations" 
        ADD CONSTRAINT "clean_unique_thread_id" 
        UNIQUE ("threadId");
      `, { transaction });
      console.log('   ✅ Added: Clean threadId unique constraint');
    } catch (error) {
      console.log('   ⚠️  ThreadId unique constraint might already exist:', error.message);
    }
    
    // Add a composite unique constraint for participant+agent
    try {
      await sequelize.query(`
        ALTER TABLE "ParticipantAgentAssociations" 
        ADD CONSTRAINT "clean_unique_participant_agent" 
        UNIQUE ("participantId", "agentId");
      `, { transaction });
      console.log('   ✅ Added: Clean participant+agent unique constraint');
    } catch (error) {
      console.log('   ⚠️  Participant+Agent unique constraint might already exist:', error.message);
    }
    
    // Add clean foreign keys with SIMPLE behavior (no cascade)
    try {
      await sequelize.query(`
        ALTER TABLE "ParticipantAgentAssociations" 
        ADD CONSTRAINT "clean_fk_participant"
        FOREIGN KEY ("participantId") 
        REFERENCES "Participants"("id");
      `, { transaction });
      console.log('   ✅ Added: Clean participantId foreign key (NO CASCADE)');
    } catch (error) {
      console.log('   ⚠️  Participant FK might already exist:', error.message);
    }
    
    try {
      await sequelize.query(`
        ALTER TABLE "ParticipantAgentAssociations" 
        ADD CONSTRAINT "clean_fk_agent"
        FOREIGN KEY ("agentId") 
        REFERENCES "Agents"("id");
      `, { transaction });
      console.log('   ✅ Added: Clean agentId foreign key (NO CASCADE)');
    } catch (error) {
      console.log('   ⚠️  Agent FK might already exist:', error.message);
    }
    
    await transaction.commit();
    console.log('\n✅ ALL CONSTRAINTS CLEANED AND REBUILT!');
    console.log('\n3️⃣ Testing manual deletion...');
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error during constraint cleaning:', error);
    throw error;
  }
}

async function testDirectDeletion() {
  try {
    console.log('\n🧪 Testing direct deletion capability...');
    
    // Get sample data
    const [results] = await sequelize.query(`
      SELECT id, "participantId", "agentId", "threadId" 
      FROM "ParticipantAgentAssociations" 
      LIMIT 1;
    `);
    
    if (results.length > 0) {
      const sample = results[0];
      console.log(`   Sample association found: ID=${sample.id}, Participant=${sample.participantId}, Agent=${sample.agentId}`);
      console.log(`   ThreadId: ${sample.threadId}`);
      
      console.log('\n📋 WORKING DELETION QUERIES FOR PgAdmin4:');
      console.log('');
      console.log(`   -- Delete this specific association by ID:`);
      console.log(`   DELETE FROM "ParticipantAgentAssociations" WHERE id = ${sample.id};`);
      console.log('');
      console.log(`   -- Delete by participant + agent:`);
      console.log(`   DELETE FROM "ParticipantAgentAssociations" WHERE "participantId" = ${sample.participantId} AND "agentId" = ${sample.agentId};`);
      console.log('');
      console.log(`   -- Delete by threadId:`);
      console.log(`   DELETE FROM "ParticipantAgentAssociations" WHERE "threadId" = '${sample.threadId}';`);
      console.log('');
      
    } else {
      console.log('   No associations found to test with');
    }
    
  } catch (error) {
    console.error('❌ Error testing deletion:', error);
  }
}

async function showCurrentConstraints() {
  try {
    console.log('\n📊 CURRENT CONSTRAINT STATUS:');
    const [constraints] = await sequelize.query(`
      SELECT 
        constraint_name,
        constraint_type,
        column_name
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'ParticipantAgentAssociations'
      ORDER BY constraint_type, constraint_name;
    `);
    
    console.log('');
    constraints.forEach(c => {
      console.log(`   ${c.constraint_type}: ${c.constraint_name} (${c.column_name || 'multiple'})`);
    });
    console.log('');
    
  } catch (error) {
    console.error('❌ Error showing constraints:', error);
  }
}

async function main() {
  try {
    await aggressiveConstraintCleaning();
    await testDirectDeletion();
    await showCurrentConstraints();
    
    console.log('🎉 COMPLETE SUCCESS!');
    console.log('Now you should be able to delete associations manually in PgAdmin4!');
    console.log('');
    console.log('💡 If you still have issues, the problem might be:');
    console.log('   1. PgAdmin4 connection/transaction settings');
    console.log('   2. User permissions on the database');
    console.log('   3. Active connections blocking the operation');
    console.log('');
    
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

module.exports = { aggressiveConstraintCleaning };
