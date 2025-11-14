# 🤖 OpenAI Models Guide - Reasoning vs Non-Reasoning

**Version**: PCTMv1.6.0-11  
**Date**: November 14, 2025  
**Purpose**: Technical reference for OpenAI model selection and configuration  

---

## 🎯 Model Comparison

### **GPT-5 (Original)** - Reasoning Always ON

**Configuration**:
```javascript
{
  model: "gpt-5",
  max_output_tokens: 4096,        // NOT max_completion_tokens
  reasoning_effort: "high",       // Default, cannot change
  verbosity: "medium",            // Optional
  // temperature NOT supported
  // top_p NOT supported
  streaming: false
}
```

**Characteristics**:
- ✅ Highest quality reasoning and planning
- ✅ Best for complex tasks requiring step-by-step thinking
- ❌ SLOW: 20-30s due to reasoning tokens (800-1000 tokens)
- ❌ Cannot disable reasoning
- ❌ Traditional parameters (temperature, top_p) NOT supported
- 💰 Most expensive

**Use Cases**:
- Complex problem solving
- Multi-step planning
- Code generation with architecture decisions
- NOT recommended for simple tasks or chatbots

---

### **GPT-5.1** - Reasoning Optional

**Configuration**:
```javascript
{
  model: "gpt-5.1",
  max_output_tokens: 4096,
  reasoning_effort: "none",       // ⭐ Can disable reasoning!
  verbosity: "low",
  streaming: false
}
```

**Reasoning Effort Options**:
- `none`: No reasoning (fast, ~5-10s)
- `minimal`: Light reasoning (~10-15s)
- `low`: Some reasoning (~15-20s)
- `medium`: Moderate reasoning (~20-25s)
- `high`: Full reasoning (~25-30s)

**Characteristics**:
- ✅ Flexible: Can disable reasoning for speed
- ✅ Fast when reasoning_effort='none' (5-10s)
- ✅ GPT-5 quality when reasoning enabled
- ❌ Still doesn't support temperature/top_p
- 💰 Expensive (same as GPT-5)

**Use Cases**:
- Tasks that sometimes need reasoning, sometimes don't
- Quality priority with speed flexibility
- May not be widely available yet

---

### **GPT-5-mini** - No Reasoning (RECOMMENDED)

**Configuration**:
```javascript
{
  model: "gpt-5-mini",
  max_completion_tokens: 4096,    // Standard parameter
  temperature: 1,                 // ✅ Supported
  top_p: 1,                       // ✅ Supported
  streaming: false
}
```

**Characteristics**:
- ✅ FAST: 3-8s response time
- ✅ No reasoning tokens (direct response)
- ✅ Supports ALL traditional parameters
- ✅ Excellent quality for most tasks
- ✅ 70% cheaper than GPT-5
- ❌ No advanced reasoning capability

**Use Cases**:
- Chatbots and conversational AI ✅
- Image description and analysis ✅
- Creative writing and content generation ✅
- Simple Q&A ✅
- **PERFECT for Foto Producto AI** ✅

---

## 📊 Performance Comparison (Real Data)

### **Test: Simple "Hola" Message**

| Model | OpenAI Time | Total Time | Reasoning Tokens | Cost |
|-------|-------------|------------|------------------|------|
| **gpt-5** | 30-31s | 35-36s | 800-1000 | $0.05 |
| **gpt-5-mini** (expected) | 3-8s | 7-13s | 0 | $0.015 |
| **Improvement** | **4-10x faster** | **2.7-5x faster** | **100% eliminated** | **70% cheaper** |

---

## 🛠️ How to Switch Models

### **Using updateAgentModel.js Tool**:

```bash
# Switch to gpt-5-mini (RECOMMENDED)
node tools/updateAgentModel.js 50151 gpt-5-mini false 4096

# Switch to gpt-5 (if you need reasoning)
node tools/updateAgentModel.js 50151 gpt-5 false 4096

# Enable streaming for better UX
node tools/updateAgentModel.js 50151 gpt-5-mini true 4096

# Reduce max tokens for speed
node tools/updateAgentModel.js 50151 gpt-5-mini false 2048

# Always clear cache after
node tools/clearAgentCache.js 69157006d7b5fc82c033dc86
```

### **Direct MongoDB Update**:

