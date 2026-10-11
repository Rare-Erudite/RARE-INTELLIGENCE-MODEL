# RARE-INTELLIGENCE v1 REST API Integration Contract
## Official Integration Guide for RARE-THE-SIXTH

### 1. Architectural Architecture & Security Rules

1. **Zero-Money Free Tier Policy**:
   - The engine strictly enforces $0.00 incurred expenses.
   - External calls use Google Gemini Free Tier quotas (15 RPM / 1M TPM / 1500 RPD).
   - If quotas are exhausted, requests fail with HTTP 429 (`RATE_LIMIT_EXHAUSTED`). Automatic paid upgrades are forbidden.

2. **Server-Side Secret Isolation**:
   - **DO NOT** embed `GEMINI_API_KEY` in the mobile app (RARE-THE-SIXTH).
   - The mobile application connects to the RARE-INTELLIGENCE server using a lightweight Client API key (`RARE_API_KEY`).
   - The server performs all model provider calls, prompt sanitization, secret redaction, and local fallback handling.

3. **Engine Running vs. Real AI Ready Distinction**:
   - The engine can be running (`isEngineRunning == true`) while in an offline or degraded state where no neural model is ready (`isAiProviderReady == false`).
   - Clients must inspect `isAiProviderReady` to truthfully inform the user whether live AI answers or deterministic offline fallbacks are being utilized.

---

### 2. Authentication & Authorization (RBAC)

All requests to protected endpoints must pass credentials via standard HTTP headers:
```http
Authorization: Bearer <RARE_API_KEY>
X-API-Key: <RARE_API_KEY>
```

#### Roles:
- **`public`**: Unauthenticated callers.
  - Allowed: `GET /api/v1/engine/health`, `GET /api/v1/engine/status`
- **`client`** (RARE-THE-SIXTH application):
  - Allowed: Chat (`/chat`), Tasks (`/tasks/*`, `/queue/*`), Memory (`/memory`), Conversations (`/conversations`), Assistant utilities (`/assistant/*`), Provider catalog (`/providers`), System status.
- **`developer`** (Administrative/Diagnostic):
  - Allowed: All client endpoints PLUS Tools sandbox (`/tools/execute`), Checkpoints (`/build/*`), Self-repair (`/repair/*`), Provider switching (`/providers/switch`), Model downloads, Benchmarks, Upgrade adoption/rollback.

---

### 3. Core Endpoints Specification

#### A. Health & Capability Check
- **Endpoint**: `GET /api/v1/engine/health`
- **Auth**: Public or Client
- **Response**:
```json
{
  "success": true,
  "health": {
    "status": "healthy",
    "operationalState": "ONLINE",
    "isOnline": true,
    "activeProvider": "gemini",
    "availableProviders": [
      {
        "id": "gemini",
        "name": "Google Gemini (Native SDK)",
        "modelIdentifier": "gemini-3.8-flash",
        "isAvailable": true,
        "isConfigured": true,
        "statusMessage": "Operational: live inference verified with gemini-3.8-flash."
      },
      {
        "id": "ollama",
        "name": "Ollama / Local Open-Weight Runtime",
        "modelIdentifier": "llama3.2:1b",
        "isAvailable": false,
        "isConfigured": false,
        "statusMessage": "No local daemon detected at http://127.0.0.1:11434"
      }
    ],
    "memoryStorageType": "file-backed-persistent",
    "zeroBudgetPolicyEnforced": true
  }
}
```

#### B. Conversational Chat
- **Endpoint**: `POST /api/v1/chat`
- **Auth**: `client` or `developer`
- **Request Body**:
```json
{
  "messages": [
    { "role": "user", "content": "Analyze battery optimization for mobile background tasks." }
  ],
  "options": {
    "temperature": 0.7,
    "maxOutputTokens": 1024,
    "systemInstruction": "You are the RARE-THE-SIXTH intelligence engine assistant."
  }
}
```
- **Response**:
```json
{
  "success": true,
  "result": {
    "text": "1. Schedule tasks during unmetered Wi-Fi and charging windows...",
    "provider": "gemini",
    "model": "gemini-3.8-flash",
    "latencyMs": 420,
    "isSimulated": false,
    "costEstimateUSD": 0
  }
}
```

