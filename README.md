# 🍌 Micro Banana - AI Image Processing Chatbot Engine

A powerful Node.js/Express.js API combining **Google Gemini image processing** with conversational AI agents across multiple messaging platforms. Create professional product photography, edit images, and generate visual content through WhatsApp conversations.

**Version**: PCTMv1.5.0-4  
**Architecture**: MongoDB-Only with Separated Message Collection

---

## 🚀 Architecture

**MongoDB-Only AI Image Processing Engine** with multi-platform support:
- **Agents**: AI assistants with consolidated configuration (OpenAI Responses API + Google Gemini)
- **Participants**: Users with credit system (2000 initial credits)
- **Conversations**: Lightweight metadata without embedded messages
- **Messages**: Separated collection for unlimited scalability
- **Payments**: MercadoPago integration with webhook processing
- **Requests**: Image processing workflows with Google Gemini
- **ToolSchemas**: Dynamic tool loading with agent assignments

---

## 💾 Technologies

- **Backend**: Node.js + Express.js
- **Database**: MongoDB + Redis (PostgreSQL removed)
  - **MongoDB**: All data storage (agents, participants, conversations, messages, payments, requests, tools)
  - **Redis**: Caching, message queuing, duplicate prevention
- **AI Integration**: 
  - **OpenAI Responses API**: GPT-5-mini with 10 specialized tools
  - **Google Gemini API**: Professional image processing (gemini-2.5-flash-image stable)
- **Messaging**: UltraMsg with native image + caption delivery, WhatsApp Business API
- **File Storage**: Crypto-secure storage with dual URL architecture (internal + external HTTPS)
- **Image Processing**: Multi-image consolidation, text-to-image generation, iterative refinement
- **Payment System**: MercadoPago Checkout Pro with credit management

---

## 📦 Installation

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env with your MongoDB and API credentials

# 3. MongoDB will auto-create collections on first use
# No migrations needed with MongoDB-only architecture

# 4. Optional: Populate test agents
node tools/populateDatabase.js
```

---

## 🔧 Usage

```bash
# Development server
npm run dev

# Production server  
npm start

# Database utilities
node tools/inspectRedis.js              # Check Redis state
node tools/validateMongoMigration.js    # Validate MongoDB architecture
node tools/testCompletePaymentFlow.js   # Test payment system
node tools/finalSystemValidation.js     # Complete system validation
```

---

## 🌐 Environment Variables

```env
# Database Connections (MongoDB-Only)
MONGODB_URI=mongodb://user:password@host:27017/database?authSource=admin
REDIS_URL=redis://:password@host:6379

# AI Integration APIs
OPENAI_API_KEY=sk-proj-...                    # OpenAI Responses API
GEMINI_API_KEY=AIzaSy...                     # Google Gemini API

# Messaging & Webhook APIs  
ULTRAMSG_BASE_URL=https://api.ultramsg.com/instance
API_KEY_WEBHOOK=AIA_...                      # Webhook authentication + file storage access

# MercadoPago Payment Integration
MP_ACCESS_TOKEN=APP_USR-...
MP_SECRET_KEY=...                            # For webhook signature validation
WEBHOOK_BASE_URL=https://your-domain.com     # For webhook callbacks

# File Storage Configuration (Dual URL Architecture)
FILE_STORAGE_BASE_URL=http://mvp_files               # Internal Docker access
FILE_STORAGE_EXTERNAL_URL=https://files.your-domain.com  # External HTTPS access
FILE_SIZE_LIMIT=25                           # Max file size in MB

# Queue Configuration
QUEUE_INTERVAL_MS=2000                       # Message queue processing interval

