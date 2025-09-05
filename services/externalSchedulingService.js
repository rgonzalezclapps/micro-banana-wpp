const axios = require('axios');
require('dotenv').config();

const BUKEALA_API_URL = process.env.BUKEALA_API_URL;
const BUKEALA_CLIENT_ID = process.env.BUKEALA_CLIENT_ID;
const BUKEALA_CLIENT_SECRET = process.env.BUKEALA_CLIENT_SECRET;

let accessToken = null;
let tokenExpiresAt = null;

/**
 * Manages the OAuth 2.0 authentication flow for the Bukeala API.
 * It fetches, caches, and refreshes the access token as needed.
 * @returns {Promise<string>} The valid access token.
 */
const getAccessToken = async () => {
    if (accessToken && tokenExpiresAt && new Date() < tokenExpiresAt) {
        return accessToken;
    }

    try {
        console.log('Fetching new Bukeala access token...');
        const response = await axios.post(`${BUKEALA_API_URL}/oAuth/getToken`, {
            client_id: BUKEALA_CLIENT_ID,
            client_secret: BUKEALA_CLIENT_SECRET,
        });

        const { access_token, expires_in } = response.data;
        accessToken = access_token;
        // Set expiry to 5 minutes before the actual expiry time for safety
        tokenExpiresAt = new Date(new Date().getTime() + (expires_in - 300) * 1000);
        
        console.log('Successfully fetched Bukeala access token.');
        return accessToken;
    } catch (error) {
        console.error('Error fetching Bukeala access token:', error.response ? error.response.data : error.message);
        throw new Error('Failed to authenticate with Bukeala API.');
    }
};

/**
 * Fetches patient data from the Bukeala API using their identification number.
 * @param {string} identificationNumber - The patient's DNI.
 * @returns {Promise<Object>} The patient data object or a "not found" message.
 */
const getPatient = async (identificationNumber, identificationType) => {
    try {
        const token = await getAccessToken();
        const response = await axios.get(`${BUKEALA_API_URL}/v4/patients/get`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            params: {
                identificationType: identificationType,
                identificationNumber: identificationNumber,
            },
        });

        console.log('identificationType: ', identificationType);
        console.log('identificationNumber: ', identificationNumber);

        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            // Assuming Bukeala returns a 404 for not found, which is a standard REST practice.
            // If they return a different code or a specific message, this can be adjusted.
            return { "result": "Patient not found." };
        }
        console.error('Error fetching patient from Bukeala:', error.response ? error.response.data : error.message);
        throw new Error('Failed to fetch patient data from Bukeala.');
    }
};

const createPatient = async (patientData) => {
    try {
        const token = await getAccessToken();
        
        // Map gender explicitly to 'F' or 'M'
        let gender = 'M'; // Default to 'M'
        if (patientData.gender && patientData.gender.toLowerCase().startsWith('f')) {
            gender = 'F';
        }

        const apiPayload = {
            identificationType: patientData.identificationType,
            identificationNumber: patientData.identificationNumber,
            firstName: patientData.first_name,
            lastName: patientData.last_name,
            gender: gender,
            birthDate: patientData.birth_date,
            insuranceCode: patientData.insurance_code,
            planCode: patientData.plan_code, // Pass directly from tool
            insuranceNumber: patientData.insurance_number, // Pass directly from tool
            email: patientData.email,
        };

        console.log('Sending patient creation payload to Bukeala:', apiPayload);

        const response = await axios.post(`${BUKEALA_API_URL}/v4/patients/create`, apiPayload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });

        return response.data;
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error creating patient in Bukeala:', errorMessage);
        throw new Error(`Failed to create patient in Bukeala: ${errorMessage}`);
    }
};

module.exports = {
    getAccessToken,
    getPatient,
    createPatient,
};

/**
 * Fetches schedules (availability) for a given set of filters.
 * This is a thin wrapper around Bukeala's GET /v4/schedules/get endpoint.
 *
 * Required params (by Bukeala): facilityCode OR (cityCode + regionCode), specialtyCode, dateFrom, identificationType, identificationNumber, insuranceCode, planCode, isPresential.
 * Optional params: resourceName, cityCode, regionCode, startTimeSeconds, endTimeSeconds, daysOfWeek, limit, facilityGroupCode.
 *
 * @param {Object} params Request parameters
 * @returns {Promise<Object>} The schedules response from Bukeala
 */
