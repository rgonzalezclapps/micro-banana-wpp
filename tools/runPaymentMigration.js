/**
 * runPaymentMigration.js
 * 
 * Description: Tool to execute the payment system database migration
 * 
 * Role in the system: Creates Payment table and adds creditBalance to Participants for MercadoPago integration
 * 
 * Node.js Context: Tool - Database migration utility
 * 
 * Dependencies:
 * - sequelize (migration execution)
 * - database/index.js (database connection)
 * - migrations/add_payment_system_schema.js (migration file)
 * 
 * Usage: node tools/runPaymentMigration.js
 */

const { sequelize } = require('../database');
const migration = require('../migrations/add_payment_system_schema.js');

async function runPaymentMigration() {
  console.log('🚀 Starting Payment System Migration...\n');

  try {
    // Test database connection
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully');

    // Get migration state 
    console.log('📊 Checking current migration state...');
    
    // Check if Payments table already exists
    const [results] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'Payments';
    `);
    
    if (results.length > 0) {
      console.log('⚠️  Payments table already exists. Checking structure...');
      
      // Check if creditBalance column exists in Participants
      const [balanceColumn] = await sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'Participants' 
        AND column_name = 'credit_balance';
      `);
      
      if (balanceColumn.length === 0) {
        console.log('🔧 Adding missing creditBalance column to Participants...');
        await sequelize.query(`
          ALTER TABLE "Participants" 
          ADD COLUMN "credit_balance" INTEGER NOT NULL DEFAULT 10000;
        `);
        console.log('✅ CreditBalance column added successfully');
      } else {
        console.log('✅ Payment system already fully migrated');
        return;
      }
    } else {
      // Run full migration
      console.log('🔄 Running payment system migration...');
      
      await migration.up(sequelize.getQueryInterface(), sequelize.constructor);
      
      console.log('✅ Payment system migration completed successfully!');
    }

    // Verify migration results
    console.log('\n📋 Verifying migration results...');
    
    const [paymentTable] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'Payments';
    `);
    
    const [creditBalanceColumn] = await sequelize.query(`
      SELECT column_name, column_default
      FROM information_schema.columns 
      WHERE table_name = 'Participants' 
      AND column_name = 'credit_balance';
    `);
    
    if (paymentTable.length > 0 && creditBalanceColumn.length > 0) {
      console.log('✅ Migration verification passed:');
      console.log('  - Payments table: ✓ Created');
      console.log('  - CreditBalance column: ✓ Added to Participants');
      console.log(`  - Default credit balance: ${creditBalanceColumn[0].column_default || '10000'}`);
    } else {
      throw new Error('Migration verification failed');
    }

    // Test Payment model
    console.log('\n🧪 Testing Payment model...');
    const { Payment } = require('../models');
    
    const testPayment = await Payment.build({
      participantId: 1,
      amount: 100,
      credits: 100,
      note: 'Test payment',
      idempotencyKey: 'test-' + Date.now(),
      status: 'new'
    });
    
    await testPayment.validate();
    console.log('✅ Payment model validation passed');

    console.log('\n🎉 Payment System Migration Complete!');
    console.log('\n📋 Next Steps:');
    console.log('1. Add MercadoPago environment variables to .env');
    console.log('2. Configure MercadoPago webhook URL in MP dashboard');
    console.log('3. Test createTopupLink tool in OpenAI Assistant');
    console.log('4. Restart the application server');

  } catch (error) {
    console.error('❌ Payment system migration failed:', error);
    console.error('\n🔧 Troubleshooting:');
    console.error('1. Ensure database is running and accessible');
    console.error('2. Check database connection string in .env');
    console.error('3. Verify database user has CREATE TABLE permissions');
    console.error('4. Review error details above for specific issues');
    
    process.exit(1);
  } finally {
    await sequelize.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Run migration if called directly
if (require.main === module) {
  runPaymentMigration()
    .then(() => {
      console.log('\n✨ Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration failed:', error.message);
      process.exit(1);
    });
}

module.exports = { runPaymentMigration };
