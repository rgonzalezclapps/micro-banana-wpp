/**
 * tools/updateConversationsReferences.js
 * 
 * Description: Updates existing Conversations to use Agent and Participant ObjectId references
 * 
 * Usage: node tools/updateConversationsReferences.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');

const Agent = require('../models/Agent');
const Participant = require('../models/Participant');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

async function updateConversationReferences() {
  console.log('🔄 Starting Conversation references update...\n');
  
  try {
    await DatabaseManager.initializeAll();
    
    // Step 1: Get all conversations
    const conversations = await Conversation.find({}).lean();
    console.log(`📂 Found ${conversations.length} conversations to update\n`);
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    let messagesCreated = 0;
    
    for (const conv of conversations) {
      console.log(`\n📋 Processing conversation: ${conv._id}`);
      console.log('─'.repeat(50));
      
      try {
        let needsUpdate = false;
        const updates = {};
        
        // Check if agentId is Number (needs migration)
        if (typeof conv.agentId === 'number') {
          console.log(`   🔍 Found numeric agentId: ${conv.agentId}`);
          
          // Find agent in old agentConfigs collection
          const AgentConfigCollection = mongoose.connection.collection('agentConfigs');
          const agentConfig = await AgentConfigCollection.findOne({ agentId: conv.agentId });
          
          if (agentConfig) {
            // Find new Agent by instanceId
            const newAgent = await Agent.findOne({ instanceId: agentConfig.channelConfig.channelId });
            
            if (newAgent) {
              updates.agentId = newAgent._id;
              updates.agentName = newAgent.name;
              needsUpdate = true;
              console.log(`   ✅ Mapped to Agent ObjectId: ${newAgent._id}`);
            } else {
              console.warn(`   ⚠️  No Agent found with instanceId: ${agentConfig.channelConfig.channelId}`);
            }
          } else {
            console.warn(`   ⚠️  No AgentConfig found for agentId: ${conv.agentId}`);
          }
        }
        
        // Check if participantId is Number (needs migration)
        if (typeof conv.participantId === 'number') {
          console.log(`   🔍 Found numeric participantId: ${conv.participantId}`);
          
          // Find participant by phone number
          const participant = await Participant.findByPhone(conv.phoneNumber);
          
          if (participant) {
            updates.participantId = participant._id;
            updates.participantName = participant.name;
            needsUpdate = true;
            console.log(`   ✅ Mapped to Participant ObjectId: ${participant._id}`);
          } else {
            // Create new participant
            const newParticipant = new Participant({
              phoneNumber: conv.phoneNumber,
              name: conv.participantName || 'Unknown',
              status: 'active',
              creditBalance: 2000,  // 2000 créditos de bienvenida
              metadata: {
                createdVia: 'migration',
                notes: `Created during conversation migration for phone: ${conv.phoneNumber}`
              }
            });
            
            await newParticipant.save();
            updates.participantId = newParticipant._id;
            updates.participantName = newParticipant.name;
            needsUpdate = true;
            console.log(`   ✅ Created new Participant: ${newParticipant._id}`);
          }
        }
        
        // Initialize messageCount if it doesn't exist
        if (conv.messageCount === undefined) {
          // Count messages if embedded array exists
          if (conv.messages && Array.isArray(conv.messages)) {
            updates.messageCount = conv.messages.length;
            needsUpdate = true;
            console.log(`   ✅ Set messageCount: ${conv.messages.length}`);
            
            // Migrate embedded messages to Message collection
            for (const msg of conv.messages) {
              const newMessage = new Message({
                conversationId: conv._id,
                sender: msg.sender,
                type: msg.type,
                content: msg.content || [],
                audioTranscription: msg.audioTranscription,
                timestamp: msg.timestamp || new Date(),
                status: msg.status || 'pending',
                ultraMsgData: msg.ultraMsgData,
                thinking: msg.thinking,
                aiSystemMessage: msg.aiSystemMessage,
                openaiToolContext: msg.openaiToolContext,
                recipient: msg.recipient,
                fileStorage: msg.fileStorage,
                msg_foreign_id: msg.msg_foreign_id,
                msg_source: msg.msg_source
              });
              
              await newMessage.save();
              messagesCreated++;
            }
            
            console.log(`   ✅ Migrated ${conv.messages.length} messages to Message collection`);
          } else {
            updates.messageCount = 0;
            needsUpdate = true;
          }
        }
        
        // Apply updates
        if (needsUpdate) {
          await Conversation.updateOne({ _id: conv._id }, { $set: updates, $unset: { messages: "" } });
          console.log(`   ✅ Conversation updated successfully`);
          updated++;
        } else {
          console.log(`   ⏭️  Conversation already up-to-date`);
          skipped++;
        }
        
      } catch (error) {
        console.error(`   ❌ Error updating conversation ${conv._id}:`, error.message);
        errors++;
      }
    }
    
    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('📊 MIGRATION SUMMARY');
    console.log('═'.repeat(50));
    console.log(`✅ Updated: ${updated}`);
    console.log(`📨 Messages created: ${messagesCreated}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📂 Total processed: ${conversations.length}`);
    
    if (updated > 0) {
      console.log('\n✅ Migration completed successfully!');
      console.log('\n📝 Next steps:');
      console.log('   1. Test webhook processing with new ObjectId references');
      console.log('   2. Verify messages in Message collection');
      console.log('   3. Delete agentConfigs collection when ready: db.agentConfigs.drop()');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await DatabaseManager.closeAll();
    process.exit(0);
  }
}

// Run migration
updateConversationReferences();