const getSchedules = async (params = {}) => {
    try {
        const token = await getAccessToken();

        const queryParams = {
            // Required
            facilityCode: params.facilityCode,
            specialtyCode: params.specialtyCode,
            dateFrom: params.dateFrom,
            identificationType: params.identificationType,
            identificationNumber: params.identificationNumber,
            insuranceCode: params.insuranceCode,
            planCode: params.planCode,
            isPresential: params.isPresential ?? 'TRUE',
            // Optional
            resourceName: params.resourceName,
            cityCode: params.cityCode,
            regionCode: params.regionCode,
            startTimeSeconds: params.startTimeSeconds,
            endTimeSeconds: params.endTimeSeconds,
            daysOfWeek: params.daysOfWeek,
            limit: params.limit,
            facilityGroupCode: params.facilityGroupCode,
        };

        // Remove undefined to avoid sending empty values
        Object.keys(queryParams).forEach((key) => {
            if (queryParams[key] === undefined || queryParams[key] === null || queryParams[key] === '') {
                delete queryParams[key];
            }
        });

        const response = await axios.get(`${BUKEALA_API_URL}/v4/schedules/get`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            params: queryParams,
        });

        return response.data;
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('Error fetching schedules from Bukeala:', errorMsg);
        throw new Error(`Failed to fetch schedules from Bukeala: ${errorMsg}`);
    }
};

/**
 * Gets existing appointments from Bukeala API.
 * Supports filtering by patient, facility, specialty, resource, date range, and status.
 * Maximum date range is 30 days.
 * 
 * @param {Object} params Query parameters for appointment search
 * @param {string} [params.facilityCode] Facility code to filter appointments
 * @param {string} [params.specialtyCode] Specialty code to filter appointments  
 * @param {string} [params.resourceCode] Doctor/resource code to filter appointments
 * @param {string} [params.identificationType] Patient ID type
 * @param {string} [params.identificationNumber] Patient ID number
 * @param {string} [params.dateFrom] Start date (YYYY-MM-DD)
 * @param {string} [params.dateTo] End date (YYYY-MM-DD)
 * @param {string} [params.status] Appointment status (CONFIRMED, PENDING, CANCELED, NOT_ASSISTED)
 * @param {string} [params.creationDateFrom] Creation date from (YYYY-MM-DD)
 * @param {string} [params.creationDateTo] Creation date to (YYYY-MM-DD)
 * @param {string} [params.facilityGroupCode] Facility group code
 * @returns {Promise<Object>} Appointments list or error
 */
const getAppointments = async (params) => {
    try {
        const token = await getAccessToken();
        console.log('params original: ', params);
        
        // Remove undefined/null/empty values
        const cleanParams = Object.fromEntries(
            Object.entries(params).filter(([_, value]) => 
                value !== undefined && value !== null && value !== ''
            )
        );

        console.log('Calling Bukeala getAppointments with params:', cleanParams);
        
        const response = await axios.get(`${BUKEALA_API_URL}/v4/appointments/get`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            params: cleanParams,
        });
        
        console.log('Bukeala getAppointments response:', response.data);
        return response.data;
        
    } catch (error) {
        console.error('Error fetching appointments from Bukeala:', error.response?.data || error.message);
        throw new Error(`Failed to fetch appointments: ${error.response?.data?.error?.message || error.message}`);
    }
};

/**
 * Creates a draft appointment (reserves slot for 5 minutes) in Bukeala API.
 * This is for internal use and not exposed as an AI tool.
 * 
 * @param {Object} appointmentData Draft appointment data
 * @param {string} appointmentData.facilityCode Facility code
 * @param {string} appointmentData.specialtyCode Specialty code
 * @param {string} appointmentData.resourceCode Doctor/resource code
 * @param {string} appointmentData.date Appointment date (YYYY-MM-DD)
 * @param {string} appointmentData.identificationType Patient ID type
 * @param {string} appointmentData.identificationNumber Patient ID number
 * @param {string} appointmentData.startTimeSeconds Start time in seconds
 * @returns {Promise<Object>} Draft result or error
 */