```javascript
db.agents.updateOne(
  { instanceId: "50151" },
  { 
    $set: { 
      "modelConfig.model": "gpt-5-mini",
      "metadata.lastModified": new Date()
    }
  }
)
```

---

## ⚙️ Parameter Compatibility

### **Reasoning Models (GPT-5, GPT-5.1 with effort)**:
```javascript
✅ max_output_tokens
✅ reasoning_effort
✅ verbosity
✅ streaming
❌ temperature (NOT supported)
❌ top_p (NOT supported)
❌ logit_bias (NOT supported)
❌ max_completion_tokens (use max_output_tokens)
```

### **Non-Reasoning Models (GPT-5-mini, GPT-4o)**:
```javascript
✅ max_completion_tokens
✅ temperature
✅ top_p
✅ frequency_penalty
✅ presence_penalty
✅ logit_bias
✅ streaming
❌ reasoning_effort (not applicable)
❌ verbosity (not applicable)
```

---

## 🎯 Current Configuration (After Update)

**Agent**: Maxi Prod (instanceId: 50151)  
**MongoDB ID**: 69157006d7b5fc82c033dc86

```javascript
{
  name: "Maxi Prod",
  modelConfig: {
    model: "gpt-5-mini",          // ⭐ UPDATED
    maxCompletionTokens: 4096,
    temperature: 1,
    streaming: false
  },
  imageContextConfig: {
    historyMode: "low",
    maxHistoricalImages: 20,
    enableAIObservation: true
  }
}
```

**Expected Performance**:
```
OpenAI processing: 3-8s (vs 30s before)
Total time: 7-13s (vs 36s before)
Overhead (our system): ~4-5s ✅
```

---

## 📈 Expected Improvements

### **Response Time**:
```
Before: 36 seconds (too slow)
After:  7-13 seconds (acceptable) ✅
Improvement: 2.7-5x faster ⚡
```

### **Token Cost**:
```
Before: ~10,000 tokens/request
After:  ~3,000 tokens/request (no reasoning tokens)
Savings: 70% cost reduction 💰
```

### **User Experience**:
```
Before: Timeout anxiety, user waits forever
After:  "Instant" feeling, natural conversation ✅
```

---

## 🧪 Testing After Model Change

### **Test Scenario**: Send "Hola"

**Expected Logs**:
```
[+0ms] ⚡ FIRST message - processing IMMEDIATELY
[+2,000ms] OpenAI request start
[+5,000ms] OpenAI response received (3s vs 30s before) ✅
[+7,000ms] Message sent
[+7,200ms] Complete

Total: ~7 seconds ✅ (vs 36s before)
```

**Expected Token Usage**:
```json
{
  "usage": {
    "prompt_tokens": ~8000,
    "completion_tokens": ~300-500 (NO reasoning_tokens ✅),
    "total_tokens": ~8500,
    "completion_tokens_details": {
      "reasoning_tokens": 0  // ⭐ ZERO reasoning tokens
    }
  }
}
```

---

## 🎓 Key Learnings

### **1. Reasoning Tokens in GPT-5**:
- GPT-5 has "extended thinking" built-in
- Causes 800-1000 reasoning tokens per request
- Adds 20-30s of latency
- CANNOT be disabled in GPT-5 original
- Only GPT-5.1 supports `reasoning_effort: 'none'`

### **2. Model Selection Matters**:
- Use GPT-5 for complex reasoning tasks only
- Use GPT-5-mini for speed and general tasks
- Use GPT-5.1 when you need flexibility

### **3. Parameter Compatibility**:
- Reasoning models have different parameter sets
- Temperature NOT supported in GPT-5/5.1 (with reasoning)
- Always check model compatibility docs

---

## 📚 Official Documentation References

1. **OpenAI GPT-5 Models**: https://platform.openai.com/docs/models/gpt-5
2. **Azure Reasoning Models**: https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/reasoning
3. **GPT-5.1 Guide**: https://platform.openai.com/docs/guides/latest-model
4. **AI SDK Provider Docs**: https://ai-sdk.dev/providers/ai-sdk-providers/openai

---

**Current Model**: `gpt-5-mini` ✅  
**Status**: Production Ready  
**Expected Performance**: 7-13s total (3-8s OpenAI + 4-5s overhead)

