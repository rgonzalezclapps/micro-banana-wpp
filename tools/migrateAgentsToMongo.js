/**
 * tools/migrateAgentsToMongo.js
 *
 * Description: One-time migration script to move agent configurations from PostgreSQL
 * and local files into the new AgentConfig collection in MongoDB.
 *
 * Role in the system: Populates the MongoDB `agentConfigs` collection, which is critical
 * for the new Responses API architecture.
 *
 * Usage: node tools/migrateAgentsToMongo.js
 */

const fs = require('fs').promises;
const path = require('path');
const { Agent } = require('../models'); // Sequelize Agent model
const AgentConfig = require('../models/AgentConfig'); // Mongoose AgentConfig model
const { sequelize, mongoose } = require('../database'); // DB connections

// Default response schema (as defined previously)
const defaultResponseSchema = {
    name: "enhanced_fotoproducto_response_schema",
    strict: true,
    schema: {
        type: "object",
        description: "Root object for the AI assistant's structured response.",
        properties: {
            timestamp: { type: "string", description: "Timestamp of the user's last message plus 5 seconds to emulate thinking time" },
            thinking: { type: "string", description: "Assistant's internal reasoning using chain of thought approach, including analysis of both commercial needs and technical requirements" },
            response: {
                type: "object",
                description: "The direct response to be sent to the user.",
                properties: {
                    recipient: { type: "string", description: "The recipient of the message, for now, it's alway's 'user'." },
                    message: { type: "string", description: "Warm, professional reply to the user combining commercial communication with technical capabilities as needed" }
                },
                required: ["recipient", "message"],
                additionalProperties: false
            },
            ai_system_message: {
                type: "object",
                description: "Structured data extracted from the conversation for system use.",
                properties: {
                    lead_info: {
                        type: "object",
                        description: "Information captured about the user as a potential lead.",
                        properties: {
                            full_name: { type: "string", description: "Full name if provided by user, empty string if not provided" },
                            phone: { type: "string", description: "Phone number from webhook if available, empty string otherwise" },
                            email: { type: "string", description: "Empty string by default unless specifically provided" },
                            company: { type: "string", description: "Empty string by default unless specifically mentioned" },
                            interest: { type: "string", description: "Description of image processing type requested or service needed" },
                            notes: { type: "string", description: "Details about processed requests and delivered results" }
                        },
                        required: ["full_name", "phone", "email", "company", "interest", "notes"],
                        additionalProperties: false
                    },
                    current_flow: {
                        type: "object",
                        description: "The current state of the conversation flow.",
                        properties: {
                            status: { type: "string", enum: ["awaiting_name", "ready_to_process", "processing_images", "delivering_results"], description: "Current stage in the lead capture and service flow" }
                        },
                        required: ["status"],
                        additionalProperties: false
                    },
                    image_processing: {
                        type: "object",
                        description: "State and metadata related to image processing tasks.",
                        properties: {
                            active_requests: { type: "string", description: "Number of active image processing requests as string, '0' if none" },
                            last_request_id: { type: "string", description: "ID of the most recent request if any were processed, empty string if none" },
                            processing_type: { type: "string", description: "Description of the type of image processing performed, empty string if none" }
                        },
                        required: ["active_requests", "last_request_id", "processing_type"],
                        additionalProperties: false
                    }
                },
                required: ["lead_info", "current_flow", "image_processing"],
                additionalProperties: false
            }
        },
        required: ["timestamp", "thinking", "response", "ai_system_message"],
        additionalProperties: false
    }
};


async function migrateAgents() {
    console.log('🚀 Starting agent configuration migration to MongoDB...');

    try {
        // 1. Connect to databases
        await sequelize.authenticate();
        console.log('✅ PostgreSQL connected.');
        
        // Explicitly connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            connectTimeoutMS: 10000 // 10 seconds timeout
        });
        console.log('✅ MongoDB connected.');

        // 2. Fetch all agents from PostgreSQL
        const pgAgents = await Agent.findAll({ paranoid: false }); // Include soft-deleted if needed
        if (pgAgents.length === 0) {
            console.warn('⚠️ No agents found in PostgreSQL. Nothing to migrate.');
            return;
        }
        console.log(`Found ${pgAgents.length} agents in PostgreSQL.`);

        // 3. Map agent prompts from local files
        const promptFileMap = {
            1: 'agent-1.md',
            2: 'agent-2.md',
            3: 'agent-3.md'
        };

        // 4. Iterate and create/update configs in MongoDB
        for (const pgAgent of pgAgents) {
            console.log(`\nProcessing Agent ID: ${pgAgent.id} (${pgAgent.name})...`);

            const promptFileName = promptFileMap[pgAgent.id];
            if (!promptFileName) {
                console.warn(`- ⚠️ No prompt file mapped for Agent ID ${pgAgent.id}. Skipping.`);
                continue;
            }

            try {
                const promptFilePath = path.resolve(__dirname, '..', promptFileName);
                const systemPrompt = await fs.readFile(promptFilePath, 'utf8');
                console.log(`- 📂 Read prompt from ${promptFileName} (${systemPrompt.length} chars).`);

                const agentConfigData = {
                    agentId: pgAgent.id,
                    agentName: pgAgent.name,
                    status: pgAgent.status === 'Active' ? 'active' : 'inactive', // Map status
                    channelConfig: {
                        channelType: pgAgent.type === 'wpp-bsp' ? 'wspb' : 'umsg', // Map type
                        channelId: pgAgent.instanceId, // Map instanceId
                        channelToken: pgAgent.token // Map token
                    },
                    systemPrompt: systemPrompt,
                    modelConfig: { // Default model config
                        model: 'gpt-5-mini',
                        maxCompletionTokens: 4096,
                        temperature: 1.0,
                        streaming: true
                    },
                    responseSchema: defaultResponseSchema,
                    metadata: {
                        category: pgAgent.id === 3 ? 'healthcare' : 'photography',
                        notes: `Migrated from PostgreSQL agent table on ${new Date().toISOString()}`
                    }
                };
                
                // Using the static method to create or update
                const mongoAgentConfig = await AgentConfig.createOrUpdate(agentConfigData);

                console.log(`- ✅ Successfully migrated configuration for Agent ID ${pgAgent.id}.`);
                console.log(`  - MongoDB Document ID: ${mongoAgentConfig._id}`);
                console.log(`  - Config Version: ${mongoAgentConfig.metadata.version}`);

            } catch (fileError) {
                console.error(`- ❌ Could not read prompt file for Agent ID ${pgAgent.id}: ${promptFileName}`, fileError.message);
            }
        }

        console.log('\n🎉 Migration complete!');

    } catch (error) {
        console.error('\n❌ An error occurred during migration:', error);
    } finally {
        // 5. Close connections
        await sequelize.close();
        await mongoose.disconnect();
        console.log('🔌 Database connections closed.');
    }
}

// Run the migration
migrateAgents();
