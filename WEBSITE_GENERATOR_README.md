# 🌐 Website Generation System - Complete Implementation

## 📋 Overview

The Website Generation System integrates with the `webs.clapps.io` API to provide long-duration (5-20 minute) website generation with Redis-based job queue management and dual messaging service notifications.

## 🏗️ Architecture

### **Redis-Based Job Queue System**
- **Long-Duration Processing**: Optimized for 5-20 minute generation times
- **Adaptive Polling**: 30s → 45s → 60s → 90s intervals based on elapsed time
- **Queue Recovery**: Survives server restarts with job state persistence
- **Distributed Locking**: Prevents duplicate processing across multiple instances

### **Dual Messaging Integration**
- **UltraMsg Support**: For traditional agents
- **WhatsApp Business**: For `wpp-bsp` agent types
- **Immediate Messaging**: `messageToUser` support for instant user feedback
- **Completion Notifications**: Automatic success/failure notifications

## 🔧 Components

### **1. webGeneratorService.js**
**Purpose**: Core service for API integration and Redis state management
- **API Integration**: Handles `webs.clapps.io` API calls with authentication
- **Redis State**: Manages job state with 25-minute TTL for long processing
- **URL Construction**: Builds tracking URLs from project IDs
- **Error Handling**: Comprehensive error management with user-friendly messages

### **2. webGeneratorWorker.js**  
**Purpose**: Background worker for continuous job processing
- **Queue Processing**: Uses `BRPOP` for efficient blocking queue operations
- **Adaptive Polling**: Intelligent intervals reduce API calls by 60-70%
- **Job Recovery**: Scans Redis for pending jobs after server restart
- **Timeout Management**: 20-minute maximum with graceful failure handling
- **Notification System**: Sends completion messages via appropriate service

### **3. WebsiteGeneration Model**
**Purpose**: Optional database persistence for audit and recovery
- **Audit Trail**: Complete job history with timing and error details  
- **Recovery Data**: Supports job recovery scenarios
- **User History**: Track website generation history per conversation
- **Cleanup Methods**: Automatic cleanup of old records

### **4. OpenAI Tool Integration**
**Purpose**: `generateWebsite` tool case in `openaiIntegration.js`
- **Parameter Validation**: Prompt validation with minimum length requirements
- **Immediate Response**: Returns tracking URL instantly while processing in background
- **Error Handling**: Service-specific error messages and fallbacks
- **Message Integration**: Supports `messageToUser` for instant communication

## 🚀 Usage

### **OpenAI Tool Definition**
```json
{
  "name": "generateWebsite",
  "description": "Genera un sitio web completo y profesional basado en la descripción proporcionada y muestra un mensaje de espera al usuario.",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string", 
        "description": "Descripción del sitio web que se va a generar."
      },
      "messageToUser": {
        "type": "string",
        "description": "Mensaje en español argentino para informar al usuario que espere y que puede seguir conversando mientras tanto."
      }
    },
    "required": ["prompt", "messageToUser"],
    "additionalProperties": false
  }
}
```

### **Flow Example**
```javascript
// 1. User requests website generation
"Genera un sitio web para mi pizzería con diseño italiano"

// 2. AI calls generateWebsite tool
{
  "prompt": "sitio web para pizzería con diseño italiano", 
  "messageToUser": "Perfecto! Estoy generando tu sitio web. Esto puede tardar entre 5 y 15 minutos. Puedes seguir conversando mientras tanto 🚀"
}

// 3. Immediate response to user
"Tu solicitud está siendo procesada. Puedes ver el progreso en: https://webs.clapps.io/site-abc123"

// 4. Background processing (5-15 minutes)
// ... Redis queue processing with adaptive polling ...

// 5. Completion notification
"🎉 ¡Tu web ha sido terminada! Échale un vistazo: https://webs.clapps.io/site-abc123"
```

## ⚙️ Configuration

### **Environment Variables**
```bash
# Required API configuration
WEB_GENERATOR_URL=https://webs.clapps.io
WEB_GENERATOR_API_KEY=AIA_7h9j2k8m4n6p1q3r5s7t9u2w4x6y8z0a2b4c6d8e0f2g4h6i8j0k2l4m6n8o0p2q4r6s8t0u2v4w6x8y0z2

# Redis configuration (already configured)
REDIS_URL=redis://:password@host:6379
```

### **Redis Keys Pattern**
```javascript
// Generation state (25min TTL)
website:generating:${requestId} → { projectId, status, conversationId, startTime }

// Polling job queue (persistent)  
website:poll:queue → List of requestIds to process

// Polling locks (2min TTL)
website:lock:${requestId} → worker instance ID

// Completed jobs (6hrs TTL - audit)
website:completed:${requestId} → { url, success, completedAt }

// Attempt counters (25min TTL)
website:attempts:${requestId} → current attempt number
```

