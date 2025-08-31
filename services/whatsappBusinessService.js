/**
 * whatsappBusinessService.js
 * 
 * Description: Servicio para integración con WhatsApp Factory API
 * 
 * Role in the system: Maneja el envío de mensajes y comunicación con WhatsApp Factory API
 * 
 * Node.js Context: Service - external API integration
 * 
 * Dependencies:
 * - whatsappFactoryApiService (servicio centralizado)
 * - Agent model para obtener configuración
 * 
 * Dependants:
 * - routes/webhookRoutes.js (webhook processing)
 * - modules/messageQueue.js (message sending)
 */

const { sendTextMessage, getNumberInfo, validateAgent } = require('./whatsappFactoryApiService');

/**
 * Envía un mensaje usando WhatsApp Factory API
 * @param {Object} agent - Agente configurado con token y instanceId
 * @param {string} to - Número de teléfono destino (formato: 1234567890)
 * @param {string} message - Mensaje a enviar
 * @param {Object} messageToQuote - Mensaje a citar (opcional)
 * @returns {Promise<Object>} Respuesta de la API
 */
async function sendWhatsAppBusinessMessage(agent, to, message, messageToQuote = null) {
  return sendTextMessage(agent, to, message, messageToQuote);
}

/**
 * Verifica la configuración del agente para WhatsApp Factory API
 * @param {Object} agent - Agente a verificar
 * @returns {Object} Estado de la configuración
 */
function validateWhatsAppFactoryAgent(agent) {
  return validateAgent(agent);
}

/**
 * Obtiene información del número de WhatsApp Factory
 * @param {Object} agent - Agente configurado
 * @returns {Promise<Object>} Información del número
 */
async function getWhatsAppFactoryNumberInfo(agent) {
  return getNumberInfo(agent);
}

module.exports = {
  sendWhatsAppBusinessMessage,
  validateWhatsAppFactoryAgent,
  getWhatsAppFactoryNumberInfo
};
