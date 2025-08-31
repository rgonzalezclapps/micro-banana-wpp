#!/usr/bin/env node

/**
 * Redis Inspection Script
 * 
 * Description: Inspects Redis server to understand duplicate detection state
 * 
 * Usage: node tools/inspectRedis.js
 */

require('dotenv').config();
const redis = require('redis');

async function inspectRedis() {
  console.log('🔍 Redis Duplicate Detection Inspector');
  console.log('====================================');
  
  const client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://:Rd4NbY2jF8sL9mEq@api-ai-mvp.com:6379'
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to Redis server:', process.env.REDIS_URL || 'default');
    
    // Get all processed keys
    console.log('\n📋 All "processed:" keys:');
    const allKeys = await client.keys('processed:*');
    console.log(`Found ${allKeys.length} processed message keys`);
    
    if (allKeys.length === 0) {
      console.log('🎉 No duplicate keys found - Redis is clean!');
      return;
    }
    
    // Display each key with details
    console.log('\n🔍 Key Details:');
    for (const key of allKeys) {
      const value = await client.get(key);
      const ttl = await client.ttl(key);
      const keyAge = ttl > 0 ? 600 - ttl : 'expired';
      
      console.log(`\n🔑 Key: ${key}`);
      console.log(`  📄 Value: ${value}`);
      console.log(`  ⏱️  TTL: ${ttl} seconds (${Math.round(ttl/60*100)/100} minutes)`);
      console.log(`  📅 Age: ${typeof keyAge === 'number' ? keyAge + ' seconds' : keyAge}`);
      
      // Extract message info
      const messageId = key.replace('processed:', '');
      console.log(`  🆔 Message ID: ${messageId}`);
      
      // Check if this looks like the problematic message
      if (messageId.includes('false_5491123500639')) {
        console.log(`  🚨 This is the PROBLEMATIC message!`);
      }
    }
    
    // Check Redis info
    console.log('\n📊 Redis Server Info:');
    const info = await client.info('memory');
    const lines = info.split('\r\n');
    lines.forEach(line => {
      if (line.includes('used_memory') || line.includes('keyspace')) {
        console.log(`  ${line}`);
      }
    });
    
    // Check keyspace info
    const keyspaceInfo = await client.info('keyspace');
    console.log('\n🗃️  Keyspace Info:');
    console.log(keyspaceInfo || 'No keyspace info available');
    
  } catch (error) {
    console.error('❌ Redis inspection failed:', error.message);
  } finally {
    await client.quit();
    console.log('\n🔌 Redis connection closed');
  }
}

async function clearDuplicateKeys() {
  console.log('\n🧹 Clearing all duplicate detection keys...');
  
  const client = redis.createClient({
    url: process.env.REDIS_URL || 'redis://:Rd4NbY2jF8sL9mEq@api-ai-mvp.com:6379'
  });
  
  try {
    await client.connect();
    
    const allKeys = await client.keys('processed:*');
    if (allKeys.length === 0) {
      console.log('✨ No keys to clear');
      return;
    }
    
    console.log(`🗑️  Deleting ${allKeys.length} keys...`);
    const deleted = await client.del(...allKeys);
    console.log(`✅ Deleted ${deleted} keys successfully`);
    
  } catch (error) {
    console.error('❌ Clear operation failed:', error.message);
  } finally {
    await client.quit();
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--clear') || args.includes('-c')) {
    await clearDuplicateKeys();
  } else {
    await inspectRedis();
    
    console.log('\n💡 Usage:');
    console.log('  node tools/inspectRedis.js          # Inspect current state');
    console.log('  node tools/inspectRedis.js --clear  # Clear all duplicate keys');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { inspectRedis, clearDuplicateKeys };