# Application Settings
PORT=5001
NODE_ENV=production
TZ=America/Argentina/Buenos_Aires
```

---

## 🏗️ Project Structure

- **`routes/`** - API endpoints and webhook handlers
- **`services/`** - Business logic, Google Gemini integration, and external APIs  
- **`models/`** - MongoDB models (Agent, Participant, Conversation, Message, Payment, Request, ToolSchema)
- **`modules/`** - Core business logic (conversation manager, message queue, OpenAI integration)
- **`utils/`** - File storage utilities, media processing, shared functions
- **`ai_debugging/`** - AI debugging framework with prompts and tool definitions
- **`tools/`** - Database management, migration scripts, and validation utilities
- **`docs/`** - Complete project documentation
- **`workbench/`** - Development tracking and specifications

---

## 🔗 API Endpoints

### **Core Messaging API**
- **`POST /api/webhook`** - Unified webhook handler for all platforms (UltraMsg, WhatsApp Factory, MercadoPago)
- **`GET /api/external/conversations`** - External API access to conversation data
- **`GET /api/external/conversations/:id/messages`** - Paginated message retrieval
- **`GET /health`** - Health check endpoint

### **Payment Return URLs**
- **`GET /api/webhook/payment-success`** - MercadoPago success return
- **`GET /api/webhook/payment-failure`** - MercadoPago failure return
- **`GET /api/webhook/payment-pending`** - MercadoPago pending return

### **AI Processing Integration**
- **OpenAI Tools**: 10 function calling tools for image processing, payments, and video generation
- **Google Gemini**: Professional image processing with structured JSON prompts
- **Smart Response Routing**: Automatic detection of text/image/video for optimal delivery

---

## 🤖 Agent Configuration

### **Agents Available**:

1. **Maxi Prod** (Main Photography Agent)
   - instanceId: 50151
   - Type: openai
   - Tools: 8 (image processing + payments)
   - Model: gpt-5-mini
   - Status: active

2. **Bananon** (Development Agent)
   - instanceId: 34104
   - Type: openai
   - Tools: 10 (all tools)

3. **Delfino** (Healthcare Agent)
   - instanceId: 559995607197034
   - Type: wpp-bsp (WhatsApp Business)
   - Tools: 2 (payments only)

### **Agent Structure** (MongoDB):
```javascript
{
  _id: ObjectId,
  name: String,
  type: 'openai' | 'wpp-bsp',
  instanceId: String,
  token: String,
  systemPrompt: String (up to 1MB),
  modelConfig: { model, maxCompletionTokens, temperature, streaming },
  responseSchema: Object,
  status: 'active' | 'inactive' | 'paused'
}
```

---

## 🧪 Testing & Validation

```bash
# Complete system validation
node tools/finalSystemValidation.js

# MongoDB migration validation
node tools/validateMongoMigration.js

# Payment flow testing
node tools/testCompletePaymentFlow.js

# Participant creation testing
node tools/testParticipantCreation.js

# Tool loading verification
node tools/testToolLoading.js
```

---

## 💰 Payment System

**Credit System**:
- New participants: **2000 initial credits**
- Credit top-up via MercadoPago Checkout Pro
- 1 ARS = 1 credit
- WhatsApp notifications for approved/rejected payments

**Payment Flow**:
1. User requests credits via `checkCredits` tool
2. AI generates payment link via `createTopupLink` tool
3. User completes payment in MercadoPago
4. Webhook processes payment and credits participant
5. User receives WhatsApp confirmation

---

## 📊 Database Collections

### **MongoDB Collections**:
- **agents** - AI agent configurations (3 docs)
- **toolSchemas** - Tool definitions with agent assignments (10 docs)
- **participants** - Users with credit balances
- **conversations** - Conversation metadata (without embedded messages)
- **messages** - Separated message storage for scalability
- **payments** - MercadoPago payment records
- **requests** - Google Gemini image processing requests

### **Key Features**:
- ✅ Unlimited message scalability (separated collection)
- ✅ ObjectId references throughout
- ✅ Optimized indexes for all query patterns
- ✅ No 16MB document limit
- ✅ Native pagination support

---

## 🎨 Image Processing Features

**Tools Available**:
- `newRequest` - Create image processing request with structured JSON prompts
- `updateRequest` - Add images or refine instructions iteratively
- `processRequest` - Execute professional image generation
- `getRequestStatus` - Monitor processing status
- `listActiveRequests` - Manage multiple requests
- `cancelRequest` - Cancel active requests

**Capabilities**:
- Professional product photography
- Multi-image composition
- Background replacement
- Style transfer
- Text-to-image generation
- Iterative refinement

---

## 🔐 Security Features

- **JWT Authentication**: API key validation for webhooks
- **MercadoPago Signature Validation**: HMAC-SHA256 verification
- **Duplicate Prevention**: Redis-based message deduplication
- **Rate Limiting**: Redis-backed rate limiting
- **Secure File Storage**: Crypto-secure file IDs with API key protection
- **Base64 Image Processing**: Eliminates external URL dependencies

---

## 📝 Documentation

Complete documentation available in `/docs/`:
- **tech_specs.md** - Technical specifications and architecture
- **directory.md** - Project structure and file organization
- **kanban_board.md** - Project management and task tracking

Development documentation in `/workbench/`:
- **system_prd.md** - Product requirements and system design
- **memory.md** - Development log and decision tracking

---

## 🚀 Getting Started

1. **Clone and install**:
```bash
git clone <repository>
cd Micro-banana
npm install
```

2. **Configure environment**:
```bash
# Copy and edit .env file
cp .env.example .env
# Configure: MONGODB_URI, REDIS_URL, OPENAI_API_KEY, GEMINI_API_KEY
```

3. **Start server**:
```bash
npm run dev
```

4. **Verify**:
- MongoDB connection: ✅
- Redis connection: ✅
- Agent configurations loaded: ✅
- Webhook endpoint ready: ✅

---

## 📄 License

MIT License

---

**Status**: 🟢 Production Ready  
**Architecture**: MongoDB-Only, Scalable, Clean
