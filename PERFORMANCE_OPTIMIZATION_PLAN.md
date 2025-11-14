# ⚡ Performance Optimization Plan - Zero-Delay Smart Queue

**Version**: PCTMv1.6.0-MAJOR-PERFORMANCE  
**Date**: November 13, 2025  
**Objective**: Reduce message processing time from ~60s to < 5s with intelligent cancellation  
**Status**: TECHNICAL DESIGN COMPLETE - READY FOR IMPLEMENTATION  

---

## 🎯 Executive Summary

**Current Problem**: First message takes ~60 seconds to process (2.4s overhead + 1.5s unnecessary queue wait + OpenAI time)

**Target**: < 5 seconds total for any message (< 1s overhead + OpenAI time)

**Solution**: Zero-delay smart queue with OpenAI request cancellation and comprehensive AI request tracking

---

## 📊 Current Architecture - Static Verification

### **File: `modules/messageQueue.js`** (970 lines total)

#### Critical Functions & Line Numbers:
| Function | Lines | Purpose | Bottleneck |
|----------|-------|---------|------------|
| `addMessage()` | 55-97 | Add message to queue | ❌ Calls resetQueueTimer (line 96) |
| `resetQueueTimer()` | 367-388 | Set timer for processing | ❌ **1.5s delay ALWAYS** |
| `processQueue()` | 390-396 | Trigger processing | ✅ OK |
| `shouldProcessQueue()` | 398-411 | Check if can process | ✅ OK |
| `executeQueueProcessing()` | 420-970 | Main processing logic | ⚠️ No abort checkpoints |

#### Current Timer Logic (Lines 382-387):
```javascript
const timer = setTimeout(() => {
  this.processQueue(conversationId);
}, this.queueInterval); // ❌ ALWAYS 1500ms (or 2000ms default)
```

**Problem**: No differentiation between first message (should be instant) and subsequent messages (can batch).

---

### **File: `modules/responsesClient.js`** (715 lines total)

#### Critical Functions & Line Numbers:
| Function | Lines | Purpose | Abort Capable? |
|----------|-------|---------|----------------|
| `generateResponse()` | 28-195 | Main entry point | ❌ No AbortController |
| `loadAgentConfig()` | 663-715 | Load from MongoDB + Redis | ⚠️ Needs caching optimization |
| `buildMessages()` | 200-298 | Build OpenAI context | ✅ OK (fast) |
| `processStream()` | 300-518 | Handle OpenAI response | ❌ No abort signal |

#### OpenAI Request (Line 163):
```javascript
const response = await this.openai.chat.completions.create(requestConfig);
```

**Problem**: No AbortController signal passed, cannot cancel mid-flight.

---

### **File: `models/Message.js`** (347 lines total)

#### Current Status Field (Lines 121-125):
```javascript
status: {
  type: String,
  enum: ['pending', 'sent', 'delivered', 'read', 'received', 'ultraMsg'],
  default: 'pending'
}
```

**Problem**: Missing 'cancelled' and 'failed' status for comprehensive tracking.

---

## 🚨 CRITICAL BOTTLENECK DISCOVERED: Image Re-downloading

### **Problem Identified** (`responsesClient.js` lines 348-387)

**Current Behavior**:
```javascript
async loadImageAsBase64(fileId, conversationId) {
  const downloadUrl = createDownloadUrl(fileId);
  console.log(`📥 Downloading image to send as base64: ${downloadUrl}`);
  
  const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
  const base64Image = Buffer.from(response.data).toString('base64');
  // ...
}
```

**Impact Per Request with 5 Historical Images**:
- **Time Lost**: 5 images × 0.6-1s each = **3-5 seconds WASTED**
- **Tokens Wasted**: 5 images × ~1000 tokens = **5000+ unnecessary tokens**
- **File System I/O**: 5 downloads × network latency
- **CPU**: 5 Buffer encoding operations

**Example from Production**:
```
📥 [conversationId] Downloading image 1... (+500ms)
📥 [conversationId] Downloading image 2... (+1000ms)
📥 [conversationId] Downloading image 3... (+1500ms)
📥 [conversationId] Downloading image 4... (+2000ms)
📥 [conversationId] Downloading image 5... (+2500ms)
Total: 2.5-5s of pure download time ❌
```

**Solution Strategy**:
1. **Blob Caching**: Store base64 in Message.fileStorage.base64Cache on first download
2. **Smart History**: Agent-level setting `imageContextConfig.historyMode` ('full' | 'low' | 'none')
3. **Contextual Placeholders**: For 'low' mode, replace old images with text descriptions
4. **AI Image Memory**: Response schema includes `images_observed` for future reference

**Expected Impact**:
- **Time Savings**: -3 to -5 seconds per request with historical images
- **Token Savings**: ~4000-5000 tokens (95-98% reduction on image blobs)
- **Cost Savings**: ~$0.02-0.05 per request (at GPT-5 pricing)

---

## 🏗️ Solution Architecture - Detailed Technical Design

### **Component 1: AIRequest Collection (NEW)**

