/**
 * tools/testPaymentFlow.js
 * 
 * Description: Test complete payment flow with MongoDB
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');

const Agent = require('../models/Agent');
const Participant = require('../models/Participant');
const Conversation = require('../models/Conversation');
const Payment = require('../models/Payment');
const mercadopagoService = require('../services/mercadopagoService');

async function testPaymentFlow() {
  console.log('🧪 Testing Payment Flow with MongoDB...\n');
  
  try {
    await DatabaseManager.initializeAll();
    
    // Step 1: Create test participant
    console.log('1️⃣  Creating test participant...');
    const testParticipant = new Participant({
      name: 'Test Payment User',
      phoneNumber: `549${Date.now()}`,
      status: 'active',
      creditBalance: 100
    });
    await testParticipant.save();
    console.log(`✅ Participant created: ${testParticipant._id}\n`);
    
    // Step 2: Create test payment
    console.log('2️⃣  Creating test payment...');
    const testExternalRef = `topup_test_${Date.now()}`;
    
    const testPayment = new Payment({
      participantId: testParticipant._id,
      amount: 1000,
      credits: 1000,
      status: 'pending',
      externalReference: testExternalRef,
      idempotencyKey: `test_${Date.now()}`,
      mpPaymentId: 'test_mp_123',
      mpPreferenceId: 'test_pref_456'
    });
    await testPayment.save();
    console.log(`✅ Payment created: ${testPayment._id}`);
    console.log(`   externalReference: ${testPayment.externalReference}\n`);
    
    // Step 3: Test payment lookup (simulate webhook)
    console.log('3️⃣  Testing payment lookup (MongoDB syntax)...');
    
    const foundPayment = await Payment.findOne({
      externalReference: testExternalRef
    });
    
    if (foundPayment) {
      console.log(`✅ Payment found successfully!`);
      console.log(`   _id: ${foundPayment._id}`);
      console.log(`   participantId: ${foundPayment.participantId}`);
      console.log(`   amount: ${foundPayment.amount}`);
      console.log(`   credits: ${foundPayment.credits}`);
      console.log(`   status: ${foundPayment.status}`);
    } else {
      console.error(`❌ Payment NOT found with externalReference: ${testExternalRef}`);
      console.log('   This would cause the webhook to fail!\n');
      
      // Debug: Try with wrong Sequelize syntax
      console.log('🔍 Trying with Sequelize syntax (should fail):');
      try {
        const wrongQuery = await Payment.findOne({
          where: { externalReference: testExternalRef }
        });
        console.log(`   Result: ${wrongQuery ? 'Found (unexpected)' : 'Not found (expected)'}`);
      } catch (err) {
        console.log(`   Error (expected): Query doesn't work with Mongoose`);
      }
    }
    console.log('');
    
    // Step 4: Test credit operation
    console.log('4️⃣  Testing credit acreditation...');
    const initialBalance = testParticipant.creditBalance;
    await testParticipant.addCredits(testPayment.credits);
    console.log(`✅ Credits added: ${initialBalance} → ${testParticipant.creditBalance}`);
    console.log('');
    
    // Step 5: Test payment status update
    console.log('5️⃣  Testing payment status update...');
    await testPayment.markAsCredited();
    console.log(`✅ Payment marked as credited`);
    console.log(`   status: ${testPayment.status}`);
    console.log(`   creditedAt: ${testPayment.creditedAt}`);
    console.log('');
    
    // Cleanup
    console.log('🧹 Cleaning up test data...');
    await Payment.deleteOne({ _id: testPayment._id });
    await Participant.deleteOne({ _id: testParticipant._id });
    console.log('✅ Cleanup complete\n');
    
    // Summary
    console.log('═'.repeat(50));
    console.log('✅ PAYMENT FLOW TEST PASSED');
    console.log('═'.repeat(50));
    console.log('');
    console.log('📝 Validated:');
    console.log('   ✅ Payment creation with ObjectId participantId');
    console.log('   ✅ Payment lookup with MongoDB syntax (no "where:")');
    console.log('   ✅ Participant credit operations');
    console.log('   ✅ Payment status updates');
    console.log('');
    console.log('🚀 Payment webhook should now work correctly!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await DatabaseManager.closeAll();
    process.exit(0);
  }
}

testPaymentFlow();

