/**
 * patientManagementTools.js
 * 
 * Description: Healthcare patient management tools for patient identification, verification, registration, appointment scheduling, and assistance requests.
 * 
 * Role in the system: Provides healthcare-specific function tools for AI agents to manage patient interactions, handle 2FA verification, and schedule medical appointments.
 * 
 * Node.js Context: Tool - function call handlers for OpenAI assistant integration
 * 
 * Dependencies:
 * - ../models/Conversation (MongoDB conversation logging)
 * - ../utils/dbUtils (database retry utilities)
 * - fs (file system operations for JSON data)
 * - path (file path utilities)
 * 
 * Dependants:
 * - modules/openaiIntegration.js (executes these tools via function calls)
 * - tools/healthReportTools.js (imports these functions for integration)
 */

const Conversation = require('../models/Conversation');
const { saveWithRetry } = require('../utils/dbUtils');

const { getPatient, createPatient, getSchedules, getAppointments, createAppointment, cancelAppointment } = require('../services/externalSchedulingService');
const { syncPatientToCRM, createSupportTask, createDataUpdateTask, createOpportunityFromAppointment, manageConversationForPatient, syncAppointmentCancellationToCRM } = require('../services/twentyCrmService');

// ============================================================================
// Utility Functions - Database logging and data operations
// ============================================================================

/**
 * Ensures Argentina phone format for Bukeala API.
 * Adds +54 country code to local mobile numbers starting with 9.
 * 
 * @param {string} phoneNumber Raw phone number
 * @returns {string} Phone number with Argentina format for Bukeala
 */
function ensureArgentinaPhoneFormat(phoneNumber) {
  if (!phoneNumber) return phoneNumber;
  
  // Clean the phone number first
  const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
  
  // If it's an Argentina mobile number starting with 9 (and not already prefixed with country code)
  if (cleaned.match(/^9[0-9]{9,10}$/) && !cleaned.startsWith('54')) {
    console.log('🔍 TRACE: Adding Argentina country code to mobile number:', cleaned, '→', `+54${cleaned}`);
    return `+54${cleaned}`;  // Add Argentina country code
  }
  
  // Return as-is for other formats
  return phoneNumber;
}

/**
 * Adds a function call record to the conversation message in MongoDB.
 * This maintains the audit trail for all healthcare operations.
 * 
 * @param {string} conversationId MongoDB conversation ID
 * @param {string} functionName Name of the function being called
 * @param {Object} args Function arguments passed by the AI
 * @returns {Promise<void>} Completes when function call is logged
 */
async function addFunctionCallToMessage(conversationId, functionName, args) {
  console.log(`Adding function call ${functionName} to conversation ${conversationId}`);
  console.log('args', args);
  
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) {
    console.error('Conversation not found:', conversationId);
    return;
  }

  // Get the last user message to attach the function call
  const lastUserMessage = conversation.messages
    .filter(msg => msg.sender === 'user')
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

  if (lastUserMessage) {
    if (!lastUserMessage.functionCalls) {
      lastUserMessage.functionCalls = [];
    }
    lastUserMessage.functionCalls.push({
      type: 'function',
      name: functionName,
      parameters: args,
      timestamp: new Date().toISOString()
    });
    
    await saveWithRetry(conversation);
    console.log(`Function call ${functionName} added to conversation ${conversationId}`);
  } else {
    console.error('No user message found to attach function call in conversation:', conversationId);
  }
}

// ============================================================================
// Patient Management Tools - Core healthcare functions
// ============================================================================

/**
 * Searches for a patient using their DNI (national identification number).
 * Returns patient information and synchronizes with Twenty CRM automatically.
 * 
 * @param {Object} args Function arguments from OpenAI
 * @param {string} args.identificationNumber Patient's DNI to search for
 * @param {string} args.identificationType Type of identification document
 * @param {string} conversationId MongoDB conversation ID for logging
 * @returns {Promise<Object>} Search result with patient status, email info, and CRM sync status
 */