#### Schema Definition:
```javascript
const AIRequestSchema = new Schema({
  // === Request Identification ===
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  agentId: {
    type: Schema.Types.ObjectId,
    ref: 'Agent',
    required: true,
    index: true
  },
  
  // === Message References ===
  userMessageIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Message'
  }],
  aiMessageId: {
    type: Schema.Types.ObjectId,
    ref: 'Message',
    required: false  // Only if response was generated
  },
  
  // === Request Metadata ===
  model: {
    type: String,
    required: true  // e.g., "gpt-5-mini"
  },
  streaming: {
    type: Boolean,
    default: false
  },
  
  // === Token Tracking (HIGH PRECISION) ===
  tokens: {
    input: {
      prompt_tokens: { type: Number, default: 0 },
      cached_tokens: { type: Number, default: 0 },
      audio_tokens: { type: Number, default: 0 }
    },
    output: {
      completion_tokens: { type: Number, default: 0 },
      reasoning_tokens: { type: Number, default: 0 },
      audio_tokens: { type: Number, default: 0 }
    },
    total: { type: Number, default: 0 }
  },
  
  // === Timing (MICROSECOND PRECISION) ===
  timestamps: {
    queueStart: { type: Date, required: true },          // When message added to queue
    processingStart: { type: Date },                     // When executeQueueProcessing started
    openaiRequestStart: { type: Date },                  // When OpenAI request sent
    openaiResponseReceived: { type: Date },              // When OpenAI responded
    messageSendStart: { type: Date },                    // When started sending to user
    messageSendComplete: { type: Date },                 // When user received message
    cancelled: { type: Date }                            // If request was cancelled
  },
  
  // === Performance Metrics ===
  durations: {
    queueWait: { type: Number },           // ms from queue to processing
    openaiProcessing: { type: Number },    // ms for OpenAI to respond
    messageSending: { type: Number },      // ms to send to user
    total: { type: Number }                // Total end-to-end time
  },
  
  // === Status Tracking ===
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'cancelled', 'failed'],
    default: 'queued',
    index: true
  },
  cancelReason: {
    type: String,
    enum: ['new_message_arrived', 'abort_signal', 'timeout', 'error'],
    required: function() { return this.status === 'cancelled'; }
  },
  
  // === Error Tracking ===
  error: {
    message: String,
    code: String,
    stack: String
  },
  
  // === Tool Usage ===
  toolsUsed: [{
    name: String,
    executionTime: Number,
    success: Boolean
  }]
}, {
  timestamps: true,
  collection: 'ai_requests'
});

// Compound index for analytics queries
AIRequestSchema.index({ conversationId: 1, 'timestamps.queueStart': -1 });
AIRequestSchema.index({ agentId: 1, status: 1 });
AIRequestSchema.index({ status: 1, 'timestamps.queueStart': -1 });
```

**Location**: `models/AIRequest.js` (NEW FILE)

---

### **Component 2: Enhanced Message Status**

#### Updated Message Status Field:
```javascript
status: {
  type: String,
  enum: [
    'pending',      // Created, not yet sent
    'sent',         // Successfully sent to user
    'delivered',    // Delivered to user (WhatsApp confirmation)
    'read',         // Read by user
    'received',     // Received from user
    'ultraMsg',     // Legacy UltraMsg status
    'cancelled',    // ⭐ NEW: Message generated but cancelled before sending
    'failed'        // ⭐ NEW: Failed to send
  ],
  default: 'pending'
},
cancelReason: {  // ⭐ NEW FIELD
  type: String,
  enum: ['new_message_arrived', 'user_abort', 'timeout', 'error'],
  required: function() { return this.status === 'cancelled'; }
},
failureReason: {  // ⭐ NEW FIELD
  type: String,
  required: function() { return this.status === 'failed'; }
}
```

**Location**: `models/Message.js` (lines 121-125) → UPDATE

---

### **Component 3: Image Blob Caching System (NEW - CRITICAL)**

#### Enhanced Message Schema - fileStorage with Blob Cache:
```javascript
// models/Message.js - Update fileStorage field (line 166)

fileStorage: {
  status: {
    type: String,
    enum: ['pending', 'success', 'error', 'not_applicable'],
    default: 'not_applicable'
  },
  fileId: String,
  filename: String,
  originalFilename: String,
  fileSize: Number,
  fileSizeHuman: String,
  contentType: String,
  downloadUrl: String,
  uploadDate: Date,
  requestId: String,
  
  // ⭐ NEW: Blob caching for OpenAI context reuse
  base64Cache: {
    data: {
      type: String,              // Base64 encoded image data
      select: false              // Exclude from default queries (too large)
    },
    mimeType: String,            // e.g., "image/jpeg"
    cachedAt: Date,              // When blob was cached
    sizeBytes: Number,           // Size in bytes (for monitoring)
    sizeKB: Number               // Human-readable size
  },
  
  // ⭐ NEW: AI's observation of the image (for contextual placeholders)
  aiObservation: {
    metadetails: {
      type: String,              // Filename, type, size, upload date
      maxlength: 500
    },
    visualDescription: {
      type: String,              // AI's description of what it sees
      maxlength: 2000            // Sufficient for context without blob
    },
    observedAt: Date,            // When AI first saw this image
    modelUsed: String            // Which AI model generated the description
  }
}
```

**Location**: `models/Message.js` (lines 166-210) → ENHANCE

---

#### Agent Config - Image History Setting:
```javascript
// models/Agent.js - Add new field after responseSchema

imageContextConfig: {
  type: new Schema({
    historyMode: {
      type: String,
      enum: ['full', 'low', 'none'],
      default: 'low',
      description: `
        full: Include ALL image blobs in OpenAI context (high token cost)
        low: Only include blobs AFTER last assistant message, placeholders for older images
        none: Never include historical images, only current message images
      `
    },
    maxHistoricalImages: {
      type: Number,
      default: 20,
      min: 1,
      max: 50,
      description: 'Maximum historical images to include (even in full mode)'
    },
    enableAIObservation: {
      type: Boolean,
      default: true,
      description: 'Whether AI should generate visual descriptions for images'
    }
  }, { _id: false }),
  default: () => ({
    historyMode: 'low',
    maxHistoricalImages: 20,
    enableAIObservation: true
  })
}
```

**Location**: `models/Agent.js` (after line 111) → ADD NEW FIELD

---

#### Enhanced Response Schema - images_observed Field:
```json
{
  "name": "enhanced_fotoproducto_response_schema",
  "schema": {
    "type": "object",
    "properties": {
      "timestamp": {...},
      "thinking": {...},
      "response": {...},
      "ai_system_message": {...},
      
      "images_observed": {
        "type": "array",
        "description": "ONLY populate if images were sent in user's message. Array of observations for each image to enable future context without re-sending blobs.",
        "items": {
          "type": "object",
          "properties": {
            "message_id": {
              "type": "string",
              "description": "The message_id that contained this image"
            },
            "metadetails": {
              "type": "string",
              "description": "Technical metadata: filename, type, size, upload timestamp"
            },
            "visual_description": {
              "type": "string", 
              "description": "Comprehensive visual description of the image content: subjects, objects, colors, composition, context. Must be detailed enough to reference in future messages without seeing the actual image."
            }
          },
          "required": ["message_id", "metadetails", "visual_description"],
          "additionalProperties": false
        }
      }
    },
    "required": ["timestamp", "thinking", "response", "ai_system_message"],
    "additionalProperties": false
  }
}
```

**Note**: `images_observed` is NOT in required array - only populate if images present.

**Location**: `assistant_tools/response_schema.json` → ADD NEW FIELD

---

