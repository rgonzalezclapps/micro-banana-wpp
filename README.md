# 🍌 Micro Banana - AI Image Processing Chatbot Engine

A powerful Node.js/Express.js API combining **Google Gemini image processing** with conversational AI agents across multiple messaging platforms. Create professional product photography, edit images, and generate visual content through WhatsApp conversations.

## 🚀 Architecture

**AI Image Processing Engine** with multi-platform support:
- **Participants**: Users engaging with AI agents for image processing
- **Agents**: AI assistants with OpenAI + Google Gemini integration
- **Conversations**: MongoDB-based conversation storage with PostgreSQL metadata
- **Parallel Requests**: Micro-conversations for specialized image processing workflows
- **Multi-Provider**: UltraMsg with native image delivery, WhatsApp Business API
- **File Storage**: Crypto-secure storage with dual URL architecture

## 💾 Technologies

- **Backend**: Node.js + Express.js
- **Database**: Triple architecture - PostgreSQL (metadata) + MongoDB (conversations + requests) + Redis (caching)
- **AI Integration**: 
  - **OpenAI Assistants API**: 6 specialized tools + thread management
  - **Google Gemini API**: Professional image processing (gemini-2.5-flash-image-preview)
- **Messaging**: UltraMsg with native image + caption delivery, WhatsApp Business API
- **File Storage**: Crypto-secure storage with dual URL architecture (internal + external HTTPS)
- **Image Processing**: Multi-image consolidation, text-to-image generation, iterative refinement

## 📦 Installation

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env with your database and API credentials

# 3. Create fresh database schema
node tools/recreateDatabase.js

# 4. Populate with initial data (Banana client + Bananon agent)
node tools/populateDatabase.js
```

## 🔧 Usage

```bash
# Development server
npm run dev

# Production server  
npm start

# Database utilities
node tools/inspectRedis.js          # Check Redis state
node tools/fixConversations.js      # Fix conversation schema issues
```

## 🌐 Environment Variables

```env
# Database Connections
POSTGRES_URI=postgresql://fotoproducto_user:password@api-ai-mvp.com:5432/fotoproducto
MONGODB_URI=mongodb://fotoproducto_user:password@api-ai-mvp.com:27017/fotoproducto?authSource=admin
REDIS_URL=redis://:password@api-ai-mvp.com:6379

# AI Integration APIs
OPENAI_API_KEY=sk-proj-...                    # OpenAI Assistants API
GEMINI_API_KEY=AIzaSy...                     # Google Gemini API (NEW)

# Messaging & Webhook APIs  
ULTRAMSG_BASE_URL=https://api.ultramsg.com/instance
API_KEY_WEBHOOK=AIA_...                      # Webhook authentication + file storage access

# File Storage Configuration (NEW - Dual URL Architecture)
FILE_STORAGE_BASE_URL=http://mvp_files               # Internal Docker access
FILE_STORAGE_EXTERNAL_URL=https://files.api-ai-mvp.com  # External HTTPS access
FILE_SIZE_LIMIT=25                           # Max file size in MB

# Application Settings
PORT=5001
NODE_ENV=production
TZ=America/Argentina/Buenos_Aires
```

## 🏗️ Project Structure

- **`routes/`** - API endpoints and webhook handlers
- **`services/`** - Business logic, Google Gemini integration, and external APIs  
- **`models/`** - Database models (PostgreSQL + MongoDB + Request entity)
- **`modules/`** - Core business logic (conversation, request management, AI integration)
- **`utils/`** - File storage utilities, media processing, shared functions
- **`assistant_tools/`** - OpenAI Assistant configuration (6 tools + prompts) **(NEW)**
- **`tools/`** - Database management and administrative utilities
- **`docs/`** - Complete project documentation
- **`workbench/`** - Development tracking and specifications

## 🔗 API Endpoints

### **Core Messaging API**
- **`POST /api/webhook`** - Receive messages from messaging platforms (with media storage)
- **`GET /api/external/conversations`** - External API access to conversation data
- **`GET /health`** - Health check endpoint

### **File Storage API**
- **`POST /upload`** - Secure file upload to crypto-secure storage
- **`GET /file/{fileId}`** - File download with API key authentication
- **`GET /search`** - Advanced file search with filters

### **AI Processing Integration**
- **OpenAI Tools**: 6 function calling tools for image processing workflows
- **Google Gemini**: Automatic image processing and generation
- **Smart Response Routing**: Text vs Image vs Image+Caption delivery

## 🧪 Testing

```bash
# Database and system utilities
node tools/populateDatabase.js --validate
node tools/inspectRedis.js          # Check Redis state
node tools/fixConversations.js      # Fix conversation schema issues

# Manual testing endpoints
curl -X POST "https://api-ai-mvp.com/api/webhook?api_key=API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"test": "webhook test"}'

# File storage testing
curl "https://files.api-ai-mvp.com/?key=API_KEY"
```

## 🤖 OpenAI Assistant Setup

### **Configuration Files**
All OpenAI Assistant configuration files are in `/assistant_tools/`:

1. **Tools**: Copy 6 JSON tool definitions to OpenAI Assistant
2. **Prompt**: Use `enhanced_assistant_prompt_v3_secure.md` (RECOMMENDED)
3. **Response Schema**: Copy `response_schema.json` for JSON format
4. **Guide**: Follow `README.md` in assistant_tools for complete setup

### **Expected User Experience**
```
👤: [Uploads product images] "Mejorá profesionalmente"
🤖: "¡Hola! ¿Cómo te llamás?"
👤: "Carlos"
🤖: "Perfecto Carlos. Procesando tus productos..."
📱: [30-60 seconds] WhatsApp delivers professional composition
🤖: "¡Listo! Te envié tu composición profesional."
```

## 📄 License

MIT License