async function handleSearchPatient(args, conversationId) {
  console.log('Handling search patient with Bukeala API + CRM sync:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'search_patient', args);
  
  try {
    const identificationNumber = args.identificationNumber;
    const identificationType = args.identificationType;
    
    // Step 1: Get patient data from Bukeala API
    const patientData = await getPatient(identificationNumber, identificationType);
    console.log('Bukeala patient data received:', patientData);
    
    // Step 2: Phone extraction will be handled by CRM service
    console.log('Phone extraction will be handled by CRM service with conversation:', conversationId);
    
    // Step 3: Synchronize patient data with Twenty CRM
    let crmSyncResult = null;
    try {
      if (patientData && (patientData.email || patientData.mobilePhone)) {
        console.log('Synchronizing patient with CRM...');
        console.log('DEBUG: conversationId being passed to CRM:', conversationId, 'type:', typeof conversationId);
        // Convert ObjectId to string for CRM service
        const conversationIdString = conversationId ? conversationId.toString() : null;
        console.log('DEBUG: conversationId converted to string:', conversationIdString);
        // Extract insurance data from plans array
        const primaryPlan = patientData.plans && patientData.plans.length > 0 ? patientData.plans[0] : {};
        console.log('Extracted primary plan from Bukeala:', primaryPlan);
        
        // Get phone number from conversation/patient context
        let phoneNumber = patientData.mobilePhone;
        if (!phoneNumber || phoneNumber === '') {
          // Extract phone from conversation
          const conversation = await Conversation.findById(conversationIdString);
          console.log('DEBUG: Conversation found for phone extraction:', !!conversation);
          console.log('DEBUG: Conversation phoneNumber field:', conversation?.phoneNumber);
          console.log('DEBUG: Conversation patientId:', conversation?.patientId);
          
          if (conversation && conversation.phoneNumber) {
            phoneNumber = conversation.phoneNumber;
            console.log('Phone extracted from conversation metadata for CRM:', phoneNumber);
          } else if (conversation && conversation.patientId) {
            // Try to get phone from Patient model (Sequelize)
            try {
              const { Patient } = require('../models');
              const patient = await Patient.findByPk(conversation.patientId);
              console.log('DEBUG: Patient found via Sequelize:', !!patient, 'phone:', patient?.phoneNumber);
              console.log('DEBUG: Full patient object:', patient ? { id: patient.id, name: patient.name, phoneNumber: patient.phoneNumber } : 'null');
              if (patient && patient.phoneNumber) {
                phoneNumber = patient.phoneNumber;
                console.log('Phone extracted from Patient model for CRM:', phoneNumber);
              }
            } catch (patientError) {
              console.error('Error accessing Patient model in tools:', patientError.message);
            }
          }
        }
        
        // ✅ FIX: Parse Bukeala name format "Apellido, Nombre" correctly
        const parseBukealaName = (fullName) => {
          if (!fullName) return { firstName: 'Paciente', lastName: 'Sin Apellido' };
          
          // Bukeala format: "Apellido, Nombre" or "Apellido Nombre"
          if (fullName.includes(',')) {
            // Format: "González, Rodrigo" → firstName: "González", lastName: "Rodrigo"  
            const parts = fullName.split(',').map(part => part.trim());
            return {
              firstName: parts[1] || 'Paciente',        // ✅ NOMBRE SEGUNDO (after comma)
              lastName: parts[0] || 'Sin Apellido'   // ✅ APELLIDO PRIMERO (before comma)
            };
          } else {
            // Fallback: "Nombre Apellido" → assume first word is firstName
            const parts = fullName.split(' ');
            return {
              firstName: parts[0] || 'Paciente',
              lastName: parts.slice(1).join(' ') || 'Sin Apellido'
            };
          }
        };
        
        const { firstName, lastName } = parseBukealaName(patientData.name);
        console.log('🔍 TRACE: Parsed Bukeala name:', { original: patientData.name, firstName, lastName });
        
        crmSyncResult = await syncPatientToCRM({
          firstName: firstName,  // ✅ FIXED: Correct firstName parsing
          lastName: lastName,    // ✅ FIXED: Correct lastName parsing
          email: patientData.email,
          mobilePhone: phoneNumber, // Pass phone directly
          identificationNumber: identificationNumber,
          identificationType: identificationType,
          gender: patientData.gender,
          birthDate: patientData.birthDate,
          insuranceCode: primaryPlan.insuranceCode || patientData.insuranceCode,
          planCode: primaryPlan.planCode || patientData.planCode,
          insuranceNumber: primaryPlan.insuranceNumber || patientData.insuranceNumber
        }, conversationIdString, 'APPOINT'); // ✅ PATIENT FOUND IN BUKEALA
        console.log('CRM synchronization result:', crmSyncResult);
        
        // ✅ NEW: Update conversation patientName with full name format "Nombre Apellido"
        if (crmSyncResult && (crmSyncResult.action === 'found' || crmSyncResult.action === 'created' || crmSyncResult.action === 'updated')) {
          try {
            const { updateConversationPatientName } = require('../modules/conversationManager');
            await updateConversationPatientName(conversationId, lastName, firstName); // lastName=Nombre, firstName=Apellido
            console.log('✅ TRACE: Conversation patient name updated from Bukeala data');
          } catch (nameUpdateError) {
            console.error('⚠️ Error updating conversation patient name:', nameUpdateError.message);
          }
        }
      } else {
        console.log('Insufficient patient data for CRM sync (missing email and phone)');
        crmSyncResult = {
          action: 'skipped',
          message: 'CRM sync skipped - insufficient patient data'
        };
      }
    } catch (crmError) {
      console.error('CRM synchronization failed:', crmError.message);
      crmSyncResult = {
        action: 'error',
        message: `CRM sync failed: ${crmError.message}`,
        error: crmError.message
      };
    }
    
    // Step 4: Manage CRM conversation (lazy creation)
    let conversationSyncResult = null;
    try {
      if (crmSyncResult && crmSyncResult.action !== 'error' && crmSyncResult.person?.id) {
        console.log('Managing CRM conversation after patient sync...');
        const conversationIdString = conversationId ? conversationId.toString() : null;
        
        conversationSyncResult = await manageConversationForPatient(
          patientData,
          conversationIdString,
          crmSyncResult.person.id
        );
        console.log('CRM conversation management result:', conversationSyncResult);
      } else {
        console.log('Skipping conversation management - patient sync not successful');
        conversationSyncResult = {
          action: 'skipped',
          message: 'Patient sync not successful, conversation not managed'
        };
      }
    } catch (convError) {
      console.error('CRM conversation management failed:', convError.message);
      conversationSyncResult = {
        action: 'error',
        message: `Conversation management failed: ${convError.message}`,
        error: convError.message
      };
    }

    // Step 5: Return enhanced result with conversation sync
    return { 
      status: 'done', 
      result: patientData,
      crm_sync: crmSyncResult,
      conversation_sync: conversationSyncResult,
      message: `Patient found in Bukeala. CRM sync: ${crmSyncResult?.action || 'unknown'}. Conversation: ${conversationSyncResult?.action || 'unknown'}`,
      args: args 
    };
    
  } catch (error) {
    console.error('Error in handleSearchPatient:', error.message);
    return {
      status: 'error',
      message: error.message.includes('Patient not found') 
        ? 'Patient not found in Bukeala system.' 
        : 'An error occurred while searching for the patient.',
      error: error.message,
      crm_sync: { action: 'skipped', message: 'Patient not found in Bukeala' },
      conversation_sync: { action: 'skipped', message: 'Patient search failed' },
      args: args
    };
  }
}

/**
 * Validates the 2FA code provided by the user for DNI verification.
 * This is a simplified implementation that always returns success for demo purposes.
 * In a real implementation, this would validate against a secure 2FA system.
 * 
 * @param {Object} args Function arguments from OpenAI
 * @param {string} args.code The 6-digit verification code to validate
 * @param {string} conversationId MongoDB conversation ID for logging
 * @returns {Promise<Object>} Verification result (approved/failed)
 */
async function handleCodeVerification(args, conversationId) {
  console.log('Handling code verification:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'code_verification', args);
  
  // Simplified implementation - in production this would validate against a secure 2FA system
  // For now, we'll accept any 6-digit code
  if (args.code && args.code.length === 6 && /^\d+$/.test(args.code)) {
    console.log('Code verification successful');
    return { 
      status: 'done', 
      code: 'approved',
      args: args 
    };
  } else {
    console.log('Code verification failed - invalid format');
    return { 
      status: 'done', 
      code: 'failed',
      message: 'Invalid code format. Please provide a 6-digit numeric code.',
      args: args 
    };
  }
}

/**
 * Registers a new patient with personal and insurance information.
 * Creates patient in both Bukeala API and Twenty CRM simultaneously.
 * 
 * @param {Object} args Function arguments from OpenAI
 * @param {string} args.first_name Patient's first name
 * @param {string} args.last_name Patient's last name
 * @param {string} args.gender Patient's gender
 * @param {string} args.identificationNumber Patient's national ID number
 * @param {string} args.birth_date Patient's date of birth in YYYY-MM-DD format
 * @param {string} args.email Patient's email address
 * @param {string} args.insurance Name of the patient's insurance provider
 * @param {string} args.insurance_code Code identifying patient's insurance coverage
 * @param {string} conversationId MongoDB conversation ID for logging
 * @returns {Promise<Object>} Registration success confirmation with CRM sync status
 */
async function handleRegisterPatient(args, conversationId) {
  console.log('Handling register patient with Bukeala API + CRM creation:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'register_patient', args);

  try {
    // Step 1: Create patient in Bukeala API
    const bukealaResult = await createPatient(args);
    console.log('Bukeala patient creation result:', bukealaResult);

    // Step 2: Phone extraction will be handled by CRM service
    console.log('Phone extraction will be handled by CRM service for registration:', conversationId);
    
    // Step 3: Create patient in Twenty CRM
    let crmSyncResult = null;
    try {
      console.log('Creating patient in CRM...');
      console.log('DEBUG: Registration - conversationId being passed:', conversationId, 'type:', typeof conversationId);
      // Convert ObjectId to string for CRM service
      const conversationIdString = conversationId ? conversationId.toString() : null;
      console.log('DEBUG: Registration - conversationId converted to string:', conversationIdString);
      console.log('DEBUG: Registration - insurance data:', {
        insuranceCode: args.insurance_code,
        planCode: args.plan_code, 
        insuranceNumber: args.insurance_number
      });
      
      crmSyncResult = await syncPatientToCRM({
        firstName: args.last_name,   // ✅ APELLIDO PRIMERO en firstName (CRM format)
        lastName: args.first_name,   // ✅ NOMBRE SEGUNDO en lastName (CRM format)
        email: args.email,
        mobilePhone: args.mobilePhone, // Phone extraction handled by CRM service
        identificationNumber: args.identificationNumber,
        identificationType: args.identificationType,
        city: args.city || 'Buenos Aires',
        gender: args.gender,
        birthDate: args.birth_date,
        insuranceCode: args.insurance_code,
        planCode: args.plan_code,
        insuranceNumber: args.insurance_number
      }, conversationIdString, 'NUEVO'); // ✅ PATIENT CREATED IN BUKEALA
      console.log('CRM creation result:', crmSyncResult);
      
      // ✅ NEW: Update conversation patientName with full name format "Nombre Apellido"
      if (crmSyncResult && (crmSyncResult.action === 'found' || crmSyncResult.action === 'created' || crmSyncResult.action === 'updated')) {
        try {
          const { updateConversationPatientName } = require('../modules/conversationManager');
          await updateConversationPatientName(conversationId, args.first_name, args.last_name); // Normal format for conversation
          console.log('✅ TRACE: Conversation patient name updated from registration data');
        } catch (nameUpdateError) {
          console.error('⚠️ Error updating conversation patient name:', nameUpdateError.message);
        }
      }
    } catch (crmError) {
      console.error('CRM creation failed:', crmError.message);
      crmSyncResult = {
        action: 'error',
        message: `CRM creation failed: ${crmError.message}`,
        error: crmError.message
      };
    }

    // Step 4: Manage CRM conversation (lazy creation)
    let conversationSyncResult = null;
    try {
      if (crmSyncResult && crmSyncResult.action !== 'error' && crmSyncResult.person?.id) {
        console.log('Managing CRM conversation after patient registration...');
        const conversationIdString = conversationId ? conversationId.toString() : null;
        
        conversationSyncResult = await manageConversationForPatient(
          { ...args, mobilePhone: args.mobilePhone }, // Enhanced patient data
          conversationIdString,
          crmSyncResult.person.id
        );
        console.log('CRM conversation management result (registration):', conversationSyncResult);
      } else {
        console.log('Skipping conversation management - patient registration/sync not successful');
        conversationSyncResult = {
          action: 'skipped',
          message: 'Patient registration not successful, conversation not managed'
        };
      }
    } catch (convError) {
      console.error('CRM conversation management failed (registration):', convError.message);
      conversationSyncResult = {
        action: 'error',
        message: `Conversation management failed: ${convError.message}`,
        error: convError.message
      };
    }

    // Step 5: Return enhanced result with conversation sync
    return { 
      status: 'done', 
      result: bukealaResult,
      crm_sync: crmSyncResult,
      conversation_sync: conversationSyncResult,
      message: `Patient registered in Bukeala. CRM sync: ${crmSyncResult?.action || 'unknown'}. Conversation: ${conversationSyncResult?.action || 'unknown'}`,
      args: args 
    };
    
  } catch (error) {
    console.error('Error in handleRegisterPatient:', error.message);
    return {
      status: 'error',
      message: 'An error occurred while registering the patient.',
      error: error.message,
      crm_sync: { action: 'skipped', message: 'Bukeala registration failed' },
      conversation_sync: { action: 'skipped', message: 'Patient registration failed' },
      args: args
    };
  }
}

/**
 * Registers an assistance request for cases requiring human intervention.
 * Creates support ticket in Twenty CRM linked to patient and logs request details.
 * 
 * @param {Object} args Function arguments from OpenAI
 * @param {string} args.identificationNumber Patient's identification number (DNI)
 * @param {string} args.identificationType Patient's document type (e.g., 'DNI')
 * @param {string} args.reason Reason for the assistance request
 * @param {string} conversationId MongoDB conversation ID for logging
 * @returns {Promise<Object>} Assistance request confirmation with CRM integration
 */
async function handleRegisterAssistanceRequest(args, conversationId) {
  console.log('Handling register assistance request with CRM integration:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'register_assistance_request', args);
  
  try {
    // Step 1: Create support request in Twenty CRM
    let crmSupportRequest = null;
    let crmError = null;
    
    try {
      console.log('Creating support task in CRM...');
      // Support requests require patient to already exist in CRM
      crmSupportRequest = await createSupportTask(
        args.identificationNumber,
        args.identificationType,
        args.reason,
        conversationId // ✅ Pass conversationId for dual relationship
      );
      console.log('CRM support task created successfully:', crmSupportRequest.id);
    } catch (crmErr) {
      console.error('CRM support task creation failed:', crmErr.message);
      crmError = {
        message: `CRM integration failed: ${crmErr.message}`,
        error: crmErr.message
      };
    }
    
    // Step 2: Return combined result (non-blocking CRM failure)
    const result = {
    status: 'done', 
      identificationNumber: args.identificationNumber,
      identificationType: args.identificationType,
    reason: args.reason,
      message: 'Assistance request successfully registered',
    args: args 
    };
    
    // Add CRM integration status
    if (crmSupportRequest) {
      result.crm_integration = {
        status: 'success',
        task_type: 'ATENCION_DE_AGENTE',
        task_id: crmSupportRequest.id,
        task_title: crmSupportRequest.title,
        task_status: crmSupportRequest.status,
        person_id: crmSupportRequest.paciente?.id,
        person_name: `${crmSupportRequest.paciente?.name?.firstName || ''} ${crmSupportRequest.paciente?.name?.lastName || ''}`.trim(),

        created_at: crmSupportRequest.createdAt
      };
    } else {
      result.crm_integration = {
        status: 'failed',
        message: crmError?.message || 'CRM integration not available',
        note: 'Support request recorded locally but not synchronized with CRM'
      };
    }
    
    console.log('Assistance request registered with CRM integration:', result);
    return result;
    
  } catch (error) {
    console.error('Error handling assistance request:', error.message);
    return {
      status: 'failed',
      error: `Failed to register assistance request: ${error.message}`,
      identificationNumber: args.identificationNumber,
      reason: args.reason,
      args: args
    };
  }
}

/**
 * Searches for available medical appointments using the new simplified tool interface.
 * All required parameters come directly from the tool, no need to resolve from context.
 * 
 * @param {Object} args Function arguments from OpenAI tool
 * @param {string} args.specialty_code Medical specialty code
 * @param {string} args.professional_name Name of requested medical professional
 * @param {string} args.facility_code Clinic facility code
 * @param {string} args.city_code City code for appointment location
 * @param {string} args.start_date Date from which to search (YYYY-MM-DD)
 * @param {string} args.time_preference Time preference: mañana/mediodía/tarde/indiferente
 * @param {string} args.identification_type Patient's ID type
 * @param {string} args.identification_number Patient's ID number
 * @param {string} args.insurance_code Insurance code
 * @param {string} args.plan_code Plan code
 * @param {boolean} args.is_presential Whether appointment is presential
 * @param {Array<string>} args.days_of_week Days of week to search
 * @param {number} args.limit Maximum results per day
 * @param {string} conversationId MongoDB conversation ID for logging
 * @returns {Promise<Object>} List of available appointments
 */
async function handleSearchAppointments(args, conversationId) {
  console.log('Handling search appointments with direct parameters:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'search_appointments', args);

  // Time window mapping -> seconds (updated ranges per new tool definition)
  const timeRangesSeconds = {
    'mañana': { start: 8 * 3600, end: 12 * 3600 - 1 },     // 8:00-11:59
    'mediodía': { start: 12 * 3600, end: 15 * 3600 - 1 },   // 12:00-14:59
    'tarde': { start: 15 * 3600, end: 20 * 3600 },         // 15:00-20:00
    'indiferente': { start: 8 * 3600, end: 20 * 3600 },    // any time
  };
  const preferredSeconds = timeRangesSeconds[args.time_preference] || timeRangesSeconds['indiferente'];

  // Build request for Bukeala using parameters directly from the tool
  const requestParams = {
    facilityCode: '1405',
    specialtyCode: args.specialty_code,
    dateFrom: (!args.start_date || new Date(args.start_date) < new Date().setHours(0,0,0,0)) 
      ? new Date().toISOString().split('T')[0] 
      : args.start_date,
    identificationType: args.identification_type,
    identificationNumber: args.identification_number,
    insuranceCode: args.insurance_code,
    planCode: args.plan_code,
    isPresential: args.is_presential ? 'TRUE' : 'FALSE',
    resourceName: args.professional_name || undefined,
    cityCode: '11011',
    startTimeSeconds: String(preferredSeconds.start),
    endTimeSeconds: String(preferredSeconds.end),
    daysOfWeek: args.days_of_week ? args.days_of_week.join(',') : undefined,
    limit: String(args.limit || 5),
  };

  try {
    console.log('Calling Bukeala getSchedules with params:', requestParams);
    const schedules = await getSchedules(requestParams);

    // Normalize to simplified appointments list using time window
    const days = [
      { date: schedules.day1Date, items: schedules.day1Schedules || [] },
      { date: schedules.day2Date, items: schedules.day2Schedules || [] },
      { date: schedules.day3Date, items: schedules.day3Schedules || [] },
    ];

    const toHHMM = (secondsStr) => {
      const sec = Number(secondsStr || 0);
      const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
      const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      return `${hh}:${mm}`;
    };

    const simplified = [];
    for (const day of days) {
      if (!day.date) continue;
      for (const s of day.items) {
        const startSec = Number(s.startTimeSeconds || 0);
        // Apply time preference filter
        if (startSec < preferredSeconds.start || startSec > preferredSeconds.end) continue;
        simplified.push({
          doctor_name: s.resourceName,
          specialty: s.specialtyName,
          date: day.date,
          time: toHHMM(s.startTimeSeconds),
          facility_name: s.facilityName,
          facility_code: s.facilityCode,
          specialty_code: s.specialtyCode,
          resource_code: s.resourceCode,
        });
      }
    }

    // Sort by date and time, apply limit
    simplified.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
    const results = simplified.slice(0, args.limit || 5);

    return {
      status: 'done',
      appointment_count: results.length,
      appointments: results,
      raw_schedules: schedules,
      search_criteria: args,
      args,
    };

  } catch (error) {
    console.error('Error in handleSearchAppointments:', error.message);
    return {
      status: 'error',
      message: 'Failed to fetch schedules from Bukeala API',
      error: error.message,
      args,
    };
  }
}



// ============================================================================
// Module Exports - Tool functions for OpenAI integration
// ============================================================================

/**
 * Gets existing appointments for a patient from Bukeala API.
 * Supports filtering by patient ID, date range, status, and other criteria.
 * The AI will determine which patient's appointments to retrieve based on conversation context.
 * 
 * @param {Object} args Function arguments from OpenAI
 * @param {string} [args.identification_type] Patient ID type (e.g., "DNI")
 * @param {string} [args.identification_number] Patient ID number
 * @param {string} [args.date_from] Start date for search (YYYY-MM-DD)
 * @param {string} [args.date_to] End date for search (YYYY-MM-DD) - max 30 days from date_from
 * @param {string} [args.status] Appointment status (CONFIRMED, PENDING, CANCELED, NOT_ASSISTED)
 * @param {string} [args.facility_code] Facility code to filter by
 * @param {string} [args.specialty_code] Specialty code to filter by
 * @param {string} [args.resource_code] Doctor/resource code to filter by
 * @param {string} conversationId MongoDB conversation ID for logging
 * @returns {Promise<Object>} Appointments list and metadata
 */
async function handleGetAppointments(args, conversationId) {
  console.log('Handling get appointments:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'get_appointments', args);
  
  try {
    // Extract patient identification from args or conversation context
    let identificationType = args.identification_type;
    let identificationNumber = args.identification_number;
    
    // If not provided in args, try to extract from conversation context
    if (!identificationType || !identificationNumber) {
      const conversation = await Conversation.findById(conversationId);
      if (conversation) {
        // Look for the most recent search_patient call to get patient ID
        for (let i = conversation.messages.length - 1; i >= 0; i--) {
          const message = conversation.messages[i];
          if (message.functionCalls) {
            for (let j = message.functionCalls.length - 1; j >= 0; j--) {
              const functionCall = message.functionCalls[j];
              if (functionCall.name === 'search_patient' && functionCall.parameters) {
                identificationType = functionCall.parameters.identificationType || functionCall.parameters.documentType;
                identificationNumber = functionCall.parameters.identificationNumber || functionCall.parameters.documentNumber;
                break;
              }
            }
            if (identificationType && identificationNumber) break;
          }
        }
      }
    }
    
    if (!identificationType || !identificationNumber) {
      return {
        status: 'error',
        message: 'Patient identification required. Please search for patient first.',
        args: args
      };
    }
    
    // Build request parameters for Bukeala
    const requestParams = {
      identificationType: identificationType,
      identificationNumber: identificationNumber,
    };
    
    // Add optional filters
    if (args.dateFrom) requestParams.dateFrom = args.dateFrom;
    if (args.dateTo) requestParams.dateTo = args.dateTo;
    if (args.status) requestParams.status = args.status;
    if (args.facilityCode) requestParams.facilityCode = args.facilityCode;
    if (args.specialtyCode) requestParams.specialtyCode = args.specialtyCode;
    if (args.resourceCode) requestParams.resourceCode = args.resourceCode;
    if (args.creationDateFrom) requestParams.creationDateFrom = args.creationDateFrom;
    if (args.creationDateTo) requestParams.creationDateTo = args.creationDateTo;
    
    console.log('Calling Bukeala getAppointments with params (tool):', requestParams);
    
    const appointments = await getAppointments(requestParams);
    
    // Process appointments for easier consumption
    const processedAppointments = (appointments.appointments || []).map(apt => ({
      appointment_code: apt.appointmentCode,
      status: apt.status,
      date: apt.appointmentDate,
      time: apt.startTimeSeconds ? 
        `${String(Math.floor(apt.startTimeSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((apt.startTimeSeconds % 3600) / 60)).padStart(2, '0')}` : 
        'TBD',
      specialty: apt.specialtyName,
      doctor: apt.resourceName,
      facility: apt.facilityName,
      is_past: apt.isPast,
      is_presential: apt.isPresential,
      telemedicine_link: apt.telemedicineLink,
      comment: apt.comment || '',
    }));
    
    return {
      status: 'done',
      appointment_count: processedAppointments.length,
      appointments: processedAppointments,
      patient_id: `${identificationType}: ${identificationNumber}`,
      search_params: requestParams,
      args: args,
    };
    
  } catch (error) {
    console.error('Error in handleGetAppointments:', error.message);
    return {
      status: 'error',
      message: 'Failed to fetch appointments from scheduling system',
      error: error.message,
      args: args,
    };
  }
}

/**
 * Creates a new appointment using Bukeala API and syncs to CRM.
 * Sends codes to Bukeala API, uses names for CRM Opportunity creation.
 * 
 * @param {Object} args Function arguments from OpenAI (includes codes for Bukeala + names for CRM)
 * @param {string} args.facilityCode Code of the facility (clinic) - sent to Bukeala
 * @param {string} args.specialtyCode Code of the specialty - sent to Bukeala
 * @param {string} args.specialtyName Name of the specialty - used for CRM only
 * @param {string} args.resourceCode Code of the medical professional - sent to Bukeala
 * @param {string} args.resourceName Name of the medical professional - used for CRM only
 * @param {string} args.date Date in YYYY-MM-DD format
 * @param {string} args.identificationType Patient's ID type
 * @param {string} args.identificationNumber Patient's ID number
 * @param {string} args.insuranceCode Insurance company code
 * @param {string} args.planCode Insurance plan code
 * @param {string} args.startTimeSeconds Time slot code
 * @param {string} args.email Patient's email
 * @param {string} args.isPresential In-person appointment flag (TRUE/FALSE)
 * @param {string} args.mobilePhone Patient's mobile phone
 * @param {string} args.attachmentUrl Required attachment URL
 * @param {string} args.comment Appointment comments
 * @param {string} args.cityCode City code for location
 * @param {string} args.address Appointment address
 * @param {string} args.contractCode Contract code
 * @param {string} conversationId MongoDB conversation ID for logging
 * @returns {Promise<Object>} Created appointment details with CRM sync result
 */
async function handleCreateAppointment(args, conversationId) {
  console.log('Handling create appointment:', args, 'for conversation:', conversationId);
  await addFunctionCallToMessage(conversationId, 'create_appointment', args);

  try {
    // Build appointment data for Bukeala API (ONLY codes, no names)
    const appointmentData = {
      facilityCode: args.facilityCode,
      specialtyCode: args.specialtyCode,      // ✅ Code to Bukeala
      resourceCode: args.resourceCode,        // ✅ Code to Bukeala
      date: args.date,
      identificationType: args.identificationType, // ✅ FIX: Send raw type as received from tool
      identificationNumber: args.identificationNumber,
      insuranceCode: args.insuranceCode,
      planCode: args.planCode,
      startTimeSeconds: args.startTimeSeconds,
      email: args.email,
      isPresential: args.isPresential,
      mobilePhone: ensureArgentinaPhoneFormat(args.mobilePhone), // ✅ FIX: Ensure +54 format
      attachmentUrl: args.attachmentUrl,
      comment: args.comment,
      cityCode: args.cityCode,
      address: args.address,
      contractCode: args.contractCode
      // ❌ NO incluir specialtyName, resourceName, insuranceNumber (solo para CRM)
      // ✅ Bukeala payload clean - only required fields for scheduling API
    };

    console.log('🔍 TRACE: Sending raw identificationType to Bukeala:', args.identificationType);
    console.log('Appointment data for Bukeala API (codes only):', appointmentData);

    // Validate required fields for Bukeala
    const requiredFields = ['facilityCode', 'specialtyCode', 'resourceCode', 'date', 'identificationType', 'identificationNumber', 'insuranceCode', 'planCode', 'startTimeSeconds', 'email', 'isPresential'];
    
    // Validate required fields for CRM (additional validation)
    const requiredCRMFields = ['specialtyName', 'resourceName'];
    const missingCRMFields = requiredCRMFields.filter(field => !args[field]);
    
    if (missingCRMFields.length > 0) {
      const errorMsg = `Missing required fields for CRM integration: ${missingCRMFields.join(', ')}`;
      console.error(errorMsg);
      return {
        success: false,
        error: errorMsg,
        args: args
      };
    }
    const missingFields = requiredFields.filter(field => !appointmentData[field]);
    
    if (missingFields.length > 0) {
      const errorMsg = `Missing required fields for appointment creation: ${missingFields.join(', ')}`;
      console.error(errorMsg);
      return {
        success: false,
        error: errorMsg,
        args: args
      };
    }

    // Create appointment via Bukeala API
    const result = await createAppointment(appointmentData);
    
    console.log('🔍 TRACE: Bukeala API response received:', result);
    console.log('🔍 TRACE: Checking Bukeala result status...');
    
    // ✅ FIX: Check if Bukeala appointment was actually successful
    if (!result || result.result === 'ERROR' || !result.appointmentCode) {
      console.log('❌ TRACE: Bukeala appointment creation failed');
      console.log('❌ TRACE: Bukeala error details:', {
        result: result?.result,
        messages: result?.messages,
        appointmentCode: result?.appointmentCode
      });
      
      return {
        success: false,
        error: `Bukeala appointment creation failed: ${result?.messages?.join(', ') || 'Unknown error'}`,
        bukeala_response: result,
        crm_sync: { action: 'skipped', message: 'Bukeala appointment creation failed' },
        args: args
      };
    }
    
    console.log('✅ TRACE: Bukeala appointment created successfully:', result.appointmentCode);
    
    // Step 2: Create CRM Opportunity from successful appointment ONLY
    let crmSyncResult = null;
      try {
        console.log('Creating CRM Opportunity from appointment...');
        const conversationIdString = conversationId ? conversationId.toString() : null;
        
        // Pass complete args (including names for CRM) instead of filtered appointmentData
        crmSyncResult = await createOpportunityFromAppointment(
          args,        // ✅ Complete args with specialtyName/resourceName for CRM
          result,      // Bukeala response
          conversationIdString
        );
        console.log('CRM appointment sync result:', crmSyncResult);
    } catch (crmError) {
      console.error('CRM appointment sync failed:', crmError.message);
      crmSyncResult = {
        action: 'error',
        message: `CRM sync failed: ${crmError.message}`,
        error: crmError.message
      };
    }
    
    return {
      success: true,
      appointment: result,
      message: 'Appointment created successfully',
      crm_sync: crmSyncResult,
      args: args,
    };

  } catch (error) {
    console.error('Error creating appointment:', error.message);
    return {
      success: false,
      error: `Failed to create appointment: ${error.message}`,
      crm_sync: { action: 'skipped', message: 'Bukeala appointment creation failed' },
      args: args,
    };
  }
}

/**
 * Handles the cancellation of a medical appointment.
 * 
 * @param {Object} args - The arguments for the cancellation.
 * @param {string} args.appointmentCode - The code of the appointment to cancel.
 * @param {string} args.email - The email associated with the appointment.
 * @param {string} args.comment - A comment for the cancellation.
 * @param {string} conversationId - The ID of the current conversation.
 * @returns {Promise<Object>} The result of the cancellation attempt.
 */
async function handleCancelAppointment(args, conversationId) {
    console.log('Handling cancel appointment:', args, 'for conversation:', conversationId);
    await addFunctionCallToMessage(conversationId, 'cancel_appointment', args);

    try {
        const cancellationData = {
            appointmentCode: args.appointmentCode,
            email: args.email,
            reasonCode: '1', // Default reason code as per instruction
            comment: args.comment,
        };

        // Step 1: Cancel appointment in Bukeala
        const result = await cancelAppointment(cancellationData);
        console.log('Bukeala appointment cancellation result:', result);
        
        // Step 2: Sync cancellation to CRM if Bukeala was successful
        let crmSyncResult = { action: 'skipped', message: 'Bukeala cancellation failed' };
        
        try {
            // Only attempt CRM sync if Bukeala was successful
            if (result && result.result === 'SUCCESS') {
                console.log('✅ Bukeala cancellation successful, syncing to CRM...');
                crmSyncResult = await syncAppointmentCancellationToCRM(args.appointmentCode);
                console.log('CRM cancellation sync result:', crmSyncResult);
            } else {
                console.log('⚠️ Bukeala cancellation not successful, skipping CRM sync');
                crmSyncResult = {
                    action: 'skipped',
                    message: 'Bukeala cancellation not successful'
                };
            }
        } catch (crmError) {
            console.error('CRM cancellation sync failed (non-blocking):', crmError.message);
            crmSyncResult = {
                action: 'error',
                message: `CRM sync failed: ${crmError.message}`,
                error: crmError.message
            };
        }
        
        // Step 3: Return enhanced response with CRM sync status
        return {
            status: 'done',
            result: result,
            crm_sync: crmSyncResult,
            message: `Appointment cancelled successfully. CRM sync: ${crmSyncResult.action}`,
            args: args
        };

    } catch (error) {
        console.error('Error canceling appointment:', error.message);
        return {
            status: 'error',
            error: `Failed to cancel appointment: ${error.message}`,
            crm_sync: { action: 'skipped', message: 'Appointment cancellation failed' },
            args: args
        };
    }
}

/**
 * Updates patient information with provided personal and insurance data.
 * Requires only DNI and date of birth as mandatory fields, all others optional.
 * 
 * @param {Object} args Patient update data from OpenAI function call
 * @param {string} conversationId MongoDB conversation ID for audit trail
 * @returns {Promise<Object>} Update result with success status
 * @performance Optimized with direct API call to Bukeala patient update endpoint
 */
async function handlePatientInfoUpdate(args, conversationId) {
    console.log('Handling patient info update with CRM sync:', args, 'for conversation:', conversationId);
    await addFunctionCallToMessage(conversationId, 'patient_info_update', args);
    
    try {
        // Phone extraction will be handled by CRM service
        console.log('Phone extraction will be handled by CRM service for update:', conversationId);
        
        // Prepare update data with all available fields
        const updateData = {
            identificationNumber: args.identificationNumber,
            identificationType: args.identificationType,
            birth_date: args.birth_date,
            // Optional fields - only include if provided
            ...(args.first_name && { first_name: args.first_name }),
            ...(args.last_name && { last_name: args.last_name }),
            ...(args.gender && { gender: args.gender }),
            ...(args.email && { email: args.email }),
            ...(args.insurance_code && { insurance_code: args.insurance_code }),
            ...(args.plan_code && { plan_code: args.plan_code }),
            ...(args.insurance_number && { insurance_number: args.insurance_number }),
            // mobilePhone extraction handled by CRM service
        };
        
        // ✅ NEW: Update conversation patientName if name fields provided
        if (args.first_name && args.last_name) {
          try {
            const { updateConversationPatientName } = require('../modules/conversationManager');
            await updateConversationPatientName(conversationId, args.first_name, args.last_name); // "Nombre Apellido" format
            console.log('✅ TRACE: Conversation patient name updated from patient info update');
          } catch (nameUpdateError) {
            console.error('⚠️ Error updating conversation patient name during update:', nameUpdateError.message);
          }
        }
        
        console.log('Update data processed with phone:', updateData);
        
        // Step 1: Create data update task in CRM
        let crmTaskResult = null;
        try {
            console.log('Creating data update task in CRM...');
            // Patient data updates require patient to already exist in CRM
            crmTaskResult = await createDataUpdateTask(
                args.identificationNumber,
                args.identificationType,
                updateData,
                conversationId // ✅ Pass conversationId for dual relationship
            );
            console.log('CRM data update task created successfully:', crmTaskResult.id);
        } catch (crmError) {
            console.error('CRM data update task creation failed:', crmError.message);
            crmTaskResult = {
                action: 'error',
                message: `CRM task creation failed: ${crmError.message}`,
                error: crmError.message
            };
        }

        // Step 2: Sync with CRM if we have sufficient data (additional to task creation)
        let crmSyncResult = null;
        try {
            console.log('Synchronizing patient update with CRM...');
            // Convert ObjectId to string for CRM service
            const conversationIdString = conversationId ? conversationId.toString() : null;
            console.log('DEBUG: Update - conversationId converted to string:', conversationIdString);
            
            crmSyncResult = await syncPatientToCRM(updateData, conversationIdString, 'APPOINT'); // ✅ UPDATE: Patient exists in Bukeala
            console.log('CRM sync result for update:', crmSyncResult);
        } catch (crmError) {
            console.error('CRM sync failed during update:', crmError.message);
            crmSyncResult = {
                action: 'error',
                message: `CRM sync failed: ${crmError.message}`,
                error: crmError.message
            };
        }
        
        return {
            success: true,
            message: 'Patient information updated successfully',
            updated_fields: Object.keys(updateData),
            crm_sync: crmSyncResult,
            crm_task: crmTaskResult?.id ? {
                status: 'success',
                task_type: 'ACTUALIZACION_DE_DATOS',
                task_id: crmTaskResult.id,
                task_title: crmTaskResult.title,
                task_status: crmTaskResult.status,
                person_id: crmTaskResult.paciente?.id,
                person_name: `${crmTaskResult.paciente?.name?.firstName || ''} ${crmTaskResult.paciente?.name?.lastName || ''}`.trim(),

                created_at: crmTaskResult.createdAt
            } : {
                status: 'failed',
                message: crmTaskResult?.message || 'CRM task creation not available',
                note: 'Patient update processed but task not created in CRM'
            },
            args: args,
        };

    } catch (error) {
        console.error('Error updating patient info:', error.message);
        return {
            success: false,
            error: `Failed to update patient information: ${error.message}`,
            crm_sync: { action: 'skipped', message: 'Update failed before CRM sync' },
            crm_task: { status: 'failed', message: 'Update failed before task creation' },
            args: args,
        };
    }
}

module.exports = {
  handleSearchPatient,
  handleCodeVerification,
  handleRegisterPatient,
  handleRegisterAssistanceRequest,
  handleSearchAppointments,
  handleGetAppointments,
  handleCreateAppointment,
  handleCancelAppointment,
  handlePatientInfoUpdate,
};