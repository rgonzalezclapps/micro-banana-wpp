/**
 * tools/clearRedis.js
 * 
 * Description: Connects to Redis using the REDIS_URL from the environment
 * and executes FLUSHALL to clear all data. This is useful for clearing
 * stale locks or resetting the queue state during development.
 * 
 * Usage: node tools/clearRedis.js
 */

require('dotenv').config();
const { createClient } = require('redis');

async function clearRedis() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.error('❌ REDIS_URL not found in .env file. Please ensure it is set.');
    process.exit(1);
  }

  console.log('🔄 Connecting to Redis...');
  const client = createClient({
    url: redisUrl
  });

  client.on('error', (err) => {
    console.error('❌ Redis Client Error', err);
  });

  try {
    await client.connect();
    console.log('✅ Connected to Redis successfully.');

    console.log('🔥 Executing FLUSHALL...');
    const reply = await client.flushAll();
    console.log(`✅ Redis FLUSHALL command executed successfully. Reply: ${reply}`);

  } catch (err) {
    console.error('❌ An error occurred during the Redis operation:', err);
  } finally {
    console.log('👋 Disconnecting from Redis...');
    await client.disconnect();
    console.log('✅ Disconnected.');
  }
}

clearRedis();