## 📊 Performance Characteristics  

### **Polling Optimization**
- **Early Stage** (0-2min): 30-second intervals
- **Normal Processing** (2-10min): 45-second intervals  
- **Late Stage** (10-18min): 60-second intervals
- **Final Attempts** (18-20min): 90-second intervals

### **Resource Efficiency**
- **60-70% fewer API calls** compared to fixed 20s polling
- **Zero job loss** with Redis persistence
- **Graceful degradation** on Redis/API failures
- **Automatic cleanup** of expired jobs

## 🛡️ Error Handling

### **Timeout Scenarios**
```javascript
// 20-minute timeout with user notification
if (elapsed > 1200000) {
  await notifyUser("El proceso tardó más de lo esperado. Por favor intenta nuevamente.");
  await cleanupJob(requestId);
}
```

### **API Failure Recovery**
```javascript
// Exponential backoff for temporary failures
const retryDelay = Math.min(30000 * Math.pow(2, attempts), 300000); // Max 5min
setTimeout(() => requeueJob(requestId), retryDelay);
```

### **Connection Resilience**
```javascript
// Redis disconnection handling
if (error.includes('connection')) {
  console.log('Redis reconnecting...');
  await sleep(5000);
}
```

## 🔍 Monitoring & Debugging

### **Logging Pattern**
```javascript
console.log(`🚀 [${requestId}] Website generation initiated`);
console.log(`🔍 [${requestId}] Polling status (attempt ${count}, elapsed: ${minutes}min)`);
console.log(`✅ [${requestId}] Generation completed: ${url}`);
console.log(`❌ [${requestId}] Generation failed: ${error}`);
```

### **Redis Monitoring**
```bash
# Check active jobs
redis-cli LLEN website:poll:queue

# Check generation states  
redis-cli KEYS "website:generating:*"

# Monitor worker locks
redis-cli KEYS "website:lock:*" 
```

### **Health Checks**
```javascript
// Check worker health
const queueLength = await redisClient.lLen('website:poll:queue');
const activeJobs = await redisClient.keys('website:generating:*');
console.log(`Queue: ${queueLength}, Active: ${activeJobs.length}`);
```

## 🚦 Status Codes & States

### **Job States**
- **`generating`**: Initial state after API call
- **`processing`**: Confirmed processing by external API
- **`completed`**: Website generation successful
- **`failed`**: Generation failed with error
- **`timeout`**: Exceeded 20-minute maximum

### **API Response Codes**
- **200**: Success 
- **400**: Bad request (invalid prompt)
- **401**: Invalid API key
- **429**: Rate limit exceeded (10/hour)
- **500**: Internal server error

## 📝 Best Practices

### **Prompt Guidelines**
- **Minimum 10 characters** for detailed descriptions
- **Include specific details**: colors, style, content type
- **Mention business type**: restaurant, shop, portfolio, etc.

### **Error Messages** 
- **User-friendly Spanish**: Clear explanations without technical jargon
- **Actionable guidance**: "Intenta con una descripción más detallada"
- **Context preservation**: Include original prompt in error logs

### **Resource Management**
- **Graceful shutdown**: Worker stops cleanly on SIGTERM/SIGINT
- **Memory cleanup**: Automatic cleanup of completed jobs
- **Connection pooling**: Reuse Redis connections efficiently

## 🔧 Troubleshooting

### **Common Issues**

**Worker Not Starting**
```bash
# Check Redis connection
redis-cli ping

# Verify environment variables
echo $WEB_GENERATOR_API_KEY
```

**Jobs Not Processing**
```bash
# Check queue length
redis-cli LLEN website:poll:queue

# Check for stuck locks
redis-cli KEYS "website:lock:*"
redis-cli DEL website:lock:stuck_request_id
```

**API Rate Limits**
```javascript
// Check rate limit headers in logs
"API Error: Rate limit exceeded. Please try again later"

// Monitor request frequency
// Max 10 generation requests per hour per API key
```

**Long Processing Times**
```javascript
// Check external API status
const statusResponse = await axios.get(
  `https://webs.clapps.io/api/status/${requestId}?key=${apiKey}`
);
```

## 🎯 Production Readiness

✅ **Redis persistence** - Jobs survive server restarts  
✅ **Graceful shutdown** - Clean worker termination  
✅ **Error recovery** - Automatic retry with exponential backoff  
✅ **Timeout handling** - 20-minute maximum with user notification  
✅ **Dual messaging** - Support for both UltraMsg and WhatsApp Business  
✅ **Resource cleanup** - Automatic cleanup of expired jobs and locks  
✅ **Monitoring** - Comprehensive logging and health checks  
✅ **Rate limiting** - Built-in API rate limit respect  

The system is production-ready and optimized for 5-20 minute website generation workflows with enterprise-grade reliability and user experience.