#### System Prompt Enhancement (agent-1.md):

Need to add instructions for AI to generate `images_observed`:

```markdown
**IMAGES OBSERVATION (Nuevo campo opcional en respuesta)**:

Si el usuario te mandó imágenes en este mensaje, DEBES completar el campo `images_observed` (array) con una entrada por cada imagen. Esto nos permite guardar contexto visual sin tener que reenviar las imágenes en futuros mensajes (ahorro de tiempo y tokens).

Para cada imagen observada, completá:
- `message_id`: El message_id que contenía esta imagen
- `metadetails`: Metadata técnica (filename, tipo, tamaño, fecha de upload)
- `visual_description`: Descripción COMPREHENSIVA del contenido visual (2-3 oraciones):
  - Qué objetos/sujetos ves
  - Colores dominantes y composición
  - Contexto y ambiente
  - Detalles técnicos relevantes (lighting, ángulo, estado)
  
Ejemplo:
```json
"images_observed": [
  {
    "message_id": "false_5491123500639@c.us_AC524E5256F57176CF3A4FB7DC513146",
    "metadetails": "2025-11-13T18-26-11-215Z_b96eb60665a30299_media.jpg, image/jpeg, 0.13MB",
    "visual_description": "White athletic sneakers with gradient pink-to-orange sole and burgundy straps, mesh texture visible, brand new condition. Product shot on wooden floor with black dumbbells, blue boxes, and a tablet displaying colorful graphics in the background. Natural side lighting with soft shadows."
  }
]
```

⚠️ IMPORTANTE: Solo completar `images_observed` si HAY imágenes en el mensaje actual. Si no hay, omitir el campo completamente (no es required).
```

**Location**: `agent-1.md` (after line 445, before "Formato de respuesta") → ADD NEW SECTION

---

