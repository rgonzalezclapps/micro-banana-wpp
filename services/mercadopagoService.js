/**
 * mercadopagoService.js
 * 
 * Description: MercadoPago integration service for payment processing and webhook validation
 * 
 * Role in the system: Handles MercadoPago Checkout Pro payment creation, webhook signature validation, and payment status queries
 * 
 * Node.js Context: Service - External API integration for payment processing
 * 
 * Dependencies:
 * - axios (HTTP client for MercadoPago API calls)
 * - crypto (HMAC-SHA256 signature validation)
 * - Payment model (for payment lifecycle management)
 * - Participant model (for credit balance updates)
 * 
 * Dependants:
 * - modules/openaiIntegration.js (calls createTopupLink via createTopupLink tool)
 * - routes/webhookRoutes.js (uses webhook validation and payment processing)
 * - services/ultramsgService.js (sends payment confirmation messages)
 */

const axios = require('axios');
const crypto = require('crypto');
const { Payment, Participant } = require('../models');

class MercadoPagoService {
  constructor() {
    this.accessToken = process.env.MP_ACCESS_TOKEN;
    this.secretKey = process.env.MP_SECRET_KEY;
    this.baseURL = 'https://api.mercadopago.com';
    
    if (!this.accessToken) {
      throw new Error('MP_ACCESS_TOKEN is required in environment variables');
    }
    if (!this.secretKey) {
      throw new Error('MP_SECRET_KEY is required for webhook signature validation');
    }
  }

