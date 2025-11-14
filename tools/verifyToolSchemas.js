/**
 * tools/verifyToolSchemas.js
 * 
 * Description: Verify ToolSchema enabledForAgents field types
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');

async function verifyToolSchemas() {
  try {
    await DatabaseManager.initializeAll();
    
    console.log('🔍 Verifying ToolSchemas...\n');
    
    // Access collection directly to see raw data
    const ToolSchemaCollection = mongoose.connection.collection('toolSchemas');
    const tools = await ToolSchemaCollection.find({}).toArray();
    
    console.log(`📂 Found ${tools.length} ToolSchemas\n`);
    
    for (const tool of tools) {
      console.log(`🛠️  ${tool.toolName}`);
      console.log(`   enabledForAgents type: ${typeof tool.enabledForAgents}`);
      console.log(`   enabledForAgents value:`, tool.enabledForAgents);
      
      if (tool.enabledForAgents && tool.enabledForAgents.length > 0) {
        const firstElement = tool.enabledForAgents[0];
        console.log(`   First element type: ${typeof firstElement}`);
        console.log(`   Is ObjectId: ${firstElement instanceof mongoose.Types.ObjectId || (firstElement && firstElement._bsontype === 'ObjectId')}`);
      }
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await DatabaseManager.closeAll();
    process.exit(0);
  }
}

verifyToolSchemas();

