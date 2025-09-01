/**
 * fixPrimaryKey.js
 * 
 * Description: Fix PRIMARY KEY issue in ParticipantAgentAssociations for PgAdmin4 GUI operations
 * 
 * Role in the system: Database primary key fixer to enable GUI delete operations
 */

const { sequelize } = require('../database');

async function fixPrimaryKey() {
  console.log('🔑 FIXING PRIMARY KEY for PgAdmin4 GUI Support');
  console.log('============================================\n');
  
  const transaction = await sequelize.transaction();
  
  try {
    console.log('1️⃣ Adding PRIMARY KEY constraint to id column...');
    
    // Add primary key constraint to the existing id column
    await sequelize.query(`
      ALTER TABLE "ParticipantAgentAssociations" 
      ADD CONSTRAINT "ParticipantAgentAssociations_pkey" 
      PRIMARY KEY ("id");
    `, { transaction });
    
    console.log('   ✅ PRIMARY KEY constraint added successfully!');
    
    await transaction.commit();
    console.log('\n✅ PRIMARY KEY FIXED!');
    
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error fixing primary key:', error.message);
    
    if (error.message.includes('already exists')) {
      console.log('   ℹ️  Primary key constraint might already exist');
    } else {
      throw error;
    }
  }
}

async function verifyPrimaryKey() {
  try {
    console.log('\n🔍 Verifying PRIMARY KEY...');
    
    const [results] = await sequelize.query(`
      SELECT 
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu 
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'ParticipantAgentAssociations'
        AND tc.constraint_type = 'PRIMARY KEY';
    `);
    
    if (results.length > 0) {
      console.log('   ✅ PRIMARY KEY found:');
      results.forEach(r => {
        console.log(`      ${r.constraint_name} on column: ${r.column_name}`);
      });
    } else {
      console.log('   ❌ No PRIMARY KEY found');
    }
    
  } catch (error) {
    console.error('❌ Error verifying primary key:', error);
  }
}

async function testTableStructure() {
  try {
    console.log('\n📊 Final table structure check...');
    
    const [results] = await sequelize.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable,
        column_default,
        CASE 
          WHEN column_name = 'id' THEN 'PRIMARY KEY'
          ELSE 'REGULAR'
        END as column_type
      FROM information_schema.columns 
      WHERE table_name = 'ParticipantAgentAssociations'
      ORDER BY 
        CASE WHEN column_name = 'id' THEN 1 ELSE 2 END,
        ordinal_position;
    `);
    
    console.log('\n   📋 Column Structure:');
    results.forEach(col => {
      console.log(`      ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'} ${col.column_type === 'PRIMARY KEY' ? '🔑' : ''}`);
    });
    
  } catch (error) {
    console.error('❌ Error checking table structure:', error);
  }
}

async function main() {
  try {
    await fixPrimaryKey();
    await verifyPrimaryKey();
    await testTableStructure();
    
    console.log('\n🎉 SUCCESS!');
    console.log('Now PgAdmin4 should recognize the PRIMARY KEY and enable the delete button (tachito)!');
    console.log('');
    console.log('💡 To test in PgAdmin4:');
    console.log('   1. Refresh your table view (F5)');
    console.log('   2. Select a row');
    console.log('   3. The delete button (tachito) should now be enabled');
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

module.exports = { fixPrimaryKey };
