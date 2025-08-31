# 🍌 Micro Banana - Generic AI Chatbot Engine

A versatile Node.js/Express.js API for managing AI-powered conversational agents across multiple messaging platforms (WhatsApp, etc.).

## 🚀 Architecture

**Generic Chatbot Engine** with multi-platform support:
- **Participants**: Any person/entity engaging with agents (renamed from Patients for broader use)
- **Agents**: AI assistants with OpenAI integration and multi-provider messaging
- **Conversations**: MongoDB-based conversation storage with PostgreSQL metadata
- **Multi-Provider**: UltraMsg, WhatsApp Business API, and extensible for other platforms

## 💾 Technologies

- **Backend**: Node.js + Express.js
- **Database**: Dual architecture - PostgreSQL (metadata) + MongoDB (conversations) + Redis (caching)
- **AI Integration**: OpenAI Assistant API with thread management
- **Messaging**: UltraMsg, WhatsApp Business API
- **Real-time**: Async message processing with queue system

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
# Database connections
POSTGRES_URI=postgresql://user:password@host:5432/database
MONGODB_URI=mongodb://user:password@host:27017/database
REDIS_URL=redis://:password@host:6379

# API Configuration
OPENAI_API_KEY=your-openai-api-key
API_KEY_ADAM=your-external-api-key
ULTRAMSG_BASE_URL=https://api.ultramsg.com/instance

# Optional
POSTGRES_SSL=false
PORT=5001
```

## 🏗️ Project Structure

- **`routes/`** - API endpoints and webhook handlers
- **`services/`** - Business logic and external API integrations  
- **`models/`** - Database models (PostgreSQL + MongoDB)
- **`modules/`** - Core business logic (conversation management, OpenAI integration)
- **`tools/`** - Utility scripts for database management and testing
- **`utils/`** - Shared utility functions

## 🔗 API Endpoints

- **`POST /webhook`** - Receive messages from messaging platforms
- **`GET /external/conversations`** - External API access to conversation data
- **`GET /health`** - Health check endpoint

## 🧪 Testing

```bash
# Test webhook duplicate detection
node tools/testDuplicates.js

# Test database population
node tools/populateDatabase.js --validate
```

## 📄 License

MIT License