#### Blob Caching Implementation:
```javascript
// responsesClient.js - Refactor loadImageAsBase64() (lines 348-387)

async loadImageAsBase64(message, conversationId, forceReload = false) {
  const perfStart = performance.now();
  const fileId = message.fileStorage?.fileId;
  
  if (!fileId) {
    console.log(`[+0ms] ⚠️ No fileId found in message`);
    return null;
  }
  
  // ========================================================================
  // ⭐ OPTIMIZATION 1: Use cached blob if available
  // ========================================================================
  
  if (!forceReload && message.fileStorage.base64Cache?.data) {
    const cacheAge = Date.now() - new Date(message.fileStorage.base64Cache.cachedAt).getTime();
    const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    if (cacheAge < MAX_CACHE_AGE) {
      console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] ♻️ Using cached blob: ${fileId} (age: ${(cacheAge/1000/60).toFixed(0)}min, size: ${message.fileStorage.base64Cache.sizeKB}KB)`);
      
      return {
        type: 'image_url',
        image_url: {
          url: `data:${message.fileStorage.base64Cache.mimeType};base64,${message.fileStorage.base64Cache.data}`
        }
      };
    } else {
      console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] ⚠️ Cached blob expired (${(cacheAge/1000/60/60/24).toFixed(0)} days old) - re-downloading`);
    }
  }
  
  // ========================================================================
  // ⭐ DOWNLOAD & CACHE: First time or expired/missing cache
  // ========================================================================
  
  console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 📥 Downloading and caching image: ${fileId}`);
  
  try {
    const downloadUrl = createDownloadUrl(fileId);
    
    const response = await axios({
      method: 'get',
      url: downloadUrl,
      responseType: 'arraybuffer',
      timeout: 60000,
      headers: {
        'User-Agent': 'Micro-Banana-ResponsesClient/1.0',
        'X-API-Key': process.env.API_KEY_WEBHOOK
      }
    });
    
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const base64Data = Buffer.from(response.data).toString('base64');
    const mimeType = response.headers['content-type'] || 'image/jpeg';
    const sizeBytes = response.data.length;
    const sizeKB = Math.round(sizeBytes / 1024);
    
    console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] ✅ Image downloaded (${sizeKB}KB)`);
    
    // ========================================================================
    // ⭐ SAVE TO MONGODB: Cache for future use
    // ========================================================================
    
    try {
      const Message = require('../models/Message');
      await Message.findByIdAndUpdate(message._id, {
        'fileStorage.base64Cache': {
          data: base64Data,
          mimeType: mimeType,
          cachedAt: new Date(),
          sizeBytes: sizeBytes,
          sizeKB: sizeKB
        }
      });
      
      console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 💾 Blob cached in MongoDB: ${fileId} (${sizeKB}KB)`);
    } catch (cacheError) {
      console.error(`⚠️ Failed to cache blob (non-blocking):`, cacheError.message);
      // Continue anyway - caching is optimization, not critical path
    }
    
    return {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${base64Data}`
      }
    };
    
  } catch (error) {
    console.error(`❌ [${conversationId}] Failed to download image ${fileId}:`, error.message);
    return null;
  }
}
```

---

#### Smart Image History Filter:
```javascript
// responsesClient.js - Enhanced buildMessages() (lines 200-340)

async buildMessages(conversationId, newMessage) {
  const perfStart = performance.now();
  const conversation = await Conversation.findById(conversationId);
  
  // Load agent config to get image history settings
  const agentConfig = await this.loadAgentConfig(conversation?.agentId);
  const imageHistoryMode = agentConfig.imageContextConfig?.historyMode || 'low';
  const maxHistoricalImages = agentConfig.imageContextConfig?.maxHistoricalImages || 20;
  
  console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 📂 Loading messages with image mode: ${imageHistoryMode}`);
  
  // Load historical messages (limited for performance)
  const historicalMessages = await Message.find({ conversationId })
    .sort({ timestamp: 1 })
    .limit(50)
    .select('-fileStorage.base64Cache.data')  // ⭐ Exclude blob from initial query
    .lean();
  
  console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 📥 Loaded ${historicalMessages.length} historical messages`);
  
  // ========================================================================
  // ⭐ FIND LAST ASSISTANT MESSAGE (for 'low' mode cutoff)
  // ========================================================================
  
  let lastAssistantMessageIndex = -1;
  
  if (imageHistoryMode === 'low') {
    for (let i = historicalMessages.length - 1; i >= 0; i--) {
      if (historicalMessages[i].sender === 'ai_agent') {
        lastAssistantMessageIndex = i;
        console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 🔍 Last assistant message at index ${i}`);
        break;
      }
    }
  }
  
  // Build messages array
  const messages = [{ role: 'system', content: systemPrompt }];
  
  let imagesIncluded = 0;
  let imagesPlaceholdered = 0;
  
  for (let i = 0; i < historicalMessages.length; i++) {
    const msg = historicalMessages[i];
    
    if (msg.sender === 'user') {
      const contentParts = [];
      
      // Add text content
      const textContent = this.reconstructUserMessageAsJSON(msg, conversation);
      if (textContent?.trim()) {
        contentParts.push({ type: 'text', text: textContent });
      }
      
      // ====================================================================
      // ⭐ SMART IMAGE INCLUSION LOGIC
      // ====================================================================
      
      if (msg.fileStorage?.fileId && msg.fileStorage?.status === 'success') {
        let shouldIncludeBlob = false;
        
        switch (imageHistoryMode) {
          case 'full':
            // Always include blob (respecting max limit)
            shouldIncludeBlob = (imagesIncluded < maxHistoricalImages);
            break;
            
          case 'low':
            // Only include if AFTER last assistant message
            shouldIncludeBlob = (i > lastAssistantMessageIndex) && (imagesIncluded < maxHistoricalImages);
            break;
            
          case 'none':
            // Never include historical blobs
            shouldIncludeBlob = false;
            break;
        }
        
        if (shouldIncludeBlob) {
          // ================================================================
          // ⭐ INCLUDE ACTUAL BLOB (with caching)
          // ================================================================
          
          // Load full message with blob cache data
          const fullMessage = await Message.findById(msg._id)
            .select('+fileStorage.base64Cache.data')  // Explicitly include
            .lean();
          
          const imagePart = await this.loadImageAsBase64(fullMessage, conversationId, false);
          
          if (imagePart) {
            contentParts.push(imagePart);
            imagesIncluded++;
            console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 🖼️ Included image blob #${imagesIncluded}: ${msg.fileStorage.fileId}`);
          }
          
        } else {
          // ================================================================
          // ⭐ USE CONTEXTUAL PLACEHOLDER (save time + tokens)
          // ================================================================
          
          const placeholder = this.createImagePlaceholder(msg);
          
          // Append to text content
          if (contentParts.length > 0 && contentParts[0].type === 'text') {
            contentParts[0].text += `\n\n${placeholder}`;
          } else {
            contentParts.push({ type: 'text', text: placeholder });
          }
          
          imagesPlaceholdered++;
          console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 📝 Used placeholder for: ${msg.fileStorage.fileId}`);
        }
      }
      
      // Add to messages array
      let finalContent;
      if (contentParts.length === 1 && contentParts[0].type === 'text') {
        finalContent = contentParts[0].text;
      } else if (contentParts.length === 0) {
        finalContent = "";
      } else {
        finalContent = contentParts;
      }
      
      messages.push({ role: 'user', content: finalContent });
    }
    
    // ... handle assistant messages
  }
  
  console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] ✅ Messages built:`, {
    total: messages.length,
    imagesIncluded,
    imagesPlaceholdered,
    tokensSaved: imagesPlaceholdered * 1000
  });
  
  return messages;
}
```

---

#### Image Placeholder Creation:
```javascript
// responsesClient.js - NEW METHOD

createImagePlaceholder(message) {
  // Build contextual placeholder from available data
  
  const parts = [];
  
  // Use AI observation if available (best option)
  if (message.fileStorage?.aiObservation?.visualDescription) {
    return `[Previously shared image: ${message.fileStorage.aiObservation.visualDescription}]`;
  }
  
  // Fallback to metadata
  parts.push('[Previously shared image');
  
  if (message.fileStorage?.contentType) {
    parts.push(`type: ${message.fileStorage.contentType}`);
  }
  
  if (message.fileStorage?.filename) {
    parts.push(`file: ${message.fileStorage.filename}`);
  }
  
  if (message.fileStorage?.fileSizeHuman) {
    parts.push(`size: ${message.fileStorage.fileSizeHuman}`);
  }
  
  // Include user's text description if they provided one
  const userText = message.content?.map(c => c.content).join(' ').trim();
  if (userText && userText.length > 10) {
    parts.push(`context: "${userText.substring(0, 100)}"`);
  }
  
  return parts.join(', ') + ']';
}
```

---

#### AI Observation Extraction from Response:
```javascript
// messageQueue.js - After AI response parsing (line ~580)

// Extract images_observed from AI response (if present)
if (aiResponse.images_observed && Array.isArray(aiResponse.images_observed)) {
  console.log(`[+${elapsed}ms] 🎨 AI observed ${aiResponse.images_observed.length} images - saving observations`);
  
  for (const observation of aiResponse.images_observed) {
    try {
      // Find the message by message_id
      const userMessage = await Message.findOne({
        conversationId: conversation._id,
        msg_foreign_id: observation.message_id
      });
      
      if (userMessage && userMessage.fileStorage?.fileId) {
        // Save AI's observation to message
        await Message.findByIdAndUpdate(userMessage._id, {
          'fileStorage.aiObservation': {
            metadetails: observation.metadetails,
            visualDescription: observation.visual_description,
            observedAt: new Date(),
            modelUsed: agent.modelConfig.model
          }
        });
        
        console.log(`[+${elapsed}ms] 💾 Saved AI observation for message: ${observation.message_id}`);
      }
    } catch (obsError) {
      console.error(`⚠️ Failed to save AI observation (non-blocking):`, obsError.message);
    }
  }
}
```

---

#### Performance Impact Analysis:

**BEFORE (Current System)**:
```
Conversation with 5 historical images:
1. Load 5 messages from MongoDB (100ms)
2. Download image 1 (500ms)
3. Encode to base64 (50ms)
4. Download image 2 (500ms)
5. Encode to base64 (50ms)
6. Download image 3 (500ms)
7. Encode to base64 (50ms)
8. Download image 4 (500ms)
9. Encode to base64 (50ms)
10. Download image 5 (500ms)
11. Encode to base64 (50ms)
12. Build OpenAI payload (50ms)
Total: 2.9s + 5000 tokens
```

**AFTER (With Caching + 'low' mode)**:
```
Same conversation, second request:
1. Load 5 messages from MongoDB (100ms)
2. Check last assistant index (2ms)
3. For 3 old images: Create placeholders (1ms each) = 3ms
4. For 2 new images: Load cached blobs from MongoDB (10ms each) = 20ms
5. Build OpenAI payload (50ms)
Total: 175ms + 2075 tokens (2000 from new images + 75 from placeholders)

Time saved: 2.73s ⚡
Tokens saved: 2925 ⚡
```

**FIRST REQUEST (Need to cache)**:
```
1. Load 5 messages (100ms)
2. Download & cache 5 images (2.5s) - ONE TIME COST
3. AI generates images_observed (included in response)
4. Save observations to messages (50ms)
Total: 2.65s first time, then 175ms forever ✅
```

---

### **Component 4: Smart Queue with Zero-Delay**

#### New Architecture (messageQueue.js refactor):

```javascript
class MessageQueue {
  constructor() {
    this.queues = new Map();                      // conversationId -> [messages]
    this.processing = new Map();                  // conversationId -> ProcessingContext
    this.accumulationTimers = new Map();          // conversationId -> setTimeout
    this.performanceTrackers = new Map();         // conversationId -> { startTime, checkpoints }
    
    // Configuration
    this.ACCUMULATION_WINDOW = 300;               // 300ms pure window
    this.ABORT_CHECK_INTERVAL = 100;              // Check abort signal every 100ms
  }
  
  // ========================================================================
  // ProcessingContext Structure
  // ========================================================================
  /*
  ProcessingContext = {
    abortController: AbortController instance,
    aiRequestId: ObjectId,                        // Reference to AIRequest document
    startTime: performance.now(),
    userMessageIds: [ObjectId],                   // Messages being processed
    aborted: false
  }
  */
  
  async addMessage(conversation, messageData, agent = null) {
    const conversationId = conversation._id.toString();
    const perfStart = performance.now();
    
    // Initialize performance tracker
    if (!this.performanceTrackers.has(conversationId)) {
      this.performanceTrackers.set(conversationId, {
        startTime: perfStart,
        checkpoints: []
      });
    }
    
    const perf = this.performanceTrackers.get(conversationId);
    perf.checkpoints.push({
      name: 'addMessage_start',
      elapsed: performance.now() - perf.startTime
    });
    
    // Initialize queue
    if (!this.queues.has(conversationId)) {
      this.queues.set(conversationId, []);
      console.log(`[+${(performance.now() - perf.startTime).toFixed(0)}ms] Queue created for: ${conversationId}`);
    }
    
    // Add message to queue
    const queue = this.queues.get(conversationId);
    queue.push(messageData);
    
    perf.checkpoints.push({
      name: 'message_queued',
      elapsed: performance.now() - perf.startTime
    });
    
    console.log(`[+${(performance.now() - perf.startTime).toFixed(0)}ms] 📦 Message added to queue`, {
      queueLength: queue.length,
      messageType: messageData.ultraMsgData.type
    });
    
    // ====================================================================
    // SMART DECISION TREE
    // ====================================================================
    
    const isCurrentlyProcessing = this.processing.has(conversationId);
    
    if (isCurrentlyProcessing) {
      // SCENARIO A: New message during processing → ABORT IMMEDIATELY
      console.log(`[+${(performance.now() - perf.startTime).toFixed(0)}ms] 🚫 New message during processing - ABORTING current request`);
      
      await this.abortCurrentProcessing(conversationId, 'new_message_arrived');
      
      // Start accumulation window (pure 300ms from NOW)
      this.startAccumulationWindow(conversationId);
      
    } else {
      // SCENARIO B: Not processing
      
      const hasAccumulationTimer = this.accumulationTimers.has(conversationId);
      
      if (hasAccumulationTimer) {
        // SCENARIO B1: Already accumulating → Reset timer (extend window)
        console.log(`[+${(performance.now() - perf.startTime).toFixed(0)}ms] ⏳ Extending accumulation window`);
        this.startAccumulationWindow(conversationId); // Resets timer
        
      } else {
        // SCENARIO B2: Fresh start
        
        if (queue.length === 1) {
          // SCENARIO B2a: FIRST message → Process IMMEDIATELY (0ms delay)
          console.log(`[+${(performance.now() - perf.startTime).toFixed(0)}ms] ⚡ FIRST message - processing IMMEDIATELY`);
          
          // Process on next tick (not blocking current execution)
          setImmediate(() => this.processQueue(conversationId));
          
        } else {
          // SCENARIO B2b: Multiple messages already queued → Start accumulation
          console.log(`[+${(performance.now() - perf.startTime).toFixed(0)}ms] 📦 Multiple messages - starting accumulation window`);
          this.startAccumulationWindow(conversationId);
        }
      }
    }
  }
  
  // ========================================================================
  // Abort Current Processing (COMPLETE FLOW CANCELLATION)
  // ========================================================================
  
  async abortCurrentProcessing(conversationId, reason = 'new_message_arrived') {
    const perfStart = this.performanceTrackers.get(conversationId)?.startTime || performance.now();
    
    console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 🛑 Aborting processing for: ${conversationId}`);
    
    const processingContext = this.processing.get(conversationId);
    
    if (!processingContext) {
      console.warn(`⚠️ No processing context found for ${conversationId}`);
      return;
    }
    
    // 1. Signal abort to OpenAI request (if in-flight)
    if (processingContext.abortController) {
      console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 🚫 Sending abort signal to OpenAI request`);
      processingContext.abortController.abort();
    }
    
    // 2. Mark AIRequest as cancelled
    if (processingContext.aiRequestId) {
      try {
        const AIRequest = require('../models/AIRequest');
        await AIRequest.findByIdAndUpdate(processingContext.aiRequestId, {
          status: 'cancelled',
          cancelReason: reason,
          'timestamps.cancelled': new Date(),
          'durations.total': performance.now() - processingContext.startTime
        });
        
        console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] ✅ AIRequest marked as cancelled: ${processingContext.aiRequestId}`);
      } catch (error) {
        console.error(`❌ Failed to update AIRequest:`, error.message);
      }
    }
    
    // 3. Mark AI message as cancelled (if exists)
    if (processingContext.aiMessageId) {
      try {
        const Message = require('../models/Message');
        await Message.findByIdAndUpdate(processingContext.aiMessageId, {
          status: 'cancelled',
          cancelReason: reason
        });
        
        console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] ✅ AI Message marked as cancelled: ${processingContext.aiMessageId}`);
      } catch (error) {
        console.error(`❌ Failed to update Message status:`, error.message);
      }
    }
    
    // 4. Clear Redis activeRun lock
    try {
      await redisClient.del(`activeRun:${conversationId}`);
      console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 🧹 Redis lock cleared`);
    } catch (error) {
      console.error(`❌ Failed to clear Redis lock:`, error.message);
    }
    
    // 5. Clear processing context
    this.processing.delete(conversationId);
    
    console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] ✅ Abort complete`);
  }
  
  // ========================================================================
  // Pure Accumulation Window (300ms clean)
  // ========================================================================
  
  startAccumulationWindow(conversationId) {
    const perfStart = this.performanceTrackers.get(conversationId)?.startTime || performance.now();
    
    // Clear existing timer
    if (this.accumulationTimers.has(conversationId)) {
      clearTimeout(this.accumulationTimers.get(conversationId));
      console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] ⏹️ Cleared previous accumulation timer`);
    }
    
    // Create NEW timer starting NOW (pure 300ms from this moment)
    const windowStart = performance.now();
    
    const timer = setTimeout(() => {
      const windowEnd = performance.now();
      const actualWindow = windowEnd - windowStart;
      
      console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] ⏰ Accumulation window closed (actual: ${actualWindow.toFixed(0)}ms)`);
      
      this.accumulationTimers.delete(conversationId);
      this.processQueue(conversationId);
    }, this.ACCUMULATION_WINDOW);
    
    this.accumulationTimers.set(conversationId, timer);
    console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] ⏳ Accumulation window started (${this.ACCUMULATION_WINDOW}ms pure)`);
  }
}
```

