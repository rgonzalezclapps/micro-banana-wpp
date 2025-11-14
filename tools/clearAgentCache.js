/**
 * tools/clearAgentCache.js
 * 
 * Description: Clear Redis cache for a specific agent configuration
 * 
 * Usage: node tools/clearAgentCache.js <agentMongoId>
 * Example: node tools/clearAgentCache.js 69157006d7b5fc82c033dc86
 */

const { redisClient } = require('../database');

async function clearAgentCache(agentId) {
    try {
        console.log(`🚀 Clearing cache for agent ${agentId}`);
        
        // Connect Redis if not connected
        if (!redisClient.isOpen) {
            await redisClient.connect();
            console.log('✅ Connected to Redis');
        }
        
        // Clear agent config cache
        const configCacheKey = `agent_config:${agentId}`;
        const deleted = await redisClient.del(configCacheKey);
        
        if (deleted) {
            console.log(`✅ Cleared agent config cache: ${configCacheKey}`);
        } else {
            console.log(`⚠️ No cache found for key: ${configCacheKey}`);
        }
        
        // Also check for any other related keys
        const keys = await redisClient.keys(`*${agentId}*`);
        if (keys.length > 0) {
            console.log(`📦 Found ${keys.length} related cache keys:`);
            keys.forEach(key => console.log(`  - ${key}`));
            
            for (const key of keys) {
                await redisClient.del(key);
                console.log(`🗑️ Deleted: ${key}`);
            }
        }
        
        console.log(`🎉 Cache clearing completed for agent ${agentId}`);
        
    } catch (error) {
        console.error(`❌ Error clearing cache:`, error.message);
        throw error;
    } finally {
        await redisClient.quit();
        console.log('🔌 Disconnected from Redis');
    }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 1) {
    console.error('Usage: node tools/clearAgentCache.js <agentMongoId>');
    console.error('Example: node tools/clearAgentCache.js 69157006d7b5fc82c033dc86');
    process.exit(1);
}

const [agentId] = args;

// Run cache clear
clearAgentCache(agentId)
    .then(() => {
        console.log('✅ Cache clear completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Cache clear failed:', error.message);
        process.exit(1);
    });

