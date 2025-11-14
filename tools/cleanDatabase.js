/**
 * tools/cleanDatabase.js
 * 
 * Description: Clean MongoDB database keeping only Agents and ToolSchemas
 * 
 * Usage: node tools/cleanDatabase.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { DatabaseManager } = require('../database');

async function cleanDatabase() {
  console.log('🧹 Starting Database Cleanup...\n');
  
  try {
    await DatabaseManager.initializeAll();
    
    // Get all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collectionNames = collections.map(c => c.name);
    
    console.log('📂 Current collections:');
    collectionNames.forEach(name => console.log(`   - ${name}`));
    console.log('');
    
    // Collections to PRESERVE
    const preserveCollections = [
      'agents',        // Agent configurations
      'toolschemas'    // Tool definitions
    ];
    
    // Collections to DELETE
    const deleteCollections = collectionNames.filter(name => 
      !preserveCollections.includes(name.toLowerCase()) && 
      !name.startsWith('system.')  // Don't touch MongoDB system collections
    );
    
    console.log('✅ Collections to PRESERVE:');
    preserveCollections.forEach(name => {
      const exists = collectionNames.some(c => c.toLowerCase() === name);
      console.log(`   - ${name} ${exists ? '(exists)' : '(will be created)'}`);
    });
    console.log('');
    
    console.log('🗑️  Collections to DELETE:');
    if (deleteCollections.length === 0) {
      console.log('   (none - database is already clean)');
    } else {
      for (const name of deleteCollections) {
        const count = await mongoose.connection.db.collection(name).countDocuments();
        console.log(`   - ${name} (${count} documents)`);
      }
    }
    console.log('');
    
    // Show Agent and ToolSchema counts
    const Agent = require('../models/Agent');
    const ToolSchema = require('../models/ToolSchema');
    
    const agentCount = await Agent.countDocuments();
    const toolCount = await ToolSchema.countDocuments();
    
    console.log('📊 Data to preserve:');
    console.log(`   - Agents: ${agentCount} documents`);
    console.log(`   - ToolSchemas: ${toolCount} documents`);
    console.log('');
    
    // List agents
    if (agentCount > 0) {
      const agents = await Agent.find({}).select('name type instanceId status').lean();
      console.log('🤖 Agents that will be preserved:');
      agents.forEach(agent => {
        console.log(`   - ${agent.name} (${agent.type}) - instanceId: ${agent.instanceId} - status: ${agent.status}`);
      });
      console.log('');
    }
    
    // Confirmation prompt
    if (deleteCollections.length > 0) {
      console.log('⚠️  WARNING: This will permanently delete the following collections:');
      deleteCollections.forEach(name => console.log(`   - ${name}`));
      console.log('');
      console.log('═'.repeat(50));
      console.log('⚠️  THIS ACTION CANNOT BE UNDONE');
      console.log('═'.repeat(50));
      console.log('');
      
      // Auto-proceed (no interactive prompt in script)
      console.log('🚀 Proceeding with cleanup...\n');
      
      // Delete collections
      for (const name of deleteCollections) {
        try {
          await mongoose.connection.db.collection(name).drop();
          console.log(`✅ Deleted collection: ${name}`);
        } catch (error) {
          if (error.code === 26) {
            console.log(`⏭️  Collection ${name} already deleted`);
          } else {
            console.error(`❌ Error deleting ${name}:`, error.message);
          }
        }
      }
      
      console.log('');
    }
    
    // Final summary
    console.log('═'.repeat(50));
    console.log('📊 CLEANUP SUMMARY');
    console.log('═'.repeat(50));
    console.log(`✅ Agents preserved: ${agentCount}`);
    console.log(`✅ ToolSchemas preserved: ${toolCount}`);
    console.log(`🗑️  Collections deleted: ${deleteCollections.length}`);
    console.log('');
    
    console.log('✅ Database cleaned successfully!');
    console.log('');
    console.log('📝 Database is now ready with clean slate:');
    console.log('   - Agent configurations preserved');
    console.log('   - Tool definitions preserved');
    console.log('   - All transactional data cleared');
    console.log('   - Ready for production use');
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await DatabaseManager.closeAll();
    process.exit(0);
  }
}

// Run cleanup
cleanDatabase();