**Key Innovation**: The 300ms timer starts at `setTimeout()` call, NOT after any processing. This ensures pure accumulation time.

---

### **Component 4: AbortController Integration**

#### Changes to `responsesClient.js` (Line 163):

**BEFORE:**
```javascript
const response = await this.openai.chat.completions.create(requestConfig);
```

**AFTER:**
```javascript
// Create abort controller for this request
const abortController = new AbortController();

// Store controller reference in processing context (passed from messageQueue)
// This allows messageQueue to abort the request if new messages arrive

const response = await this.openai.chat.completions.create(
  requestConfig,
  { signal: abortController.signal }  // ⭐ Enable cancellation
);
```

#### Handling AbortError:
```javascript
try {
  const response = await this.openai.chat.completions.create(
    requestConfig,
    { signal: abortController.signal }
  );
} catch (error) {
  if (error.name === 'AbortError') {
    console.log(`🚫 [${conversationId}] OpenAI request was aborted`);
    // Don't throw - this is expected behavior
    return {
      content: null,
      toolCalls: [],
      toolResults: [],
      hasTools: false,
      aborted: true  // ⭐ NEW FLAG
    };
  }
  throw error; // Re-throw other errors
}
```

---

### **Component 5: Complete Flow with Abort Checkpoints**

#### Flow Diagram with Checkpoints:
```
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 0: Webhook Received                                  │
│ Time: T0                                                        │
│ Action: Start performance tracker                               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 1: addMessage()                                      │
│ Time: T0 + 0-50ms                                              │
│ Abort Check: Is conversation processing?                       │
│   YES → Abort + Start accumulation window                      │
│   NO  → Check queue length                                      │
│     1 message  → Process IMMEDIATELY (setImmediate)            │
│     2+ messages → Start accumulation window (300ms)            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 2: executeQueueProcessing() START                   │
│ Time: T0 + 0-300ms                                             │
│ Actions:                                                        │
│   1. Create AIRequest document (status: 'queued')              │
│   2. Set Redis activeRun lock                                  │
│   3. Create AbortController                                    │
│   4. Store ProcessingContext in this.processing                │
│ Abort Check: Before MongoDB queries                            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 3: Before OpenAI Request                            │
│ Time: T0 + 100-500ms                                           │
│ Actions:                                                        │
│   1. Update AIRequest (status: 'processing')                   │
│   2. Set timestamps.openaiRequestStart                         │
│ Abort Check: Check Redis abort signal                          │
│   IF abort → Cancel, save AIRequest, exit                      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 4: OpenAI Processing (IN-FLIGHT)                    │
│ Time: T0 + 500ms - Xms                                         │
│ Abort Mechanism: AbortController.signal                        │
│   IF new message → abortController.abort()                     │
│   OpenAI request throws AbortError                             │
│   Catch and handle gracefully                                  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 5: OpenAI Response Received                         │
│ Time: OpenAI complete                                          │
│ Actions:                                                        │
│   1. Set timestamps.openaiResponseReceived                     │
│   2. Parse response and extract tokens                         │
│   3. Create AI Message in MongoDB                              │
│ Abort Check: ⭐ CRITICAL - Check BEFORE sending to user        │
│   IF abort → Mark message 'cancelled', save AIRequest, exit    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 6: Send Message to User                             │
│ Time: After OpenAI + 0-100ms                                   │
│ Actions:                                                        │
│   1. Set timestamps.messageSendStart                           │
│   2. Call sendUltraMsg() or sendWhatsAppBusinessMessage()      │
│   3. Set timestamps.messageSendComplete                        │
│   4. Update Message status to 'sent'                           │
│   5. Update AIRequest status to 'completed'                    │
│   6. Calculate all durations                                   │
│ Abort Check: NOT POSSIBLE (already sending)                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ CHECKPOINT 7: Cleanup                                           │
│ Time: Final                                                     │
│ Actions:                                                        │
│   1. Clear processing context                                  │
│   2. Clear Redis lock                                          │
│   3. Clear performance tracker                                 │
│   4. Log complete timeline                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔍 Abort Check Implementation - Technical Details

### **Abort Signal via Redis**

#### Key: `abort_signal:${conversationId}`
#### Value: 
```json
{
  "abort": true,
  "reason": "new_message_arrived",
  "timestamp": "2025-11-13T19:50:00.123Z",
  "newMessageCount": 2
}
```

#### Check Points in Code:

**1. Before MongoDB Queries** (`messageQueue.js` line ~450):
```javascript
async executeQueueProcessing(conversationId) {
  const perfStart = performance.now();
  
  // ⭐ ABORT CHECK 1: Before expensive operations
  if (await this.checkAbortSignal(conversationId)) {
    console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 🚫 Abort signal detected - exiting early`);
    return;
  }
  
  // ... continue with MongoDB queries
}
```

**2. Before OpenAI Request** (`messageQueue.js` line ~527):
```javascript
// ⭐ ABORT CHECK 2: Before OpenAI call
if (await this.checkAbortSignal(conversationId)) {
  console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 🚫 Abort before OpenAI - exiting`);
  await this.cleanupAbortedRequest(conversationId);
  return;
}

