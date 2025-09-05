/**
 * insuranceMappings.js
 * 
 * Description: Modular insurance and plan mapping system for healthcare provider codes and names.
 * 
 * Role in the system: Provides static mapping data for converting insurance codes to readable names and plan codes to plan names.
 * 
 * Node.js Context: Configuration - static data mapping for healthcare insurance systems
 * 
 * Dependencies:
 * - None (pure data configuration)
 * 
 * Dependants:
 * - services/twentyCrmService.js (uses insurance and plan mappings)
 * - tools/patientManagementTools.js (uses mappings for CRM integration)
 */

// ============================================================================
// Insurance Provider Mappings - Code to Name conversion
// ============================================================================

/**
 * Maps insurance provider codes to readable names.
 * Used for CRM integration to store descriptive names instead of codes.
 * 
 * Format: "code": "Provider Name"
 */
const INSURANCE_PROVIDERS = {
    "11": "HOPE",
    "100403": "MEDIFE",
    "100411": "APSOT",
    "100413": "CAJA NOTARIAL ESCRIBANOS CABA",
    "100419": "OSDIPP",
    "100422": "EUROP ASSISTANCE",
    "100423": "AVALIAN",
    "100426": "GEDYT",
    "100428": "AGENTES DE PROPAGANDA MEDICA",
    "100429": "MUTUAL FEDERADA",
    "100430": "PREVENCION SALUD SA",
    "100434": "FSST - FUND. SERV. SOCIALES",
    "100435": "SADAIC",
    "100437": "OPDEA",
    "100439": "OMINT",
    "100440": "MEDICUS S.A.",
    "100441": "SOLIDEZ",
    "100442": "COLEGIO ESCRIBANOS PROV BS.AS.",
    "100446": "OBRA SOCIAL PODER JUDICIAL",
    "100449": "UNIVERSAL ASSISTANCE",
    "100450": "CENTRO MEDICO PUEYRREDON",
    "100452": "OSPE",
    "100455": "PROGRAMAS MEDICOS",
    "100457": "CONFERENCIA EPISCOPAL ARG",
    "100458": "OSOCNA",
    "100459": "CASA",
    "100461": "MDABROAD",
    "100462": "ASOCIACION MUTUAL SAN LUCAS",
    "100463": "FORD ARGENTINA SA",
    "100467": "EXPERTA",
    "100474": "OBRA SOCIAL YPF",
    "100476": "SEMPRE",
    "100478": "DITCAP",
    "100481": "MINISTERIO DE SALUD D LA PAMPA",
    "100482": "CEGYR",
    "100483": "AMFFA",
    "100485": "DASU",
    "100486": "FOB - MEDICINA MARÍTIMA",
    "100488": "OSPIP",
    "100489": "JERÁRQUICOS SALUD",
    "100509": "DASMI",
    "100511": "ANDAR - OBRA SOCIAL DE VIAJANTES VENDEDORES DE LA REP ARG",
    "100516": "DASUTEN",
    "100521": "MEDIMAS",
    "100523": "RAS",
    "100524": "SWISS MEDICAL ART",
    "100530": "ROI SA",
    "100531": "WORLD MEDICAL CARE",
    "100538": "BSI - BIOANALITICA",
    "100540": "OSFATUN",
    "100542": "CAJA DE SANTA CRUZ",
    "100545": "CONSULT RENT",
    "100546": "OMI",
    "1107": "SWISS MEDICAL",
    "20464": "OSDE"
};

// ============================================================================
// Insurance Plan Mappings - Entity + Plan ID to Plan Name conversion
// ============================================================================

/**
 * Maps insurance plan combinations to readable plan names.
 * Key format: "entityId_planId" -> "Plan Name"
 * Used for detailed plan information in CRM.
 */
