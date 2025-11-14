/**
 * tools/cleanPaymentRecordCollection.js
 * 
 * Description: Remove redundant paymentRecords collection from MongoDB
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');

async function cleanPaymentRecordCollection() {
  console.log('🧹 Removing redundant paymentRecords collection...\n');
  
  try {
    await DatabaseManager.initializeAll();
    
    // Check if collection exists
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    if (collectionNames.includes('paymentRecords')) {
      const count = await mongoose.connection.db.collection('paymentRecords').countDocuments();
      console.log(`📂 Found paymentRecords collection with ${count} documents`);
      
      if (count > 0) {
        console.log(`⚠️  Collection has ${count} documents - will be deleted`);
      }
      
      // Drop collection
      await mongoose.connection.db.collection('paymentRecords').drop();
      console.log('✅ paymentRecords collection deleted successfully\n');
    } else {
      console.log('ℹ️  paymentRecords collection does not exist (already clean)\n');
    }
    
    // Verify final state
    console.log('📊 Final Collections:');
    const finalCollections = await mongoose.connection.db.listCollections().toArray();
    finalCollections
      .filter(c => !c.name.startsWith('system.'))
      .forEach(c => console.log(`   - ${c.name}`));
    
    console.log('\n✅ Database cleanup complete!');
    console.log('📝 Only Payment model remains for payment system');
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  } finally {
    await DatabaseManager.closeAll();
    process.exit(0);
  }
}

cleanPaymentRecordCollection();