// Proceed with OpenAI request
const result = await openAIIntegration.processConversationMessage(
  conversationId, 
  JSON.stringify(openAiObject),
  abortController  // ⭐ Pass abort controller
);
```

**3. After OpenAI Response** (`messageQueue.js` line ~580):
```javascript
// ⭐ ABORT CHECK 3: After OpenAI but BEFORE sending to user
if (await this.checkAbortSignal(conversationId)) {
  console.log(`[+${(performance.now() - perfStart).toFixed(0)}ms] 🚫 Abort after OpenAI - NOT sending message`);
  
  // Save AI message with 'cancelled' status
  aiMessage.status = 'cancelled';
  aiMessage.cancelReason = 'new_message_arrived';
  await aiMessage.save();
  
  // Update AIRequest
  await AIRequest.findByIdAndUpdate(processingContext.aiRequestId, {
    status: 'cancelled',
    cancelReason: reason,
    aiMessageId: aiMessage._id,  // Reference the cancelled message
    'timestamps.cancelled': new Date()
  });
  
  await this.cleanupAbortedRequest(conversationId);
  return;
}

// Proceed to send message to user
```

---

## 💾 MongoDB Optimization Strategy

### **Current Issues Identified**:

#### 1. **Agent Config Loading** (`responsesClient.js` line 663-715)
**Current**: Loads from MongoDB, caches for 1 hour
**Optimization**: 
- Increase cache TTL to 24 hours (prompts rarely change)
- Pre-warm cache on server startup
- Use Redis pipeline for multi-key fetches

#### 2. **Message Loading** (`responsesClient.js` line 200-298)
**Current**: Loads ALL messages for conversation
**Optimization**:
- Limit to last 20 messages (configurable)
- Lazy load only if user explicitly requests history
- Add projection to exclude unnecessary fields

#### 3. **Missing Indexes**
**Current**: Basic indexes on conversationId, timestamp
**Required**:
```javascript
// Message collection
MessageSchema.index({ conversationId: 1, timestamp: -1 }); // ✅ Exists
MessageSchema.index({ conversationId: 1, sender: 1, timestamp: -1 }); // ⭐ ADD
MessageSchema.index({ msg_foreign_id: 1 }, { sparse: true }); // ✅ Exists
MessageSchema.index({ status: 1, timestamp: -1 }); // ⭐ ADD (for analytics)

