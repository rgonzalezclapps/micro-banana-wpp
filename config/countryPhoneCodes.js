/**
 * countryPhoneCodes.js
 * 
 * Description: International phone country codes and calling codes mapping system for global phone number handling.
 * 
 * Role in the system: Provides automatic country detection and phone formatting for CRM integration across all countries.
 * 
 * Node.js Context: Configuration - international phone number mapping and detection
 * 
 * Dependencies:
 * - None (pure data configuration)
 * 
 * Dependants:
 * - services/twentyCrmService.js (uses country detection for phone formatting)
 * - tools/patientManagementTools.js (uses international phone handling)
 */

// ============================================================================
// International Country Phone Codes - Complete global mapping
// ============================================================================

/**
 * Maps calling codes to country information.
 * Used for automatic country detection from phone numbers.
 * 
 * Format: "callingCode": { countryCode: "ISO", countryName: "Name" }
 */
const CALLING_CODE_TO_COUNTRY = {
    // Americas
    "1": { countryCode: "US", countryName: "United States" },
    "52": { countryCode: "MX", countryName: "Mexico" },
    "54": { countryCode: "AR", countryName: "Argentina" },
    "55": { countryCode: "BR", countryName: "Brazil" },
    "56": { countryCode: "CL", countryName: "Chile" },
    "57": { countryCode: "CO", countryName: "Colombia" },
    "58": { countryCode: "VE", countryName: "Venezuela" },
    "51": { countryCode: "PE", countryName: "Peru" },
    "593": { countryCode: "EC", countryName: "Ecuador" },
    "595": { countryCode: "PY", countryName: "Paraguay" },
    "598": { countryCode: "UY", countryName: "Uruguay" },
    "591": { countryCode: "BO", countryName: "Bolivia" },
    
    // Europe
    "33": { countryCode: "FR", countryName: "France" },
    "34": { countryCode: "ES", countryName: "Spain" },
    "39": { countryCode: "IT", countryName: "Italy" },
    "49": { countryCode: "DE", countryName: "Germany" },
    "44": { countryCode: "GB", countryName: "United Kingdom" },
    "351": { countryCode: "PT", countryName: "Portugal" },
    "31": { countryCode: "NL", countryName: "Netherlands" },
    "32": { countryCode: "BE", countryName: "Belgium" },
    "41": { countryCode: "CH", countryName: "Switzerland" },
    "43": { countryCode: "AT", countryName: "Austria" },
    "45": { countryCode: "DK", countryName: "Denmark" },
    "46": { countryCode: "SE", countryName: "Sweden" },
    "47": { countryCode: "NO", countryName: "Norway" },
    "358": { countryCode: "FI", countryName: "Finland" },
    "48": { countryCode: "PL", countryName: "Poland" },
    "420": { countryCode: "CZ", countryName: "Czech Republic" },
    "36": { countryCode: "HU", countryName: "Hungary" },
    "7": { countryCode: "RU", countryName: "Russia" },
    
    // Asia Pacific
    "86": { countryCode: "CN", countryName: "China" },
    "81": { countryCode: "JP", countryName: "Japan" },
    "82": { countryCode: "KR", countryName: "South Korea" },
    "91": { countryCode: "IN", countryName: "India" },
    "65": { countryCode: "SG", countryName: "Singapore" },
    "60": { countryCode: "MY", countryName: "Malaysia" },
    "66": { countryCode: "TH", countryName: "Thailand" },
    "84": { countryCode: "VN", countryName: "Vietnam" },
    "63": { countryCode: "PH", countryName: "Philippines" },
    "62": { countryCode: "ID", countryName: "Indonesia" },
    "61": { countryCode: "AU", countryName: "Australia" },
    "64": { countryCode: "NZ", countryName: "New Zealand" },
    
    // Middle East & Africa
    "971": { countryCode: "AE", countryName: "United Arab Emirates" },
    "966": { countryCode: "SA", countryName: "Saudi Arabia" },
    "972": { countryCode: "IL", countryName: "Israel" },
    "90": { countryCode: "TR", countryName: "Turkey" },
    "20": { countryCode: "EG", countryName: "Egypt" },
    "27": { countryCode: "ZA", countryName: "South Africa" },
    "234": { countryCode: "NG", countryName: "Nigeria" },
    "254": { countryCode: "KE", countryName: "Kenya" }
};

/**
 * Maps country codes to calling codes.
 * Used for reverse lookup and validation.
 */
const COUNTRY_TO_CALLING_CODE = {
    // Americas
    "US": "+1", "CA": "+1",
    "MX": "+52",
    "AR": "+54",
    "BR": "+55", 
    "CL": "+56",
    "CO": "+57",
    "VE": "+58",
    "PE": "+51",
    "EC": "+593",
    "PY": "+595",
    "UY": "+598",
    "BO": "+591",
    
    // Europe
    "FR": "+33",
    "ES": "+34", 
    "IT": "+39",
    "DE": "+49",
    "GB": "+44",
    "PT": "+351",
    "NL": "+31",
    "BE": "+32",
    "CH": "+41",
    "AT": "+43",
    "DK": "+45",
    "SE": "+46",
    "NO": "+47",
    "FI": "+358",
    "PL": "+48",
    "CZ": "+420",
    "HU": "+36",
    "RU": "+7",
    
    // Asia Pacific
    "CN": "+86",
    "JP": "+81",
    "KR": "+82",
    "IN": "+91",
    "SG": "+65",
    "MY": "+60",
    "TH": "+66",
    "VN": "+84",
    "PH": "+63",
    "ID": "+62",
    "AU": "+61",
    "NZ": "+64",
    
    // Middle East & Africa
    "AE": "+971",
    "SA": "+966",
    "IL": "+972",
    "TR": "+90",
    "EG": "+20",
    "ZA": "+27",
    "NG": "+234",
    "KE": "+254"
};