#### C. Conversation Session Lifecycle (RARE-THE-SIXTH Dedicated Endpoints)
1. **Create Conversation**:
   - `POST /api/v1/conversations`
   - Body: `{ "title": "Battery Optimization Chat" }`
   - Response: `{ "success": true, "id": "conv_93f8x2a", "conversation": { ... } }`

2. **List Conversations**:
   - `GET /api/v1/conversations`
   - Response: `{ "success": true, "conversations": [ ... ] }`

3. **Get Conversation History**:
   - `GET /api/v1/conversations/:id`
   - Response: `{ "success": true, "conversation": { "id": "conv_93f8x2a", "messages": [ ... ] } }`

4. **Send Message to Conversation**:
   - `POST /api/v1/conversations/:id/messages`
   - Body: `{ "message": "How do we reduce CPU cycles in offline mode?" }`
   - Response:
     ```json
     {
       "success": true,
       "conversationId": "conv_93f8x2a",
       "message": { "role": "model", "content": "..." },
       "result": { "text": "...", "provider": "local-transformers" }
     }
     ```

5. **Rename/Update Conversation**:
   - `PATCH /api/v1/conversations/:id`
   - Body: `{ "title": "Renamed Chat Title" }`

6. **Delete Conversation**:
   - `DELETE /api/v1/conversations/:id`
   - Response: `{ "success": true, "deleted": true }`

#### D. Persistent Task Queue (Offline Capable)
- **Endpoint**: `POST /api/v1/queue/enqueue`
- **Auth**: `client` or `developer`
- **Request Body**:
```json
{
  "objective": "Index offline workspace documents",
  "networkDependency": "local_only",
  "constraints": ["Do not consume cellular data"]
}
```
- **Response**:
```json
{
  "success": true,
  "task": {
    "taskId": "task_j38f92k",
    "objective": "Index offline workspace documents",
    "networkDependency": "local_only",
    "status": "pending",
    "createdAt": 1791726000000
  }
}
```

---

### 4. Flutter Integration Code Example

```dart
import 'rare_intelligence_client.dart';

// Configure authorized endpoint and secure key via environment or Flutter secure storage
final client = RareIntelligenceClient(
  baseUrl: const String.fromEnvironment('RARE_ENGINE_URL', defaultValue: 'http://10.0.2.2:3000'), // 10.0.2.2 for Android emulator
  apiKey: const String.fromEnvironment('RARE_API_KEY', defaultValue: ''), // Injected via --dart-define
);

// 1. Check health before initiating UI flow
final status = await client.checkHealth();
if (status.isAiProviderReady) {
  print('AI model is active: ${status.activeProvider} (${status.modelIdentifier})');
} else {
  print('Running in offline/diagnostic mode: ${status.summaryMessage}');
}

// 2. Send Chat Prompt
try {
  final reply = await client.sendMessage(
    prompt: 'How should RARE-THE-SIXTH handle offline task resumption?',
  );
  print('Response (${reply.isSimulated ? "Mock" : "Real AI"}): ${reply.text}');
} on RareIntelligenceException catch (e) {
  print('Engine error [${e.code}]: ${e.message}');
}
```

---

### 5. Standard Error Format

All errors return uniform JSON with correlation IDs and error codes:
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXHAUSTED",
    "message": "Quota exhausted on Gemini free tier (HTTP 429). Blocked until quota reset; paid auto-upgrades are strictly disabled.",
    "correlationId": "req_8v2kd9m",
    "statusCode": 429,
    "timestamp": 1791726050000,
    "isTransient": true
  }
}
```
