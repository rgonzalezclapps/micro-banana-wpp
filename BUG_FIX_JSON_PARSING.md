# 🐛 Bug Fix: JSON Parsing Error - Multiple Response Objects

**Date**: November 13, 2025  
**Version**: PCTMv1.5.1-6-BUG_JSON_PARSING_MULTIPLE_RESPONSES  
**Status**: ✅ RESOLVED  
**Priority**: CRITICAL  

---

## 🔍 Problem Description

### Error Message
```
❌ Invalid JSON in AI response: Unexpected non-whitespace character after JSON at position 1002 (line 2 column 1)
SyntaxError: Unexpected non-whitespace character after JSON at position 1002
    at JSON.parse (<anonymous>)
    at MessageQueue.executeQueueProcessing (/Users/rgonzalez/workspace/Micro-banana/modules/messageQueue.js:533:29)
```

### Root Cause
GPT-5-mini was generating **multiple JSON objects** concatenated by newlines instead of a single JSON object:

```json
{"timestamp":"2025-11-13T15:58:25-03:00","thinking":"Actualizaré la composición...","response":{...}}
{"timestamp":"2025-11-13T15:58:25-03:00","thinking":"Procesando...","response":{...}}
{"timestamp":"2025-11-13T16:00:45-03:00","thinking":"Finalicé el procesamiento...","response":{...}}
```

The AI was attempting to provide **"progress updates"** during long operations (like image processing with `updateRequest` + `processRequest`), generating 3 separate JSON responses when it should generate only 1.

### Impact
- **User Experience**: Conversations broke mid-flow when AI used tools that took time to process
- **System Reliability**: Queue processing failed, preventing message delivery
- **Data Loss**: User interactions were not saved when parsing failed

---

## ✅ Solutions Implemented

### 1. Defensive JSON Parsing (Immediate Fix)

**File**: `modules/messageQueue.js` (lines 541-578)

**Implementation**:
```javascript
// DEFENSIVE PARSING: Handle multiple JSON objects concatenated by newlines
console.log(`🔄 [${conversationId}] Attempting defensive JSON parsing (multiple objects detected)`);

// Split by newlines and try to parse each line as separate JSON
const lines = result.content.trim().split('\n').filter(line => line.trim().length > 0);

if (lines.length > 1) {
  console.log(`📦 [${conversationId}] Found ${lines.length} JSON objects, using the LAST one (most recent)`);
  
  // Parse all valid JSON objects
  const parsedObjects = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      parsedObjects.push(parsed);
    } catch (lineError) {
      console.warn(`⚠️ [${conversationId}] Skipping invalid JSON line:`, line.substring(0, 100));
    }
  }
  
  if (parsedObjects.length > 0) {
    // Use the last valid JSON object (most recent state)
    aiResponse = parsedObjects[parsedObjects.length - 1];
    console.log(`✅ [${conversationId}] Successfully recovered using last JSON object (timestamp: ${aiResponse.timestamp})`);
  }
}
```

**Benefits**:
- ✅ System gracefully handles malformed AI responses
- ✅ Backward compatible (works with single JSON too)
- ✅ Uses the last (most complete) JSON object
- ✅ Detailed logging for debugging
- ✅ Falls back to original error if recovery fails

---

### 2. System Prompt Update (Preventive Fix)

**File**: `agent-1.md` (lines 726-730)

**Added Section**:
```markdown
**CRÍTICO - FORMATO JSON:**
- Generá **UN SOLO** objeto JSON por respuesta, nunca múltiples objetos consecutivos
- Si necesitás comunicar progreso, hacelo en un único "response.message" detallando todos los pasos
- NO generes múltiples JSONs separados por saltos de línea, incluso si estás procesando durante mucho tiempo
- Cada turno de conversación = 1 objeto JSON completo y final
```

**Benefits**:
- ✅ Prevents the issue at the source (AI behavior)
- ✅ Clear, explicit instructions for JSON format
- ✅ Educates the AI on proper response structure
- ✅ Reduces defensive parsing triggers over time

**Agent Updated**: Maxi Prod (MongoDB ID: `69157006d7b5fc82c033dc86`, instanceId: `50151`)

---

### 3. Infrastructure Tools Created

#### `tools/updateAgentPrompt.js`
**Purpose**: Direct MongoDB prompt update utility

**Usage**:
```bash
node tools/updateAgentPrompt.js <agentId> <promptFilePath>
# Example: node tools/updateAgentPrompt.js 50151 agent-1.md
```

**Features**:
- Connects directly to MongoDB
- Finds agent by instanceId or name pattern
- Updates systemPrompt field
- Updates metadata (lastModified, modifiedBy)
- Lists available agents if not found

#### `tools/clearAgentCache.js`
**Purpose**: Redis cache invalidation for agent configs

**Usage**:
```bash
node tools/clearAgentCache.js <agentMongoId>
# Example: node tools/clearAgentCache.js 69157006d7b5fc82c033dc86
```

**Features**:
- Connects to Redis automatically
- Clears `agent_config:*` cache
- Clears `agent_tools:*` cache
- Lists all related cache keys
- Detailed logging

