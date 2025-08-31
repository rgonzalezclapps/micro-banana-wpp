#!/usr/bin/env node

/**
 * Database Population Script - Fresh Start
 * 
 * Description: Populates fresh Clients and Agents tables with initial data
 * 
 * Role in the system: Development utility to populate clean database with Banana client and Bananon agent
 * 
 * Node.js Context: Utility - database seeding for fresh schema
 * 
 * Dependencies:
 * - dotenv (Environment variable loading)
 * - sequelize (Direct SQL for clean population)
 * 
 * Usage: 
 * 1. First run: node tools/recreateDatabase.js (to create clean schema)
 * 2. Then run: node tools/populateDatabase.js (to populate with data)
 */

// Load environment variables from .env file
require('dotenv').config();

const { Sequelize } = require('sequelize');

/**
 * Populates the fresh database with Banana client and Bananon agent
 * Uses direct SQL for clean, predictable population
 * 
 * @returns {Promise<void>} Completes when population is finished
 */
async function populateDatabase() {
    console.log('🍌 Starting fresh database population...');
    
    try {
        // Check if POSTGRES_URI is configured
        if (!process.env.POSTGRES_URI) {
            console.log('❌ POSTGRES_URI environment variable is not set!');
            console.log('');
            console.log('📝 To use this script, please:');
            console.log('1. Create a .env file in the project root');
            console.log('2. Add your PostgreSQL connection string:');
            console.log('   POSTGRES_URI=postgresql://username:password@hostname:port/database');
            console.log('');
            console.log('💡 Example:');
            console.log('   POSTGRES_URI=postgresql://postgres:password@localhost:5432/micro_banana');
            process.exit(1);
        }
        
        // Create sequelize instance
        const sequelize = new Sequelize(process.env.POSTGRES_URI, {
            dialect: 'postgres',
            logging: false
        });
        
        // Check if database connection is working
        await sequelize.authenticate();
        console.log('✅ Database connection established successfully');
        
        // Check if Clients table is empty
        const clientResult = await sequelize.query('SELECT COUNT(*) as count FROM "Clients"');
        const clientCount = parseInt(clientResult[0][0].count);
        console.log(`📊 Current clients count: ${clientCount}`);
        
        let clientId;
        
        if (clientCount === 0) {
            // Create Banana client
            const clientInsert = await sequelize.query(`
                INSERT INTO "Clients" ("name", "status", "createdAt", "updatedAt") 
                VALUES ('Banana', 'active', NOW(), NOW()) 
                RETURNING "id", "name"
            `);
            clientId = clientInsert[0][0].id;
            console.log('✅ Created Banana client (ID: ' + clientId + ')');
        } else {
            // Get existing client
            const existingClient = await sequelize.query('SELECT "id", "name" FROM "Clients" ORDER BY "id" ASC LIMIT 1');
            clientId = existingClient[0][0].id;
            console.log('ℹ️  Using existing client: ' + existingClient[0][0].name + ' (ID: ' + clientId + ')');
        }
        
        // Check if Agents table is empty
        const agentResult = await sequelize.query('SELECT COUNT(*) as count FROM "Agents" WHERE "deletedAt" IS NULL');
        const agentCount = parseInt(agentResult[0][0].count);
        console.log(`📊 Current agents count: ${agentCount}`);
        
        if (agentCount === 0) {
            // Create Bananon agent with OpenAI configuration
            const agentInsert = await sequelize.query(`
                INSERT INTO "Agents" (
                    "name", "type", "assistantId", "instanceId", "token", 
                    "status", "clientId", "channelId", "createdAt", "updatedAt"
                ) VALUES (
                    'Bananon', 'openai', 'asst_2ZIGzjierV5qa6MtLNcne7Uz', '34104', 'c10jnkg82d36zed5',
                    'Active', $1, NULL, NOW(), NOW()
                ) RETURNING "id", "name", "type", "status", "assistantId", "instanceId", "token", "clientId"
            `, {
                bind: [clientId]
            });
            
            const agent = agentInsert[0][0];
            console.log('✅ Created Bananon agent (ID: ' + agent.id + ')');
            console.log('   - Name: ' + agent.name);
            console.log('   - Assistant ID: ' + agent.assistantId);  
            console.log('   - Instance ID: ' + agent.instanceId);
            console.log('   - Token: ' + agent.token);
            console.log('   - Type: ' + agent.type);
            console.log('   - Status: ' + agent.status);
            console.log('   - Client ID: ' + agent.clientId);
        } else {
            console.log('ℹ️  Agents table already contains data, skipping agent creation');
            
            // Display existing agents
            const existingAgents = await sequelize.query(`
                SELECT a."id", a."name", a."type", a."status", a."clientId", c."name" as client_name
                FROM "Agents" a
                LEFT JOIN "Clients" c ON a."clientId" = c."id"
                WHERE a."deletedAt" IS NULL
                ORDER BY a."id"
            `);
            
            console.log('📋 Existing agents:');
            existingAgents[0].forEach(agent => {
                console.log(`   - ${agent.name} (ID: ${agent.id}, Type: ${agent.type}, Status: ${agent.status}, Client: ${agent.client_name})`);
            });
        }
        

        
        console.log('🎉 Database population completed successfully!');
        
    } catch (error) {
        console.error('❌ Error during database population:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    } finally {
        // Close database connection
        if (typeof sequelize !== 'undefined') {
            await sequelize.close();
            console.log('🔌 Database connection closed');
        }
    }
}

/**
 * Display current database state for verification
 * Shows all clients and agents with their relationships using direct SQL
 * 
 * @returns {Promise<void>} Completes when display is finished
 */
async function displayDatabaseState() {
    console.log('\n📊 Current Database State:');
    console.log('========================');
    
    const sequelize = new Sequelize(process.env.POSTGRES_URI, {
        dialect: 'postgres',
        logging: false
    });
    
    try {
        await sequelize.authenticate();
        
        const clients = await sequelize.query(`
            SELECT c."id", c."name", c."status", c."createdAt"
            FROM "Clients" c
            ORDER BY c."id"
        `);
        
        for (const client of clients[0]) {
            console.log(`\n🏢 Client: ${client.name} (ID: ${client.id}, Status: ${client.status})`);
            console.log(`   Created: ${new Date(client.createdAt).toLocaleString()}`);
            
            const agents = await sequelize.query(`
                SELECT a."id", a."name", a."type", a."status", a."assistantId", a."instanceId", a."token"
                FROM "Agents" a
                WHERE a."clientId" = $1 AND a."deletedAt" IS NULL
                ORDER BY a."id"
            `, {
                bind: [client.id]
            });
            
            if (agents[0].length > 0) {
                agents[0].forEach(agent => {
                    console.log(`   🤖 Agent: ${agent.name} (ID: ${agent.id})`);
                    console.log(`      - Type: ${agent.type}`);
                    console.log(`      - Status: ${agent.status}`);
                    console.log(`      - Assistant ID: ${agent.assistantId}`);
                    console.log(`      - Instance ID: ${agent.instanceId}`);
                    console.log(`      - Token: ${agent.token}`);
                });
            } else {
                console.log('   (No agents assigned)');
            }
        }
        

        
    } catch (error) {
        console.error('❌ Error displaying database state:', error.message);
    } finally {
        await sequelize.close();
    }
}

// Run the population script
if (require.main === module) {
    (async () => {
        await populateDatabase();
        await displayDatabaseState();
    })();
}

module.exports = {
    populateDatabase,
    displayDatabaseState
};
