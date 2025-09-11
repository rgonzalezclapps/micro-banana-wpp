// models/Conversation.js

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const MessageChunkSchema = new Schema({
  order: Number,
  content: String
});

// OpenAI Tool Call Context Sub-schemas for perfect structure
const ToolCallSchema = new Schema({
  id: String,           // OpenAI tool call ID (e.g., "call_abc123")
  type: String,         // "function"
  function: {
    name: String,       // Tool function name  
    arguments: String   // JSON string of arguments
  }
}, { _id: false });

const ToolResultSchema = new Schema({
  tool_call_id: String,           // Matches tool_calls[].id
  role: { type: String, default: 'tool' },  // OpenAI role
  content: String                 // Tool execution result (JSON string)
}, { _id: false });

const ExecutionMetadataSchema = new Schema({
  timestamp: { type: Date, default: Date.now },
  total_tools: Number,
  success_count: Number,
  error_count: Number,
  processing_time_ms: Number
}, { _id: false });

const MessageSchema = new Schema({
  sender: {
    type: String,
    enum: ['ai_agent', 'bot_agent', 'user', 'agent', 'specialist', 'system_trigger'],
    required: true
  },
  type: {
    type: String,
    enum: [
      // Original types
      'chat', 'text', 'buttons', 'button-click', 'audio', 'ptt', 'image', 'file',
      // WhatsApp Factory message types
      'video', 'document', 'sticker', 'location', 'contacts', 'interactive', 'reaction',
      // Business and system types
      'system', 'order', 'template', 'hsm', 'edited', 'deleted'
    ],
    required: false
  },
  msg_foreign_id: {
    type: String,
    required: false
  },
  msg_source: {
    type: String,
    enum: ['botmaker', 'ultramsg', 'whatsapp-factory'],
    required: false
  },
  content: [MessageChunkSchema],
  audioTranscription: {
    text: [MessageChunkSchema],
    status: { 
      type: String, 
      enum: ['pending', 'processing', 'completed', 'failed']
    },
    status_reason: {
      type: String,
      required: function() {
        return this.status === 'failed';
      }
    }
  },
  timestamp: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'received', 'ultraMsg'],
    default: 'pending'
  },
  ultraMsgData: {
    type: mongoose.Schema.Types.Mixed,
    required: false  
  },
  // New fields for AI response
  thinking: String,
  aiSystemMessage: {
    type: String,
    get: function(data) {
      try {
        return JSON.parse(data);
      } catch (error) {
        return data;
      }
    },
    set: function(data) {
      return JSON.stringify(data);
    }
  },
  // OpenAI Responses API - Complete tool call context storage
  openaiToolContext: {
    // Exact OpenAI tool_calls format from assistant response
    tool_calls: [ToolCallSchema],
    // Exact OpenAI tool results format for context reconstruction  
    tool_results: [ToolResultSchema],
    // Metadata for debugging and audit
    execution_metadata: ExecutionMetadataSchema
  },
  recipient: {
    type: String,
    enum: ['user', 'operator', 'specialist', 'system'],
    default: 'user'
  },
  // File storage result for media messages
  fileStorage: {
    status: {
      type: String,
      enum: ['pending', 'success', 'error', 'not_applicable'],
      default: 'not_applicable'
    },
    fileId: {
      type: String,
      required: false // Crypto-secure file ID from our storage server
    },
    filename: {
      type: String,
      required: false // Generated secure filename
    },
    originalFilename: {
      type: String,
      required: false // Original filename if available
    },
    fileSize: {
      type: Number,
      required: false // File size in bytes
    },
    fileSizeHuman: {
      type: String,
      required: false // Human-readable file size
    },
    contentType: {
      type: String,
      required: false // MIME type
    },
    downloadUrl: {
      type: String,
      required: false // URL to access file from our storage
    },
    uploadDate: {
      type: Date,
      required: false // When file was successfully stored
    },
    errorCode: {
      type: String,
      required: false // Error code if storage failed
    },
    errorMessage: {
      type: String,
      required: false // Error message if storage failed
    },
    requestId: {
      type: String,
      required: false // Request tracking ID
    }
  }
});

// Remove any existing indexes on the messages or content fields
MessageSchema.index({ content: 1 }, { background: true, sparse: true });

const ConversationSchema = new Schema({
  participantId: {
    type: Number,
    required: true
  },
  phoneNumber: {
    type: String,
    required: true
  },
  participantName: {
    type: String,
    default: 'Unknown'
  },
  agentId: {
    type: Schema.Types.Mixed,
    required: true,
    ref: 'Agent'
  },
  agentName: {
    type: String,
    required: false // Made optional to prevent validation errors
  },
  messages: [MessageSchema],
  unreadCount: {
    type: Number,
    default: 0
  },
  lastMessage: {
    type: String,
    default: ''
  },
  lastMessageTime: {
    type: Date,
    default: Date.now
  },
  lastMessageSender: {
    role: {
      type: String,
      enum: ['ai_agent', 'bot_agent', 'user', 'agent', 'specialist', 'system_trigger'],
      required: false // Made optional to prevent validation errors
    },
    name: {
      type: String,
      default: function() {
        if (this.lastMessageSender?.role === 'user') {
          return this.participantName || 'User';
        } else if (this.lastMessageSender?.role === 'ai_agent') {
          return this.agentName || 'AI Agent';
        }
        return '';
      }
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
  // clientId removed - no longer needed in clientless architecture
}, {
  timestamps: true
});

// Add this line to create a virtual populate for the agent
ConversationSchema.virtual('agent', {
  ref: 'Agent',
  localField: 'agentId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtuals are included when converting to JSON
ConversationSchema.set('toJSON', { virtuals: true });
ConversationSchema.set('toObject', { virtuals: true });

const Conversation = mongoose.model('Conversation', ConversationSchema);

module.exports = Conversation;