---

## 🧪 Testing Instructions

### Test Case 1: Defensive Parsing (Existing Behavior)
**Scenario**: AI generates multiple JSON objects (backward compatibility test)

**Steps**:
1. Monitor logs during image processing requests
2. Look for: `🔄 [conversationId] Attempting defensive JSON parsing`
3. Verify: `✅ Successfully recovered using last JSON object`

**Expected**: System recovers gracefully, uses last JSON, conversation continues

---

### Test Case 2: Single JSON (New Behavior)
**Scenario**: AI follows new prompt instructions

**Steps**:
1. Send complex image processing request
2. Monitor OpenAI response logs
3. Check for single JSON object in `content_full`

**Expected**: AI generates only 1 JSON object, no defensive parsing needed

**Validation Logs**:
```
📥 [conversationId] FULL RESPONSE FROM OPENAI: {
  "content_full": "{\"timestamp\":\"...\",\"thinking\":\"...\",\"response\":{...},\"ai_system_message\":{...}}"
}
```

---

### Test Case 3: Complete User Flow
**Scenario**: End-to-end test with image updates

**Steps**:
1. Send multiple images to agent
2. Request: "Me darías estas zapatillas en una modelo en un gimnasio..."
3. User confirms processing
4. Agent updates request with `updateRequest`
5. Agent processes with `processRequest`

**Expected**:
- ✅ No JSON parsing errors
- ✅ Messages delivered successfully
- ✅ Conversation state preserved
- ✅ Final image delivered

---

## 📊 Monitoring & Alerts

### Key Metrics to Track

1. **Defensive Parsing Frequency**
   - Log pattern: `🔄 Attempting defensive JSON parsing`
   - Target: < 5% of requests
   - Action if > 5%: Investigate prompt effectiveness or model settings

2. **JSON Parsing Failures**
   - Log pattern: `❌ Invalid JSON in AI response`
   - Target: 0 occurrences
   - Action if > 0: Check defensive parsing logic

3. **Recovery Success Rate**
   - Log pattern: `✅ Successfully recovered using last JSON object`
   - Target: 100% of defensive parsing attempts
   - Action if < 100%: Investigate edge cases

---

## 🔄 Rollback Plan

If issues arise with the defensive parsing logic:

### Rollback Defensive Parsing
```bash
git revert <commit-hash>  # Revert messageQueue.js changes
```

### Rollback Prompt Update
```bash
# Restore original prompt
node tools/updateAgentPrompt.js 50151 agent-1-backup.md

# Clear cache
node tools/clearAgentCache.js 69157006d7b5fc82c033dc86
```

---

## 📝 Technical Details

### Response Schema
**Name**: `enhanced_fotoproducto_response_schema`  
**Mode**: Strict  
**Required Fields**:
- `timestamp` (string)
- `thinking` (string)
- `response` (object with `recipient`, `message`)
- `ai_system_message` (object with `lead_info`, `current_flow`, `image_processing`)

### AI Model
**Model**: `gpt-5-mini-2025-08-07`  
**Temperature**: 1.0  
**Max Tokens**: 4096  
**Streaming**: false (for this agent)

### Error Context
**Original Error Location**: `modules/messageQueue.js:533`
```javascript
aiResponse = JSON.parse(result.content);  // ❌ Failed here
```

**Content Length**: 2858 characters  
**Content Preview**: 3 JSON objects (1002 chars + 856 chars + 1000 chars)

---

## 🎯 Success Criteria

- [x] Defensive parsing implemented and tested
- [x] System prompt updated with explicit instructions
- [x] Agent configuration updated in MongoDB
- [x] Redis cache cleared
- [x] No linter errors
- [x] Memory log updated
- [x] Documentation created
- [ ] User testing confirms fix (PENDING USER VALIDATION)
- [ ] Monitor logs for 24-48 hours
- [ ] Confirm defensive parsing frequency < 5%

---

## 🚀 Next Steps

1. **User Testing**: Have user run the same interaction that caused the error
2. **Monitoring**: Track defensive parsing frequency for 48 hours
3. **Optimization**: If defensive parsing > 5%, consider:
   - Adjusting temperature (lower = more consistent)
   - Enhancing prompt with examples
   - Adding response format validation in schema
4. **Alert Setup**: Create monitoring alert if parsing failures occur

---

## 📚 Related Files

- `modules/messageQueue.js` - Queue processing with defensive parsing
- `agent-1.md` - Agent system prompt with JSON format instructions
- `modules/openaiIntegration.js` - OpenAI API integration
- `modules/responsesClient.js` - Response handling and streaming
- `tools/updateAgentPrompt.js` - Prompt update utility (NEW)
- `tools/clearAgentCache.js` - Cache invalidation utility (NEW)
- `workbench/memory.md` - Development log with fix documentation

---

**Fix Author**: KheprAI (Clapps Main AI Agent Software Developer)  
**Review Status**: PENDING USER VALIDATION  
**Deployment**: LIVE (MongoDB + Redis cache updated)