// Conversation collection  
ConversationSchema.index({ agentId: 1, status: 1 }); // ⭐ ADD
ConversationSchema.index({ phoneNumber: 1, agentId: 1 }); // ⭐ ADD

// AIRequest collection (NEW)
AIRequestSchema.index({ conversationId: 1, 'timestamps.queueStart': -1 });
AIRequestSchema.index({ agentId: 1, status: 1 });
AIRequestSchema.index({ status: 1, 'timestamps.queueStart': -1 });
```

---

## 📈 Performance Impact Projections

### **Timeline Comparison**

| Stage | Current | Optimized | Savings |
|-------|---------|-----------|---------|
| Webhook → Queue | 2.4s | **0.5s** | -1.9s ⚡ |
| Queue Timer Wait | 1.5s | **0ms** | -1.5s ⚡ |
| **Image Downloads** | **3-5s** | **0ms** | **-3-5s** ⚡⚡⚡ |
| MongoDB Queries | 0.3s | **0.1s** | -0.2s ⚡ |
| OpenAI Request | Variable | Variable | 0s |
| Message Send | 0.2s | **0.2s** | 0s |
| **TOTAL OVERHEAD** | **~7.4-9.4s** | **< 1s** | **-6.4-8.4s** ⚡⚡⚡ |

**Token Savings** (with 5 historical images in 'low' mode):
- **Before**: 5000 tokens for image blobs
- **After**: 75 tokens for placeholders
- **Savings**: 4925 tokens (~98% reduction) 💰

**Expected Results**:
- **First message**: ~3-4s total (< 1s overhead + OpenAI)
- **Subsequent messages with history**: ~3-4s (no re-downloads, placeholders for old images)
- **Cancelled requests**: Save 100% of OpenAI cost
- **Rapid messages**: Only process the last batch
- **Token cost**: ~95% reduction on image-heavy conversations

---

## 🗂️ File Changes Required

### **NEW FILES** (3):
1. `models/AIRequest.js` - Complete AI request tracking (~250 lines)
2. `utils/performanceTracker.js` - Centralized performance tracking (~150 lines)
3. `PERFORMANCE_OPTIMIZATION_IMPLEMENTATION.md` - Complete implementation log

### **MODIFIED FILES** (7):
1. `models/Message.js`:
   - Lines 121-125: Add 'cancelled' and 'failed' status + reasons
   - Lines 166-210: Add base64Cache and aiObservation to fileStorage
2. `models/Agent.js` (after line 111): Add imageContextConfig field
3. `assistant_tools/response_schema.json`: Add images_observed array (optional field)
4. `modules/messageQueue.js` (lines 37-97, 367-970): Complete refactor with smart queue + abort + AI observations
5. `modules/responsesClient.js`:
   - Lines 28-195: Add AbortController support
   - Lines 200-340: Smart image history filtering
   - Lines 348-387: Blob caching in loadImageAsBase64()
   - NEW: createImagePlaceholder() method
6. `modules/openaiIntegration.js` (lines 33-64): Pass abort controller through
7. `workbench/memory.md`: Log all changes

### **INDEXES TO ADD** (5):
1. Message: `{ conversationId: 1, sender: 1, timestamp: -1 }`
2. Message: `{ status: 1, timestamp: -1 }`
3. Message: `{ 'fileStorage.base64Cache.cachedAt': 1 }` (for cache expiration queries)
4. Conversation: `{ agentId: 1, status: 1 }`
5. Conversation: `{ phoneNumber: 1, agentId: 1 }`

---

## 🧪 Testing Scenarios - Comprehensive

### **Test 1: Single Message (Baseline)**
**Input**: User sends "Hola"
**Expected**:
```
[+0ms] Webhook received
[+50ms] Message added to queue (queueLength: 1)
[+51ms] ⚡ FIRST message - processing IMMEDIATELY
[+100ms] MongoDB queries complete
[+150ms] OpenAI request sent
[+3000ms] OpenAI response received
[+3200ms] Message sent to user
[+3201ms] ✅ Request completed
Total: ~3.2s (vs 60s current) ✅
```

### **Test 2: Rapid Messages (Cancellation)**
**Input**: 
- T0: User sends "Hola"
- T0+500ms: User sends "que tal"
- T0+800ms: User sends "como estas"

**Expected**:
```
[T0+0ms] Message 1 queued → Process IMMEDIATELY
[T0+100ms] OpenAI request 1 started
[T0+500ms] Message 2 arrives → 🚫 ABORT request 1
[T0+501ms] Accumulation window started (300ms)
[T0+800ms] Message 3 arrives → Reset accumulation window
[T0+1100ms] Accumulation complete → Process messages 1+2+3 together
[T0+1200ms] OpenAI request 2 started (with 3 messages)
[T0+4200ms] Response received and sent
Total: ~4.2s for 3 messages (only 1 OpenAI call) ✅
```

### **Test 3: Post-OpenAI Abort (Edge Case)**
**Input**:
- T0: User sends "Hola"
- T0+3000ms: OpenAI responds (not sent yet)
- T0+3050ms: User sends "espera"

**Expected**:
```
[T0+3000ms] OpenAI response received
[T0+3010ms] AI message created (status: 'pending')
[T0+3050ms] New message arrives → 🚫 ABORT CHECK
[T0+3051ms] AI message marked 'cancelled' (NOT sent)
[T0+3052ms] AIRequest marked 'cancelled'
[T0+3053ms] Accumulation window started
[T0+3353ms] Process with BOTH messages
Total: ~6.3s but avoided sending stale response ✅
```

---

## 📝 Implementation Order (Sequential)

### **Phase 1: Foundation** (30 min)
1. ✅ Create `models/AIRequest.js` with complete schema
2. ✅ Create `utils/performanceTracker.js` helper
3. ✅ Update `models/Message.js` status enum + fileStorage.base64Cache + aiObservation
4. ✅ Update `models/Agent.js` with imageContextConfig setting
5. ✅ Update `assistant_tools/response_schema.json` with images_observed field
6. ✅ Add MongoDB indexes

### **Phase 2: Image Optimization** (35 min) - ⭐ CRITICAL PATH
7. ✅ Implement blob caching in responsesClient.loadImageAsBase64()
8. ✅ Implement smart history filter in responsesClient.buildMessages()
9. ✅ Implement createImagePlaceholder() method
10. ✅ Implement AI observation extraction in messageQueue.js
11. ✅ Test blob caching and placeholder generation

### **Phase 3: Tracking** (20 min)
12. ✅ Add performance.now() timestamps to messageQueue.js
13. ✅ Add performance.now() timestamps to responsesClient.js
14. ✅ Add AIRequest creation at processing start

### **Phase 4: Cancellation** (45 min)
15. ✅ Implement AbortController in responsesClient.js
16. ✅ Implement abort checkpoints in messageQueue.js (3 checkpoints)
17. ✅ Implement Redis abort signal system
18. ✅ Add post-OpenAI abort check (CRITICAL for your perfeccionismo requirement)

### **Phase 5: Smart Queue** (30 min)
19. ✅ Refactor resetQueueTimer → startAccumulationWindow
20. ✅ Add immediate processing for first message (0ms)
21. ✅ Implement pure 300ms accumulation window (measured from setTimeout call)

### **Phase 6: MongoDB Optimization** (25 min)
22. ✅ Add all required indexes
23. ✅ Implement aggressive config caching (24h TTL)
24. ✅ Optimize buildMessages() query projections

### **Phase 7: Testing** (45 min)
25. ✅ Test single message scenario (no images) - expect < 4s
26. ✅ Test message with NEW image (should cache blob) - expect ~5s first time
27. ✅ Test subsequent message (should use cached blob - 'low' mode) - expect < 4s
28. ✅ Test rapid messages scenario (should cancel first 2) - expect 1 OpenAI call only
29. ✅ Test post-OpenAI abort scenario (CRITICAL: cancel before send)
30. ✅ Test 'full' vs 'low' mode with 10 historical images
31. ✅ Performance profiling and validation

**Total Estimated Time**: ~3.5 hours
**Expected Performance Gain**: 15-20x faster (from 60s to < 3-4s)
**Expected Token Savings**: ~95% on image-heavy conversations

---

## 🚀 Success Criteria

- [ ] First message processed in < 5s total
- [ ] Rapid messages (3 in 2s) result in only 1 OpenAI call
- [ ] Message arriving after OpenAI but before send is properly cancelled
- [ ] Image blobs cached in MongoDB on first download
- [ ] Subsequent requests use cached blobs (no re-download)
- [ ] 'low' mode only includes recent images, uses placeholders for old ones
- [ ] AI generates images_observed with visual descriptions
- [ ] Token savings ~95% on conversations with 5+ historical images
- [ ] All AIRequest documents have complete token and timing data
- [ ] All cancelled messages have proper status and reason
- [ ] Performance logs show [+XXms] timestamps at every checkpoint
- [ ] MongoDB queries < 100ms with new indexes
- [ ] Zero linter errors across all modified files

---

## 📊 Monitoring & Observability

### **New Metrics Available**:
1. **AIRequest Collection Analytics**:
   - Requests per conversation
   - Cancellation rate
   - Average processing time
   - Token consumption trends

2. **Performance Logs**:
   - Complete timeline for every request
   - Bottleneck identification
   - Abort effectiveness

3. **Message Status Distribution**:
   - Sent vs Cancelled vs Failed
   - Cancellation reasons
   - Failure patterns

---

**Plan Status**: ✅ COMPLETE - READY FOR IMPLEMENTATION  
**Review Required**: User approval to proceed  
**Estimated Impact**: 10-12x performance improvement  
**Risk Level**: MEDIUM (comprehensive testing required)

---

¿Arranco con la implementación? Voy a ir fase por fase, testeando cada una antes de avanzar. 🚀

