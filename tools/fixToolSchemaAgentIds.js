/**
 * tools/fixToolSchemaAgentIds.js
 * 
 * Description: Updates ToolSchema enabledForAgents with correct Agent ObjectIds
 * 
 * Usage: node tools/fixToolSchemaAgentIds.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');

const Agent = require('../models/Agent');
const ToolSchema = require('../models/ToolSchema');

async function fixToolSchemaAgentIds() {
  console.log('🔄 Starting ToolSchema Agent ID fix...\n');
  
  try {
    await DatabaseManager.initializeAll();
    
    // Step 1: Get all agents and build mapping
    console.log('📊 Step 1: Building Agent mapping from instanceIds...');
    console.log('─'.repeat(50));
    
    const agents = await Agent.find({}).lean();
    console.log(`📂 Found ${agents.length} Agents\n`);
    
    // Manual mapping based on known agent structure
    // agentId 1 → Bananon → instanceId: 34104
    // agentId 2 → Maxi Prod → instanceId: 50151
    // agentId 3 → Delfino → instanceId: 559995607197034
    
    const instanceToOldId = {
      '34104': 1,      // Bananon
      '50151': 2,      // Maxi Prod
      '559995607197034': 3  // Delfino
    };
    
    // Build reverse mapping: oldId → ObjectId
    const oldIdToObjectId = new Map();
    
    agents.forEach(agent => {
      const oldId = instanceToOldId[agent.instanceId];
      if (oldId) {
        oldIdToObjectId.set(oldId, agent._id);
        console.log(`   ${oldId} (${agent.name}) → ${agent._id}`);
      }
    });
    
    console.log(`\n✅ Mapping complete: ${oldIdToObjectId.size} agents mapped\n`);
    
    // Step 2: Update all ToolSchemas
    console.log('📊 Step 2: Updating ToolSchemas...');
    console.log('─'.repeat(50));
    
    const toolSchemas = await ToolSchema.find({});
    console.log(`📂 Found ${toolSchemas.length} ToolSchemas to update\n`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const tool of toolSchemas) {
      console.log(`\n🛠️  ${tool.toolName}`);
      
      try {
        // Check if enabledForAgents contains Numbers
        const hasNumericIds = tool.enabledForAgents && 
                              tool.enabledForAgents.length > 0 && 
                              typeof tool.enabledForAgents[0] === 'number';
        
        if (!hasNumericIds) {
          console.log(`   ⏭️  Already using ObjectIds or empty`);
          skipped++;
          continue;
        }
        
        console.log(`   📋 Old IDs: [${tool.enabledForAgents.join(', ')}]`);
        
        // Map to ObjectIds
        const newAgentIds = [];
        for (const oldId of tool.enabledForAgents) {
          if (oldIdToObjectId.has(oldId)) {
            const objectId = oldIdToObjectId.get(oldId);
            newAgentIds.push(objectId);
            
            // Get agent name for logging
            const agent = agents.find(a => a._id.toString() === objectId.toString());
            console.log(`      ${oldId} → ${objectId} (${agent?.name || 'Unknown'})`);
          } else {
            console.warn(`      ⚠️  No Agent found for oldId ${oldId}`);
          }
        }
        
        if (newAgentIds.length > 0) {
          tool.enabledForAgents = newAgentIds;
          tool.metadata.lastModified = new Date();
          tool.metadata.modifiedBy = 'migration_script';
          tool.metadata.notes = `${tool.metadata.notes || ''} | Updated to ObjectId references on ${new Date().toISOString()}`;
          
          await tool.save();
          
          console.log(`   ✅ Updated successfully`);
          updated++;
        } else {
          console.warn(`   ⚠️  No valid mappings - skipped`);
          skipped++;
        }
        
      } catch (error) {
        console.error(`   ❌ Error:`, error.message);
      }
    }
    
    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('📊 UPDATE SUMMARY');
    console.log('═'.repeat(50));
    console.log(`✅ Updated: ${updated}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`📂 Total: ${toolSchemas.length}`);
    
    if (updated > 0) {
      console.log('\n✅ ToolSchemas updated successfully!');
      console.log('\n📝 Tool-Agent associations now use ObjectIds');
      
      // Show final tool distribution
      console.log('\n🛠️  Final Tool Distribution:');
      const updatedTools = await ToolSchema.find({}).populate('enabledForAgents', 'name').lean();
      for (const tool of updatedTools) {
        const agentNames = tool.enabledForAgents?.map(a => a.name || 'Unknown').join(', ') || 'None';
        console.log(`   - ${tool.toolName}: ${agentNames}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await DatabaseManager.closeAll();
    process.exit(0);
  }
}

// Run fix
fixToolSchemaAgentIds();