const INSURANCE_PLANS = {
    // AFA
    "100433_988": "AFA - GENERAL",
    
    // AGENTES DE PROPAGANDA MEDICA
    "100428_734": "PLAN 5000 APM",
    
    // AMFFA
    "100483_771": "CAFAR",
    "100483_1136": "INTEGRAL",
    "100483_1227": "PREMIUM ORO",
    "100483_1228": "PREMIUM PLATA",
    "100483_1222": "SENIOR",
    "100483_1229": "START",
    
    // ANDAR
    "100511_826": "PLUS",
    
    // APSOT
    "100411_487": "Basico",
    
    // ASOCIACION MUTUAL SAN LUCAS
    "100462_688": "UNICO",
    
    // AVALIAN
    "100423_1186": "INTEGRAL AS 200",
    "100423_1187": "INTEGRAL AS 204",
    "100423_657": "SELECTA (AS 400)",
    "100423_659": "SELECTA (AS 500)",
    "100423_658": "SUPERIOR (AS 300)",
    
    // BSI - BIOANALITICA
    "100538_1151": "UNICO",
    
    // CAJA DE SANTA CRUZ
    "100542_1178": "UNICO",
    
    // CAJA NOTARIAL ESCRIBANOS CABA
    "100413_1068": "A PLUS",
    "100413_472": "B",
    
    // CASA
    "100459_680": "BAYRES 3001",
    "100459_681": "BAYRES 4001",
    "100459_677": "CASA MED",
    "100459_678": "CASA PLUS",
    "100459_676": "INTEGRAL",
    "100459_679": "JUBILADOS",
    "100459_1105": "ORIGEN +",
    
    // CEGYR
    "100482_768": "UNICO",
    
    // CENTRO MEDICO PUEYRREDON
    "100450_922": "AR1",
    "100450_708": "AR2",
    "100450_923": "CM-A",
    "100450_707": "CM-B",
    "100450_924": "MCI-1",
    "100450_938": "MCI-4",
    "100450_939": "MCI4-S",
    "100450_706": "MCI5",
    "100450_705": "MCI6",
    "100450_940": "OM",
    "100450_941": "OM1",
    "100450_628": "OM3",
    "100450_942": "OM4",
    "100450_943": "OM4C",
    "100450_945": "OM4-S1",
    "100450_946": "OM4-S2",
    "100450_629": "OM5",
    "100450_630": "OM6",
    "100450_704": "OM6C",
    "100450_631": "OM7",
    "100450_944": "OMC4I",
    "100450_947": "OM-U",
    "100450_948": "SR-ALFA",
    "100450_949": "SR-BETA",
    
    // COLEGIO ESCRIBANOS PROV BS.AS.
    "100442_603": "PLAN UNICO",
    
    // CONFERENCIA EPISCOPAL ARG
    "100457_673": "PLAN UNICO",
    
    // CONSULT RENT
    "100545_1203": "CRISTAL ESMERALDA",
    "100545_1205": "CRISTAL ZAFIRO",
    "100545_1204": "RAS 1500",
    
    // DASMI
    "100509_822": "UNICO",
    
    // DASU
    "100485_790": "Adherentes",
    "100485_769": "Dasu",
    
    // DASUTEN
    "100516_912": "UNICO",
    
    // DITCAP
    "100478_756": "Unico",
    
    // EUROP ASSISTANCE
    "100422_497": "Básico",
    
    // EXPERTA
    "100467_716": "PLAN UNICO",
    
    // FOB - MEDICINA MARÍTIMA
    "100486_770": "Unico",
    
    // FORD ARGENTINA SA
    "100463_691": "PLAN UNICO",
    
    // FSST - FUND. SERV. SOCIALES
    "100434_565": "PLAN 1",
    "100434_566": "PLAN 14",
    
    // GEDYT
    "100426_549": "BASICO",
    
    // HOPE
    "11_506": "DORADO HT",
    "11_507": "DORADO HU",
    "11_508": "DORADO HW",
    "11_509": "DORADO HX",
    "11_510": "DORADO HY",
    "11_714": "DORADO LR",
    "11_511": "DORADO LT",
    "11_512": "DORADO LU",
    "11_513": "DORADO LW",
    "11_514": "DORADO LX",
    "11_515": "DORADO LY",
    "11_710": "DORADO MS6",
    "11_711": "DORADO MS7",
    "11_712": "DORADO MS8",
    "11_713": "DORADO MS9",
    "11_1207": "DORADO MT",
    "11_516": "DORADO NT",
    "11_517": "DORADO NU",
    "11_518": "DORADO NW",
    "11_519": "DORADO NX",
    "11_520": "DORADO NY",
    "11_521": "DORADO OS6",
    "11_522": "DORADO OS7",
    "11_523": "DORADO OS8",
    "11_524": "DORADO OS9",
    "11_17": "DORADO T",
    "11_502": "DORADO U",
    "11_503": "DORADO W",
    "11_504": "DORADO X",
    "11_505": "DORADO Y",
    "11_715": "PLATA L35",
    
    // JERÁRQUICOS SALUD
    "100489_776": "PMI",
    "100489_779": "PMI 2000",
    "100489_815": "PMI 2886",
    "100489_782": "PMI 2886 2000",
    "100489_783": "PMI 2886 3000",
    "100489_781": "PMI 2886 SOLTERO",
    "100489_780": "PMI 3000",
    "100489_787": "PMI JUB",
    "100489_788": "PMI JUB 2000",
    "100489_789": "PMI JUB 3000",
    "100489_784": "PMI MONOTRIBUTISTA",
    "100489_786": "PMI MONOTRIBUTISTA 2000",
    "100489_785": "PMI MONOTRIBUTISTA SOLTERO",
    "100489_778": "PMI SOLTERO",
    
    // MDABROAD
    "100461_1224": "CIGNA",
    "100461_686": "UNICO",
    
    // MEDICUS S.A.
    "100440_1125": "ADV",
    "100440_1121": "BLANCO",
    "100440_601": "CARNET AZUL",
    "100440_602": "CARNET CELESTE",
    "100440_1123": "FAMILY CARE ONE",
    "100440_1124": "FAMILY FLEX",
    "100440_1122": "GRIS CORPORATE",
    
    // MEDIFE
    "100403_535": "BRONCE",
    "100403_810": "JUNTOS",
    "100403_1080": "MEDIFE +",
    "100403_416": "ORO",
    "100403_447": "PLATA",
    "100403_452": "PLATINUM",
    "100403_1128": "PREOCUPACIONALES MEDIFE",
    
    // MEDIMAS
    "100521_1158": "300",
    
    // MINISTERIO DE SALUD D LA PAMPA
    "100481_763": "Unico",
    
    // MUTUAL FEDERADA
    "100429_557": "GRUPO 1",
    "100429_558": "GRUPO 2",
    
    // OBRA SOCIAL PODER JUDICIAL
    "100446_616": "PLAN UNICO",
    
    // OBRA SOCIAL YPF
    "100474_1170": "UNICO",
    
    // OMI
    "100546_1233": "UNICO",
    
    // OMINT
    "100439_599": "8500 PREMIUM",
    "100439_597": "PLAN O",
    
    // OPDEA
    "100437_1087": "PLAN 04",
    "100437_727": "PLAN 10",
    "100437_592": "PLAN 12",
    "100437_593": "PLAN 15",
    
    // OSDE
    "20464_883": "110",
    "20464_464": "210",
    "20464_461": "310",
    "20464_462": "410",
    "20464_465": "450",
    "20464_463": "510",
    "20464_1155": "8 260",
    "20464_1079": "8 360",
    "20464_1156": "8 430",
    
    // OSDIPP
    "100419_1215": "1 PLUS PLUSPETROL",
    "100419_492": "Plan 1",
    "100419_493": "Plan 1 Plus",
    "100419_619": "Plan 150",
    "100419_494": "Plan Magnus",
    "100419_626": "Plus Jerárquico",
    
    // OSFATUN
    "100540_1213": "DOCENTE",
    "100540_1168": "NO DOCENTE",
    "100540_1169": "PREMIUM DIFERENCIAL",
    "100540_1226": "UNI 4000",
    
    // OSOCNA
    "100458_675": "UNICO",
    
    // OSPE
    "100452_636": "A 606",
    "100452_637": "A 700",
    "100452_933": "A 704",
    "100452_934": "A 704 SC SANTA CRUZ",
    "100452_639": "ADHERENTE D-750",
    "100452_935": "AFIP",
    "100452_638": "OSPESSA",
    
    // OSPIP
    "100488_1129": "UNICO",
    
    // PREVENCION SALUD SA
    "100430_1221": "PLAN A2",
    "100430_1220": "PLAN A3",
    "100430_559": "Plan A4",
    "100430_560": "Plan A5",
    "100430_561": "Plan A6"
};