const draftAppointment = async (appointmentData) => {
    try {
        const token = await getAccessToken();
        
        console.log('Creating draft appointment in Bukeala:', appointmentData);
        
        const response = await axios.post(`${BUKEALA_API_URL}/v4/appointments/draft`, appointmentData, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        
        console.log('Bukeala draft appointment response:', response.data);
        return response.data;
        
    } catch (error) {
        console.error('Error creating draft appointment in Bukeala:', error.response?.data || error.message);
        throw new Error(`Failed to create draft appointment: ${error.response?.data?.error?.message || error.message}`);
    }
};

/**
 * Creates a confirmed appointment in Bukeala API.
 * 
 * @param {Object} appointmentData Appointment creation data
 * @param {string} appointmentData.facilityCode Facility code
 * @param {string} appointmentData.specialtyCode Specialty code
 * @param {string} appointmentData.resourceCode Doctor/resource code
 * @param {string} appointmentData.date Appointment date (YYYY-MM-DD)
 * @param {string} appointmentData.identificationType Patient ID type
 * @param {string} appointmentData.identificationNumber Patient ID number
 * @param {string} appointmentData.insuranceCode Insurance provider code
 * @param {string} appointmentData.planCode Insurance plan code
 * @param {string} appointmentData.startTimeSeconds Start time in seconds
 * @param {string} appointmentData.email Patient email
 * @param {string} appointmentData.isPresential TRUE/FALSE for presential appointment
 * @param {string} [appointmentData.mobilePhone] Patient mobile phone
 * @param {string} [appointmentData.attachmentUrl] Required attachment URL
 * @param {string} [appointmentData.comment] Appointment comment
 * @param {string} [appointmentData.cityCode] City code if address required
 * @param {string} [appointmentData.address] Patient address if required
 * @param {string} [appointmentData.contractCode] Contract code
 * @returns {Promise<Object>} Created appointment data or error
 */
const createAppointment = async (appointmentData) => {
    try {
        const token = await getAccessToken();
        
        // Remove undefined/null/empty values for optional fields
        const cleanData = Object.fromEntries(
            Object.entries(appointmentData).filter(([_, value]) => 
                value !== undefined && value !== null && value !== ''
            )
        );
        
        console.log('🔍 TRACE: Creating appointment in Bukeala with cleaned data:', cleanData);
        console.log('🔍 TRACE: Bukeala API URL:', `${BUKEALA_API_URL}/v4/appointments/create`);
        console.log('🔍 TRACE: Authorization token available:', !!token);
        
        const response = await axios.post(`${BUKEALA_API_URL}/v4/appointments/create`, cleanData, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        
        console.log('🔍 TRACE: Bukeala HTTP response status:', response.status);
        console.log('🔍 TRACE: Bukeala create appointment response:', response.data);
        console.log('🔍 TRACE: Checking Bukeala response validity...');
        console.log('🔍 TRACE: - result field:', response.data?.result);
        console.log('🔍 TRACE: - messages field:', response.data?.messages);
        console.log('🔍 TRACE: - appointmentCode field:', response.data?.appointmentCode);
        
        return response.data;
        
    } catch (error) {
        console.error('Error creating appointment in Bukeala:', error.response?.data || error.message);
        throw new Error(`Failed to create appointment: ${error.response?.data?.error?.message || error.message}`);
    }
};

/**
 * Cancels a previously scheduled appointment.
 * 
 * @param {Object} cancellationData - The data required for cancellation.
 * @param {string} cancellationData.appointmentCode - The unique code of the appointment.
 * @param {string} cancellationData.email - The email associated with the appointment.
 * @param {string} cancellationData.reasonCode - The reason for the cancellation.
 * @param {string} [cancellationData.comment] - An optional comment.
 * @returns {Promise<Object>} The result of the cancellation request.
 */
const cancelAppointment = async (cancellationData) => {
    try {
        const token = await getAccessToken();
        
        const payload = {
            appointmentCode: cancellationData.appointmentCode,
            email: cancellationData.email,
            reasonCode: cancellationData.reasonCode,
            comment: cancellationData.comment,
        };

        // Remove undefined/null/empty values for optional fields
        const cleanPayload = Object.fromEntries(
            Object.entries(payload).filter(([_, value]) => 
                value !== undefined && value !== null && value !== ''
            )
        );

        console.log('Canceling appointment in Bukeala with payload:', cleanPayload);
        
        const response = await axios.post(`${BUKEALA_API_URL}/v4/appointments/cancel`, cleanPayload, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        
        console.log('Bukeala cancel appointment response:', response.data);
        return response.data;

    } catch (error) {
        console.error('Error canceling appointment in Bukeala:', error.response?.data || error.message);
        throw new Error(`Failed to cancel appointment: ${error.response?.data?.error?.message || error.message}`);
    }
};

module.exports = {
    getPatient,
    createPatient,
    getSchedules,
    getAppointments,
    draftAppointment,
    createAppointment,
    cancelAppointment,
};
