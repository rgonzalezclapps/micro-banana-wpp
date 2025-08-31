#!/usr/bin/env node

/**
 * Fix Conversations Script
 * 
 * Description: Fixes existing conversations with invalid lastMessageSender format
 * 
 * Usage: node tools/fixConversations.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');

async function fixExistingConversations() {
    console.log('🔧 Fixing existing conversations with invalid lastMessageSender...');
    
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://fotoproducto_user:Mh7TpW3kZ9nQ6xCv@api-ai-mvp.com:27017/fotoproducto?authSource=admin');
        console.log('✅ Connected to MongoDB');
        
        // Find conversations with string lastMessageSender (invalid format)
        const invalidConversations = await Conversation.find({
            $or: [
                { lastMessageSender: { $type: "string" } },  // String instead of object
                { lastMessageSender: null },                  // Null values
                { lastMessageSender: { $exists: false } }     // Missing field
            ]
        });
        
        console.log(`🔍 Found ${invalidConversations.length} conversations to fix`);
        
        if (invalidConversations.length === 0) {
            console.log('🎉 No conversations need fixing!');
            return;
        }
        
        let fixed = 0;
        
        for (const conversation of invalidConversations) {
            try {
                // Determine role and name based on existing data
                let role = 'user';
                let name = 'User';
                
                if (typeof conversation.lastMessageSender === 'string') {
                    role = conversation.lastMessageSender;
                }
                
                if (role === 'user') {
                    name = conversation.participantName || 'User';
                } else if (role === 'ai_agent') {
                    name = conversation.agentName || 'AI Agent';
                }
                
                // Update with proper object structure
                conversation.lastMessageSender = {
                    role: role,
                    name: name
                };
                
                await conversation.save();
                console.log(`✅ Fixed conversation ${conversation._id}: role=${role}, name=${name}`);
                fixed++;
                
            } catch (error) {
                console.error(`❌ Failed to fix conversation ${conversation._id}:`, error.message);
            }
        }
        
        console.log(`🎉 Successfully fixed ${fixed}/${invalidConversations.length} conversations`);
        
    } catch (error) {
        console.error('❌ Fix operation failed:', error.message);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 MongoDB connection closed');
    }
}

async function validateConversations() {
    console.log('\n🧪 Validating conversation structure...');
    
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://fotoproducto_user:Mh7TpW3kZ9nQ6xCv@api-ai-mvp.com:27017/fotoproducto?authSource=admin');
        
        const totalConversations = await Conversation.countDocuments();
        const validConversations = await Conversation.countDocuments({
            'lastMessageSender.role': { $exists: true },
            'lastMessageSender.name': { $exists: true }
        });
        
        console.log(`📊 Total conversations: ${totalConversations}`);
        console.log(`✅ Valid conversations: ${validConversations}`);
        console.log(`❌ Invalid conversations: ${totalConversations - validConversations}`);
        
        if (totalConversations === validConversations) {
            console.log('🎉 All conversations have valid structure!');
        }
        
    } catch (error) {
        console.error('❌ Validation failed:', error.message);
    } finally {
        await mongoose.connection.close();
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--validate') || args.includes('-v')) {
        await validateConversations();
    } else {
        await fixExistingConversations();
        await validateConversations();
    }
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { fixExistingConversations, validateConversations };
