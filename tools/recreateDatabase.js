#!/usr/bin/env node

/**
 * Database Recreation Script
 * 
 * Description: Drops all tables and recreates the database schema from scratch with clean, minimal structure
 * 
 * Role in the system: Development utility to reset database to clean state and create fresh schema
 * 
 * Node.js Context: Utility - database schema recreation and reset tool
 * 
 * Dependencies:
 * - dotenv (Environment variable loading)
 * - sequelize (Direct SQL execution for schema creation)
 * 
 * Usage: node tools/recreateDatabase.js
 */

// Load environment variables from .env file
require('dotenv').config();

const { Sequelize } = require('sequelize');

/**
 * Recreates the database schema with clean, minimal structure
 * Drops all existing tables and creates fresh schema for Clients and Agents
 * 
 * @returns {Promise<void>} Completes when recreation is finished
 */
async function recreateDatabase() {
    console.log('🗑️  Starting database recreation (DROP + CREATE)...');
    
    try {
        // Check if POSTGRES_URI is configured
        if (!process.env.POSTGRES_URI) {
            console.log('❌ POSTGRES_URI environment variable is not set!');
            console.log('');
            console.log('📝 Please set POSTGRES_URI in your .env file:');
            console.log('   POSTGRES_URI=postgresql://username:password@hostname:port/database');
            process.exit(1);
        }
        
        // Create sequelize instance for direct SQL execution
        const sequelize = new Sequelize(process.env.POSTGRES_URI, {
            dialect: 'postgres',
            logging: false // Reduce noise
        });
        
        // Test database connection
        await sequelize.authenticate();
        console.log('✅ Database connection established');
        
        // Drop all tables (CASCADE to handle foreign keys)
        console.log('🗑️  Dropping all existing tables...');
        await sequelize.query(`
            DROP TABLE IF EXISTS "Agents" CASCADE;
            DROP TABLE IF EXISTS "Clients" CASCADE; 
            DROP TABLE IF EXISTS "Participants" CASCADE;
            DROP TABLE IF EXISTS "ParticipantAgentAssociations" CASCADE;
            DROP TABLE IF EXISTS "Patients" CASCADE;
            DROP TABLE IF EXISTS "PatientAgentAssociations" CASCADE;
            DROP TABLE IF EXISTS "SystemUsers" CASCADE;
            DROP TABLE IF EXISTS "SequelizeMeta" CASCADE;
            
            -- Drop any existing ENUMs
            DROP TYPE IF EXISTS "enum_Agents_status" CASCADE;
            DROP TYPE IF EXISTS "enum_Agents_type" CASCADE;
            DROP TYPE IF EXISTS "enum_Clients_status" CASCADE;
            DROP TYPE IF EXISTS "enum_Participants_status" CASCADE;
        `);
        console.log('✅ All tables dropped successfully');
        
        // Create ENUMs first
        console.log('🏗️  Creating ENUM types...');
        await sequelize.query(`
            CREATE TYPE "enum_Agents_status" AS ENUM ('Ready', 'Active', 'Paused');
            CREATE TYPE "enum_Agents_type" AS ENUM ('openai', 'wpp-bsp');  
            CREATE TYPE "enum_Clients_status" AS ENUM ('active', 'inactive');
            CREATE TYPE "enum_Participants_status" AS ENUM ('active', 'inactive');
        `);
        console.log('✅ ENUM types created');
        
        // Create Clients table
        console.log('🏗️  Creating Clients table...');
        await sequelize.query(`
            CREATE TABLE "Clients" (
                "id" SERIAL PRIMARY KEY,
                "name" VARCHAR(255) NOT NULL,
                "status" "enum_Clients_status" DEFAULT 'active',
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            );
        `);
        console.log('✅ Clients table created');
        
        // Create Agents table  
        console.log('🏗️  Creating Agents table...');
        await sequelize.query(`
            CREATE TABLE "Agents" (
                "id" SERIAL PRIMARY KEY,
                "name" VARCHAR(255) NOT NULL,
                "type" "enum_Agents_type" NOT NULL DEFAULT 'openai',
                "channelId" VARCHAR(255),
                "assistantId" VARCHAR(255),
                "instanceId" VARCHAR(255),
                "token" VARCHAR(255),
                "status" "enum_Agents_status" DEFAULT 'Ready',
                "clientId" INTEGER NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                
                CONSTRAINT "fk_agents_client" 
                    FOREIGN KEY ("clientId") 
                    REFERENCES "Clients"("id") 
                    ON DELETE CASCADE
            );
        `);
        console.log('✅ Agents table created');
        
        // Create Participants table (renamed from Patients for generic engine)
        console.log('🏗️  Creating Participants table...');
        await sequelize.query(`
            CREATE TABLE "Participants" (
                "id" SERIAL PRIMARY KEY,
                "name" VARCHAR(255),
                "phoneNumber" VARCHAR(255) NOT NULL UNIQUE,
                "status" "enum_Participants_status" DEFAULT 'active',
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            );
        `);
        console.log('✅ Participants table created');
        
        // Create ParticipantAgentAssociations table (renamed from PatientAgentAssociations)
        console.log('🏗️  Creating ParticipantAgentAssociations table...');
        await sequelize.query(`
            CREATE TABLE "ParticipantAgentAssociations" (
                "id" SERIAL PRIMARY KEY,
                "participantId" INTEGER NOT NULL,
                "agentId" INTEGER NOT NULL,
                "threadId" VARCHAR(255) NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                
                CONSTRAINT "fk_participant_associations_participant"
                    FOREIGN KEY ("participantId")
                    REFERENCES "Participants"("id")
                    ON DELETE CASCADE,
                    
                CONSTRAINT "fk_participant_associations_agent"
                    FOREIGN KEY ("agentId")
                    REFERENCES "Agents"("id")
                    ON DELETE CASCADE,
                    
                CONSTRAINT "unique_participant_agent"
                    UNIQUE("participantId", "agentId")
            );
        `);
        console.log('✅ ParticipantAgentAssociations table created');
        
        // Create indexes for performance
        console.log('🏗️  Creating indexes...');
        await sequelize.query(`
            CREATE INDEX "idx_agents_client_id" ON "Agents"("clientId");
            CREATE INDEX "idx_agents_status" ON "Agents"("status");
            CREATE INDEX "idx_agents_type" ON "Agents"("type");
            CREATE INDEX "idx_agents_deleted_at" ON "Agents"("deletedAt");
            CREATE INDEX "idx_participants_phone_number" ON "Participants"("phoneNumber");
            CREATE INDEX "idx_participants_status" ON "Participants"("status");
            CREATE INDEX "idx_participant_associations_participant_id" ON "ParticipantAgentAssociations"("participantId");
            CREATE INDEX "idx_participant_associations_agent_id" ON "ParticipantAgentAssociations"("agentId");
            CREATE INDEX "idx_participant_associations_thread_id" ON "ParticipantAgentAssociations"("threadId");
        `);
        console.log('✅ Indexes created');
        
        console.log('🎉 Database recreation completed successfully!');
        console.log('');
        console.log('📊 Fresh database schema:');
        
        // Display new schema
        const clientsSchema = await sequelize.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'Clients' 
            ORDER BY ordinal_position;
        `);
        
        const agentsSchema = await sequelize.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'Agents' 
            ORDER BY ordinal_position;
        `);
        
        const participantsSchema = await sequelize.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'Participants' 
            ORDER BY ordinal_position;
        `);
        
        const associationsSchema = await sequelize.query(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'ParticipantAgentAssociations' 
            ORDER BY ordinal_position;
        `);
        
        console.log('\n🏢 Clients table:');
        clientsSchema[0].forEach(col => {
            console.log(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(required)' : '(optional)'}`);
        });
        
        console.log('\n🤖 Agents table:');
        agentsSchema[0].forEach(col => {
            console.log(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(required)' : '(optional)'}`);
        });
        
        console.log('\n👥 Participants table:');
        participantsSchema[0].forEach(col => {
            console.log(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(required)' : '(optional)'}`);
        });
        
        console.log('\n🔗 ParticipantAgentAssociations table:');
        associationsSchema[0].forEach(col => {
            console.log(`   - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(required)' : '(optional)'}`);
        });
        
    } catch (error) {
        console.error('❌ Error during database recreation:', error.message);
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

// Run the recreation script
if (require.main === module) {
    recreateDatabase();
}

module.exports = {
    recreateDatabase
};
