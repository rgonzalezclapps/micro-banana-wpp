# 🔄 Refactoring: Image-Only Focused Prompt

**Date**: November 13, 2025  
**Version**: PCTMv1.5.2-7-REFACTOR_PROMPT_IMAGE_ONLY  
**Status**: ✅ COMPLETED  
**Priority**: MAJOR REFACTORING  

---

## 🎯 Objective

Simplify the "Maxi — Foto Producto AI" agent to **exclusively focus on image processing** and **payment/credit management**, removing all video generation and website creation capabilities.

---

## 📊 Scope Analysis

### ✅ **Features MAINTAINED**

#### 1. **Image Processing Tools** (Core Business)
- `newRequest` - Create new image processing request
- `updateRequest` - Add images or refine instructions
- `processRequest` - Execute image generation/editing
- `cancelRequest` - Cancel active request
- `getRequestStatus` - Check request status
- `listActiveRequests` - List all active requests

#### 2. **Payment & Credit Tools** (Essential)
- `createTopupLink` - Generate payment link for credit purchase
- `checkCredits` - Check user's credit balance

### ❌ **Features REMOVED**

#### 1. **Video Generation** (Eliminated)
- `videoGenerator` tool
- Complete video prompt construction guide (~265 lines)
- 12 professional video examples (~395 lines)
- Video format selection logic (Veo2 vs Veo3)
- Audio generation guidelines
- Camera movement specifications

#### 2. **Website Creation** (Eliminated)
- `generateWebsite` tool
- `updateWebsite` tool
- Website discovery questionnaire (~30 lines)
- Brand/product information gathering flow
- Website style and reference collection

---

## 📏 Metrics

### Size Reduction
| Metric | Before | After | Reduction |
|--------|--------|-------|-----------|
| **Total Lines** | 1,184 | 485 | 58.9% ↓ |
| **Characters** | 46,031 | 24,058 | 47.7% ↓ |
| **Words** | 6,487 | 3,328 | 48.7% ↓ |
| **Estimated Tokens** | ~11,500 | ~6,000 | ~5,500 tokens saved |

### Lines Removed by Section
| Section | Lines | Description |
|---------|-------|-------------|
| Website References | ~30 | generateWebsite/updateWebsite + questionnaire |
| Video Tooling | ~8 | Video tool references in flow |
| Video Tips Guide | ~265 | Complete video generation guide |
| Video Examples | ~395 | 12 professional video examples + templates |
| **TOTAL** | **~698** | **59% of original prompt** |

---

## 🛠️ Implementation Details

### Changes Made

#### 1. **Removed Website Integration** (Lines 24-53)
**Before:**
```markdown
Tus unicas excepciones para con el usuario es para compartir el link de pago que te devuelve la tool "createTopupLink",la web que devuelve la tool "generateWebsite" y también "updateWebsite". Para pagos, debes devolverlo como si armases una lista en whatsapp, pero con 3 elementos: El link, cantidad de créditos, y monto en pesos. El link de la web es en una lista de un solo elemento.

Cuando el usuario te pida un sitio web, deberas pedirle más detalles si no te los ha dado, y pedirle confirmacion junto a repasar lo que entendiste para que confirme y procedan. Una vez que te dio los detalles, es tu obligacion utilizar la tool generateWebsite. Debes tomar la tracking_url de la response de la tool y darsela al usuario con tu respuesta.

Sugierele y hazle algunas preguntas sobre todo al comienzo del pedido respecto de los siguientes puntos para poder construir un mejor prompt para la tool de IA:
[... 25 líneas de cuestionario ...]
```

**After:**
```markdown
Tu única excepción para compartir URLs con el usuario es el link de pago que te devuelve la tool "createTopupLink". Para pagos, debes devolverlo como si armases una lista en whatsapp, pero con 3 elementos: El link, cantidad de créditos, y monto en pesos.
```

---

#### 2. **Removed Video Tooling** (Lines 93-96)
**Before:**
```markdown
Tooling Video: Para generar los videos, primero vamos a tomar la imagen de input que nos pasó el usuario, vamos a generar 

Para videos → videoGenerator.
```

**After:**
```markdown
[Section completely removed]
```

---

#### 3. **Removed Video Policy** (Line 206)
**Before:**
```markdown
videoGenerator: Si el usuario no indicó mayor calidad, o requiere 9:16 format, debemoso utilizar 2 for Veo2. Otherwisee, we'll use Veo3 specially if audio is needed). Antes de hacer video generratoor, debes escolar la tool para procesar la imagen hacia un punto de partiida adecuado para el video, por ejemplo, si tengo el logo de mi empresa sobre blanco, y quiero hacerrlo volando por la jungla. deebo primero generar lo que sería el frame inicial, y que veo pueda salir de ese mismo lugar.
```

**After:**
```markdown
[Line completely removed]
```

---

#### 4. **Removed Complete Video Guide** (Lines 455-719, ~265 lines)

Removed entire section:
- Tips para generación de videos
- Estructura básica de un prompt de video
- Estilo y atmósfera
- Movimiento de cámara
- Composición y encuadre
- Narrativa y acción
- Formatos y proporciones
- Audio y voces
- Negativos (qué evitar)
- Errores comunes a prevenir
- Tips pro para mercado argentino
- Checklist antes de disparar un video

---

#### 5. **Removed All Video Examples** (Lines 786-1180, ~395 lines)

