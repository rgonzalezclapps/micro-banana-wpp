/**
 * tools/forceUpdateToolSchemas.js
 * 
 * Description: Force update ToolSchemas using direct collection updates
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');
const Agent = require('../models/Agent');

async function forceUpdateToolSchemas() {
  console.log('🔄 Force updating ToolSchemas...\n');
  
  try {
    await DatabaseManager.initializeAll();
    
    // Get agents
    const agents = await Agent.find({}).lean();
    
    // Build mapping: oldId → ObjectId
    const mapping = {
      1: agents.find(a => a.instanceId === '34104')?._id,      // Bananon
      2: agents.find(a => a.instanceId === '50151')?._id,      // Maxi Prod
      3: agents.find(a => a.instanceId === '559995607197034')?._id  // Delfino
    };
    
    console.log('📊 Agent Mapping:');
    console.log(`   1 → ${mapping[1]} (Bananon)`);
    console.log(`   2 → ${mapping[2]} (Maxi Prod)`);
    console.log(`   3 → ${mapping[3]} (Delfino)`);
    console.log('');
    
    // Access collection directly
    const ToolSchemaCollection = mongoose.connection.collection('toolSchemas');
    const tools = await ToolSchemaCollection.find({}).toArray();
    
    console.log(`📂 Updating ${tools.length} ToolSchemas...\n`);
    
    let updated = 0;
    
    for (const tool of tools) {
      console.log(`🛠️  ${tool.toolName}`);
      console.log(`   Old IDs: [${tool.enabledForAgents?.join(', ') || 'none'}]`);
      
      if (tool.enabledForAgents && tool.enabledForAgents.length > 0) {
        // Map to ObjectIds
        const newIds = tool.enabledForAgents
          .filter(oldId => mapping[oldId]) // Only keep valid mappings
          .map(oldId => mapping[oldId]);
        
        if (newIds.length > 0) {
          // Direct update
          await ToolSchemaCollection.updateOne(
            { _id: tool._id },
            { 
              $set: { 
                enabledForAgents: newIds,
                'metadata.lastModified': new Date(),
                'metadata.modifiedBy': 'migration_force_update'
              } 
            }
          );
          
          console.log(`   ✅ New IDs: [${newIds.map(id => id.toString().substring(0, 12) + '...').join(', ')}]`);
          updated++;
        } else {
          console.log(`   ⚠️  No valid mappings found`);
        }
      } else {
        console.log(`   ⏭️  No agents assigned`);
      }
      console.log('');
    }
    
    console.log('═'.repeat(50));
    console.log(`✅ Updated ${updated} ToolSchemas`);
    console.log('═'.repeat(50));
    
    // Verify
    console.log('\n🔍 Verification:');
    const updatedTools = await ToolSchemaCollection.find({}).toArray();
    for (const tool of updatedTools) {
      if (tool.enabledForAgents && tool.enabledForAgents.length > 0) {
        const firstType = typeof tool.enabledForAgents[0];
        const isObjectId = tool.enabledForAgents[0]._bsontype === 'ObjectId';
        console.log(`   ${tool.toolName}: ${firstType}, isObjectId: ${isObjectId}`);
      }
    }
    
    console.log('\n✅ All ToolSchemas updated successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await DatabaseManager.closeAll();
    process.exit(0);
  }
}

forceUpdateToolSchemas();

