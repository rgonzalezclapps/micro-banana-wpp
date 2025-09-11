/**
 * tools/migrateParticipantsToMongo.js
 *
 * Description: Migrate participants from PostgreSQL to MongoDB ParticipantProfile collection
 */

const { Participant } = require('../models');
const ParticipantProfile = require('../models/ParticipantProfile');
const { sequelize, mongoose } = require('../database');

async function migrateParticipants() {
    console.log('🚀 Starting participant migration to MongoDB...');

    try {
        // Connect to databases
        await sequelize.authenticate();
        console.log('✅ PostgreSQL connected.');
        
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB connected.');

        // Fetch all participants from PostgreSQL
        const pgParticipants = await Participant.findAll({ paranoid: false });
        if (pgParticipants.length === 0) {
            console.warn('⚠️ No participants found in PostgreSQL. Nothing to migrate.');
            return;
        }
        console.log(`Found ${pgParticipants.length} participants in PostgreSQL.`);

        // Migrate each participant
        for (const pgParticipant of pgParticipants) {
            console.log(`\nProcessing Participant ID: ${pgParticipant.id} (${pgParticipant.name})...`);

            try {
                const participantData = {
                    participantId: pgParticipant.id,
                    name: pgParticipant.name || 'Unknown',
                    phoneNumber: pgParticipant.phoneNumber,
                    status: pgParticipant.status === 'active' ? 'active' : 'inactive',
                    creditBalance: pgParticipant.creditBalance || 0,
                    totalCreditsEarned: pgParticipant.totalCreditsEarned || 0,
                    totalCreditsSpent: pgParticipant.totalCreditsSpent || 0,
                    profile: {
                        email: pgParticipant.email || '',
                        firstName: pgParticipant.firstName || '',
                        lastName: pgParticipant.lastName || '',
                        preferredLanguage: 'es-AR',
                        timezone: 'America/Argentina/Buenos_Aires'
                    },
                    healthcare: {
                        dni: pgParticipant.dni || '',
                        dniType: pgParticipant.dniType || '',
                        birthDate: pgParticipant.birthDate || null,
                        gender: pgParticipant.gender || '',
                        insuranceCode: pgParticipant.insuranceCode || '',
                        planCode: pgParticipant.planCode || '',
                        insuranceNumber: pgParticipant.insuranceNumber || ''
                    },
                    conversationCount: 0, // Will be calculated separately
                    metadata: {
                        createdVia: 'migration',
                        notes: `Migrated from PostgreSQL participant table on ${new Date().toISOString()}`
                    }
                };
                
                // Create or update in MongoDB
                const mongoProfile = await ParticipantProfile.createOrUpdate(participantData);

                console.log(`- ✅ Successfully migrated Participant ID ${pgParticipant.id}.`);
                console.log(`  - MongoDB Document ID: ${mongoProfile._id}`);
                console.log(`  - Phone: ${mongoProfile.phoneNumber}`);
                console.log(`  - Credits: ${mongoProfile.creditBalance}`);

            } catch (participantError) {
                console.error(`- ❌ Error migrating Participant ID ${pgParticipant.id}:`, participantError.message);
            }
        }

        console.log('\n🎉 Participant migration complete!');

        // Summary
        const totalMigrated = await ParticipantProfile.countDocuments();
        console.log(`📊 Total participants in MongoDB: ${totalMigrated}`);

    } catch (error) {
        console.error('\n❌ An error occurred during participant migration:', error);
    } finally {
        // Close connections
        await sequelize.close();
        await mongoose.disconnect();
        console.log('🔌 Database connections closed.');
    }
}

// Run the migration
migrateParticipants();
