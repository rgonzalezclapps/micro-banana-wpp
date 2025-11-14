/**
 * tools/validateMongoMigration.js
 * 
 * Description: Validation script to test MongoDB consolidation migration
 * 
 * Role in the system: Comprehensive testing of all critical flows after migration
 * 
 * Node.js Context: Tool - Migration validation and testing
 * 
 * Usage: node tools/validateMongoMigration.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');

// Import models
const Agent = require('../models/Agent');
const Participant = require('../models/Participant');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Payment = require('../models/Payment');

// Test results tracking
const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

function logTest(name, status, details = '') {
  const symbol = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  console.log(`${symbol} ${name}${details ? ': ' + details : ''}`);
  
  if (status === 'pass') testResults.passed.push(name);
  else if (status === 'fail') testResults.failed.push({ name, details });
  else testResults.warnings.push({ name, details });
}

async function validateMongoMigration() {
  console.log('🧪 Starting MongoDB Consolidation Validation...\n');
  
  try {
    // ========================================================================
    // TEST 1: Database Connections
    // ========================================================================
    console.log('📊 Test 1: Database Connections');
    console.log('─'.repeat(50));
    
    const dbStatus = await DatabaseManager.initializeAll();
    
    if (dbStatus.mongodb) {
      logTest('MongoDB connection', 'pass');
    } else {
      logTest('MongoDB connection', 'fail', 'Could not connect to MongoDB');
      return;
    }
    
    if (dbStatus.redis) {
      logTest('Redis connection', 'pass');
    } else {
      logTest('Redis connection', 'warn', 'Redis not available');
    }
    
    console.log('');
    
    // ========================================================================
    // TEST 2: Agent Model (Consolidated)
    // ========================================================================
    console.log('📊 Test 2: Agent Model (Consolidated)');
    console.log('─'.repeat(50));
    
    // Test agent creation
    const testAgent = new Agent({
      name: 'Test Agent',
      type: 'openai',
      status: 'active',
      instanceId: `test_${Date.now()}`,
      token: 'test_token_123',
      systemPrompt: 'You are a helpful assistant for testing.',
      modelConfig: {
        model: 'gpt-5-mini',
        maxCompletionTokens: 16000,
        temperature: 1.0,
        streaming: true
      },
      responseSchema: {
        name: 'test_schema',
        strict: true,
        schema: { type: 'object', properties: {} }
      }
    });
    
    await testAgent.save();
    logTest('Agent creation with consolidated model', 'pass', `ID: ${testAgent._id}`);
    
    // Test agent lookup by instanceId
    const foundAgent = await Agent.findByInstanceId(testAgent.instanceId);
    if (foundAgent && foundAgent._id.toString() === testAgent._id.toString()) {
      logTest('Agent.findByInstanceId()', 'pass');
    } else {
      logTest('Agent.findByInstanceId()', 'fail', 'Could not find agent by instanceId');
    }
    
    // Test agent has AI configuration
    const aiConfig = testAgent.getAIConfig();
    if (aiConfig.systemPrompt && aiConfig.modelConfig && aiConfig.responseSchema) {
      logTest('Agent AI configuration access', 'pass');
    } else {
      logTest('Agent AI configuration access', 'fail', 'Missing AI config fields');
    }
    
    console.log('');
    
    // ========================================================================
    // TEST 3: Participant Model (Renamed from ParticipantProfile)
    // ========================================================================
    console.log('📊 Test 3: Participant Model');
    console.log('─'.repeat(50));
    
    // Test participant creation (should NOT have participantId Number)
    const testParticipant = new Participant({
      name: 'Test User',
      phoneNumber: `549${Date.now()}`,
      status: 'active',
      creditBalance: 1000
    });
    
    await testParticipant.save();
    logTest('Participant creation with ObjectId', 'pass', `ID: ${testParticipant._id}`);
    
    // Verify participantId Number field does not exist
    if (testParticipant.participantId === undefined) {
      logTest('participantId Number removed', 'pass');
    } else {
      logTest('participantId Number removed', 'fail', 'participantId still exists');
    }
    
    // Test participant lookup by phone
    const foundParticipant = await Participant.findByPhone(testParticipant.phoneNumber);
    if (foundParticipant && foundParticipant._id.toString() === testParticipant._id.toString()) {
      logTest('Participant.findByPhone()', 'pass');
    } else {
      logTest('Participant.findByPhone()', 'fail');
    }
    
    // Test credit operations
    await testParticipant.addCredits(500);
    if (testParticipant.creditBalance === 1500) {
      logTest('Participant.addCredits()', 'pass');
    } else {
      logTest('Participant.addCredits()', 'fail', `Expected 1500, got ${testParticipant.creditBalance}`);
    }
    
    console.log('');
    
    // ========================================================================
    // TEST 4: Conversation Model (ObjectId References)
    // ========================================================================
    console.log('📊 Test 4: Conversation Model');
    console.log('─'.repeat(50));
    
    // Test conversation creation with ObjectId refs
    const testConversation = new Conversation({
      participantId: testParticipant._id,  // ObjectId
      phoneNumber: testParticipant.phoneNumber,
      participantName: testParticipant.name,
      agentId: testAgent._id,  // ObjectId
      agentName: testAgent.name,
      messageCount: 0,
      status: 'active'
    });
    
    await testConversation.save();
    logTest('Conversation creation with ObjectId refs', 'pass', `ID: ${testConversation._id}`);
    
    // Verify messages array does NOT exist
    if (testConversation.messages === undefined || Array.isArray(testConversation.messages) === false) {
      logTest('Conversation.messages array removed', 'pass');
    } else {
      logTest('Conversation.messages array removed', 'fail', 'messages array still exists');
    }
    
    // Verify messageCount field exists
    if (typeof testConversation.messageCount === 'number') {
      logTest('Conversation.messageCount field added', 'pass');
    } else {
      logTest('Conversation.messageCount field added', 'fail');
    }
    
    // Test conversation lookup
    const foundConversation = await Conversation.findByParticipantAndAgent(
      testParticipant._id,
      testAgent._id
    );
    if (foundConversation && foundConversation._id.toString() === testConversation._id.toString()) {
      logTest('Conversation.findByParticipantAndAgent()', 'pass');
    } else {
      logTest('Conversation.findByParticipantAndAgent()', 'fail');
    }
    
    console.log('');
    
    // ========================================================================
    // TEST 5: Message Model (Separated Collection)
    // ========================================================================
    console.log('📊 Test 5: Message Model (Separated Collection)');
    console.log('─'.repeat(50));
    
    // Test message creation
    const testMessage1 = new Message({
      conversationId: testConversation._id,
      sender: 'user',
      type: 'text',
      content: [{ order: 0, content: 'Hello, this is a test message' }],
      timestamp: new Date(),
      status: 'received',
      msg_foreign_id: `test_msg_${Date.now()}_1`,
      ultraMsgData: {
        id: `test_msg_${Date.now()}_1`,
        from: testParticipant.phoneNumber,
        body: 'Hello, this is a test message'
      }
    });
    
    await testMessage1.save();
    logTest('Message creation in separated collection', 'pass', `ID: ${testMessage1._id}`);
    
    // Test second message
    const testMessage2 = new Message({
      conversationId: testConversation._id,
      sender: 'ai_agent',
      type: 'chat',
      content: [{ order: 0, content: 'Hello! How can I help you?' }],
      timestamp: new Date(),
      status: 'sent',
      recipient: 'user'
    });
    
    await testMessage2.save();
    logTest('Second message creation', 'pass', `ID: ${testMessage2._id}`);
    
    // Update conversation message count
    testConversation.messageCount = 2;
    testConversation.lastMessage = 'Hello! How can I help you?';
    testConversation.lastMessageTime = new Date();
    await testConversation.save();
    
    // Test message query by conversation
    const messages = await Message.findByConversation(testConversation._id);
    if (messages.length === 2) {
      logTest('Message.findByConversation()', 'pass', `Found ${messages.length} messages`);
    } else {
      logTest('Message.findByConversation()', 'fail', `Expected 2, found ${messages.length}`);
    }
    
    // Test message count
    const messageCount = await Message.countByConversation(testConversation._id);
    if (messageCount === 2) {
      logTest('Message.countByConversation()', 'pass');
    } else {
      logTest('Message.countByConversation()', 'fail', `Expected 2, got ${messageCount}`);
    }
    
    // Test message lookup by foreign ID
    const messageByForeignId = await Message.findByForeignId(testMessage1.msg_foreign_id);
    if (messageByForeignId && messageByForeignId._id.toString() === testMessage1._id.toString()) {
      logTest('Message.findByForeignId()', 'pass');
    } else {
      logTest('Message.findByForeignId()', 'fail');
    }
    
    console.log('');
    
    // ========================================================================
    // TEST 6: Payment Model (ObjectId References)
    // ========================================================================
    console.log('📊 Test 6: Payment Model');
    console.log('─'.repeat(50));
    
    // Test payment creation with ObjectId participantId
    const testPayment = new Payment({
      participantId: testParticipant._id,  // ObjectId
      amount: 1000,
      credits: 1000,
      status: 'new',
      idempotencyKey: `test_idem_${Date.now()}`
    });
    
    await testPayment.save();
    
    // Verify participantId is ObjectId
    if (testPayment.participantId instanceof mongoose.Types.ObjectId) {
      logTest('Payment.participantId is ObjectId', 'pass');
    } else {
      logTest('Payment.participantId is ObjectId', 'fail', `Type: ${typeof testPayment.participantId}`);
    }
    
    // Test payment lookup
    const foundPayment = await Payment.findByIdempotencyKey(testPayment.idempotencyKey);
    if (foundPayment && foundPayment._id.toString() === testPayment._id.toString()) {
      logTest('Payment.findByIdempotencyKey()', 'pass');
    } else {
      logTest('Payment.findByIdempotencyKey()', 'fail');
    }
    
    console.log('');
    
    // ========================================================================
    // TEST 7: Virtual Populate (Backward Compatibility)
    // ========================================================================
    console.log('📊 Test 7: Virtual Populate & Compatibility');
    console.log('─'.repeat(50));
    
    // Test conversation with populated messages
    const conversationWithMessages = await Conversation.findById(testConversation._id)
      .populate('messages');
    
    if (conversationWithMessages.messages && conversationWithMessages.messages.length === 2) {
      logTest('Virtual populate for messages', 'pass', `${conversationWithMessages.messages.length} messages`);
    } else {
      logTest('Virtual populate for messages', 'fail', 'Messages not populated');
    }
    
    // Test legacy id virtual
    if (testAgent.id && testAgent.id === testAgent._id.toString()) {
      logTest('Legacy id virtual property', 'pass');
    } else {
      logTest('Legacy id virtual property', 'fail');
    }
    
    console.log('');
    
    // ========================================================================
    // CLEANUP: Remove test data
    // ========================================================================
    console.log('🧹 Cleaning up test data...');
    
    await Message.deleteMany({ conversationId: testConversation._id });
    await Conversation.deleteOne({ _id: testConversation._id });
    await Payment.deleteOne({ _id: testPayment._id });
    await Participant.deleteOne({ _id: testParticipant._id });
    await Agent.deleteOne({ _id: testAgent._id });
    
    console.log('✅ Test data cleaned up\n');
    
    // ========================================================================
    // RESULTS SUMMARY
    // ========================================================================
    console.log('═'.repeat(50));
    console.log('📊 VALIDATION RESULTS SUMMARY');
    console.log('═'.repeat(50));
    console.log(`✅ Passed: ${testResults.passed.length}`);
    console.log(`❌ Failed: ${testResults.failed.length}`);
    console.log(`⚠️  Warnings: ${testResults.warnings.length}`);
    console.log('');
    
    if (testResults.failed.length > 0) {
      console.log('❌ Failed Tests:');
      testResults.failed.forEach(({ name, details }) => {
        console.log(`  - ${name}: ${details}`);
      });
      console.log('');
    }
    
    if (testResults.warnings.length > 0) {
      console.log('⚠️  Warnings:');
      testResults.warnings.forEach(({ name, details }) => {
        console.log(`  - ${name}: ${details}`);
      });
      console.log('');
    }
    
    if (testResults.failed.length === 0) {
      console.log('🎉 ALL TESTS PASSED! MongoDB consolidation migration is successful.');
      console.log('');
      console.log('✅ System is ready to use with:');
      console.log('  - MongoDB-only architecture');
      console.log('  - Separated Message collection');
      console.log('  - ObjectId references throughout');
      console.log('  - Consolidated Agent model');
      console.log('  - Renamed Participant model');
    } else {
      console.log('⚠️  Some tests failed. Please review and fix issues before deploying.');
    }
    
    console.log('═'.repeat(50));
    
  } catch (error) {
    console.error('❌ Validation failed with error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Close connections
    await DatabaseManager.closeAll();
    process.exit(testResults.failed.length === 0 ? 0 : 1);
  }
}

// Run validation
validateMongoMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

