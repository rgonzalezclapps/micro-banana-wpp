/**
 * database/index.js
 * 
 * Description: Professional centralized database connection manager with proper separation of concerns
 * 
 * Role in the system: Single source of truth for all database connections with connection pooling and error handling
 * 
 * Node.js Context: Database - Centralized connection management for PostgreSQL, MongoDB, and Redis
 * 
 * Dependencies:
 * - sequelize (PostgreSQL ORM)
 * - mongoose (MongoDB ODM)  
 * - redis (Redis client)
 * - dotenv (Environment variable loading)
 * 
 * Dependants:
 * - server.js (application startup)
 * - models/index.js (model definitions)
 * - All modules requiring database access
 */

require('dotenv').config();

const { Sequelize } = require('sequelize');
const mongoose = require('mongoose');
const redis = require('redis');

// ============================================================================
// PostgreSQL Configuration & Connection
// ============================================================================

const postgresConfig = {
  uri: process.env.POSTGRES_URI,
  ssl: process.env.POSTGRES_SSL === 'true'
};

const sequelize = new Sequelize(postgresConfig.uri, {
  dialect: 'postgres',
  dialectOptions: postgresConfig.ssl ? {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  } : undefined,
  // Professional connection pooling
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  // Reduce logging noise in production
  logging: process.env.NODE_ENV === 'development' ? console.log : false
});

async function testPostgreSQLConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ PostgreSQL connection established successfully');
    return true;
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    return false;
  }
}

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
    console.log('🔄 Initializing all database connections...');
    
    const results = await Promise.allSettled([
      testPostgreSQLConnection(),
      connectMongoDB(),
      connectRedis()
    ]);
    
    const [postgres, mongodb, redis] = results;
    
    const summary = {
      postgresql: postgres.status === 'fulfilled' && postgres.value,
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
      sequelize.close(),
      mongoose.connection.close(),
      redisClient.quit()
    ]);
    
    console.log('✅ All database connections closed');
  }
}

// ============================================================================
// Professional Exports
// ============================================================================

module.exports = {
  // Database instances
  sequelize,
  mongoose,
  redisClient,
  
  // Connection functions (legacy compatibility)
  testConnection: testPostgreSQLConnection,
  connectMongoDB,
  connectRedis,
  
  // Professional database manager
  DatabaseManager
};
