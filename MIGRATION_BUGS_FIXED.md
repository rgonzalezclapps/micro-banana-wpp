# 🐛 MongoDB Migration - Bugs Encontrados y Corregidos

**Fecha**: PCTMv1.5.0-3  
**Contexto**: Migración completa de PostgreSQL a MongoDB-only  
**Método**: FIXER MODE (fixer:deep+trace)

---

## 🔴 **BUG #1: Payment.findOne() con Sintaxis Sequelize**

### **Ubicación**:
`services/mercadopagoService.js` línea 320

### **Síntoma**:
- Webhook de MercadoPago llegaba correctamente
- Payment nunca se encontraba en DB
- Créditos NO se acreditaban al participant
- NO se enviaba mensaje de confirmación por WhatsApp
- `checkCredits` tool mostraba 0 a pesar de compra exitosa

### **Causa Raíz**:
```javascript
// ❌ ANTES (Sequelize syntax - PostgreSQL)
const payment = await Payment.findOne({
  where: { externalReference: paymentInfo.external_reference }
});
// Resultado: null (query no funciona con Mongoose)

// ✅ DESPUÉS (Mongoose syntax - MongoDB)
const payment = await Payment.findOne({
  externalReference: paymentInfo.external_reference
});
// Resultado: Payment document encontrado ✅
```

### **Impacto**:
- **CRÍTICO** - Sistema de pagos completamente roto
- Usuarios pagaban pero no recibían créditos
- No había notificación de confirmación

### **Fix Aplicado**:
Removido wrapper `where:` de query Mongoose

---

## 🔴 **BUG #2: Métodos Faltantes en Payment Model**

### **Ubicación**:
`models/Payment.js`

### **Síntoma**:
```
TypeError: payment.markAsApproved is not a function
TypeError: payment.markAsRejected is not a function
```

### **Causa Raíz**:
El modelo Payment solo tenía `markAsCredited()` pero faltaban:
- `markAsApproved()` - Para payment status 'approved'
- `markAsRejected()` - Para payment status 'rejected'

### **Fix Aplicado**:
```javascript
// Agregados al Payment model:

PaymentSchema.methods.markAsApproved = function(metadata = {}) {
  this.status = 'approved';
  this.approvedAt = new Date();
  this.metadata = { ...this.metadata, ...metadata };
  return this.save();
};

PaymentSchema.methods.markAsRejected = function(reason = '') {
  this.status = 'rejected';
  this.metadata = { 
    ...this.metadata, 
    rejectedAt: new Date(),
    rejectionReason: reason 
  };
  return this.save();
};
```

---

## 🟡 **BUG #3: Feed v2.0 Webhooks con Body Vacío**

### **Ubicación**:
`routes/webhookRoutes.js` + `services/mercadopagoService.js`

### **Síntoma**:
MercadoPago envía 2 tipos de webhooks:
- **WebHook v1.0**: Tiene body completo con `type`, `action`, `data.id` ✅
- **Feed v2.0**: Body vacío, solo query params `?id=xxx` ❌

Logs mostraban:
```
type: undefined,
action: undefined,
dataIdFromQuery: undefined
```

### **Causa Raíz**:
El código asumía que `req.body` siempre tendría datos, pero Feed v2.0 viene con body vacío.

### **Fix Aplicado**:
```javascript
// Detectar y augmentar body vacío
const webhookPayload = req.body && Object.keys(req.body).length > 0 
  ? req.body 
  : { type: webhookType, id: dataId }; // Minimal payload for Feed
```

---

## 🟡 **BUG #4: Rejected Payments Sin Notificación**

### **Ubicación**:
`services/mercadopagoService.js` + `routes/webhookRoutes.js`

### **Síntoma**:
- Pagos rechazados se registraban en DB
- Usuario NO recibía notificación por WhatsApp
- No sabía que su pago falló

### **Fix Aplicado**:

**1. MercadoPago Service** - Agregar participant info al result:
```javascript
else if (paymentInfo.status === 'rejected' || paymentInfo.status === 'cancelled') {
  await payment.markAsRejected(paymentInfo.status_detail);
  
  const participant = await Participant.findById(payment.participantId);
  
  updateResult = {
    success: true,
    action: 'rejected',
    participantId: participant?._id,
    phoneNumber: participant?.phoneNumber,
    reason: paymentInfo.status_detail,
    amount: payment.amount,
    credits: payment.credits
  };
}
```

**2. Webhook Routes** - Enviar notificación de rechazo:
```javascript
if (result.action === 'rejected') {
  notificationMessage = `❌ Pago rechazado

Tu intento de pago por $${result.amount} ARS no fue aprobado.

Motivo: ${result.reason || 'No especificado'}

Podés intentar nuevamente cuando quieras. Si tenés dudas, preguntame.`;
}
```

---

## 🟢 **BUG #5: ToolSchema con Agent IDs Numéricos**

### **Ubicación**:
`models/ToolSchema.js`

### **Síntoma**:
```javascript
enabledForAgents: [1, 2, 3]  // ❌ IDs numéricos legacy
```

### **Fix Aplicado**:
1. Actualizado schema: `type: Number` → `type: Schema.Types.ObjectId`
2. Migrados todos los IDs con script `forceUpdateToolSchemas.js`
3. Resultado:
```javascript
enabledForAgents: [
  ObjectId('69157004d7b5fc82c033dc7c'),  // Bananon
  ObjectId('69157006d7b5fc82c033dc86')   // Maxi Prod
]
```

---

## ✅ **VALIDACIÓN COMPLETA**

### **Test Script**: `tools/testCompletePaymentFlow.js`

**Resultados**:
```
✅ Payment creation: PASSED
✅ Payment lookup (MongoDB syntax): PASSED
✅ Payment approval: PASSED
✅ Credit acreditation: PASSED (0 → 1000)
✅ Payment credited status: PASSED
✅ Rejected payment handling: PASSED
```

### **Sistema Validado**:
- ✅ 3 Agents activos con configuración completa
- ✅ 10 ToolSchemas con ObjectId references
- ✅ Payment flow end-to-end funcionando
- ✅ checkCredits tool muestra balance correcto
- ✅ WhatsApp notifications para approved/rejected

---

## 🚀 **PRÓXIMO PAGO FUNCIONARÁ CORRECTAMENTE**

**Flujo Completo**:
1. Usuario genera link con `createTopupLink` tool
2. Payment se guarda en MongoDB con `externalReference`
3. Usuario completa pago en MercadoPago
4. Webhook llega (WebHook v1.0 o Feed v2.0)
5. **Payment se encuentra con MongoDB syntax** ✅
6. **Créditos se acreditan al participant** ✅
7. **Usuario recibe confirmación por WhatsApp** ✅

**Si pago es rechazado**:
1. Payment se marca como 'rejected'
2. **Usuario recibe notificación de rechazo** ✅
3. Puede reintentar el mismo link (MercadoPago lo permite)
4. Si aprueba después, se procesa normalmente ✅

---

**Estado**: ✅ TODOS LOS BUGS CORREGIDOS Y VALIDADOS