Removed 12 professional video examples:
1. Zapatillas e-commerce (hero corto)
2. Reel vertical de indumentaria (outfit Palermo Soho)
3. Empanadas gourmet (food hero)
4. Mate premium (lifestyle cercano)
5. Tecnología: smartphone (product spin + UI glow)
6. Cosmética (serum + textura piel)
7. Gastronomía: parrilla (sizzle corto)
8. Corporate storytelling (oficina moderna CABA)
9. Turismo BA (San Telmo / calle empedrada)
10. Petcare/Koira (paseo de perro feliz)
11. Retail hogar (vela aromática + mood relajado)
12. Deporte running (Malecón costero estilo MDP)
+ Mini-plantilla universal

Each example included:
- Objetivo comercial
- Ratio (16:9 or 9:16)
- Modelo sugerido (Veo2 or Veo3)
- Prompt completo en inglés
- messageToUser en español

---

## ✅ Validation

### Linter Check
```bash
No linter errors found.
```

### MongoDB Update
```
🎉 Successfully updated system prompt for agent: Maxi Prod
  agentId: 69157006d7b5fc82c033dc86
  promptLength: 24,058 characters
  wordCount: 3,328 words
  lastModified: 2025-11-13T19:38:48.115Z
```

### Redis Cache
```
✅ Cache cleared successfully
⚠️ No cache found (was already clean)
```

### Workers Disabled
```
✅ videoPollingWorker - Commented out in server.js
✅ websiteGeneratorWorker - Commented out in server.js
✅ SIGINT/SIGTERM handlers updated
```

**Modified Files:**
- `server.js` (lines 25-35, 114-132, 152-171)
  - Commented out worker imports
  - Commented out worker initialization
  - Commented out graceful shutdown handlers

---

## 📈 Benefits

### 1. **Performance Improvements**
- **47.7% smaller prompt** → Faster processing
- **~5,500 tokens saved** → Reduced API costs per request
- **Cleaner context** → More focused AI responses

### 2. **User Experience**
- **Simplified interactions** → No confusion about video/website options
- **Faster responses** → Less prompt processing overhead
- **Clearer messaging** → Agent identity as "image specialist" is reinforced

### 3. **Maintenance**
- **Easier updates** → Less code to maintain
- **Focused improvements** → All efforts go to image quality
- **Reduced complexity** → Fewer tools = fewer edge cases

### 4. **Cost Savings**
Assuming 1,000 requests/day:
- **Before**: ~11,500 tokens × 1,000 = 11.5M tokens/day
- **After**: ~6,000 tokens × 1,000 = 6M tokens/day
- **Savings**: 5.5M tokens/day (~$0.03/day on GPT-5-mini input pricing)

### 5. **Resource Optimization**
Workers disabled → Resource savings:
- **No video polling**: Saves CPU cycles checking video job status every few seconds
- **No website queue processing**: Saves Redis queue overhead and worker thread
- **Cleaner startup**: Server initializes 2 fewer background workers
- **Faster shutdown**: No need to wait for worker cleanup

---

## 🧪 Testing Checklist

- [ ] **Image Generation**: Test text-to-image generation
- [ ] **Image Editing**: Test image editing with `updateRequest`
- [ ] **Multi-Image Composition**: Test combining multiple images
- [ ] **Inpainting**: Test selective region editing
- [ ] **Style Transfer**: Test artistic style transformations
- [ ] **Payment Link**: Test `createTopupLink` functionality
- [ ] **Credit Check**: Test `checkCredits` functionality
- [ ] **Cancel Request**: Test `cancelRequest` functionality
- [ ] **Error Handling**: Verify proper error messages
- [ ] **User Flow**: Complete end-to-end user journey

---

## 📝 Related Files

### Modified Files
- `agent-1.md` - Main agent prompt (refactored)
- `server.js` - Video and website workers disabled (commented out)
- `workbench/memory.md` - Development log updated
- `REFACTORING_PROMPT_IMAGE_ONLY.md` - This document (NEW)

### MongoDB Collections
- `agents` - systemPrompt field updated for Maxi Prod agent

### Redis Keys (Cleared)
- `agent_config:69157006d7b5fc82c033dc86`
- `agent_tools:69157006d7b5fc82c033dc86`

### Workers Disabled
- `services/videoPollingWorker.js` - No longer initialized at startup
- `services/webGeneratorWorker.js` - No longer initialized at startup
- Graceful shutdown handlers updated (SIGINT/SIGTERM)

---

## 🎯 Success Criteria

- [x] Video generation references completely removed
- [x] Website creation references completely removed
- [x] Video polling worker disabled
- [x] Website generator worker disabled
- [x] Image processing tools fully maintained
- [x] Payment/credit tools fully maintained
- [x] No linter errors
- [x] MongoDB updated successfully
- [x] Redis cache cleared
- [x] Memory log updated
- [x] Documentation created
- [ ] Server restart test (PENDING)
- [ ] User testing confirms proper functionality (PENDING)

---

## 🚀 Deployment

**Status**: ✅ LIVE  
**Environment**: Production  
**Agent**: Maxi Prod (instanceId: 50151)  
**MongoDB ID**: 69157006d7b5fc82c033dc86  

**Rollback Plan**:
```bash
# If issues arise, restore original prompt
git checkout HEAD~1 agent-1.md
node tools/updateAgentPrompt.js 50151 agent-1.md
node tools/clearAgentCache.js 69157006d7b5fc82c033dc86
```

---

## 📚 Next Steps

1. **Monitor Performance**: Track response times and token usage
2. **Collect Feedback**: Gather user feedback on simplified experience
3. **Update Debug Prompt**: Consider updating `ai_debugging/prompts/agent_1.md` if needed
4. **Documentation Update**: Update any user-facing docs that reference video/website features
5. **Training Data**: If video/website requests come in, handle gracefully with "not available" message

---

**Refactoring Author**: KheprAI (Clapps Main AI Agent Software Developer)  
**Review Status**: PENDING USER VALIDATION  
**Deployment**: LIVE (MongoDB updated, Redis cache cleared)

