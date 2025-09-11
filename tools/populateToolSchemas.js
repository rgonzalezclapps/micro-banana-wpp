/**
 * tools/populateToolSchemas.js
 *
 * Description: Script to populate the ToolSchema collection in MongoDB with tool definitions
 * from the JSON files in tools/tool-definitions/ and assign them to appropriate agents.
 *
 * Role in the system: Populates the MongoDB `toolSchemas` collection with the 8 basic tools.
 *
 * Usage: node tools/populateToolSchemas.js
 */

const fs = require('fs').promises;
const path = require('path');
const ToolSchema = require('../models/ToolSchema');
const { mongoose } = require('../database');

// Tool to agent mapping (which agents use which tools)
const toolAgentMapping = {
    // Image processing tools - for photography agents (1, 2)
    'newRequest': [1, 2],
    'updateRequest': [1, 2],
    'processRequest': [1, 2], 
    'getRequestStatus': [1, 2],
    'listActiveRequests': [1, 2],
    'cancelRequest': [1, 2],
    
    // Payment tools - for all agents
    'createTopupLink': [1, 2, 3],
    'checkCredits': [1, 2, 3],
    
    // Video tools - for photography agents only
    'videoGenerator': [1, 2],
    
    // Website tools - for photography agents only
    'generateWebsite': [1, 2]
};

async function populateToolSchemas() {
    console.log('🚀 Starting tool schema population...');

    try {
        // 1. Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            connectTimeoutMS: 10000
        });
        console.log('✅ MongoDB connected.');

        // 2. Read all tool definition files
        const toolDefinitionsDir = path.join(__dirname, 'tool-definitions');
        const toolFiles = await fs.readdir(toolDefinitionsDir);
        const jsonFiles = toolFiles.filter(file => file.endsWith('.json'));
        
        console.log(`📂 Found ${jsonFiles.length} tool definition files.`);

        // 3. Process each tool file
        for (const jsonFile of jsonFiles) {
            const toolName = path.basename(jsonFile, '.json');
            console.log(`\n🔧 Processing tool: ${toolName}`);

            try {
                // Read and parse tool definition
                const toolFilePath = path.join(toolDefinitionsDir, jsonFile);
                const toolContent = await fs.readFile(toolFilePath, 'utf8');
                const toolDefinition = JSON.parse(toolContent);

                // Get agents for this tool
                const enabledForAgents = toolAgentMapping[toolName] || [];
                
                // Determine category based on tool name
                let category = 'general';
                if (['newRequest', 'updateRequest', 'processRequest', 'getRequestStatus', 'listActiveRequests', 'cancelRequest'].includes(toolName)) {
                    category = 'image_processing';
                } else if (['createTopupLink', 'checkCredits'].includes(toolName)) {
                    category = 'payment';
                } else if (['videoGenerator'].includes(toolName)) {
                    category = 'video';
                } else if (['generateWebsite'].includes(toolName)) {
                    category = 'website';
                }

                // Create tool schema document
                const toolSchemaData = {
                    toolName: toolName,
                    toolDefinition: {
                        type: "function",
                        function: toolDefinition
                    },
                    enabledForAgents: enabledForAgents,
                    metadata: {
                        category: category,
                        version: 1,
                        lastModified: new Date(),
                        modifiedBy: 'populate-script',
                        notes: `Populated from ${jsonFile} on ${new Date().toISOString()}`
                    },
                    isActive: true
                };

                // Create or update in MongoDB
                const mongoToolSchema = await ToolSchema.createOrUpdate(toolSchemaData);

                console.log(`- ✅ Successfully populated tool: ${toolName}`);
                console.log(`  - MongoDB Document ID: ${mongoToolSchema._id}`);
                console.log(`  - Enabled for agents: [${enabledForAgents.join(', ')}]`);
                console.log(`  - Category: ${category}`);

            } catch (fileError) {
                console.error(`- ❌ Error processing ${jsonFile}:`, fileError.message);
            }
        }

        console.log('\n🎉 Tool schema population complete!');

        // 4. Verify results
        const totalTools = await ToolSchema.countDocuments({ isActive: true });
        console.log(`📊 Total active tools in database: ${totalTools}`);

    } catch (error) {
        console.error('\n❌ An error occurred during tool population:', error);
    } finally {
        // 5. Close connection
        await mongoose.disconnect();
        console.log('🔌 MongoDB connection closed.');
    }
}

// Run the population
populateToolSchemas();
