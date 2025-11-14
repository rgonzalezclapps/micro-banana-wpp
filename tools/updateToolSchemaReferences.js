/**
 * tools/updateToolSchemaReferences.js
 * 
 * Description: Updates ToolSchema enabledForAgents from numeric IDs to ObjectIds
 * 
 * Usage: node tools/updateToolSchemaReferences.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');

const Agent = require('../models/Agent');
const ToolSchema = require('../models/ToolSchema');

async function updateToolSchemaReferences() {
  console.log('🔄 Starting ToolSchema references update...\n');
  
  try {
    await DatabaseManager.initializeAll();
    
    // Step 1: Build mapping of old agentId (Number) to new _id (ObjectId)
    console.log('📊 Step 1: Building Agent ID mapping...');
    console.log('─'.repeat(50));
    
    // Get old AgentConfigs to find the mapping
    const AgentConfigCollection = mongoose.connection.collection('agentConfigs');
    const oldConfigs = await AgentConfigCollection.find({}).toArray();
    
    const idMapping = new Map(); // oldAgentId (Number) → new Agent ObjectId
    
    for (const config of oldConfigs) {
      // Find new Agent by instanceId
      const newAgent = await Agent.findOne({ instanceId: config.channelConfig.channelId });
      
      if (newAgent) {
        idMapping.set(config.agentId, newAgent._id);
        console.log(`   ${config.agentId} (${config.agentName}) → ${newAgent._id}`);
      } else {
        console.warn(`   ⚠️  No Agent found for agentId ${config.agentId} (${config.agentName})`);
      }
    }
    
    console.log(`\n✅ Mapping complete: ${idMapping.size} agents mapped\n`);
    
    // Step 2: Update all ToolSchemas
    console.log('📊 Step 2: Updating ToolSchemas...');
    console.log('─'.repeat(50));
    
    const toolSchemas = await ToolSchema.find({});
    console.log(`📂 Found ${toolSchemas.length} ToolSchemas to update\n`);
    
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const tool of toolSchemas) {
      console.log(`\n🛠️  Processing: ${tool.toolName}`);
      
      try {
        // Check if enabledForAgents contains Numbers
        const hasNumericIds = tool.enabledForAgents && 
                              tool.enabledForAgents.length > 0 && 
                              typeof tool.enabledForAgents[0] === 'number';
        
        if (!hasNumericIds) {
          console.log(`   ⏭️  Already using ObjectIds or empty - skipping`);
          skipped++;
          continue;
        }
        
        console.log(`   🔍 Current enabledForAgents: [${tool.enabledForAgents.join(', ')}]`);
        
        // Map old IDs to new ObjectIds
        const newAgentIds = [];
        for (const oldId of tool.enabledForAgents) {
          if (idMapping.has(oldId)) {
            newAgentIds.push(idMapping.get(oldId));
            console.log(`      ${oldId} → ${idMapping.get(oldId)}`);
          } else {
            console.warn(`      ⚠️  No mapping found for agentId ${oldId} - skipping`);
          }
        }
        
        if (newAgentIds.length > 0) {
          tool.enabledForAgents = newAgentIds;
          await tool.save();
          
          console.log(`   ✅ Updated to: [${newAgentIds.map(id => id.toString().substring(0, 8) + '...').join(', ')}]`);
          updated++;
        } else {
          console.warn(`   ⚠️  No valid agent mappings found - tool not updated`);
          skipped++;
        }
        
      } catch (error) {
        console.error(`   ❌ Error updating ${tool.toolName}:`, error.message);
        errors++;
      }
    }
    
    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('📊 UPDATE SUMMARY');
    console.log('═'.repeat(50));
    console.log(`✅ Updated: ${updated}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📂 Total processed: ${toolSchemas.length}`);
    
    if (updated > 0) {
      console.log('\n✅ ToolSchema references updated successfully!');
      console.log('\n📝 Next steps:');
      console.log('   1. Verify tool loading in responsesClient.js');
      console.log('   2. Test webhook processing with tools');
      console.log('   3. Clean up agentConfigs collection when ready');
    }
    
  } catch (error) {
    console.error('❌ Update failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await DatabaseManager.closeAll();
    process.exit(0);
  }
}

// Run update
updateToolSchemaReferences();

