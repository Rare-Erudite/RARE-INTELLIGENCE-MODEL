# RARE-INTELLIGENCE Engine

> **Mission:** A modular, production-oriented AI intelligence engine engineered to power, integrate with, and continuously improve **RARE-THE-SIXTH**.
> **Zero-Budget Policy:** Strictly $0.00 incurred expenses. Powered exclusively by free-tier services, local open-weight runtimes, sandboxed deterministic verification, and local durable persistence.

---

## 1. Architectural Overview & Responsibilities

RARE-INTELLIGENCE implements a decoupled, resilient architecture covering the complete intelligence engine lifecycle:

1. **Intelligence Runtime & Central Orchestrator:** Unified singleton entrypoint in `src/engine/engine.ts`.
2. **Centralized Error & Resilience Architecture:**
   - Typed error contract (`AppError` in `src/engine/errors/app-error.ts`) with stable machine-readable codes (`RATE_LIMIT_EXHAUSTED`, `PATH_TRAVERSAL_BLOCKED`, `CIRCUIT_BREAKER_OPEN`, etc.).
   - Express centralized error middleware with request correlation IDs (`X-Correlation-Id`) and zero credential/stack trace leakage to unauthorized clients.
   - Provider circuit breaker (`src/engine/errors/circuit-breaker.ts`) protecting against hammering failing external services.
   - Bounded exponential backoff with jitter (`src/engine/errors/retry.ts`) that strictly refuses to retry non-transient failures.
3. **Durable Multi-Collection State Persistence:**
   - Multi-collection storage engine (`src/engine/memory/file-persistent.ts`) supporting:
     - `memories` (explicitly saved long-term preferences and facts)
     - `tasks` (plans, step statuses, checkpoint IDs)
     - `diagnostics` (traceable diagnostic audit reports)
     - `repairs` (self-repair execution logs and outcomes)
     - `checkpoints` (file snapshots for rollback)
     - `auditEvents` (administrative and security events)
   - Atomic writes (`.tmp` file swapping to eliminate partial writes).
   - Rotating backups in `data/backups/`.
   - SHA-256 integrity checksum calculation and automatic corruption recovery.
   - Automated restart-durability verification (`verifyRestartDurability()`).
4. **Self-Diagnostic Subsystem:**
   - Diagnostic engine (`src/engine/diagnostics/diagnostics-engine.ts`) auditing 10 subsystems:
     1. Server & API readiness (`server_api`)
     2. Model provider availability & quota health (`provider_health`)
     3. Tool registry integrity & parameter schemas (`tool_registry`)
     4. Filesystem workspace containment & traversal defense (`filesystem_sandbox`)
     5. Durable storage health, file writes, and backups (`storage_integrity`)
     6. Project manifest & npm scripts (`project_manifest`)
     7. Code syntax balance & static AST indicators (`syntax_integrity`)
     8. Task executor state & bounds (`task_executor`)
     9. Capability upgrade baseline & rollback readiness (`upgrade_registry`)
     10. Zero-budget policy enforcement (`budget_enforcement`)
   - Produces durable `DiagnosticReport` records with status (`HEALTHY`, `DEGRADED`, `REPAIRABLE`, etc.).
5. **Autonomous Bounded Self-Repair Subsystem:**
   - Self-repair engine (`src/engine/repair/self-repair-engine.ts`) executing the verified 12-stage lifecycle:
     `DETECT → COLLECT EVIDENCE → CLASSIFY → IDENTIFY ROOT CAUSE → SELECT REMEDIATION → CHECK PERMISSIONS → CREATE CHECKPOINT → APPLY REPAIR → RUN TARGETED TESTS → VERIFY REAL BEHAVIOR → ACCEPT OR ROLLBACK → RECORD OUTCOME`.
   - Includes demonstrable harmless fault self-repair test with independent AST balance verification.
6. **Safe Self-Build and Checkpoints:**
   - Project build engine (`src/engine/self-build/project-builder.ts`) with snapshot capture, sandboxed file modifications, and atomic rollback to checkpoints.
7. **Future Assistant Foundation (RARE-THE-SIXTH):**
   - `AssistantFoundation` (`src/engine/assistant/assistant-foundation.ts`) offering:
     - Conversational reasoning with context token budgeting.
     - Grounded research & contradiction detection.
     - Document extraction (CSV tables, JSON, Markdown).
     - Safe URL reader with SSRF defense (blocking private IPs, loopbacks, and cloud metadata endpoints).
     - Multimodal interface contract declarations (transcription, TTS, vision).
