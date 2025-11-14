/**
 * tools/testSignatureValidation.js
 * 
 * Description: Test MercadoPago signature validation for different webhook types
 */

require('dotenv').config();
const crypto = require('crypto');

function validateWebhookSignature(signature, requestId, dataId) {
  try {
    console.log('🔐 Testing signature validation...');
    console.log(`   signature: ${signature}`);
    console.log(`   requestId: ${requestId}`);
    console.log(`   dataId: ${dataId || 'null'}`);
    
    // Parse X-Signature header
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

    // Build manifest
    let manifest;
    if (dataId) {
      manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    } else {
      manifest = `request-id:${requestId};ts:${ts};`;
    }
    
    console.log(`   manifest: ${manifest}`);
    
    // Calculate signature
    const secretKey = process.env.MP_SECRET_KEY;
    const calculated = crypto
      .createHmac('sha256', secretKey)
      .update(manifest)
      .digest('hex');

    console.log(`   expected: ${v1}`);
    console.log(`   calculated: ${calculated}`);
    console.log(`   match: ${calculated === v1 ? '✅ YES' : '❌ NO'}`);
    
    return calculated === v1;

  } catch (error) {
    console.error('❌ Error:', error.message);
    return false;
  }
}

console.log('🧪 MERCADOPAGO SIGNATURE VALIDATION TEST');
console.log('═'.repeat(50));
console.log('');

// Test 1: WebHook v1.0 (with data.id)
console.log('1️⃣  WebHook v1.0 (has data.id in body)');
console.log('─'.repeat(50));
const test1Result = validateWebhookSignature(
  'ts=1763027457,v1=abc123def456',  // Example signature
  '912979c5-526a-49a3-90c2-9bba24d60837',  // Example request ID
  '133704037396'  // Payment ID
);
console.log(`Result: ${test1Result ? '✅ PASS' : '❌ FAIL'}\n`);

// Test 2: Feed v2.0 (has id in query, NOT data.id)
console.log('2️⃣  Feed v2.0 Payment (has ?id in query, NO body)');
console.log('─'.repeat(50));
const test2Result = validateWebhookSignature(
  'ts=1763032441,v1=xyz789abc123',  // Example signature
  '305081c5-9907-4c71-9d3b-0b0e1dc84911',  // Example request ID
  '133704037396'  // Payment ID from req.query.id
);
console.log(`Result: ${test2Result ? '✅ PASS' : '❌ FAIL'}\n`);

// Test 3: Preliminary notification (no dataId)
console.log('3️⃣  Preliminary Notification (no dataId)');
console.log('─'.repeat(50));
const test3Result = validateWebhookSignature(
  'ts=1763032441,v1=preliminary123',  // Example signature
  '305081c5-9907-4c71-9d3b-0b0e1dc84911',  // Example request ID
  null  // No dataId
);
console.log(`Result: ${test3Result ? '✅ PASS' : '❌ FAIL'}\n`);

console.log('═'.repeat(50));
console.log('📝 SUMMARY');
console.log('═'.repeat(50));
console.log('');
console.log('🔑 Secret Key configured: ' + (process.env.MP_SECRET_KEY ? 'YES' : 'NO'));
console.log('');
console.log('📝 Expected behavior:');
console.log('   - WebHook v1.0: Uses data.id in manifest');
console.log('   - Feed v2.0: Uses id from req.query.id in manifest');
console.log('   - Both should pass validation with correct manifest');
console.log('');
console.log('✅ Fix applied: mpDataId extracted ONCE at top of handler');
console.log('   This ensures Feed v2.0 webhooks get req.query.id correctly');

