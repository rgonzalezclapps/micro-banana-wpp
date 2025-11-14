/**
 * tools/migrateAgentConfigsToAgents.js
 * 
 * Description: Migrates existing AgentConfig documents to consolidated Agent model
 * 
 * Usage: node tools/migrateAgentConfigsToAgents.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');

// Import Agent model
const Agent = require('../models/Agent');

async function migrateAgentConfigs() {
  console.log('🔄 Starting AgentConfig → Agent migration...\n');
  
  try {
    // Connect to databases
    await DatabaseManager.initializeAll();
    
    // Access AgentConfig collection directly (model file deleted but collection exists)
    const AgentConfigCollection = mongoose.connection.collection('agentConfigs');
    const agentConfigs = await AgentConfigCollection.find({}).toArray();
    console.log(`📂 Found ${agentConfigs.length} AgentConfigs to migrate\n`);
    
    if (agentConfigs.length === 0) {
      console.log('⚠️  No AgentConfigs found. Nothing to migrate.');
      return;
    }
    
    let migrated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const config of agentConfigs) {
      console.log(`\n📋 Processing: ${config.agentName} (agentId: ${config.agentId})`);
      console.log('─'.repeat(50));
      
      try {
        // Map channelType to agent type
        const agentType = config.channelConfig.channelType === 'umsg' ? 'openai' : 'wpp-bsp';
        
        // Check if agent already exists by instanceId
        const existingAgent = await Agent.findOne({ 
          instanceId: config.channelConfig.channelId 
        });
        
        if (existingAgent) {
          console.log(`⚠️  Agent already exists with instanceId: ${config.channelConfig.channelId}`);
          console.log(`   Skipping to avoid duplicate`);
          skipped++;
          continue;
        }
        
        // Create consolidated Agent
        const newAgent = new Agent({
          // Core identity
          name: config.agentName,
          type: agentType,
          status: config.status, // 'active', 'inactive', etc.
          
          // Platform integration (from channelConfig)
          channelId: config.channelConfig.channelId,
          instanceId: config.channelConfig.channelId, // Use channelId as instanceId
          token: config.channelConfig.channelToken,
          
          // AI configuration
          systemPrompt: config.systemPrompt,
          modelConfig: config.modelConfig,
          responseSchema: config.responseSchema,
          
          // Metadata
          metadata: {
            version: config.metadata?.version || 1,
            category: config.metadata?.category || 'general',
            lastModified: new Date(),
            modifiedBy: 'migration_script',
            notes: config.metadata?.notes ? 
              `${config.metadata.notes} | Migrated from AgentConfig on ${new Date().toISOString()}` :
              `Migrated from AgentConfig (agentId: ${config.agentId}) on ${new Date().toISOString()}`
          }
        });
        
        await newAgent.save();
        
        console.log(`✅ Agent created successfully:`);
        console.log(`   _id: ${newAgent._id}`);
        console.log(`   name: ${newAgent.name}`);
        console.log(`   type: ${newAgent.type}`);
        console.log(`   instanceId: ${newAgent.instanceId}`);
        console.log(`   status: ${newAgent.status}`);
        console.log(`   systemPrompt: ${newAgent.systemPrompt.substring(0, 80)}...`);
        
        migrated++;
        
      } catch (error) {
        console.error(`❌ Error migrating ${config.agentName}:`, error.message);
        errors++;
      }
    }
    
    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('📊 MIGRATION SUMMARY');
    console.log('═'.repeat(50));
    console.log(`✅ Migrated: ${migrated}`);
    console.log(`⚠️  Skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📂 Total processed: ${agentConfigs.length}`);
    
    if (migrated > 0) {
      console.log('\n✅ Migration completed successfully!');
      console.log('\n📝 Next steps:');
      console.log('   1. Verify agents in MongoDB: db.agents.find()');
      console.log('   2. Update any remaining AgentConfig references in code');
      console.log('   3. Test webhook agent resolution');
      console.log('   4. Delete AgentConfig collection when ready: db.agentConfigs.drop()');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await DatabaseManager.closeAll();
    process.exit(0);
  }
}

// Run migration
migrateAgentConfigs();