8. **Model Provider Abstraction:**
   - `gemini`: Native `@google/genai` SDK (`gemini-3.8-flash` / `gemini-3.1-flash-lite`, User-Agent `aistudio-build`, cached status, 15s timeout).
   - `ollama`: Real local open-weight adapter (probes `http://127.0.0.1:11434`; reports offline status truthfully without faking).
   - `diagnostic-mock`: Deterministic offline sandbox provider with explicit `isSimulated: true` label.
9. **Security Sandbox & Permissions:**
   - Path containment checking (`../../` traversal blocking).
   - Secret redaction (masking API keys, Bearer tokens).
   - 4 permission tiers (`READ_ONLY`, `WORKSPACE_WRITE`, `NETWORK_ACCESS`, `SYSTEM_COMMAND`).
10. **Automated Quality Gates:**
    - 21-point automated test suite (`src/engine/tests/engine-test-suite.ts`) covering all layers.

---

## 2. Installation & Quickstart

### Prerequisites
- Node.js >= 18
- npm

### Installation
```bash
npm install
```

### Starting the Server
```bash
# Development mode with live Vite middleware & Express API
npm run dev

# Or production build
npm run build
npm start
```
The server binds to `0.0.0.0:3000` (or `process.env.PORT`).

---

## 3. Running Quality Gates and Tests

Execute the full 21-point automated test suite:
```bash
npm test
```
Type-check the codebase:
```bash
npm run lint
```

---

## 4. API Reference for RARE-THE-SIXTH

### Core Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/engine/health` | Engine readiness, active provider, storage type, and uptime |
| `GET` | `/api/v1/engine/status` | High-level engine telemetry, circuit breaker stats, budget compliance |
| `GET` | `/api/v1/diagnostics/run` | Run comprehensive 10-subsystem diagnostic audit |
| `GET` | `/api/v1/diagnostics/reports` | Retrieve durable diagnostic audit history |
| `POST` | `/api/v1/repair/run` | Execute autonomous self-repair on detected findings |
| `POST` | `/api/v1/repair/test-harmless-fault` | Run 12-stage self-repair demonstration on test fixture |
| `GET` | `/api/v1/build/checkpoints` | List saved workspace checkpoints |
| `POST` | `/api/v1/build/checkpoints/:id/restore`| Rollback workspace files to specified checkpoint |
| `POST` | `/api/v1/assistant/research` | Decompose research questions and detect contradictions |
| `POST` | `/api/v1/assistant/document-parse` | Extract structured tables from CSV, JSON, Markdown |
| `POST` | `/api/v1/assistant/safe-url-read` | Fetch external content with anti-SSRF IP firewall |
| `GET` | `/api/v1/assistant/multimodal-capabilities` | Query multimodal interface support status |
| `POST` | `/api/v1/tasks/execute` | Decompose and execute autonomous bounded task with verification |
| `POST` | `/api/v1/chat` | Conversational context with tool calling |
| `GET` | `/api/v1/memory` | Query persistent memories, preferences, and checkpoints |
| `POST` | `/api/v1/memory` | Store new persistent memory item |
| `POST` | `/api/v1/storage/verify-restart` | Verify atomic write and cold restart durability |
| `POST` | `/api/v1/storage/backup` | Create rotating persistent storage backup |
| `GET` | `/api/v1/circuit-breaker/stats` | Inspect provider circuit breaker status and failure counts |
| `POST` | `/api/v1/circuit-breaker/reset` | Manually reset circuit breaker to CLOSED |
| `POST` | `/api/v1/tests/run` | Run 21-point automated test suite with full assertion report |

---

## 5. Storage Durability and Hosting Limitations

- **Local Execution:** Data is written atomically to `data/rare_intelligence_memory.json` with temporary-file swapping and rotating backups in `data/backups/`. Survives server process restarts.
- **Preview Hosting (Cloud Run):** Filesystem storage in cloud container previews is ephemeral between container redeployments. For durable persistence in production, mount a local persistent disk or run the Node.js service on self-hosted hardware.
- **Integrity Recovery:** If the primary JSON file is ever corrupted, the engine automatically attempts restoration from the newest verified backup in `data/backups/`.