// ============================================================================
// Phone Number Detection and Formatting Functions
// ============================================================================

/**
 * Detects country information from phone number.
 * Analyzes phone number format to determine country code and calling code.
 * 
 * @param {string} phoneNumber Raw phone number (with or without country code)
 * @returns {Object} Country information object
 */
function detectCountryFromPhone(phoneNumber) {
    if (!phoneNumber) {
        return { countryCode: 'AR', callingCode: '+54', detected: false }; // Default to Argentina
    }
    
    // Clean phone number
    const cleanPhone = phoneNumber.toString().replace(/[\s\-\(\)]/g, '');
    console.log('Detecting country from phone:', cleanPhone);
    
    // Check for explicit + prefix
    if (cleanPhone.startsWith('+')) {
        const withoutPlus = cleanPhone.substring(1);
        
        // Try different calling code lengths (1-4 digits)
        for (let length = 4; length >= 1; length--) {
            const possibleCode = withoutPlus.substring(0, length);
            const countryInfo = CALLING_CODE_TO_COUNTRY[possibleCode];
            
            if (countryInfo) {
                console.log(`Country detected from +${possibleCode}:`, countryInfo);
                return {
                    countryCode: countryInfo.countryCode,
                    callingCode: `+${possibleCode}`,
                    detected: true,
                    cleanNumber: withoutPlus.substring(length)
                };
            }
        }
    }
    
    // Check for implicit country codes (without +)
    // Try common patterns
    for (const [callingCode, countryInfo] of Object.entries(CALLING_CODE_TO_COUNTRY)) {
        if (cleanPhone.startsWith(callingCode)) {
            console.log(`Country detected from implicit ${callingCode}:`, countryInfo);
            return {
                countryCode: countryInfo.countryCode,
                callingCode: `+${callingCode}`,
                detected: true,
                cleanNumber: cleanPhone.substring(callingCode.length)
            };
        }
    }
    
    // Argentina-specific patterns (most common case)
    if (cleanPhone.startsWith('549') || cleanPhone.startsWith('54')) {
        const number = cleanPhone.startsWith('549') ? cleanPhone.substring(3) : cleanPhone.substring(2);
        console.log('Argentina pattern detected:', number);
        return {
            countryCode: 'AR',
            callingCode: '+54',
            detected: true,
            cleanNumber: number
        };
    }
    
    // US/Canada pattern
    if (cleanPhone.length === 10 && /^[2-9]\d{9}$/.test(cleanPhone)) {
        console.log('US/Canada pattern detected');
        return {
            countryCode: 'US',
            callingCode: '+1',
            detected: true,
            cleanNumber: cleanPhone
        };
    }
    
    // Default fallback to Argentina
    console.log('No country pattern detected, defaulting to Argentina');
    return {
        countryCode: 'AR',
        callingCode: '+54',
        detected: false,
        cleanNumber: cleanPhone
    };
}

/**
 * Formats phone number for CRM integration with proper country codes.
 * Creates both WhatsApp and standard phone field structures.
 * 
 * @param {string} phoneNumber Raw phone number
 * @returns {Object} Formatted phone data for CRM
 */
function formatPhoneForCRM(phoneNumber) {
    if (!phoneNumber) {
        return null;
    }
    
    const countryInfo = detectCountryFromPhone(phoneNumber);
    const cleanNumber = countryInfo.cleanNumber;
    
    console.log('Formatting phone for CRM:', {
        original: phoneNumber,
        country: countryInfo.countryCode,
        calling: countryInfo.callingCode,
        clean: cleanNumber
    });
    
    return {
        // WhatsApp field (Primary)
        whatsapp: {
            primaryPhoneNumber: cleanNumber,
            primaryPhoneCountryCode: countryInfo.countryCode,
            primaryPhoneCallingCode: countryInfo.callingCode,
            additionalPhones: null
        },
        
        // Standard phones field (Secondary)
        phones: {
            primaryPhoneNumber: cleanNumber,
            primaryPhoneCountryCode: countryInfo.countryCode,
            primaryPhoneCallingCode: countryInfo.callingCode,
            additionalPhones: null
        },
        
        // Metadata
        countryDetected: countryInfo.detected,
        originalNumber: phoneNumber,
        formattedNumber: `${countryInfo.callingCode}${cleanNumber}`
    };
}

/**
 * Gets calling code for a specific country.
 * Used for manual country specification.
 * 
 * @param {string} countryCode ISO country code (e.g., 'AR', 'US')
 * @returns {string} Calling code with + prefix
 */
function getCallingCodeForCountry(countryCode) {
    return COUNTRY_TO_CALLING_CODE[countryCode.toUpperCase()] || '+54'; // Default to Argentina
}

module.exports = {
    CALLING_CODE_TO_COUNTRY,
    COUNTRY_TO_CALLING_CODE,
    detectCountryFromPhone,
    formatPhoneForCRM,
    getCallingCodeForCountry
};
