/**
 * twentyCrmService.js
 * 
 * Description: Service for integrating with Twenty CRM to manage patient records and maintain synchronized data between Bukeala API and CRM.
 * 
 * Role in the system: Provides CRM integration capabilities for patient management, ensuring all patient interactions are tracked in the CRM system.
 * 
 * Node.js Context: Service - external CRM integration and patient data synchronization
 * 
 * Dependencies:
 * - axios (HTTP client for API requests)
 * - config/environment variables (TWENTY_CRM_API_KEY, TWENTY_CRM_BASE_URL)
 * 
 * Dependants:
 * - tools/patientManagementTools.js (calls CRM sync functions)
 * - services/externalSchedulingService.js (patient data integration)
 */

const axios = require('axios');
const { getInsuranceProviderName, getInsurancePlanName, getCompleteInsuranceInfo } = require('../config/insuranceMappings');
const { formatPhoneForCRM, detectCountryFromPhone } = require('../config/countryPhoneCodes');
const Conversation = require('../models/Conversation');
const { Patient } = require('../models'); // Correct Sequelize import

class TwentyCrmService {
    constructor() {
        // ✅ SECURITY: Use environment variables without hardcoded fallbacks
        this.baseURL = process.env.TWENTY_CRM_BASE_URL || 'http://localhost:3000';
        this.apiKey = process.env.TWENTY_CRM_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxYWQ0YzBmZS00M2FjLTQ3YmQtYmQzZi1lNzljNWMzZTBjMDciLCJ0eXBlIjoiQVBJX0tFWSIsIndvcmtzcGFjZUlkIjoiMWFkNGMwZmUtNDNhYy00N2JkLWJkM2YtZTc5YzVjM2UwYzA3IiwiaWF0IjoxNzU1NjI3MjgwLCJleHAiOjQ5MDkyMjcyNzksImp0aSI6IjBkN2FjOTAzLTgzMTQtNDZjMC1hNjEyLTE4ODc3ZTZlZjk0ZiJ9.isuY6ZlaoxQ8-UA5RmHu1PauLPHtB7XgGVlpubiH8JM';
        
        // Validate required environment variables
        if (!this.baseURL) {
            throw new Error('TWENTY_CRM_BASE_URL environment variable is required');
        }
        
        if (!this.apiKey) {
            throw new Error('TWENTY_CRM_API_KEY environment variable is required');
        }
        
        console.log('Twenty CRM Service initialized with URL:', this.baseURL);
        // ✅ SECURITY: Never log API keys
        console.log('Twenty CRM API Key configured:', this.apiKey ? '✅ Present' : '❌ Missing');
        
        this.axiosInstance = axios.create({
            baseURL: this.baseURL,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    // ============================================================================
    // Patient Search and Verification - CRM integration methods
    // ============================================================================

    /**
     * Search for a person in Twenty CRM by email address.
     * Used to check if a patient already exists in the CRM before creating.
     * 
     * @param {string} email Patient's email address
     * @returns {Promise<Object|null>} CRM person object or null if not found
     * @throws {Error} if CRM API call fails
     */
    async findPersonByEmail(email) {
        try {
            console.log('Searching for person in CRM by email:', email);
            
            const query = {
                query: `query { 
                    people(filter: { 
                        emails: { 
                            primaryEmail: { eq: "${email}" } 
                        } 
                    }) { 
                        edges { 
                            node { 
                                id 
                                name { firstName lastName } 
                                email { primaryEmail } 
                                phones { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode }
                                jobTitle
                                city
                                createdAt
                                updatedAt
                            } 
                        } 
                    } 
                }`
            };

            const response = await this.axiosInstance.post('/graphql', query);
            
            if (response.data?.data?.people?.edges?.length > 0) {
                const person = response.data.data.people.edges[0].node;
                console.log('Person found in CRM:', person.id);
                return person;
            }
            
            console.log('Person not found in CRM by email:', email);
            return null;

        } catch (error) {
            console.error('Error searching person in CRM by email:', error.message);
            throw new Error(`CRM search failed: ${error.message}`);
        }
    }

    /**
     * Search for a person in Twenty CRM by document number and type.
     * Primary search method using unique document identification.
     * 
     * @param {string} documentNumber Patient's document number
     * @param {string} documentType Patient's document type
     * @returns {Promise<Object|null>} CRM person object or null if not found
     * @throws {Error} if CRM API call fails
     */
    async findPersonByDocument(documentNumber, documentType) {
        try {
            console.log('Searching for person in CRM by document:', documentNumber, documentType);
            
            const mappedDocumentType = this.mapIdentificationType(documentType);
            console.log('Mapped document type for search:', mappedDocumentType);
            
            const query = {
                query: `query { 
                    people(filter: { 
                        numeroDeDocumento: { eq: "${documentNumber}" }
                    }) { 
                        edges { 
                            node { 
                                id 
                                name { firstName lastName } 
                                emails { primaryEmail } 
                                phones { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode }
                                whatsapp { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode }
                                numeroDeDocumento
                                tipoDeDocumento
                                generoBiologico
                                fechaDeNacimiento
                                financiador
                                cobertura
                                numeroDeAfiliado
                                createdAt
                                updatedAt
                            } 
                        } 
                    } 
                }`
            };

            const response = await this.axiosInstance.post('/graphql', query);
            
            if (response.data?.data?.people?.edges?.length > 0) {
                // Filter by document type if multiple matches
                const people = response.data.data.people.edges;
                const exactMatch = people.find(edge => 
                    edge.node.tipoDeDocumento === mappedDocumentType
                );
                
                if (exactMatch) {
                    console.log('Exact document match found in CRM:', exactMatch.node.id);
                    return exactMatch.node;
                } else if (people.length > 0) {
                    // Fallback to first match if no exact type match
                    console.log('Document number match found (type may differ):', people[0].node.id);
                    return people[0].node;
                }
            }
            
            console.log('Person not found in CRM by document:', documentNumber, documentType);
            return null;

        } catch (error) {
            console.error('Error searching person in CRM by document:', error.message);
            throw new Error(`CRM document search failed: ${error.message}`);
        }
    }

    /**
     * Search for a person in Twenty CRM by phone number.
     * Alternative search method when email is not available.
     * 
     * @param {string} phoneNumber Patient's phone number (without country code)
     * @returns {Promise<Object|null>} CRM person object or null if not found
     * @throws {Error} if CRM API call fails
     */
    async findPersonByPhone(phoneNumber) {
        try {
            console.log('Searching for person in CRM by phone:', phoneNumber);
            
            // Clean phone number - remove country codes and formatting
            const cleanPhone = phoneNumber.replace(/[\+\-\s\(\)]/g, '');
            
            const query = {
                query: `query { 
                    people(filter: { 
                        phones: { 
                            primaryPhoneNumber: { contains: "${cleanPhone}" } 
                        } 
                    }) { 
                        edges { 
                            node { 
                                id 
                                name { firstName lastName } 
                                email { primaryEmail } 
                                phones { primaryPhoneNumber primaryPhoneCountryCode primaryPhoneCallingCode }
                                jobTitle
                                city
                                createdAt
                                updatedAt
                            } 
                        } 
                    } 
                }`
            };

            const response = await this.axiosInstance.post('/graphql', query);
            
            if (response.data?.data?.people?.edges?.length > 0) {
                const person = response.data.data.people.edges[0].node;
                console.log('Person found in CRM by phone:', person.id);
                return person;
            }
            
            console.log('Person not found in CRM by phone:', phoneNumber);
            return null;

        } catch (error) {
            console.error('Error searching person in CRM by phone:', error.message);
            throw new Error(`CRM phone search failed: ${error.message}`);
        }
    }

    // ============================================================================
    // Task Management - CRM task creation for support and data updates
    // ============================================================================

    /**
     * Create a task in Twenty CRM for patient support or data updates.
     * Uses dual relationship approach: custom fields (pacienteId, conversacionId) + taskTargets.
     * Requires patient to already exist in CRM - does NOT auto-create patients.
     * Supports two task types: ATENCION_DE_AGENTE and ACTUALIZACION_DE_DATOS.
     * 
     * @param {string} identificationNumber Patient's DNI or identification number
     * @param {string} identificationType Patient's document type (e.g., 'DNI')
     * @param {string} taskType Task type: 'ATENCION_DE_AGENTE' or 'ACTUALIZACION_DE_DATOS'
     * @param {string} content Content for task body (reason for support, or JSON data for updates)
     * @param {string} conversationId Optional MongoDB conversation ID for linking
     * @returns {Promise<Object>} Created task object
     * @throws {Error} if patient not found in CRM or task creation fails
     */
    async createTask(identificationNumber, identificationType, taskType, content, conversationId = null) {
        try {
            console.log('Creating task in CRM with patient verification:', { identificationNumber, identificationType, taskType });
            
            // Step 1: Find the person in CRM by document (MUST exist)
            const person = await this.findPersonByDocument(identificationNumber, this.mapIdentificationType(identificationType));
            
            if (!person) {
                // Business logic: Patient must exist in CRM before creating tasks
                throw new Error(`Patient with ${identificationType} ${identificationNumber} not found in CRM. Please verify the patient is registered in Bukeala first, and if not, create a new patient registration by collecting the required information.`);
            }
            
            console.log('Patient verified in CRM for task creation:', person.id);
            
            // Step 2: Find CRM conversation if conversationId provided
            let crmConversationId = null;
            if (conversationId) {
                try {
                    console.log('Looking for CRM conversation using MongoDB ID:', conversationId);
                    const existingConversation = await this.findConversationByMongoId(conversationId);
                    if (existingConversation) {
                        crmConversationId = existingConversation.id;
                        console.log('✅ Found CRM conversation for task:', crmConversationId);
                    } else {
                        console.log('⚠️ CRM conversation not found for MongoDB ID:', conversationId);
                    }
                } catch (convError) {
                    console.warn('Could not find CRM conversation for task (continuing without):', convError.message);
                }
            }
            
            // Step 2: Generate task title based on type
            const personDisplayName = `${person.name?.firstName || ''} ${person.name?.lastName || ''}`.trim() || 'Paciente';
            const taskTitle = taskType === 'ATENCION_DE_AGENTE' 
                ? `Soporte: ${personDisplayName}`
                : `Actualizacion: ${personDisplayName}`;
            
            // Step 3: Create task using two-step approach (task + taskTarget relationship)
            
            // Step 3a: Create task first
            const taskMutation = {
                query: `mutation CreateTask($taskData: TaskCreateInput!) {
                    createTask(data: $taskData) {
                        id
                        title
                        status
                        tipo
                        bodyV2 {
                            markdown
                        }
                        pacienteId
                        conversacionId
                        paciente {
                            id
                            name {
                                firstName
                                lastName
                            }
                            numeroDeDocumento
                        }
                        conversacion {
                            id
                            name
                            idDeConversacion
                        }
                        createdAt
                        updatedAt
                    }
                }`,
                variables: {
                    taskData: {
                        title: taskTitle,
                        bodyV2: {
                            markdown: content
                        },
                        tipo: taskType,  // ATENCION_DE_AGENTE or ACTUALIZACION_DE_DATOS
                        status: 'TODO',
                        pacienteId: person.id, // ✅ CUSTOM FIELD: Direct patient relationship
                        ...(crmConversationId && { conversacionId: crmConversationId }) // ✅ CUSTOM FIELD: Direct conversation relationship (optional)
                    }
                }
            };
            
            console.log('Step 1: Creating task:', JSON.stringify(taskMutation.variables, null, 2));
            const taskResponse = await this.axiosInstance.post('/graphql', taskMutation);
            
            if (!taskResponse.data?.data?.createTask) {
                console.error('Failed to create task:', taskResponse.data);
                throw new Error('Task creation failed');
            }
            
            const task = taskResponse.data.data.createTask;
            console.log('Step 1 completed: Task created with ID:', task.id);
            
            // Step 3b: Create taskTarget relationships (person + conversation)
            try {
                console.log('Step 2: Creating taskTarget relationships...');
                
                // Create taskTarget for person (always)
                const personTargetResponse = await this.axiosInstance.post('/rest/taskTargets', {
                    taskId: task.id,
                    personId: person.id
                });
                console.log('✅ Person taskTarget created:', personTargetResponse.data?.id || 'success');
                
                // Create taskTarget for conversation (if available)
                if (crmConversationId) {
                    try {
                        const conversationTargetResponse = await this.axiosInstance.post('/rest/taskTargets', {
                            taskId: task.id,
                            conversacionId: crmConversationId // ✅ CONVERSATION TASK TARGET
                        });
                        console.log('✅ Conversation taskTarget created:', conversationTargetResponse.data?.id || 'success');
                    } catch (convTargetError) {
                        console.warn('Conversation taskTarget creation failed:', convTargetError.message);
                    }
                }
                
            } catch (targetError) {
                console.warn('TaskTarget creation failed (task still created):', targetError.message);
                // Continue with task even if relationship creation fails
            }
            
            // Return enhanced response with dual relationships
            return {
                id: task.id,
                title: task.title || taskTitle,
                bodyV2: task.bodyV2 || { markdown: content },
                tipo: task.tipo || taskType,
                status: task.status || 'TODO',
                pacienteId: task.pacienteId,  // ✅ Direct patient relationship
                conversacionId: task.conversacionId,  // ✅ Direct conversation relationship
                paciente: task.paciente || {  // ✅ Auto-populated relationship
                    id: person.id,
                    name: person.name,
                    numeroDeDocumento: person.numeroDeDocumento,
                    tipoDeDocumento: person.tipoDeDocumento
                },
                conversacion: task.conversacion || null,  // ✅ Auto-populated relationship (if conversation found)
                createdAt: task.createdAt,
                updatedAt: task.updatedAt
            };
            
        } catch (error) {
            console.error('Error creating task in CRM:', error.message);
            if (error.response?.data) {
                console.error('CRM Error Details:', JSON.stringify(error.response.data, null, 2));
            }
            throw new Error(`CRM task creation failed: ${error.message}`);
        }
    }

    /**
     * Create a support request task in Twenty CRM.
     * Uses task type ATENCION_DE_AGENTE for patient support requests.
     * Requires patient to already exist in CRM.
     * 
     * @param {string} identificationNumber Patient's DNI or identification number
     * @param {string} identificationType Patient's document type (e.g., 'DNI')
     * @param {string} reason Reason for the support request
     * @returns {Promise<Object>} Created task object
     * @throws {Error} if patient not found in CRM or task creation fails
     */
    async createSupportTask(identificationNumber, identificationType, reason, conversationId = null) {
        return await this.createTask(identificationNumber, identificationType, 'ATENCION_DE_AGENTE', reason, conversationId);
    }

    /**
     * Create a patient data update task in Twenty CRM.
     * Uses task type ACTUALIZACION_DE_DATOS for patient information updates.
     * Requires patient to already exist in CRM.
     * 
     * @param {string} identificationNumber Patient's DNI or identification number
     * @param {string} identificationType Patient's document type (e.g., 'DNI')
     * @param {Object} updateData Patient update data to store in task body
     * @returns {Promise<Object>} Created task object
     * @throws {Error} if patient not found in CRM or task creation fails
     */
    async createDataUpdateTask(identificationNumber, identificationType, updateData, conversationId = null) {
        // Generate markdown table comparing old vs new values
        const person = await this.findPersonByDocument(identificationNumber, this.mapIdentificationType(identificationType));
        const markdownTable = this.generateUpdateMarkdownTable(person, updateData);
        return await this.createTask(identificationNumber, identificationType, 'ACTUALIZACION_DE_DATOS', markdownTable, conversationId);
    }

    // ============================================================================
    // Patient Creation and Updates - CRM data management
    // ============================================================================

    /**
     * Create a new person in Twenty CRM with patient data.
     * Maps Bukeala patient data to Twenty CRM person structure with custom fields.
     * 
     * @param {Object} patientData Patient data from Bukeala API
     * @param {string} patientData.firstName Patient's first name
     * @param {string} patientData.lastName Patient's last name
     * @param {string} patientData.email Patient's email address
     * @param {string} patientData.mobilePhone Patient's phone number
     * @param {string} patientData.identificationNumber Patient's DNI
     * @param {string} patientData.identificationType Patient's ID type
     * @param {string} patientData.gender Patient's gender (M/F)
     * @param {string} patientData.birthDate Patient's birth date (YYYY-MM-DD)
     * @param {string} patientData.insuranceCode Insurance provider code
     * @param {string} patientData.planCode Insurance plan code
     * @param {string} patientData.insuranceNumber Insurance member number
     * @param {string} patientData.city Patient's city (optional)
     * @param {string} patientData.tipo Patient origin type: 'APPOINT' (found in Bukeala) or 'NUEVO' (created in Bukeala)
     * @returns {Promise<Object>} Created CRM person object
     * @throws {Error} if CRM creation fails
     */
    async createPerson(patientData) {
        try {
            console.log('Creating person in CRM with enhanced field mapping:', patientData);
            console.log('Insurance data for mapping - insuranceCode:', patientData.insuranceCode, 'planCode:', patientData.planCode, 'insuranceNumber:', patientData.insuranceNumber);
            
            // Map Bukeala data to Twenty CRM structure with custom fields
            const crmPersonData = {
                // Standard fields
                name: {
                    firstName: patientData.firstName || patientData.first_name || 'Paciente',
                    lastName: patientData.lastName || patientData.last_name || 'Sin Apellido'
                },
                emails: {
                    primaryEmail: patientData.email
                },
                
                // Custom fields mapping with insurance name resolution
                cobertura: this.mapInsurancePlan(patientData.insuranceCode || patientData.insurance_code, patientData.planCode || patientData.plan_code), // Text - Plan name
                financiador: this.mapInsuranceProvider(patientData.insuranceCode || patientData.insurance_code), // Text - Insurance provider name
                numeroDeAfiliado: patientData.insuranceNumber || patientData.insurance_number || '', // Text - Member number
                numeroDeDocumento: patientData.identificationNumber || patientData.identificationNumber || '', // Text - ID number
                tipoDeDocumento: this.mapIdentificationType(patientData.identificationType || patientData.identificationType), // Select - ID type
                generoBiologico: this.mapGender(patientData.gender), // Text - Gender
                fechaDeNacimiento: patientData.birthDate || patientData.birth_date || null, // Date - Birth date
                tipo: patientData.tipo || 'NUEVO' // ✅ NEW: Patient origin type (APPOINT/NUEVO)
            };
            
            console.log('DEBUG: Insurance mapping results:');
            console.log('- insuranceCode input:', patientData.insuranceCode || patientData.insurance_code);
            console.log('- planCode input:', patientData.planCode || patientData.plan_code);
            console.log('- financiador mapped:', crmPersonData.financiador);
            console.log('- cobertura mapped:', crmPersonData.cobertura);

            // Add phone data if available (from patient data or conversation)
            const phoneNumber = await this.extractPhoneNumber(patientData);
            console.log('DEBUG: Phone number extracted for CRM formatting:', phoneNumber);
            
            // ✅ FIX: Ensure Argentina country code for local phones
            const correctedPhoneNumber = this.ensureArgentinaFormat(phoneNumber);
            console.log('DEBUG: Phone number corrected for Argentina:', correctedPhoneNumber);
            
            if (correctedPhoneNumber) {
                // Format phone number with international country detection
                const phoneFormatting = formatPhoneForCRM(correctedPhoneNumber);
                console.log('DEBUG: Phone formatting result:', phoneFormatting);
                
                if (phoneFormatting) {
                    // WhatsApp as PRIMARY phone field
                    crmPersonData.whatsapp = phoneFormatting.whatsapp;
                    
                    // Standard phones as secondary field
                    crmPersonData.phones = phoneFormatting.phones;
                    
                    console.log('DEBUG: Phone fields added to CRM data:', {
                        whatsapp: crmPersonData.whatsapp,
                        phones: crmPersonData.phones
                    });
                }
            } else {
                console.log('DEBUG: No phone number available for CRM formatting');
            }

            console.log('Mapped CRM person data with custom fields:', crmPersonData);

            const response = await this.axiosInstance.post('/rest/people', crmPersonData);
            
            if (response.data?.data?.createPerson) {
                const createdPerson = response.data.data.createPerson;
                console.log('Person created successfully in CRM:', createdPerson.id);
                return createdPerson;
            } else {
                throw new Error('Unexpected CRM response structure');
            }

        } catch (error) {
            console.error('Error creating person in CRM:', error.message);
            if (error.response?.data) {
                console.error('CRM Error Details:', JSON.stringify(error.response.data, null, 2));
            }
            throw new Error(`CRM creation failed: ${error.message}`);
        }
    }

    /**
     * Update an existing person in Twenty CRM with enhanced field mapping.
     * Used when patient information is updated in Bukeala.
     * 
     * @param {string} personId CRM person ID
     * @param {Object} updateData Updated patient data
     * @returns {Promise<Object>} Updated CRM person object
     * @throws {Error} if CRM update fails
     */
    async updatePerson(personId, updateData) {
        try {
            console.log('Updating person in CRM with enhanced field mapping:', personId, updateData);
            
            // Map update data to CRM structure with custom fields
            const crmUpdateData = {};
            
            // Standard fields
            if (updateData.firstName || updateData.lastName || updateData.first_name || updateData.last_name) {
                crmUpdateData.name = {
                    firstName: updateData.firstName || updateData.first_name,
                    lastName: updateData.lastName || updateData.last_name
                };
            }
            
            if (updateData.email) {
                crmUpdateData.emails = {
                    primaryEmail: updateData.email
                };
            }
            
            // Phone and WhatsApp handling with international support
            const phoneNumber = await this.extractPhoneNumber(updateData);
            console.log('DEBUG: Phone number for update formatting:', phoneNumber);
            
            // ✅ FIX: Ensure Argentina country code for local phones
            const correctedPhoneNumber = this.ensureArgentinaFormat(phoneNumber);
            console.log('DEBUG: Phone number corrected for Argentina (update):', correctedPhoneNumber);
            
            if (correctedPhoneNumber) {
                // Format phone number with international country detection
                const phoneFormatting = formatPhoneForCRM(correctedPhoneNumber);
                console.log('DEBUG: Update phone formatting result:', phoneFormatting);
                
                if (phoneFormatting) {
                    // WhatsApp as PRIMARY phone field
                    crmUpdateData.whatsapp = phoneFormatting.whatsapp;
                    
                    // Standard phones as secondary field  
                    crmUpdateData.phones = phoneFormatting.phones;
                    
                    console.log('DEBUG: Phone fields added to update data:', {
                        whatsapp: crmUpdateData.whatsapp,
                        phones: crmUpdateData.phones
                    });
                }
            }
            
            // Custom fields with insurance name mapping
            const insuranceCode = updateData.insuranceCode || updateData.insurance_code;
            const planCode = updateData.planCode || updateData.plan_code;
            
            if (planCode) {
                crmUpdateData.cobertura = this.mapInsurancePlan(insuranceCode, planCode);
            }
            
            if (insuranceCode) {
                crmUpdateData.financiador = this.mapInsuranceProvider(insuranceCode);
            }
            
            if (updateData.insuranceNumber || updateData.insurance_number) {
                crmUpdateData.numeroDeAfiliado = updateData.insuranceNumber || updateData.insurance_number;
            }
            
            if (updateData.identificationNumber || updateData.identificationNumber) {
                crmUpdateData.numeroDeDocumento = updateData.identificationNumber || updateData.identificationNumber;
            }
            
            if (updateData.identificationType || updateData.identificationType) {
                crmUpdateData.tipoDeDocumento = this.mapIdentificationType(updateData.identificationType || updateData.identificationType);
            }
            
            if (updateData.gender) {
                crmUpdateData.generoBiologico = this.mapGender(updateData.gender);
            }
            
            if (updateData.birthDate || updateData.birth_date) {
                crmUpdateData.fechaDeNacimiento = updateData.birthDate || updateData.birth_date;
            }

            const response = await this.axiosInstance.patch(`/rest/people/${personId}`, crmUpdateData);
            
            console.log('Person updated successfully in CRM:', personId);
            return response.data;

        } catch (error) {
            console.error('Error updating person in CRM:', error.message);
            throw new Error(`CRM update failed: ${error.message}`);
        }
    }

    // ============================================================================
    // Data Mapping Helper Methods - Field transformation utilities
    // ============================================================================

    /**
     * Maps identification type to Twenty CRM select values.
     * Converts various ID type formats to CRM-compatible values.
     * 
     * @param {string} identificationType Raw identification type
     * @returns {string} Mapped CRM identification type value
     */
    mapIdentificationType(identificationType) {
        if (!identificationType) return 'D_N_I'; // Default to DNI
        
        const typeMapping = {
            'DNI': 'D_N_I',
            'D.N.I.': 'D_N_I',
            'PASAPORTE': 'PASAPORTE',
            'PASSPORT': 'PASAPORTE',
            'CI': 'C_I',
            'C.I.': 'C_I',
            'DNM': 'D_N_M',
            'D.N.M.': 'D_N_M',
            'CUIT': 'C_U_I_T',
            'C.U.I.T.': 'C_U_I_T',
            'LC': 'L_C',
            'L.C.': 'L_C',
            'LE': 'L_E',
            'L.E.': 'L_E',
            'NO_TIENE': 'NO_TIENE',
            '1': 'D_N_I' // Bukeala API uses "1" for DNI
        };
        
        const normalizedType = identificationType.toString().toUpperCase();
        return typeMapping[normalizedType] || 'D_N_I';
    }

    /**
     * Converts CRM identification type back to standard format for display.
     * Used for generating support request names and display purposes.
     * 
     * @param {string} crmIdType CRM identification type (e.g., 'D_N_I')
     * @returns {string} Standard identification type for display
     */
    unmapIdentificationType(crmIdType) {
        const reverseTypeMap = {
            'D_N_I': 'DNI',
            'PASAPORTE': 'PASAPORTE',
            'C_I': 'CI',
            'D_N_M': 'DNM',
            'C_U_I_T': 'CUIT',
            'L_C': 'LC',
            'L_E': 'LE',
            'NO_TIENE': 'NO_TIENE'
        };
        
        return reverseTypeMap[crmIdType] || 'DNI'; // Default to DNI
    }

    /**
     * Generates a Markdown table showing patient data changes for update tasks.
     * Creates a comparison table with old vs new values for changed fields only.
     * 
     * @param {Object} existingPerson Current CRM person data
     * @param {Object} updateData New patient data being updated
     * @returns {string} Markdown table showing field changes
     */
    generateUpdateMarkdownTable(existingPerson, updateData) {
        const changes = [];
        
        // Helper function to format dates from YYYY-MM-DD to DD/MM/AAAA
        const formatDate = (dateStr) => {
            if (!dateStr) return '';
            const date = new Date(dateStr);
            if (isNaN(date.getTime())) return dateStr; // Return as-is if invalid
            return date.toLocaleDateString('es-AR', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric' 
            });
        };

        // Compare and add changes (excluding ID and ID Type as they never change)
        
        // Name fields
        const oldFirstName = existingPerson.name?.firstName || '';
        const newFirstName = updateData.firstName || updateData.first_name || '';
        if (oldFirstName !== newFirstName && newFirstName) {
            changes.push(['Nombre', oldFirstName, newFirstName]);
        }
        
        const oldLastName = existingPerson.name?.lastName || '';
        const newLastName = updateData.lastName || updateData.last_name || '';
        if (oldLastName !== newLastName && newLastName) {
            changes.push(['Apellido', oldLastName, newLastName]);
        }
        
        // Email
        const oldEmail = existingPerson.emails?.primaryEmail || '';
        const newEmail = updateData.email || '';
        if (oldEmail !== newEmail && newEmail) {
            changes.push(['Email', oldEmail, newEmail]);
        }
        
        // Gender with mapping
        const oldGender = existingPerson.generoBiologico || '';
        const newGender = updateData.gender ? this.mapGender(updateData.gender) : '';
        if (oldGender !== newGender && newGender) {
            changes.push(['Género', oldGender, newGender]);
        }
        
        // Birth date with formatting
        const oldBirthDate = existingPerson.fechaDeNacimiento ? formatDate(existingPerson.fechaDeNacimiento) : '';
        const newBirthDate = updateData.birth_date ? formatDate(updateData.birth_date) : '';
        if (oldBirthDate !== newBirthDate && newBirthDate) {
            changes.push(['Fecha de Nacimiento', oldBirthDate, newBirthDate]);
        }
        
        // Insurance with code mapping
        const oldInsuranceProvider = existingPerson.financiador || '';
        const newInsuranceCode = updateData.insurance_code || updateData.insuranceCode;
        const newInsuranceProvider = newInsuranceCode ? this.mapInsuranceProvider(newInsuranceCode) : '';
        if (oldInsuranceProvider !== newInsuranceProvider && newInsuranceProvider) {
            changes.push(['Financiador', oldInsuranceProvider, newInsuranceProvider]);
        }
        
        // Insurance plan with code mapping
        const oldPlan = existingPerson.cobertura || '';
        const newPlanCode = updateData.plan_code || updateData.planCode;
        const newPlan = (newInsuranceCode && newPlanCode) ? this.mapInsurancePlan(newInsuranceCode, newPlanCode) : '';
        if (oldPlan !== newPlan && newPlan) {
            changes.push(['Plan de Cobertura', oldPlan, newPlan]);
        }
        
        // Insurance number
        const oldInsuranceNumber = existingPerson.numeroDeAfiliado || '';
        const newInsuranceNumber = updateData.insurance_number || updateData.insuranceNumber || '';
        if (oldInsuranceNumber !== newInsuranceNumber && newInsuranceNumber) {
            changes.push(['Número de Afiliado', oldInsuranceNumber, newInsuranceNumber]);
        }
        
        // Phone number (sync version for comparison)
        const oldPhone = existingPerson.whatsapp?.primaryPhoneNumber || existingPerson.phones?.primaryPhoneNumber || '';
        const newPhone = this.extractPhoneNumberSync(updateData) || '';
        if (oldPhone !== newPhone && newPhone) {
            changes.push(['Teléfono', oldPhone, newPhone]);
        }
        
        // Generate markdown table
        if (changes.length === 0) {
            return 'No se detectaron cambios en los datos del paciente.';
        }
        
        let markdown = '## Actualización de Datos del Paciente\n\n';
        markdown += '| Campo | Valor Anterior | Valor Nuevo |\n';
        markdown += '|-------|----------------|-------------|\n';
        
        changes.forEach(([field, oldValue, newValue]) => {
            // Escape emails to prevent automatic link conversion
            const escapeEmail = (value) => {
                if (value && value.includes('@')) {
                    return `\`${value}\``; // Use backticks to prevent link conversion
                }
                return value;
            };
            
            const displayOldValue = escapeEmail(oldValue) || '*(vacío)*';
            const displayNewValue = escapeEmail(newValue);
            
            markdown += `| ${field} | ${displayOldValue} | ${displayNewValue} |\n`;
        });
        
        markdown += `\n**Fecha de actualización**: ${formatDate(new Date().toISOString())}\n`;
        markdown += `**Total de campos modificados**: ${changes.length}`;
        
        return markdown;
    }

    /**
     * Maps gender values to Twenty CRM format with full names.
     * Normalizes various gender representations to full Spanish names.
     * 
     * @param {string} gender Raw gender value
     * @returns {string} Mapped gender value (Masculino/Femenino)
     */
    mapGender(gender) {
        if (!gender) return '';
        
        const genderMapping = {
            'M': 'Masculino',
            'MASCULINO': 'Masculino',
            'MALE': 'Masculino',
            'HOMBRE': 'Masculino',
            'F': 'Femenino',
            'FEMENINO': 'Femenino',
            'FEMALE': 'Femenino',
            'MUJER': 'Femenino'
        };
        
        const normalizedGender = gender.toString().toUpperCase();
        return genderMapping[normalizedGender] || '';
    }

    /**
     * Maps insurance provider code to readable name.
     * Uses modular insurance mappings for code-to-name conversion.
     * 
     * @param {string} insuranceCode Insurance provider code
     * @returns {string} Insurance provider name or code if not found
     */
    mapInsuranceProvider(insuranceCode) {
        return getInsuranceProviderName(insuranceCode);
    }

    /**
     * Maps insurance plan using entity ID and plan code to readable plan name.
     * Uses modular plan mappings for comprehensive plan identification.
     * 
     * @param {string} entityId Insurance entity/provider ID
     * @param {string} planCode Insurance plan code
     * @returns {string} Insurance plan name or code if not found
     */
    mapInsurancePlan(entityId, planCode) {
        return getInsurancePlanName(entityId, planCode);
    }

    /**
     * Gets complete insurance information with provider and plan names.
     * Provides comprehensive insurance details for CRM integration.
     * 
     * @param {string} insuranceCode Insurance provider code
     * @param {string} planCode Insurance plan code
     * @returns {Object} Complete insurance information object
     */
    getInsuranceInfo(insuranceCode, planCode) {
        return getCompleteInsuranceInfo(insuranceCode, planCode);
    }

    /**
     * Extracts phone number synchronously from patient data for comparison purposes.
     * Simplified version of extractPhoneNumber for use in checkIfUpdateNeeded.
     * 
     * @param {Object} patientData Patient data object
     * @returns {string|null} Extracted phone number or null
     */
    extractPhoneNumberSync(patientData) {
        // Priority order: explicit phone -> mobile phone -> phone number
        if (patientData.whatsappNumber) return patientData.whatsappNumber;
        if (patientData.mobilePhone && patientData.mobilePhone !== '') return patientData.mobilePhone;
        if (patientData.phoneNumber) return patientData.phoneNumber;
        
        // No conversation context extraction for synchronous comparison
        return null;
    }

    /**
     * Extracts the ACTUAL conversation phone number from conversation context.
     * Used for phone management to get the real WhatsApp number being used.
     * Prioritizes conversation context over patient registered data.
     * 
     * @param {string} conversationId MongoDB conversation ID
     * @returns {Promise<string|null>} Actual conversation phone number or null
     */
    async extractConversationPhone(conversationId) {
        if (!conversationId) return null;
        
        try {
            console.log('🔍 TRACE: Extracting ACTUAL conversation phone from context:', conversationId);
            
            const conversation = await Conversation.findById(conversationId);
            console.log('DEBUG: conversation found:', !!conversation);
            
            if (conversation) {
                // Priority 1: Direct phoneNumber from conversation metadata
                if (conversation.phoneNumber) {
                    console.log('✅ TRACE: Actual conversation phone from metadata:', conversation.phoneNumber);
                    return conversation.phoneNumber;
                }
                
                // Priority 2: Extract from conversation messages (webhook data)
                if (conversation.messages && conversation.messages.length > 0) {
                    for (const message of conversation.messages) {
                        // Extract from webhook 'from' field (most reliable for actual conversation phone)
                        if (message.from && message.from.includes('@c.us')) {
                            const phoneFromWebhook = message.from.split('@')[0];
                            console.log('✅ TRACE: Actual conversation phone from webhook:', phoneFromWebhook);
                            return phoneFromWebhook;
                        }
                        
                        if (message.phoneNumber) {
                            console.log('✅ TRACE: Actual conversation phone from message field:', message.phoneNumber);
                            return message.phoneNumber;
                        }
                    }
                }
                
                // Priority 3: Patient model as last resort (but this is registered phone, not conversation phone)
                if (conversation.patientId) {
                    try {
                        const patient = await Patient.findByPk(conversation.patientId);
                        if (patient && patient.phoneNumber) {
                            console.log('⚠️ TRACE: Using registered patient phone (not conversation phone):', patient.phoneNumber);
                            return patient.phoneNumber;
                        }
                    } catch (patientError) {
                        console.error('Error accessing Patient model:', patientError);
                    }
                }
            }
            
            console.log('❌ TRACE: No actual conversation phone found');
            return null;
            
        } catch (error) {
            console.error('Error extracting actual conversation phone:', error);
            return null;
        }
    }

    /**
     * Extracts phone number from Patient model or conversation context.
     * Priority: Patient model → conversation metadata → message content.
     * 
     * @param {Object} patientData Patient data object
     * @param {string} conversationId Optional conversation ID for phone extraction
     * @returns {Promise<string|null>} Extracted phone number or null
     */
    async extractPhoneNumber(patientData, conversationId = null) {
        // Priority order: explicit phone -> mobile phone -> Patient model -> conversation context
        if (patientData.whatsappNumber) return patientData.whatsappNumber;
        if (patientData.mobilePhone && patientData.mobilePhone !== '') return patientData.mobilePhone;
        if (patientData.phoneNumber) return patientData.phoneNumber;
        
        // Extract from Patient model using conversation context
        if (conversationId) {
            try {
                console.log('Extracting phone number from Patient model via conversation:', conversationId);
                console.log('DEBUG: conversationId type in extraction:', typeof conversationId, 'value:', conversationId);
                
                const conversation = await Conversation.findById(conversationId);
                console.log('DEBUG: conversation found:', !!conversation);
                console.log('DEBUG: conversation phoneNumber:', conversation?.phoneNumber);
                console.log('DEBUG: conversation patientId:', conversation?.patientId);
                console.log('DEBUG: conversation messages count:', conversation?.messages?.length);
                
                if (conversation) {
                    // First, try direct phoneNumber from conversation
                    if (conversation.phoneNumber) {
                        console.log('Phone found in conversation metadata:', conversation.phoneNumber);
                        return conversation.phoneNumber;
                    }
                    
                    // Second, try to get phone from associated Patient model (Sequelize)
                    if (conversation.patientId) {
                        try {
                            const patient = await Patient.findByPk(conversation.patientId); // Sequelize method
                            console.log('DEBUG: patient found via patientId:', !!patient, 'phone:', patient?.phoneNumber);
                            if (patient && patient.phoneNumber) {
                                console.log('Phone found in Patient model via patientId:', patient.phoneNumber);
                                return patient.phoneNumber;
                            }
                        } catch (patientError) {
                            console.error('Error accessing Patient model via patientId:', patientError);
                        }
                    }
                    
                    // Third, look for phone in conversation messages (from webhook data)
                    if (conversation.messages && conversation.messages.length > 0) {
                        for (const message of conversation.messages) {
                            // Check if message has phone data from webhook
                            if (message.from && message.from.includes('@c.us')) {
                                const phoneFromMessage = message.from.split('@')[0];
                                console.log('Phone extracted from message.from:', phoneFromMessage);
                                return phoneFromMessage;
                            }
                            
                            if (message.phoneNumber) {
                                console.log('Phone found in message phoneNumber field:', message.phoneNumber);
                                return message.phoneNumber;
                            }
                        }
                    }
                }

                
                console.log('No phone number found in conversation or Patient model');
                return null;
            } catch (error) {
                console.error('Error extracting phone from conversation/Patient model:', error);
                return null;
            }
        }
        
        return null;
    }

    // ============================================================================
    // Appointment Management - CRM Opportunity creation for medical appointments
    // ============================================================================

    /**
     * Creates a CRM Opportunity from a successful Bukeala appointment.
     * Maps appointment data to Twenty CRM Opportunity with healthcare-specific fields.
     * 
     * @param {Object} appointmentData Input data used to create appointment in Bukeala
     * @param {Object} bukealaResponse Successful response from Bukeala appointment creation
     * @param {string} conversationId Conversation ID for phone extraction context
     * @returns {Promise<Object>} CRM sync result with opportunity data
     * @throws {Error} if patient not found in CRM or appointment creation fails
     */
    async createOpportunityFromAppointment(appointmentData, bukealaResponse, conversationId = null) {
        try {
            console.log('Creating CRM Opportunity from Bukeala appointment:', {
                appointmentData: appointmentData,
                bukealaResponse: bukealaResponse,
                conversationId: conversationId
            });

            // Step 1: Find the patient in CRM (must exist for appointment creation)
            const crmPerson = await this.findPersonByDocument(
                appointmentData.identificationNumber,
                appointmentData.identificationType
            );

            if (!crmPerson) {
                throw new Error(
                    `Patient with ${appointmentData.identificationType} ${appointmentData.identificationNumber} not found in CRM. ` +
                    `Patient must be registered before creating appointments.`
                );
            }

            console.log('Patient found in CRM for appointment:', crmPerson.id);

            // Step 2: Map appointment data to CRM Opportunity structure (using conversation context for phone)
            const opportunityData = await this.mapAppointmentToOpportunity(appointmentData, bukealaResponse, crmPerson, conversationId);
            console.log('Mapped opportunity data:', opportunityData);

            // Step 3: Create Opportunity in CRM with detailed tracing
            console.log('🔍 TRACE: About to send opportunity data to CRM:', JSON.stringify(opportunityData, null, 2));
            console.log('🔍 TRACE: Validating required fields...');
            console.log('🔍 TRACE: - name:', opportunityData.name ? '✅' : '❌');
            console.log('🔍 TRACE: - fechaHora:', opportunityData.fechaHora ? '✅' : '❌');
            console.log('🔍 TRACE: - especialidad:', opportunityData.especialidad ? '✅' : '❌');
            console.log('🔍 TRACE: - profesional:', opportunityData.profesional ? '✅' : '❌');
            console.log('🔍 TRACE: - stage:', opportunityData.stage ? '✅' : '❌');
            console.log('🔍 TRACE: - pointOfContactId:', opportunityData.pointOfContactId ? '✅' : '❌');
            console.log('🔍 TRACE: - conversacionId:', opportunityData.conversacionId ? '✅' : '❌');
            
            const createdOpportunity = await this.axiosInstance.post('/rest/opportunities', opportunityData);

            if (!createdOpportunity.data) {
                throw new Error('Failed to create opportunity in CRM');
            }

            const opportunity = createdOpportunity.data;
            console.log('Opportunity created successfully in CRM:', opportunity.id);

            return {
                action: 'created',
                opportunity: opportunity,
                patient: {
                    id: crmPerson.id,
                    name: crmPerson.name,
                    numeroDeDocumento: crmPerson.numeroDeDocumento
                },
                message: 'Appointment created in CRM successfully'
            };

        } catch (error) {
            console.error('Error creating CRM opportunity from appointment:', error.message);
            if (error.response?.data) {
                console.error('CRM Error Details:', JSON.stringify(error.response.data, null, 2));
            }
            
            return {
                action: 'error',
                opportunity: null,
                message: `CRM appointment creation failed: ${error.message}`,
                error: error.message
            };
        }
    }

    /**
     * Maps Bukeala appointment data to Twenty CRM Opportunity structure.
     * Handles insurance code mapping, phone formatting, and healthcare-specific fields.
     * 
     * @param {Object} appointmentData Original appointment input data
     * @param {Object} bukealaResponse Bukeala API response with appointment details
     * @param {Object} crmPerson Patient record from CRM
     * @returns {Object} Formatted opportunity data for CRM creation
     */
    async mapAppointmentToOpportunity(appointmentData, bukealaResponse, crmPerson, conversationId = null) {
        // Combine date and time for fechaHora
        const appointmentDateTime = this.combineDateAndTime(
            appointmentData.date,
            appointmentData.startTimeSeconds
        );

        // Build enhanced comments with appointment metadata
        const enhancedComments = this.buildAppointmentComments(appointmentData, bukealaResponse);

        // ✅ NEW: Create enhanced opportunity title with state, patient, and specialty
        const opportunityStage = 'NUEVO'; // Initial stage for new appointments
        const opportunityTitle = this.formatOpportunityTitle(opportunityStage, crmPerson, appointmentData.specialtyName);

        // ✅ FIX: Extract phone number using conversation context (CRITICAL for CRM WhatsApp field)
        console.log('🔍 TRACE: Extracting phone number for CRM opportunity...');
        console.log('🔍 TRACE: appointmentData.mobilePhone:', appointmentData.mobilePhone);
        console.log('🔍 TRACE: appointmentData.insuranceNumber:', appointmentData.insuranceNumber);
        console.log('🔍 TRACE: conversationId provided:', conversationId);
        console.log('🔍 TRACE: bukealaResponse.appointmentCode:', bukealaResponse.appointmentCode);
        
        const phoneNumber = await this.extractPhoneNumber(appointmentData, conversationId);
        console.log('🔍 TRACE: Extracted phone number:', phoneNumber);
        
        const formattedPhone = this.formatPhoneForOpportunity(phoneNumber);
        console.log('🔍 TRACE: Formatted phone for CRM:', formattedPhone);
        console.log('🔍 TRACE: Insurance number provided:', appointmentData.insuranceNumber);
        console.log('🔍 TRACE: Alternative nroDeAfiliado:', appointmentData.nroDeAfiliado);
        console.log('🔍 TRACE: CRM Patient numeroDeAfiliado:', crmPerson.numeroDeAfiliado);
        
        // ✅ NEW: Extract insurance number with priority order for CRM only (not sent to Bukeala)
        const finalInsuranceNumber = appointmentData.insuranceNumber ||        // NEW: From OpenAI tool schema
                                   appointmentData.nroDeAfiliado ||            // Alternative field name
                                   crmPerson.numeroDeAfiliado ||               // From CRM patient data
                                   crmPerson.nroDeAfiliado || '';               // Alternative CRM field
        console.log('🔍 TRACE: Final nroDeAfiliado for CRM opportunity:', finalInsuranceNumber);

        // ✅ NEW: Find CRM conversation for opportunity linking
        let crmConversationId = null;
        if (conversationId) {
            try {
                console.log('🔍 TRACE: Finding CRM conversation for opportunity linking:', conversationId);
                const crmConversation = await this.findConversationByMongoId(conversationId);
                if (crmConversation) {
                    crmConversationId = crmConversation.id;
                    console.log('✅ TRACE: CRM conversation found for opportunity:', crmConversationId);
                } else {
                    console.log('⚠️ TRACE: No CRM conversation found for opportunity, will create without conversation link');
                }
            } catch (convError) {
                console.warn('⚠️ Error finding CRM conversation for opportunity:', convError.message);
            }
        }

        // Build base opportunity payload
        const opportunityPayload = {
            // Healthcare-specific fields
            name: opportunityTitle,
            fechaHora: appointmentDateTime,
            especialidad: appointmentData.specialtyName || '',  // ✅ Use name directly (required field)
            profesional: appointmentData.resourceName || '',    // ✅ Use name directly (required field)
            
            // Insurance information with proper mapping
            financiador: this.mapInsuranceProvider(appointmentData.insuranceCode),
            coberturaPlan: this.mapInsurancePlan(appointmentData.insuranceCode, appointmentData.planCode),
            nroDeAfiliado: finalInsuranceNumber,
            
            // Contact information
            email: {
                primaryEmail: appointmentData.email
            },
            // ❌ NO whatsapp field here - added conditionally below
            
            // Comments with metadata
            comentarios: enhancedComments,
            
            // Status and linking
            stage: opportunityStage, // Use same stage as in title
            pointOfContactId: crmPerson.id,
            
            // ✅ NEW: Appointment tracking field - Store Bukeala appointment code for cross-system linking
            codigoDeTurno: bukealaResponse.appointmentCode || null,
            
            // ✅ NEW: Conversation linking field - Many-to-one relationship with conversation
            ...(crmConversationId && { conversacionId: crmConversationId })
            
            // ✅ FIX: closeDate removed - should be empty as per user feedback
            // ✅ FIX: Don't send amount field at all instead of null (causes "Cannot convert undefined or null to object")
        };

        // ✅ FIX: Only include whatsapp field if phone is valid (prevents "Cannot convert undefined or null to object")
        if (formattedPhone) {
            console.log('🔍 TRACE: Including whatsapp field in CRM payload');
            opportunityPayload.whatsapp = formattedPhone;
        } else {
            console.log('🔍 TRACE: Skipping whatsapp field (no valid phone number)');
        }

        return opportunityPayload;
    }

    /**
     * Combines date and time seconds into ISO DateTime format.
     * Uses Argentina timezone (UTC-3) for proper appointment scheduling.
     * 
     * @param {string} date Date in YYYY-MM-DD format
     * @param {string|number} timeSeconds Time in seconds since midnight
     * @returns {string} ISO DateTime string for CRM
     */
    combineDateAndTime(date, timeSeconds) {
        const seconds = parseInt(timeSeconds) || 0;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        
        // Create full datetime string in Argentina timezone
        const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
        const fullDateTime = `${date}T${timeString}-03:00`; // Argentina timezone UTC-3
        
        // Convert to Date and return ISO string
        const appointmentDate = new Date(fullDateTime);
        return appointmentDate.toISOString();
    }

    /**
     * Builds enhanced comments for appointment including metadata.
     * 
     * @param {Object} appointmentData Original appointment input data
     * @param {Object} bukealaResponse Bukeala API response
     * @returns {string} Formatted comments with metadata
     */
    buildAppointmentComments(appointmentData, bukealaResponse) {
        let comments = appointmentData.comment || '';
        
        // Add appointment modality
        const modalidad = appointmentData.isPresential === 'TRUE' ? 'Presencial' : 'Telemedicina';
        comments += `\n[Modalidad: ${modalidad}]`;
        
        // Add appointment code from Bukeala response
        if (bukealaResponse && bukealaResponse.appointmentCode) {
            comments += `\n[Código: ${bukealaResponse.appointmentCode}]`;
        }
        
        // Add facility information if available
        if (appointmentData.facilityCode) {
            comments += `\n[Centro: ${appointmentData.facilityCode}]`;
        }
        
        return comments.trim();
    }

    /**
     * Ensures Argentina country code format for local phone numbers.
     * Prevents misdetection of Argentina mobile numbers as India numbers.
     * 
     * @param {string} phoneNumber Raw phone number
     * @returns {string} Phone number with Argentina format
     */
    ensureArgentinaFormat(phoneNumber) {
        if (!phoneNumber) return phoneNumber;
        
        // Clean the phone number first
        const cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
        
        // If it's an Argentina mobile number starting with 9 (and not already prefixed with country code)
        if (cleaned.match(/^9[0-9]{9,10}$/) && !cleaned.startsWith('54')) {
            console.log('🔍 TRACE: Detected Argentina mobile number, adding country code');
            return `+54${cleaned}`;  // Add Argentina country code
        }
        
        // If it already starts with +54, return as-is
        if (cleaned.startsWith('+54') || cleaned.startsWith('54')) {
            return phoneNumber;
        }
        
        // For other formats, return as-is
        return phoneNumber;
    }

    /**
     * Formats phone number for CRM Opportunity whatsapp field.
     * Uses the same phone formatting logic as person creation.
     * 
     * @param {string} phoneNumber Raw phone number
     * @returns {Object} Formatted phone object for CRM
     */
    formatPhoneForOpportunity(phoneNumber) {
        if (!phoneNumber) return null;
        
        // ✅ FIX: Use corrected phone format
        const correctedPhone = this.ensureArgentinaFormat(phoneNumber);
        
        const { formatPhoneForCRM } = require('../config/countryPhoneCodes');
        const phoneFormatting = formatPhoneForCRM(correctedPhone);
        
        return phoneFormatting ? phoneFormatting.whatsapp : null;
    }

    // ============================================================================
    // Appointment Lifecycle Management - Bidirectional appointment tracking
    // ============================================================================

    /**
     * Maps CRM opportunity stage to friendly Spanish names for display.
     * Used in opportunity title formatting for better readability.
     * 
     * @param {string} stage CRM opportunity stage value
     * @returns {string} Friendly Spanish stage name in uppercase
     */
    mapStageToFriendlyName(stage) {
        const stageMapping = {
            'NUEVO': 'PENDIENTE',
            'CONFIRMADO': 'CONFIRMADO', 
            'CANCELADO_POR_PACIENTE': 'CANCELADO',
            'CANCELADO_POR_INSTITUCION': 'BAJA',
            'COMPLETADO': 'COMPLETADO',
            'EN_PROCESO': 'EN_PROCESO'
        };
        
        return stageMapping[stage] || 'PENDIENTE'; // Default to PENDIENTE
    }

    /**
     * Formats opportunity title with specialty and patient name.
     * Format: {Especialidad} - {Apellido}, {Nombre}
     * Example: "Cardiología - González, María"
     * 
     * @param {string} stage CRM opportunity stage (not used in new format)
     * @param {Object} crmPerson CRM person object with name
     * @param {string} specialtyName Medical specialty name
     * @returns {string} Formatted opportunity title
     */
    formatOpportunityTitle(stage, crmPerson, specialtyName) {
        // Format patient name: "Apellido, Nombre"
        const lastName = crmPerson.name?.lastName || 'Apellido';
        const firstName = crmPerson.name?.firstName || 'Nombre';
        const patientName = `${lastName}, ${firstName}`.replace(/,\s*$/, ''); // Clean trailing comma
        
        // Format specialty in normal case
        const specialty = specialtyName || 'Consulta';
        
        // Build final title: {Especialidad} - {Apellido}, {Nombre}
        const title = `${specialty} - ${patientName}`;
        
        console.log('🔍 TRACE: Formatted opportunity title:', title);
        return title;
    }

    /**
     * Searches for CRM opportunity by Bukeala appointment code.
     * Uses codigoDeTurno field for cross-system appointment tracking and cancellation sync.
     * 
     * @param {string} appointmentCode Bukeala appointment code to search for
     * @returns {Promise<Object|null>} Found opportunity or null
     */
    async findOpportunityByAppointmentCode(appointmentCode) {
        try {
            console.log('🔍 TRACE: Searching CRM opportunity by appointment code:', appointmentCode);
            
            // First try REST API approach
            const restResponse = await this.axiosInstance.get('/rest/opportunities', {
                params: {
                    'filter[codigoDeTurno][eq]': appointmentCode
                }
            });
            
            if (restResponse.data?.data?.length > 0) {
                const opportunity = restResponse.data.data[0];
                console.log('✅ TRACE: Opportunity found via REST API:', opportunity.id);
                return opportunity;
            }
            
            // Fallback to GraphQL approach if REST doesn't work
            console.log('🔄 TRACE: REST search returned no results, trying GraphQL...');
            
            const graphqlQuery = {
                query: `query {
                    opportunities(filter: { 
                        codigoDeTurno: { eq: "${appointmentCode}" }
                    }) {
                        edges {
                            node {
                                id
                                name
                                stage
                                codigoDeTurno
                                fechaHora
                                especialidad
                                profesional
                                pointOfContactId
                                createdAt
                                updatedAt
                            }
                        }
                    }
                }`
            };

            const graphqlResponse = await this.axiosInstance.post('/graphql', graphqlQuery);
            
            if (graphqlResponse.data?.data?.opportunities?.edges?.length > 0) {
                const opportunity = graphqlResponse.data.data.opportunities.edges[0].node;
                console.log('✅ TRACE: Opportunity found via GraphQL:', opportunity.id);
                return opportunity;
            }
            
            console.log('❌ TRACE: No CRM opportunity found for appointment code:', appointmentCode);
            return null;

        } catch (error) {
            console.error('❌ Error searching opportunity by appointment code:', error.message);
            if (error.response?.data) {
                console.error('CRM Search Error Details:', JSON.stringify(error.response.data, null, 2));
            }
            throw new Error(`CRM opportunity search failed: ${error.message}`);
        }
    }

    /**
     * Updates CRM opportunity stage/status.
     * Used for appointment status synchronization (e.g., cancellation).
     * 
     * @param {string} opportunityId CRM opportunity ID
     * @param {string} newStage New stage/status value
     * @returns {Promise<Object>} Updated opportunity object
     */
    async updateOpportunityStage(opportunityId, newStage) {
        try {
            console.log('🔄 TRACE: Updating opportunity stage:', {
                opportunityId,
                newStage
            });
            
            const updateData = {
                stage: newStage
            };
            
            const response = await this.axiosInstance.patch(`/rest/opportunities/${opportunityId}`, updateData);
            
            if (!response.data) {
                throw new Error('Failed to update opportunity stage in CRM');
            }
            
            console.log('✅ TRACE: Opportunity stage updated successfully:', response.data.id);
            return response.data;

        } catch (error) {
            console.error('❌ Error updating opportunity stage:', error.message);
            if (error.response?.data) {
                console.error('CRM Update Error Details:', JSON.stringify(error.response.data, null, 2));
            }
            throw new Error(`CRM opportunity stage update failed: ${error.message}`);
        }
    }

    /**
     * Syncs appointment cancellation from Bukeala to CRM.
     * Searches for opportunity by appointment code and updates stage to cancelled.
     * 
     * @param {string} appointmentCode Bukeala appointment code
     * @returns {Promise<Object>} CRM sync result with opportunity details
     */
    async syncAppointmentCancellationToCRM(appointmentCode) {
        try {
            console.log('🔄 TRACE: Starting appointment cancellation sync to CRM:', appointmentCode);
            
            // Step 1: Search for opportunity by appointment code
            const opportunity = await this.findOpportunityByAppointmentCode(appointmentCode);
            
            if (!opportunity) {
                console.log('⚠️ TRACE: No opportunity found for cancellation sync, skipping CRM update');
                return {
                    action: 'skipped',
                    opportunity: null,
                    message: `No CRM opportunity found for appointment code: ${appointmentCode}`
                };
            }
            
            // Step 2: Update opportunity stage to cancelled
            console.log('🔄 TRACE: Found opportunity, updating stage to CANCELADO_POR_PACIENTE');
            const updatedOpportunity = await this.updateOpportunityStage(opportunity.id, 'CANCELADO_POR_PACIENTE');
            
            console.log('✅ TRACE: Appointment cancellation synced to CRM successfully');
            return {
                action: 'updated',
                opportunity: {
                    id: updatedOpportunity.id,
                    stage: 'CANCELADO_POR_PACIENTE',
                    codigoDeTurno: appointmentCode
                },
                message: 'CRM appointment status updated to cancelled'
            };

        } catch (error) {
            console.error('❌ Error syncing appointment cancellation to CRM:', error.message);
            return {
                action: 'error',
                opportunity: null,
                message: `CRM cancellation sync failed: ${error.message}`,
                error: error.message
            };
        }
    }

    // ============================================================================
    // Phone Management - CRM patient phone list management and cross-reference
    // ============================================================================

    /**
     * Normalizes phone number for accurate comparison between different formats.
     * Removes formatting characters and handles Argentina country code variations.
     * 
     * @param {string} phoneNumber Raw phone number
     * @returns {string} Normalized phone number for comparison
     */
    normalizePhoneForComparison(phoneNumber) {
        if (!phoneNumber) return '';
        
        // Remove all formatting characters
        let normalized = phoneNumber.replace(/[\+\-\s\(\)]/g, '');
        
        // Handle Argentina country code variations
        if (normalized.startsWith('54') && normalized.length > 10) {
            normalized = normalized.substring(2); // Remove '54' prefix
        }
        
        console.log('🔍 TRACE: Phone normalization:', {
            original: phoneNumber,
            normalized: normalized
        });
        
        return normalized;
    }

    /**
     * Validates if conversation phone exists in CRM patient's phone list.
     * Compares against whatsapp and phones fields with normalization.
     * 
     * @param {Object} crmPerson CRM person object with phone fields
     * @param {string} conversationPhone Phone number from conversation context
     * @returns {boolean} True if phone already exists in patient record
     */
    checkPhoneExistsInPatient(crmPerson, conversationPhone) {
        if (!conversationPhone) return false;
        
        const normalizedTarget = this.normalizePhoneForComparison(conversationPhone);
        console.log('🔍 TRACE: Checking if phone exists in patient:', normalizedTarget);
        
        // Collect all existing phones from patient
        const existingPhones = [];
        
        // WhatsApp phones
        if (crmPerson.whatsapp?.primaryPhoneNumber) {
            existingPhones.push(crmPerson.whatsapp.primaryPhoneNumber);
        }
        if (crmPerson.whatsapp?.additionalPhones) {
            // ✅ FIX: additionalPhones contains objects, extract correct field name
            const additionalPhoneNumbers = crmPerson.whatsapp.additionalPhones.map(phoneObj => {
                // Handle both formats: string or object with "number" field (not "phoneNumber")
                if (typeof phoneObj === 'string') {
                    return phoneObj;
                } else if (phoneObj && phoneObj.number) {
                    return phoneObj.number;  // ✅ FIX: Use "number" field
                } else if (phoneObj && phoneObj.phoneNumber) {
                    return phoneObj.phoneNumber;  // Backward compatibility
                }
                return null;
            }).filter(phone => phone); // Remove empty values
            
            existingPhones.push(...additionalPhoneNumbers);
            console.log('🔍 TRACE: Additional WhatsApp phones extracted:', additionalPhoneNumbers);
        }
        
        // Standard phones  
        if (crmPerson.phones?.primaryPhoneNumber) {
            existingPhones.push(crmPerson.phones.primaryPhoneNumber);
        }
        if (crmPerson.phones?.additionalPhones) {
            existingPhones.push(...(crmPerson.phones.additionalPhones || []));
        }
        
        console.log('🔍 TRACE: Existing phones in patient:', existingPhones);
        
        // Compare normalized versions
        const phoneExists = existingPhones.some(existingPhone => {
            const normalizedExisting = this.normalizePhoneForComparison(existingPhone);
            const matches = normalizedExisting === normalizedTarget;
            if (matches) {
                console.log('🔍 TRACE: Phone match found:', { existing: existingPhone, target: conversationPhone });
            }
            return matches;
        });
        
        console.log('🔍 TRACE: Phone exists in patient result:', phoneExists);
        return phoneExists;
    }

    /**
     * Adds conversation phone to CRM patient's WhatsApp additional phones list.
     * Only adds if phone doesn't already exist in patient's phone lists.
     * 
     * @param {string} crmPatientId CRM person ID
     * @param {string} conversationPhone Phone number to add
     * @param {Object} crmPerson Current CRM person data for comparison
     * @returns {Promise<Object>} Phone addition result
     */
    async validateAndAddPhoneToPatient(crmPatientId, conversationPhone, crmPerson) {
        try {
            console.log('🔍 TRACE: Validating and adding phone to patient:', {
                patientId: crmPatientId,
                phone: conversationPhone
            });
            
            // Step 1: Check if phone already exists
            const phoneExists = this.checkPhoneExistsInPatient(crmPerson, conversationPhone);
            
            if (phoneExists) {
                console.log('✅ TRACE: Phone already exists in patient, skipping addition');
                return {
                    action: 'existing',
                    phone: conversationPhone,
                    message: 'Phone already exists in patient record'
                };
            }
            
            // Step 2: Add phone to whatsapp.additionalPhones array
            console.log('🔄 TRACE: Adding phone to patient whatsapp.additionalPhones');
            
            // Format phone for CRM
            const correctedPhone = this.ensureArgentinaFormat(conversationPhone);
            const formattedPhone = formatPhoneForCRM(correctedPhone);
            
            if (!formattedPhone?.whatsapp) {
                throw new Error('Failed to format phone for CRM addition');
            }
            
            // ✅ FIX: Build additionalPhones array with complete phone objects (not just numbers)
            const currentAdditionalPhones = crmPerson.whatsapp?.additionalPhones || [];
            
            // ✅ FIX: Create complete phone object for additionalPhones with correct field names
            const newPhoneObject = {
                number: formattedPhone.whatsapp.primaryPhoneNumber,        // ✅ KEY: "number" not "phoneNumber"
                countryCode: formattedPhone.whatsapp.primaryPhoneCountryCode,
                callingCode: formattedPhone.whatsapp.primaryPhoneCallingCode
            };
            
            const newAdditionalPhones = [...currentAdditionalPhones, newPhoneObject];
            
            // Update patient with new phone in additionalPhones
            const updateData = {
                whatsapp: {
                    ...crmPerson.whatsapp,
                    additionalPhones: newAdditionalPhones
                }
            };
            
            console.log('🔍 TRACE: Updating patient with complete phone structure in additionalPhones:', {
                currentPhones: currentAdditionalPhones,
                newPhoneObject: newPhoneObject,
                finalArray: newAdditionalPhones
            });
            
            const response = await this.axiosInstance.patch(`/rest/people/${crmPatientId}`, updateData);
            
            console.log('✅ TRACE: Phone added to patient successfully');
            return {
                action: 'added',
                phone: conversationPhone,
                formattedPhone: newPhoneObject,
                message: 'Phone added to patient whatsapp.additionalPhones with complete structure'
            };
            
        } catch (error) {
            console.error('❌ Error adding phone to patient:', error.message);
            return {
                action: 'error',
                phone: conversationPhone,
                message: `Failed to add phone: ${error.message}`,
                error: error.message
            };
        }
    }

    /**
     * Searches for CRM conversation by phone number name pattern.
     * Uses exact format since we control conversation name creation.
     * 
     * @param {string} phoneNumber Phone number to search for
     * @returns {Promise<Object|null>} Found conversation or null
     */
    async findConversationByPhoneName(phoneNumber) {
        try {
            if (!phoneNumber) return null;
            
            // Format conversation name exactly as we create it (phone number only)  
            const conversationName = phoneNumber;  // ✅ FIX: Remove "WhatsApp" prefix
            console.log('🔍 TRACE: Searching conversation by phone name:', conversationName);
            
            const query = {
                query: `query {
                    conversaciones(filter: { 
                        name: { eq: "${conversationName}" }
                    }) {
                        edges {
                            node {
                                id
                                name
                                idDeConversacion
                                agenteAsignadoId
                                pacientes {
                                    edges {
                                        node {
                                            id
                                            name { firstName lastName }
                                        }
                                    }
                                }
                                createdAt
                                updatedAt
                            }
                        }
                    }
                }`
            };

            const response = await this.axiosInstance.post('/graphql', query);
            
            if (response.data?.data?.conversaciones?.edges?.length > 0) {
                const conversation = response.data.data.conversaciones.edges[0].node;
                console.log('✅ TRACE: Conversation found by phone name:', conversation.id);
                return conversation;
            }
            
            console.log('❌ TRACE: No conversation found for phone name:', conversationName);
            return null;

        } catch (error) {
            console.error('❌ Error searching conversation by phone name:', error.message);
            throw new Error(`CRM conversation phone search failed: ${error.message}`);
        }
    }

    /**
     * Associates patient with existing conversation found by phone number.
     * Only associates if patient is not already linked to the conversation.
     * 
     * @param {string} crmPatientId CRM person ID
     * @param {string} phoneNumber Phone number used to find conversation
     * @returns {Promise<Object>} Association result
     */
    async associatePatientWithPhoneConversation(crmPatientId, phoneNumber) {
        try {
            console.log('🔍 TRACE: Starting patient-conversation association by phone:', {
                patientId: crmPatientId,
                phone: phoneNumber
            });
            
            // Step 1: Find conversation by phone name
            const conversation = await this.findConversationByPhoneName(phoneNumber);
            
            if (!conversation) {
                console.log('❌ TRACE: No conversation found for phone, skipping association');
                return {
                    action: 'not_found',
                    conversation: null,
                    message: `No conversation found with name '${phoneNumber}'`  // ✅ FIX: Remove "WhatsApp" prefix
                };
            }
            
            // Step 2: Check if patient already associated with this conversation
            const isAlreadyAssociated = this.checkPatientAssociation(conversation, crmPatientId);
            
            if (isAlreadyAssociated) {
                console.log('✅ TRACE: Patient already associated with phone conversation');
                return {
                    action: 'existing',
                    conversation: conversation,
                    message: 'Patient already associated with phone conversation'
                };
            }
            
            // Step 3: Associate patient with conversation
            console.log('🔄 TRACE: Associating patient with phone conversation');
            await this.associatePatientWithConversation(crmPatientId, conversation.id);
            
            console.log('✅ TRACE: Patient associated with phone conversation successfully');
            return {
                action: 'associated',
                conversation: {
                    id: conversation.id,
                    name: conversation.name,
                    idDeConversacion: conversation.idDeConversacion
                },
                message: 'Patient associated with existing phone conversation'
            };
            
        } catch (error) {
            console.error('❌ Error associating patient with phone conversation:', error.message);
            return {
                action: 'error',
                conversation: null,
                message: `Phone conversation association failed: ${error.message}`,
                error: error.message
            };
        }
    }

    // ============================================================================
    // Conversation Management - CRM conversation sync with MongoDB conversations
    // ============================================================================

    /**
     * Manages CRM conversation for a patient after successful patient sync.
     * Implements lazy creation: only creates conversation if needed.
     * 
     * @param {Object} patientData Patient data used for context
     * @param {string} mongoConversationId MongoDB conversation ObjectId as string
     * @param {string} crmPatientId CRM person ID from patient sync
     * @returns {Promise<Object>} Conversation sync result
     */
    async manageConversationForPatient(patientData, mongoConversationId, crmPatientId) {
        try {
            console.log('Managing CRM conversation for patient:', {
                mongoConversationId,
                crmPatientId
            });

            // Step 1: Search existing conversation by MongoDB ID (should exist from immediate creation)
            const existingConversation = await this.findConversationByMongoId(mongoConversationId);
            
            if (existingConversation) {
                console.log('Conversation found in CRM:', existingConversation.id);
                
                // Step 3: Check if patient is already associated
                const isPatientAssociated = this.checkPatientAssociation(existingConversation, crmPatientId);
                
                if (isPatientAssociated) {
                    return {
                        action: 'found',
                        conversation: existingConversation,
                        patient_association: 'existing',
                        message: 'Conversation exists in CRM'
                    };
                } else {
                    // Associate patient with existing conversation
                    await this.associatePatientWithConversation(crmPatientId, existingConversation.id);
                    return {
                        action: 'associated',
                        conversation: existingConversation,
                        patient_association: 'new',
                        message: 'Patient associated with existing conversation'
                    };
                }
            } else {
                // Step 4: FALLBACK - Create conversation if not found (should exist from immediate creation)
                console.log('⚠️ FALLBACK: Creating conversation in CRM (should have been created immediately)...');
                const phoneNumber = await this.extractPhoneNumber(patientData, mongoConversationId);
                const conversationTitle = phoneNumber || 'Unknown';
                
                const newConversation = await this.createConversationInCRM({
                    name: conversationTitle,
                    idDeConversacion: mongoConversationId
                });
                
                // Associate patient immediately
                await this.associatePatientWithConversation(crmPatientId, newConversation.id);
                
                return {
                    action: 'created_fallback',
                    conversation: newConversation,
                    patient_association: 'new',
                    message: 'Conversation created in CRM as fallback and patient associated'
                };
            }

        } catch (error) {
            console.error('Error managing CRM conversation:', error.message);
            return {
                action: 'error',
                conversation: null,
                message: `CRM conversation management failed: ${error.message}`,
                error: error.message
            };
        }
    }

    /**
     * Searches for existing CRM conversation by MongoDB conversation ID.
     * 
     * @param {string} mongoConversationId MongoDB ObjectId as string
     * @returns {Promise<Object|null>} Found conversation or null
     */
    async findConversationByMongoId(mongoConversationId) {
        try {
            console.log('Searching CRM conversation by MongoDB ID:', mongoConversationId);
            
            const query = {
                query: `query {
                    conversaciones(filter: { 
                        idDeConversacion: { eq: "${mongoConversationId}" }
                    }) {
                        edges {
                            node {
                                id
                                name
                                idDeConversacion
                                agenteAsignadoId
                                pacientes {
                                    edges {
                                        node {
                                            id
                                            name { firstName lastName }
                                        }
                                    }
                                }
                                createdAt
                                updatedAt
                            }
                        }
                    }
                }`
            };

            const response = await this.axiosInstance.post('/graphql', query);
            
            if (response.data?.data?.conversaciones?.edges?.length > 0) {
                const conversation = response.data.data.conversaciones.edges[0].node;
                console.log('CRM conversation found:', conversation.id);
                return conversation;
            }
            
            console.log('No CRM conversation found for MongoDB ID:', mongoConversationId);
            return null;

        } catch (error) {
            console.error('Error searching CRM conversation:', error.message);
            throw new Error(`CRM conversation search failed: ${error.message}`);
        }
    }

    /**
     * Creates a new conversation in CRM.
     * 
     * @param {Object} conversationData Conversation creation data
     * @param {string} conversationData.name Conversation title
     * @param {string} conversationData.idDeConversacion MongoDB conversation ID
     * @returns {Promise<Object>} Created conversation object
     */
    async createConversationInCRM(conversationData) {
        try {
            console.log('Creating conversation in CRM:', conversationData);
            
            const response = await this.axiosInstance.post('/rest/conversaciones', conversationData);
            
            if (response.data?.data?.createConversacion) {
                const conversation = response.data.data.createConversacion;
                console.log('Conversation created in CRM:', conversation.id);
                return conversation;
            } else {
                throw new Error('Unexpected CRM conversation creation response');
            }

        } catch (error) {
            console.error('Error creating conversation in CRM:', error.message);
            if (error.response?.data) {
                console.error('CRM Error Details:', JSON.stringify(error.response.data, null, 2));
            }
            throw new Error(`CRM conversation creation failed: ${error.message}`);
        }
    }

    /**
     * Associates a patient with a conversation by updating patient's conversacionId.
     * 
     * @param {string} crmPatientId CRM person ID
     * @param {string} crmConversationId CRM conversation ID
     * @returns {Promise<void>} Completes when association is created
     */
    async associatePatientWithConversation(crmPatientId, crmConversationId) {
        try {
            console.log('Associating patient with conversation:', {
                patientId: crmPatientId,
                conversationId: crmConversationId
            });
            
            const response = await this.axiosInstance.patch(`/rest/people/${crmPatientId}`, {
                conversacionId: crmConversationId
            });
            
            console.log('Patient associated with conversation successfully');
            return response.data;

        } catch (error) {
            console.error('Error associating patient with conversation:', error.message);
            throw new Error(`CRM patient-conversation association failed: ${error.message}`);
        }
    }

    /**
     * Checks if a patient is already associated with a conversation.
     * 
     * @param {Object} conversation CRM conversation object with pacientes
     * @param {string} crmPatientId CRM person ID to check
     * @returns {boolean} True if patient is associated
     */
    checkPatientAssociation(conversation, crmPatientId) {
        if (!conversation?.pacientes?.edges) {
            return false;
        }
        
        const isAssociated = conversation.pacientes.edges.some(
            edge => edge.node.id === crmPatientId
        );
        
        console.log('Patient association check result:', {
            patientId: crmPatientId,
            isAssociated: isAssociated,
            existingPatients: conversation.pacientes.edges.length
        });
        
        return isAssociated;
    }

    // ============================================================================
    // Integration Helper Methods - Patient synchronization utilities
    // ============================================================================

    /**
     * Synchronize patient data between Bukeala and Twenty CRM.
     * Checks if patient exists, creates if not, updates if necessary.
     * 
     * @param {Object} patientData Patient data from Bukeala API
     * @param {string} conversationId Optional conversation ID for phone extraction
     * @param {string} patientOrigin Origin type: 'APPOINT' (found in Bukeala) or 'NUEVO' (created in Bukeala)
     * @returns {Promise<Object>} CRM sync result with person data and action taken
     * @throws {Error} if synchronization fails
     */
    async syncPatientToCRM(patientData, conversationId = null, patientOrigin = 'NUEVO') {
        try {
            console.log('Starting CRM synchronization for patient:', patientData.identificationNumber, 'with conversation:', conversationId);
            console.log('ConversationId type:', typeof conversationId, 'value:', conversationId);
            
            // Extract phone number from conversation context
            const extractedPhone = await this.extractPhoneNumber(patientData, conversationId);
            console.log('Phone extracted for CRM sync:', extractedPhone);
            
            // Enhance patient data with extracted phone and origin type
            const enhancedPatientData = {
                ...patientData,
                mobilePhone: patientData.mobilePhone || extractedPhone,
                tipo: patientOrigin // ✅ NEW: Include patient origin type
            };
            
            let existingPerson = null;
            
            // ONLY search by document number and type (unique combination)
            if (enhancedPatientData.identificationNumber && enhancedPatientData.identificationType) {
                existingPerson = await this.findPersonByDocument(
                    enhancedPatientData.identificationNumber, 
                    enhancedPatientData.identificationType
                );
                console.log('CRM search by document only - Patient found:', !!existingPerson);
            } else {
                console.log('Cannot search in CRM: Missing identificationNumber or identificationType');
                throw new Error('Cannot sync patient to CRM: identificationNumber and identificationType are required');
            }
            
            if (existingPerson) {
                console.log('Patient exists in CRM, checking for updates and phone management...');
                
                // ✅ FIX: Step 1 - Phone Management (Edge Case 1) - Use ACTUAL conversation phone
                let phoneManagementResult = null;
                try {
                    // ✅ FIX: Extract ACTUAL conversation phone (not patient registered phone)
                    const conversationPhone = await this.extractConversationPhone(conversationId);
                    console.log('🔍 TRACE: ACTUAL conversation phone extracted:', conversationPhone);
                    
                    // Also log patient registered phone for comparison
                    const patientRegisteredPhone = enhancedPatientData.mobilePhone;
                    console.log('🔍 TRACE: Patient registered phone (Bukeala):', patientRegisteredPhone);
                    console.log('🔍 TRACE: Phone comparison - Conversation vs Registered:', {
                        conversation: conversationPhone,
                        registered: patientRegisteredPhone,
                        different: conversationPhone !== patientRegisteredPhone
                    });
                    
                    if (conversationPhone) {
                        console.log('🔍 TRACE: Managing phone for existing patient with ACTUAL conversation phone:', conversationPhone);
                        phoneManagementResult = await this.validateAndAddPhoneToPatient(
                            existingPerson.id,
                            conversationPhone,
                            existingPerson
                        );
                        console.log('📞 Phone management result:', phoneManagementResult);
                    } else {
                        console.log('⚠️ TRACE: No actual conversation phone extracted, skipping phone management');
                        phoneManagementResult = {
                            action: 'skipped',
                            message: 'No actual conversation phone available for management'
                        };
                    }
                } catch (phoneError) {
                    console.error('❌ Phone management failed (non-blocking):', phoneError.message);
                    phoneManagementResult = {
                        action: 'error',
                        message: `Phone management failed: ${phoneError.message}`,
                        error: phoneError.message
                    };
                }
                
                // ✅ NEW: Step 2 - Conversation Cross-Reference (Edge Case 2)
                let conversationCrossRefResult = null;
                try {
                    // Only do cross-reference if phone was ADDED (not existing)
                    if (phoneManagementResult?.action === 'added') {
                        console.log('🔗 TRACE: Phone was added, checking for conversation cross-reference');
                        conversationCrossRefResult = await this.associatePatientWithPhoneConversation(
                            existingPerson.id,
                            phoneManagementResult.phone
                        );
                        console.log('🔗 Conversation cross-reference result:', conversationCrossRefResult);
                    } else {
                        console.log('⚠️ TRACE: Phone not added, skipping conversation cross-reference');
                        conversationCrossRefResult = {
                            action: 'skipped',
                            message: 'Phone not added, no cross-reference needed'
                        };
                    }
                } catch (crossRefError) {
                    console.error('❌ Conversation cross-reference failed (non-blocking):', crossRefError.message);
                    conversationCrossRefResult = {
                        action: 'error',
                        message: `Conversation cross-reference failed: ${crossRefError.message}`,
                        error: crossRefError.message
                    };
                }
                
                // ✅ Step 3 - Standard Update Check  
                const needsUpdate = this.checkIfUpdateNeeded(existingPerson, enhancedPatientData);
                
                if (needsUpdate) {
                    const updatedPerson = await this.updatePerson(existingPerson.id, enhancedPatientData);
                    return {
                        action: 'updated',
                        person: updatedPerson,
                        phone_management: phoneManagementResult,
                        conversation_cross_ref: conversationCrossRefResult,
                        message: 'Patient updated in CRM with enhanced data and phone management'
                    };
                } else {
                    return {
                        action: 'found',
                        person: existingPerson,
                        phone_management: phoneManagementResult,
                        conversation_cross_ref: conversationCrossRefResult,
                        message: 'Patient found in CRM with phone and conversation management completed'
                    };
                }
            } else {
                console.log('Patient not found in CRM, creating new record with enhanced data...');
                const newPerson = await this.createPerson(enhancedPatientData);
                return {
                    action: 'created',
                    person: newPerson,
                    message: 'Patient created in CRM with enhanced data'
                };
            }

        } catch (error) {
            console.error('Error synchronizing patient to CRM:', error.message);
            return {
                action: 'error',
                person: null,
                message: `CRM sync failed: ${error.message}`,
                error: error.message
            };
        }
    }

    /**
     * Check if CRM person data needs updating based on Bukeala data.
     * Compares key fields including custom fields to determine if synchronization is needed.
     * 
     * @param {Object} crmPerson Existing CRM person data
     * @param {Object} bukealaData New patient data from Bukeala
     * @returns {boolean} True if update is needed
     */
    checkIfUpdateNeeded(crmPerson, bukealaData) {
        // Compare standard fields
        const crmFirstName = crmPerson.name?.firstName?.toLowerCase();
        const crmLastName = crmPerson.name?.lastName?.toLowerCase();
        const crmEmail = crmPerson.email?.primaryEmail?.toLowerCase();
        const crmPhone = crmPerson.phones?.primaryPhoneNumber;
        
        const bukealaFirstName = (bukealaData.firstName || bukealaData.first_name || '').toLowerCase();
        const bukealaLastName = (bukealaData.lastName || bukealaData.last_name || '').toLowerCase();
        const bukealaEmail = (bukealaData.email || '').toLowerCase();
        const bukealaPhone = this.extractPhoneNumberSync(bukealaData); // Fixed: Use synchronous version
        const cleanBukealaPhone = bukealaPhone ? bukealaPhone.replace(/[\+\-\s\(\)]/g, '') : '';
        
        // Compare custom fields
        const crmPlanCode = crmPerson.cobertura || '';
        const crmInsuranceCode = crmPerson.financiador || '';
        const crmInsuranceNumber = crmPerson.numeroDeAfiliado || '';
        const crmIdNumber = crmPerson.numeroDeDocumento || '';
        const crmIdType = crmPerson.tipoDeDocumento || '';
        const crmGender = crmPerson.generoBiologico || '';
        const crmBirthDate = crmPerson.fechaDeNacimiento || '';
        
        const bukealaIdNumber = bukealaData.identificationNumber || bukealaData.identificationNumber || '';
        const bukealaIdType = this.mapIdentificationType(bukealaData.identificationType || bukealaData.identificationType);
        const bukealaInsuranceCode = bukealaData.insuranceCode || bukealaData.insurance_code || '';
        const bukealaPlanCode = bukealaData.planCode || bukealaData.plan_code || '';
        const bukealaInsuranceNumber = bukealaData.insuranceNumber || bukealaData.insurance_number || '';
        const bukealaGender = this.mapGender(bukealaData.gender);
        const bukealaBirthDate = bukealaData.birthDate || bukealaData.birth_date || '';
        
        // Map insurance codes to names for comparison
        const bukealaPlanName = this.mapInsurancePlan(bukealaInsuranceCode, bukealaPlanCode);
        const bukealaProviderName = this.mapInsuranceProvider(bukealaInsuranceCode);
        
        // Check if any field has changed
        return (
            // Standard fields
            crmFirstName !== bukealaFirstName ||
            crmLastName !== bukealaLastName ||
            crmEmail !== bukealaEmail ||
            (cleanBukealaPhone && crmPhone && !crmPhone.includes(cleanBukealaPhone.slice(-8))) ||
            
            // Custom fields (compare names, not codes)
            crmPlanCode !== bukealaPlanName ||
            crmInsuranceCode !== bukealaProviderName ||
            crmInsuranceNumber !== bukealaInsuranceNumber ||
            crmIdNumber !== bukealaIdNumber ||
            crmIdType !== bukealaIdType ||
            crmGender !== bukealaGender ||
            (bukealaBirthDate && crmBirthDate && !crmBirthDate.includes(bukealaBirthDate.split('T')[0]))
        );
    }
}

// Create singleton instance
const twentyCrmService = new TwentyCrmService();

module.exports = {
    findPersonByEmail: (email) => twentyCrmService.findPersonByEmail(email),
    findPersonByPhone: (phone) => twentyCrmService.findPersonByPhone(phone),
    findPersonByDocument: (documentNumber, documentType) => twentyCrmService.findPersonByDocument(documentNumber, documentType),
    createPerson: (patientData) => twentyCrmService.createPerson(patientData),
    updatePerson: (personId, updateData) => twentyCrmService.updatePerson(personId, updateData),
    syncPatientToCRM: (patientData, conversationId, patientOrigin) => twentyCrmService.syncPatientToCRM(patientData, conversationId, patientOrigin),
    createTask: (identificationNumber, identificationType, taskType, content, conversationId) => twentyCrmService.createTask(identificationNumber, identificationType, taskType, content, conversationId),
    createSupportTask: (identificationNumber, identificationType, reason, conversationId) => twentyCrmService.createSupportTask(identificationNumber, identificationType, reason, conversationId),
    createDataUpdateTask: (identificationNumber, identificationType, updateData, conversationId) => twentyCrmService.createDataUpdateTask(identificationNumber, identificationType, updateData, conversationId),
    createOpportunityFromAppointment: (appointmentData, bukealaResponse, conversationId) => twentyCrmService.createOpportunityFromAppointment(appointmentData, bukealaResponse, conversationId),
    manageConversationForPatient: (patientData, mongoConversationId, crmPatientId) => twentyCrmService.manageConversationForPatient(patientData, mongoConversationId, crmPatientId),
    findOpportunityByAppointmentCode: (appointmentCode) => twentyCrmService.findOpportunityByAppointmentCode(appointmentCode),
    updateOpportunityStage: (opportunityId, newStage) => twentyCrmService.updateOpportunityStage(opportunityId, newStage),
    syncAppointmentCancellationToCRM: (appointmentCode) => twentyCrmService.syncAppointmentCancellationToCRM(appointmentCode),
    validateAndAddPhoneToPatient: (crmPatientId, conversationPhone, crmPerson) => twentyCrmService.validateAndAddPhoneToPatient(crmPatientId, conversationPhone, crmPerson),
    findConversationByPhoneName: (phoneNumber) => twentyCrmService.findConversationByPhoneName(phoneNumber),
    associatePatientWithPhoneConversation: (crmPatientId, phoneNumber) => twentyCrmService.associatePatientWithPhoneConversation(crmPatientId, phoneNumber),
    extractConversationPhone: (conversationId) => twentyCrmService.extractConversationPhone(conversationId),
    createConversationInCRM: (conversationData) => twentyCrmService.createConversationInCRM(conversationData)  // ✅ FIX: Missing export
};
