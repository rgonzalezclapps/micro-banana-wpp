/**
 * tools/testToolLoading.js
 * 
 * Description: Test tool loading with new ObjectId system
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');

const Agent = require('../models/Agent');
const ToolSchema = require('../models/ToolSchema');

async function testToolLoading() {
  console.log('🧪 Testing Tool Loading System...\n');
  
  try {
    await DatabaseManager.initializeAll();
    
    // Get Maxi Prod agent
    const maxiProd = await Agent.findOne({ name: 'Maxi Prod' });
    
    if (!maxiProd) {
      console.error('❌ Maxi Prod agent not found');
      return;
    }
    
    console.log('🤖 Testing with Agent: Maxi Prod');
    console.log(`   _id: ${maxiProd._id}`);
    console.log(`   instanceId: ${maxiProd.instanceId}`);
    console.log('');
    
    // Test tool loading
    console.log('📊 Loading tools for Maxi Prod...');
    const tools = await ToolSchema.findActiveToolsForAgent(maxiProd._id);
    
    console.log(`✅ Found ${tools.length} tools\n`);
    
    if (tools.length > 0) {
      console.log('🛠️  Tools loaded:');
      tools.forEach(tool => {
        console.log(`   - ${tool.toolDefinition.function.name}`);
      });
    } else {
      console.warn('⚠️  No tools found for this agent');
      
      // Debug: Show what tools exist
      const allTools = await ToolSchema.find({}).select('toolName enabledForAgents').lean();
      console.log('\n📋 All ToolSchemas in database:');
      for (const t of allTools) {
        console.log(`   - ${t.toolName}: agents [${t.enabledForAgents?.map(id => id.toString().substring(0, 8)).join(', ') || 'none'}]`);
      }
    }
    
    console.log('\n═'.repeat(50));
    if (tools.length > 0) {
      console.log('✅ Tool loading system working correctly!');
    } else {
      console.log('⚠️  Tool loading failed - needs investigation');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await DatabaseManager.closeAll();
    process.exit(0);
  }
}

testToolLoading();