// ============================================================================
// Helper Functions - Insurance and plan name resolution
// ============================================================================

/**
 * Gets the insurance provider name from code.
 * Returns the provider name if found, otherwise returns the original code.
 * 
 * @param {string} insuranceCode Insurance provider code
 * @returns {string} Provider name or original code if not found
 */
function getInsuranceProviderName(insuranceCode) {
    if (!insuranceCode) return '';
    
    const providerName = INSURANCE_PROVIDERS[insuranceCode.toString()];
    if (providerName) {
        console.log(`Insurance mapping found: ${insuranceCode} → ${providerName}`);
        return providerName;
    }
    
    console.log(`Insurance mapping not found for code: ${insuranceCode}, using code as name`);
    return insuranceCode.toString();
}

/**
 * Gets the insurance plan name from entity ID and plan code.
 * Returns the plan name if found, otherwise returns the original plan code.
 * 
 * @param {string} entityId Insurance entity/provider ID
 * @param {string} planCode Insurance plan code
 * @returns {string} Plan name or original plan code if not found
 */
function getInsurancePlanName(entityId, planCode) {
    if (!entityId || !planCode) return planCode || '';
    
    const planKey = `${entityId}_${planCode}`;
    const planName = INSURANCE_PLANS[planKey];
    
    if (planName) {
        console.log(`Plan mapping found: ${planKey} → ${planName}`);
        return planName;
    }
    
    console.log(`Plan mapping not found for: ${planKey}, using plan code: ${planCode}`);
    return planCode.toString();
}

/**
 * Gets comprehensive insurance information with both provider and plan names.
 * Combines provider name and plan name for complete insurance description.
 * 
 * @param {string} insuranceCode Insurance provider code
 * @param {string} planCode Insurance plan code
 * @returns {Object} Complete insurance information object
 */
function getCompleteInsuranceInfo(insuranceCode, planCode) {
    const providerName = getInsuranceProviderName(insuranceCode);
    const planName = getInsurancePlanName(insuranceCode, planCode);
    
    return {
        providerCode: insuranceCode,
        providerName: providerName,
        planCode: planCode,
        planName: planName,
        fullDescription: `${providerName} - ${planName}`
    };
}

module.exports = {
    INSURANCE_PROVIDERS,
    INSURANCE_PLANS,
    getInsuranceProviderName,
    getInsurancePlanName,
    getCompleteInsuranceInfo
};
