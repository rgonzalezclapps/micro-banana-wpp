/**
 * database/index.js
 * 
 * Description: Centralized database connection manager (MongoDB + Redis only)
 * 
 * Role in the system: Single source of truth for all database connections with connection pooling and error handling
 * 
 * Node.js Context: Database - Centralized connection management for MongoDB and Redis
 * 
 * Dependencies:
 * - mongoose (MongoDB ODM)  
 * - redis (Redis client)
 * - dotenv (Environment variable loading)
 * 
 * Dependants:
 * - server.js (application startup)
 * - All modules requiring database access
 */

require('dotenv').config();

const mongoose = require('mongoose');
const redis = require('redis');

// ============================================================================
// MongoDB Configuration & Connection  
// ============================================================================

async function connectMongoDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      // MongoDB connection options for production
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB connection established successfully');
    return true;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    return false;
  }
}

// ============================================================================
// Redis Configuration & Connection
// ============================================================================

const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
  // Professional Redis configuration
  socket: {
    connectTimeout: 10000,
    lazyConnect: true
  },
  // Retry configuration
  retry_delay_on_failover: 100
});

redisClient.on('error', (err) => {
  console.error('❌ Redis client error:', err.message);
});

redisClient.on('connect', () => {
  console.log('🔄 Redis client connecting...');
});

redisClient.on('ready', () => {
  console.log('✅ Redis client ready');
});

async function connectRedis() {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
      console.log('✅ Redis connection established successfully');
      return true;
    }
    return true;
  } catch (error) {
    console.error('❌ Redis connection failed:', error.message);
    return false;
  }
}

// ============================================================================
// Unified Database Manager
// ============================================================================

class DatabaseManager {
  static async initializeAll() {
    console.log('🔄 Initializing database connections (MongoDB + Redis)...');
    
    const results = await Promise.allSettled([
      connectMongoDB(),
      connectRedis()
    ]);
    
    const [mongodb, redis] = results;
    
    const summary = {
      mongodb: mongodb.status === 'fulfilled' && mongodb.value,
      redis: redis.status === 'fulfilled' && redis.value
    };
    
    console.log('📊 Database connections summary:', summary);
    
    const allSuccessful = Object.values(summary).every(status => status);
    if (allSuccessful) {
      console.log('🎉 All databases connected successfully');
    } else {
      console.warn('⚠️ Some database connections failed');
    }
    
    return summary;
  }
  
  static async closeAll() {
    console.log('🔌 Closing all database connections...');
    
    await Promise.allSettled([
      mongoose.connection.close(),
      redisClient.quit()
    ]);
    
    console.log('✅ All database connections closed');
  }
  
  static async healthCheck() {
    try {
      const mongoStatus = mongoose.connection.readyState === 1;
      const redisStatus = redisClient.isOpen;
      
      return {
        mongodb: mongoStatus ? 'connected' : 'disconnected',
        redis: redisStatus ? 'connected' : 'disconnected',
        healthy: mongoStatus && redisStatus
      };
    } catch (error) {
      return {
        mongodb: 'error',
        redis: 'error',
        healthy: false,
        error: error.message
      };
    }
  }
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Database instances
  mongoose,
  redisClient,
  
  // Connection functions
  connectMongoDB,
  connectRedis,
  
  // Professional database manager
  DatabaseManager
};
