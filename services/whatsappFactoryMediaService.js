'use strict';
/**
 * whatsappFactoryMediaService.js
 *
 * Servicio para descargar medios de WhatsApp Factory API usando el nuevo endpoint.
 * Mantiene API pública y comportamiento original:
 *  - Hasta 3 reintentos con 3s entre intentos
 *  - getMediaDownloadUrl retorna un Data URL (Base64)
 *
 * Extras:
 *  - getMediaBuffer: retorna { buffer, contentType } para uso eficiente en backend
 *  - Logs compactos (sin duplicados) y con redacción de data URLs/base64
 */

const { downloadMediaWithRetry } = require('./whatsappFactoryApiService');

/* =========================
 * Utils de logging seguros
 * ========================= */

const LOG_VERBOSE = String(process.env.MEDIA_DOWNLOAD_LOG_VERBOSE || '').toLowerCase() === 'true';


function safePreview(input, maxLen = 500) {
  try {
    let s = typeof input === 'string' ? input : String(input ?? '');
    // Quitar control chars (excepto \n \r \t)
    s = s.replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, '�');
    s = s.slice(0, maxLen);
    return s;
  } catch {
    return '[unprintable]';
  }
}

/* =========================
 * Helpers de contenido
 * ========================= */

/**
 * ¿El buffer parece HTML?
 */
function isHtmlContent(buffer) {
  try {
    const firstBytes = buffer.slice(0, 200).toString('utf8').toLowerCase();
    return (
      firstBytes.includes('<!doctype') ||
      firstBytes.includes('<!doctype html') ||
      firstBytes.includes('<html') ||
      firstBytes.includes('<head')
    );
  } catch {
    return false;
  }
}

/**
 * ¿El buffer parece JSON?
 */
function isJsonContent(buffer) {
  try {
    const content = buffer.toString('utf8').trim();
    return content.startsWith('{') || content.startsWith('[');
  } catch {
    return false;
  }
}

/* =========================
 * Descarga (núcleo)
 * ========================= */

/**
 * Descarga media (Buffer + contentType) aplicando reintentos.
 * @param {Object} params
 * @param {string} params.waId
 * @param {string} params.phoneNumberId
 * @param {string} params.agentId
 * @returns {Promise<{buffer: Buffer, contentType: string}>}
 */
async function _downloadMedia({ waId, phoneNumberId, agentId }) {
  // Validaciones tempranas
  if (!waId || typeof waId !== 'string') {
    throw new Error('Parámetro inválido: waId debe ser string no vacío');
  }
  if (!phoneNumberId || typeof phoneNumberId !== 'string') {
    throw new Error('Parámetro inválido: phoneNumberId debe ser string no vacío');
  }
  if (!agentId) {
    throw new Error('Parámetro inválido: agentId es requerido');
  }

  // Usar el servicio centralizado
  return downloadMediaWithRetry({ waId, phoneNumberId, agentId });
}

/* =========================
 * API pública
 * ========================= */

/**
 * API eficiente para backend: retorna Buffer + contentType
 */
async function getMediaBuffer(waId, phoneNumberId, agentId) {
  return _downloadMedia({ waId, phoneNumberId, agentId });
}

/**
 * Mantiene la API original: retorna un Data URL (Base64)
 */
async function getMediaDownloadUrl(waId, phoneNumberId, agentId) {
  const { buffer, contentType } = await _downloadMedia({ waId, phoneNumberId, agentId });
  const base64Media = buffer.toString('base64');
  return `data:${contentType};base64,${base64Media}`;
}

/**
 * Alias de compatibilidad
 */
async function getAudioUrl(waId, phoneNumberId, agentId) {
  return getMediaDownloadUrl(waId, phoneNumberId, agentId);
}


module.exports = {
  getMediaDownloadUrl,
  getMediaBuffer, 
  getAudioUrl,
};