  /**
   * Creates a MercadoPago Checkout Pro preference for credit top-up
   * 
   * @param {Object} topupData Credit top-up configuration
   * @param {number} topupData.amount_ars Amount in Argentine Pesos
   * @param {number} topupData.credits Number of credits to add
   * @param {string} topupData.note Optional note for the payment
   * @param {string} topupData.idempotency_key UUID v4 for deduplication
   * @param {number} topupData.participantId Internal participant ID
   * @returns {Promise<Object>} MercadoPago preference response with init_point
   */
  async createTopupLink(topupData) {
    console.log('🔄 Creating MercadoPago preference for credit top-up:', {
      amount: topupData.amount_ars,
      credits: topupData.credits,
      participantId: topupData.participantId,
      idempotencyKey: topupData.idempotency_key
    });

    try {
      // Generate external reference for tracking
      const externalReference = `topup_${topupData.idempotency_key}`;
      
      // Create preference payload for MercadoPago Checkout Pro
      const preferencePayload = {
        items: [{
          title: "Recarga de créditos",
          quantity: 1,
          unit_price: parseFloat(topupData.amount_ars),
          currency_id: "ARS"
        }],
        external_reference: externalReference,
        metadata: {
          participant_id: topupData.participantId,
          credits: topupData.credits,
          idempotency_key: topupData.idempotency_key
        },
        notification_url: `${process.env.WEBHOOK_BASE_URL || 'https://api-ai-mvp.com'}/api/webhook`,
        auto_return: "approved",
        expires: false,
        date_of_expiration: null,
        back_urls: {
          success: `${process.env.WEBHOOK_BASE_URL || 'https://api-ai-mvp.com'}/api/webhook/payment-success`,
          failure: `${process.env.WEBHOOK_BASE_URL || 'https://api-ai-mvp.com'}/api/webhook/payment-failure`,
          pending: `${process.env.WEBHOOK_BASE_URL || 'https://api-ai-mvp.com'}/api/webhook/payment-pending`
        },
        binary_mode: false, // Allow pending states for better compatibility
        payment_methods: {
          excluded_payment_types: [
            { id: "ticket" } // Only exclude offline ticket payments
          ],
          installments: 12, // Allow up to 12 installments
          default_installments: 1 // Default to 1 installment but allow more
        }
      };

      // Add optional note if provided
      if (topupData.note) {
        preferencePayload.additional_info = topupData.note;
      }

      console.log('📤 Sending preference creation request to MercadoPago...');
      console.log('🔍 [DIAGNOSTIC] Preference payload structure:', {
        items: preferencePayload.items.length,
        external_reference: preferencePayload.external_reference,
        notification_url: preferencePayload.notification_url,
        auto_return: preferencePayload.auto_return,
        has_back_urls: !!preferencePayload.back_urls,
        back_urls_keys: preferencePayload.back_urls ? Object.keys(preferencePayload.back_urls) : [],
        binary_mode: preferencePayload.binary_mode,
        amount: preferencePayload.items[0]?.unit_price,
        currency: preferencePayload.items[0]?.currency_id,
        payment_methods: {
          excluded_types: preferencePayload.payment_methods?.excluded_payment_types?.length || 0,
          installments: preferencePayload.payment_methods?.installments,
          default_installments: preferencePayload.payment_methods?.default_installments
        }
      });
      
      const response = await axios.post(
        `${this.baseURL}/checkout/preferences`,
        preferencePayload,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const preference = response.data;
      
      console.log('✅ MercadoPago preference created successfully:', {
        preferenceId: preference.id,
        initPoint: preference.init_point,
        externalReference: externalReference
      });

      return {
        preference_id: preference.id,
        init_point: preference.init_point,
        external_reference: externalReference,
        status: 'created'
      };

    } catch (error) {
      console.error('❌ Error creating MercadoPago preference:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      // Return error for AI to handle gracefully
      return {
        error: true,
        message: 'Error al generar link de pago. Por favor intenta nuevamente más tarde.',
        details: error.response?.data || error.message
      };
    }
  }

  /**
   * Validates MercadoPago webhook signature using X-Signature header
   * 
   * @param {string} signature X-Signature header value (ts=...,v1=...)
   * @param {string} requestId X-Request-Id header value
   * @param {string} dataId Payment or notification ID from webhook body
   * @returns {boolean} True if signature is valid
   */
  validateWebhookSignature(signature, requestId, dataId) {
    try {
      console.log('🔐 Validating MercadoPago webhook signature...');
      
      if (!signature || !requestId) {
        console.warn('⚠️ Missing required headers for signature validation');
        return false;
      }

      // Parse X-Signature header: "ts=1704908010,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839"
      const parts = signature.split(',');
      let ts = null;
      let v1 = null;

      for (const part of parts) {
        const [key, value] = part.split('=');
        if (key?.trim() === 'ts') ts = value?.trim();
        if (key?.trim() === 'v1') v1 = value?.trim();
      }

      if (!ts || !v1) {
        console.warn('⚠️ Invalid X-Signature format');
        return false;
      }

      // Build manifest string as per MercadoPago documentation
      // If no dataId, create manifest without id field (for some webhook types)
      let manifest;
      if (dataId) {
        manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      } else {
        // Some webhooks (like preliminary notifications) might not have data.id
        manifest = `request-id:${requestId};ts:${ts};`;
        console.log('⚠️ Building manifest without data.id for preliminary webhook');
      }
      
      console.log('🔍 Signature validation manifest:', manifest);
      
      // Calculate HMAC-SHA256 signature
      const calculatedSignature = crypto
        .createHmac('sha256', this.secretKey)
        .update(manifest)
        .digest('hex');

      const isValid = calculatedSignature === v1;
      
      if (!isValid) {
        console.log('🔍 Signature mismatch details:', {
          expected: v1,
          calculated: calculatedSignature,
          manifest: manifest,
          hasDataId: !!dataId
        });
      }
      
      console.log(isValid ? '✅ Webhook signature validated successfully' : '❌ Webhook signature validation failed');
      
      return isValid;

    } catch (error) {
      console.error('❌ Error validating webhook signature:', error);
      return false;
    }
  }

  /**
   * Retrieves payment information from MercadoPago API
   * 
   * @param {string} paymentId MercadoPago payment ID
   * @returns {Promise<Object|null>} Payment data or null if not found
   */
  async getPaymentInfo(paymentId) {
    try {
      console.log('🔍 Retrieving payment info from MercadoPago:', paymentId);
      
      const response = await axios.get(
        `${this.baseURL}/v1/payments/${paymentId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          }
        }
      );

      const paymentData = response.data;
      
      console.log('✅ Payment info retrieved:', {
        id: paymentData.id,
        status: paymentData.status,
        external_reference: paymentData.external_reference
      });

      return paymentData;

    } catch (error) {
      console.error('❌ Error retrieving payment info:', {
        paymentId,
        error: error.message,
        status: error.response?.status
      });
      return null;
    }
  }

  /**
   * Processes MercadoPago webhook notification and updates payment status
   * 
   * @param {Object} webhookData Webhook notification data
   * @param {string} signature X-Signature header
   * @param {string} requestId X-Request-Id header
   * @param {string} dataId Extracted data ID from webhook (from multiple sources)
   * @returns {Promise<Object>} Processing result
   */
  async processWebhookNotification(webhookData, signature, requestId, dataId = null) {
    console.log('🔔 Processing MercadoPago webhook notification:', {
      type: webhookData.type || webhookData.topic,
      action: webhookData.action,
      dataId: dataId || webhookData.data?.id,
      extractedDataId: dataId,
      bodyDataId: webhookData.data?.id
    });

    try {
      // Validate webhook signature using the correctly extracted dataId
      const finalDataId = dataId || webhookData.data?.id;
      if (!this.validateWebhookSignature(signature, requestId, finalDataId)) {
        console.warn('⚠️ Invalid webhook signature, ignoring notification');
        return { success: false, reason: 'invalid_signature' };
      }

      // Only process payment notifications (check both 'type' and 'topic' fields)
      const notificationType = webhookData.type || webhookData.topic;
      if (notificationType !== 'payment') {
        console.log(`ℹ️ Non-payment notification (${notificationType}), skipping processing`);
        return { success: true, reason: 'non_payment_notification', type: notificationType };
      }

      const paymentId = dataId || webhookData.data?.id;
      if (!paymentId) {
        console.warn('⚠️ No payment ID in webhook data');
        return { success: false, reason: 'missing_payment_id' };
      }

      // Get payment info from MercadoPago API
      const paymentInfo = await this.getPaymentInfo(paymentId);
      if (!paymentInfo) {
        console.warn('⚠️ Could not retrieve payment info from MercadoPago API');
        return { success: false, reason: 'payment_not_found' };
      }

      // Find our internal payment record
      const payment = await Payment.findOne({
        where: { external_reference: paymentInfo.external_reference }
      });

      if (!payment) {
        console.warn('⚠️ Payment not found in database:', paymentInfo.external_reference);
        return { success: false, reason: 'internal_payment_not_found' };
      }

      // Check if already processed (idempotency)
      if (payment.status === 'approved' && paymentInfo.status === 'approved') {
        console.log('ℹ️ Payment already processed, skipping duplicate webhook');
        return { success: true, reason: 'already_processed' };
      }

      // Update payment status based on MercadoPago status
      let updateResult = null;
      
      if (paymentInfo.status === 'approved') {
        console.log('✅ Payment approved, crediting participant...');
        
        await payment.markAsApproved({
          mp_payment_data: paymentInfo,
          processed_at: new Date()
        });

        // Credit participant balance
        const participant = await Participant.findByPk(payment.participantId);
        if (participant) {
          await participant.addCredits(payment.credits);
          await payment.markAsCredited();
          
          console.log('💰 Credits added to participant:', {
            participantId: participant.id,
            creditsAdded: payment.credits,
            newBalance: participant.creditBalance
          });
          
          updateResult = {
            success: true,
            action: 'credited',
            participantId: participant.id,
            phoneNumber: participant.phoneNumber,
            creditsAdded: payment.credits,
            amount: payment.amount,
            newBalance: participant.credit_balance
          };
        }

      } else if (paymentInfo.status === 'rejected' || paymentInfo.status === 'cancelled') {
        console.log('❌ Payment rejected/cancelled');
        await payment.markAsRejected(paymentInfo.status_detail || 'Payment not approved');
        
        updateResult = {
          success: true,
          action: 'rejected',
          reason: paymentInfo.status_detail
        };
      }

      return updateResult || { success: true, reason: 'status_updated' };

    } catch (error) {
      console.error('❌ Error processing webhook notification:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new MercadoPagoService();
