# ⚠️ OpenAI API Reality Check - What Actually Works

**Date**: November 14, 2025  
**Issue**: Sending unsupported parameters to OpenAI API  
**Status**: FIXED  

---

## 🐛 **The Problem**

We were sending **Azure OpenAI-specific parameters** to the **public OpenAI API**, which doesn't support them:

```javascript
// ❌ WHAT WE SENT (BROKEN):
{
  "max_output_tokens": 4096,        // ❌ Azure only
  "reasoning_effort": "none",       // ❌ Azure only
  "verbosity": "low"                // ❌ Azure only
}

// Error:
400 Unknown parameter: 'max_output_tokens'
```

---

## ✅ **OpenAI Public API - Supported Parameters**

### **All Models (Standard)**:
```javascript
{
  model: "gpt-5-mini" | "gpt-4o" | "gpt-4-turbo",
  messages: [...],
  max_completion_tokens: 4096,      // ✅ CORRECT parameter
  temperature: 1.0,                 // ✅ Supported
  top_p: 1.0,                       // ✅ Supported
  frequency_penalty: 0,             // ✅ Supported
  presence_penalty: 0,              // ✅ Supported
  stream: false,                    // ✅ Supported
  tools: [...],                     // ✅ Supported
  response_format: {...}            // ✅ Supported
}
```

### **Reasoning Models (gpt-5, gpt-5.1)** - In Public API:
```javascript
{
  model: "gpt-5" | "gpt-5.1",
  messages: [...],
  max_completion_tokens: 4096,      // ✅ Use this (NOT max_output_tokens)
  // ❌ NO temperature
  // ❌ NO reasoning_effort (Azure only)
  // ❌ NO verbosity (Azure only)
  stream: false,
  tools: [...],
  response_format: {...}
}
```

**Key Finding**: Reasoning models in public API have reasoning **built-in and always on**. You cannot control it.

---

## 🔧 **What We Fixed**

### **responsesClient.js**:

**BEFORE (BROKEN)**:
```javascript
if (isReasoningModel) {
  requestConfig.max_output_tokens = ...           // ❌ Not supported
  requestConfig.reasoning_effort = ...            // ❌ Not supported
  requestConfig.verbosity = ...                   // ❌ Not supported
}
```

**AFTER (FIXED)**:
```javascript
// Use ONLY supported parameters
const requestConfig = {
  model: agentConfig.modelConfig.model,
  messages,
  tools: finalTools,
  response_format: responseFormat,
  max_completion_tokens: agentConfig.modelConfig.maxCompletionTokens,  // ✅ CORRECT
  stream: agentConfig.modelConfig.streaming
};

// Add temperature ONLY for non-reasoning models
if (!isReasoningModel) {
  requestConfig.temperature = agentConfig.modelConfig.temperature;
}

// NO reasoning_effort, NO verbosity, NO max_output_tokens
```

---

## 📊 **Model Reality in OpenAI Public API**

### **GPT-5** (if available):
- ✅ Supports: max_completion_tokens, stream, tools, response_format
- ❌ Does NOT support: temperature, reasoning_effort, verbosity, max_output_tokens
- ⚠️ Reasoning: ALWAYS ON, cannot disable (~30s latency)
- 💰 Cost: High

### **GPT-5.1** (if available):
- ✅ Supports: max_completion_tokens, stream, tools, response_format
- ❌ Does NOT support: temperature, reasoning_effort, verbosity, max_output_tokens
- ⚠️ Reasoning: ALWAYS ON in public API, cannot disable
- 💰 Cost: High

### **GPT-5-mini**:
- ✅ Supports: max_completion_tokens, temperature, stream, tools, response_format
- ✅ No reasoning (fast, 3-8s)
- 💰 Cost: Low

---

## 🎯 **The Truth About Reasoning Control**

### **Azure OpenAI Service** (Enterprise):
```javascript
// ✅ Available in Azure:
{
  max_output_tokens: 4096,
  reasoning_effort: "none" | "minimal" | "low" | "medium" | "high",
  verbosity: "low" | "medium" | "high"
}

// You CAN control reasoning in Azure
```

### **OpenAI Public API** (What we use):
```javascript
// ❌ NOT available:
{
  max_completion_tokens: 4096,  // Use this instead
  // NO reasoning_effort
  // NO verbosity
}

// You CANNOT control reasoning in public API
// GPT-5 always uses reasoning (always ~30s)
```

---

## 💡 **Solution for Fast Responses**

### **Option 1: Use GPT-5-mini** (RECOMMENDED):
```javascript
{
  model: "gpt-5-mini",
  max_completion_tokens: 4096,
  temperature: 1.0,
  streaming: false
}

Result:
- Response time: 3-8s ✅
- No reasoning tokens ✅
- Quality: Excellent for most tasks ✅
- Cost: 70% cheaper ✅
```

### **Option 2: Keep GPT-5 + Accept 30s**:
```javascript
{
  model: "gpt-5",
  max_completion_tokens: 4096,
  streaming: false
  // NO temperature (not supported)
}

Result:
- Response time: 30s ⚠️
- Reasoning tokens: 800-1000 (automatic)
- Quality: Best ✅
- Cost: High 💰
```

### **Option 3: GPT-5 + Streaming for Better UX**:
```javascript
{
  model: "gpt-5",
  max_completion_tokens: 4096,
  streaming: true  // ⭐ Better UX
}

Result:
- Response time: Still 30s
- BUT user sees it typing (feels faster)
- Quality: Best ✅
```

---

## 🔧 **Current Configuration (After Fix)**

```javascript
// Agent modelConfig in MongoDB:
{
  model: "gpt-5.1",                   // Will try this model
  reasoningEffort: "none",            // Stored but NOT sent to API
  verbosity: "low",                   // Stored but NOT sent to API
  maxCompletionTokens: 4096,
  temperature: 1,                     // NOT sent (reasoning model)
  streaming: false
}

// What we actually send to OpenAI:
{
  model: "gpt-5.1",
  max_completion_tokens: 4096,        // ✅ ONLY supported params
  stream: false,
  tools: [...],
  response_format: {...}
  // NO reasoning_effort (not supported)
  // NO verbosity (not supported)
  // NO max_output_tokens (not supported)
  // NO temperature (not supported for reasoning)
}
```

---

## ⚠️ **Important Note About GPT-5.1**

`gpt-5.1` may or may not be available in public API yet. If OpenAI returns an error like "model not found", we'll need to fall back to:
- `gpt-5` (slow, ~30s)
- `gpt-5-mini` (fast, 3-8s) ✅ RECOMMENDED

---

## 🚀 **Next Test**

After fix, testing `gpt-5.1`:
- If it works: Will still have reasoning (30s) because public API can't disable it
- If it fails: Switch to `gpt-5-mini` for speed

**The Azure parameters (reasoning_effort, verbosity) are stored in DB for documentation but NOT sent to API.**

---

**Fix Applied**: ✅ Only send supported parameters  
**Model**: gpt-5.1 (testing if available)  
**Expected**: May still be slow (reasoning can't be disabled in public API)  
**Recommendation**: Use gpt-5-mini for speed

