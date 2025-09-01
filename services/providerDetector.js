// services/providerDetector.js
/**
 * Servicio para detectar el proveedor de mensajes WhatsApp y webhooks de pago
 * Determina si un mensaje proviene de UltraMessage, WhatsApp Factory API o MercadoPago
 */

/**
 * Detecta el proveedor basado en la estructura del mensaje
 * @param {Object} req - Request object con headers y body
 * @returns {string} - 'ultramsg' | 'whatsapp-factory' | 'mercadopago'
 */
function detectProvider(req) {
  const { headers, body } = req;
  
  // Detectar MercadoPago Webhook
  // Características distintivas:
  // 1. Headers específicos de MercadoPago
  if (headers['x-signature'] && headers['x-request-id']) {
    return 'mercadopago';
  }
  
  // 2. Estructura típica de notificación MP
  if (body && body.type && body.data && body.data.id && 
      (body.type === 'payment' || body.type === 'merchant_order')) {
    return 'mercadopago';
  }
  
  // 3. Live mode y user_id típicos de MP
  if (body && typeof body.live_mode === 'boolean' && body.user_id && body.api_version) {
    return 'mercadopago';
  }
  
  // Detectar WhatsApp Factory API
  // Características distintivas:
  // 1. Headers específicos de WhatsApp Factory
  if (headers['x-whatsapp-event-id'] || headers['x-whatsapp-phone-number-id']) {
    return 'whatsapp-factory';
  }
  
  // 2. Estructura típica de WhatsApp Business API
  if (body && body.object === 'whatsapp_business_account' && body.entry) {
    return 'whatsapp-factory';
  }
  
  // 3. Metadata específica de WhatsApp Factory
  if (body && body.metadata && body.metadata.phoneNumberId && body.metadata.eventId) {
    return 'whatsapp-factory';
  }
  
  // Detectar UltraMessage
  // Características distintivas:
  // 1. Estructura típica de UltraMessage
  if (body && body.event_type && body.instanceId && body.data) {
    return 'ultramsg';
  }
  
  // 2. Campos específicos de UltraMessage en data
  if (body && body.data && body.data.from && body.data.pushname && body.data.type) {
    return 'ultramsg';
  }
  
  // Por defecto, asumimos UltraMessage para mantener compatibilidad
  console.warn('No se pudo detectar el proveedor específico, asumiendo UltraMessage');
  return 'ultramsg';
}

/**
 * Verifica si un mensaje es de WhatsApp Factory
 * @param {Object} req - Request object
 * @returns {boolean}
 */
function isWhatsAppFactory(req) {
  return detectProvider(req) === 'whatsapp-factory';
}

/**
 * Verifica si un mensaje es de UltraMessage
 * @param {Object} req - Request object
 * @returns {boolean}
 */
function isUltraMessage(req) {
  return detectProvider(req) === 'ultramsg';
}

/**
 * Verifica si una notificación es de MercadoPago
 * @param {Object} req - Request object
 * @returns {boolean}
 */
function isMercadoPago(req) {
  return detectProvider(req) === 'mercadopago';
}

module.exports = {
  detectProvider,
  isWhatsAppFactory,
  isUltraMessage,
  isMercadoPago
};