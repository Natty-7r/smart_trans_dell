# Transformer Titan — AI Transformer Remote Monitoring & Predictive Maintenance

AI-enabled transformer monitoring and predictive-maintenance platform for Safaricom
Ethiopia (Dell AI Factory). Node.js + Express + SQLite (better-sqlite3), a vanilla-JS
SPA front-end, and a local-LLM (Ollama) AI assistant with Retrieval-Augmented
Generation.

This document covers the **production-readiness enhancements** (authentication/RBAC,
site & user management, collaboration, expanded maintenance, dashboards, health
parameters, and the RAG knowledge platform) added on top of the original prototype.

---

## Quick start

```bash
npm install            # installs deps incl. better-sqlite3, multer, pdf-parse
npm start              # serves on $PORT (default 3020)
npm test               # runs the automated test suite (node --test)
```

On first boot the app self-seeds the SQLite DB from `data/*.json` **and** seeds the
new platform entities (users, site allocations, collaboration groups, maintenance
schedules, failures, and a health-parameter snapshot for every site).

### Docker

```bash
docker build -t safaricom-transformer-rag .
docker run -d --network host --env-file .env safaricom-transformer-rag
```
`--network host` lets the container reach a host Ollama on `127.0.0.1:11434`.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3020` | HTTP port |
| `OLLAMA_HOST` | `http://ollama:11434` | Local LLM endpoint (chat + embeddings) |
| `ANTHROPIC_API_KEY` | *(empty)* | Optional cloud fallback for the AI assistant |
| `EMBEDDING_MODEL` | `nomic-embed-text` | Ollama model used for RAG embeddings |
| `ADMIN_PASSWORD` | `Admin@123` | Seeded administrator password (**change in prod**) |
| `DEFAULT_USER_PASSWORD` | `Password@123` | Seeded manager/technician password (**change in prod**) |
| `TT_DATABASE_FILE` | `./prism.db` | Override the SQLite file (used by tests) |
| `UPLOAD_DIR` | `./uploads` | Base dir for uploaded docs & group files |

### New dependencies
- **multer** — multipart file uploads (RAG documents, group file sharing).
- **pdf-parse** — best-effort PDF text extraction (loaded lazily; safe if absent).

### External setup for full RAG
The document RAG uses Ollama embeddings. Pull the embedding model once:
```bash
ollama pull nomic-embed-text
ollama pull llama3.1:8b        # chat model (already used by the assistant)
```
If embeddings are unavailable the pipeline **degrades gracefully to lexical
retrieval** — ingestion and search still work.

---

## Authentication & roles (E1)

Session-token auth (opaque bearer tokens, `Authorization: Bearer <token>`);
passwords hashed with Node's built-in `crypto.scrypt` (no plaintext). Log in at the
overlay shown on load.

**Seeded demo accounts** (rotate before production):

| Role | Username | Password | Scope |
|---|---|---|---|
| Administrator | `admin` | `Admin@123` | Everything |
| Regional Manager | `rm.<region>` (e.g. `rm.oromia`) | `Password@123` | Their region's sites |
| Field Technician | `tech.<engineer-id>` (e.g. `tech.eng-003`) | `Password@123` | Explicitly allocated sites |

**RBAC is enforced server-side** (independent of the UI): every `/api/*` route
requires a valid token; role-restricted routes use `requireRole(...)`; and all
site-scoped data is filtered to the caller's allocation both at the SQL layer
(`req.scope()`) and via a response-filtering safety net (`scopeResponses`).

---

## What was added — module map

### Backend
| Area | Files |
|---|---|
| Auth primitives (scrypt, sessions) | `src/auth.js` |
| RBAC + site-scoping middleware | `src/middleware/auth.js` |
| Additive schema (idempotent) | `src/db-extend.js` |
| Platform seed (users, groups, schedules, failures, health) | `src/seed-extend.js` |
| Health-parameter catalog (E6) | `src/config/health-params.js` |
| Telemetry service boundary (E5/E6) | `src/services/telemetry.js` |
| Users (E1/E2) | `src/models/User.js`, `src/routes/users.js`, `src/routes/auth.js` |
| Site management (E2) | `TransformerSite.create/update/remove` + write routes in `src/routes/sites.js` |
| Collaboration (E3) | `src/models/Group.js`, `src/routes/groups.js` (+ escalations router) |
| Maintenance (E4) | `src/models/MaintenanceSchedule.js`, `src/models/Failure.js`, `src/routes/maintenance-schedules.js`, `src/routes/failures.js` |
| Health API (E5/E6) | `src/routes/health.js` |
| RAG documents (E7) | `src/rag-documents.js`, `src/routes/documents.js`, `embed()` in `src/llm.js`, assistant wiring in `src/routes/ai.js` |

### Frontend (vanilla JS, no build step)
| File | Purpose |
|---|---|
| `public/js/auth.js` | Login gate, bearer-token `fetch` patch, role/permission UI gating, user chip |
| `public/js/enhancements.js` | New views: Fleet Health, Maintenance, Collaboration, Knowledge, Admin (registered via `window.TT_VIEWS`) |
| `public/index.html` | Added nav tabs, empty view containers, `showView()` dispatch hook, script tags |

### Tests (`npm test`)
`test/auth.test.js` (hashing/sessions), `test/rbac-scope.test.js` (role scoping +
SQL/response data isolation), `test/maintenance.test.js` (schedule/failure linkage),
`test/rag-documents.test.js` (chunking, cosine, ingest→retrieve).

---

## Key API surface (all under `/api`, all authenticated)

- **Auth:** `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`
- **Users (admin):** `GET/POST /users`, `PATCH /users/:id`, `POST /users/:id/deactivate`, `POST /users/:id/sites`
- **Sites:** `GET /sites`, `GET /sites/:id`, admin `POST/PATCH/DELETE /sites[/:id]`
- **Health:** `GET /health/index`, `/health/site/:id`, `/health/live/:id`, `/health/oil`, `/health/thresholds`, admin `POST /health/refresh`
- **Maintenance:** `GET/POST /maintenance-schedules`, `/maintenance-schedules/calendar`, `/maintenance-schedules/history/:siteId`, `POST /:id/complete`; `GET/POST/PATCH /failures`
- **Collaboration:** `GET/POST /groups`, `/groups/:id/messages`, `/groups/:id/files`, `/groups/:id/members`; `GET/POST/PATCH /escalations`
- **Knowledge (RAG):** `GET/POST /documents`, `POST /documents/:id/reindex`, `DELETE /documents/:id`, `GET /documents/search?q=`, `GET /documents/status`

---

## Health Index & telemetry (E5/E6)

18 parameters across **electrical / thermal / oil / insulation / mechanical**
(`src/config/health-params.js`) feed a weighted **Transformer Health Index**.
Real-time data flows through `src/services/telemetry.js`, which today uses a
`MockProvider` driven by each site's health score. **To integrate real sensor
feeds, implement a provider with the same `getSnapshot(site)` contract and call
`telemetry.ingest()` / `setProvider()` — no downstream code changes required.**

---

## Follow-ups before production

1. **Secrets & auth hardening** — rotate seeded passwords, force first-login
   password change, move to short-lived tokens + refresh or an OIDC/IdP behind the
   existing `verifyToken()`/`login()` surface; add rate-limiting on `/auth/login`.
2. **Real telemetry** — replace `MockProvider` with the NB-IoT/MQTT/edge feed
   ingestion adapter; wire threshold breaches to auto-create alerts/faults.
3. **Production vector store / LLM** — swap the in-SQLite cosine store for a
   dedicated vector DB (pgvector/Qdrant) behind `rag-documents.retrieve()`, and
   choose a production embedding + chat model; add OCR for scanned drawings.
4. **File storage** — move uploads from local disk to object storage (S3/AZBlob);
   add antivirus scanning and size/type quotas.
5. **Dashboard KPI scoping** — the portfolio `GET /api/stats` KPIs are fleet-wide by
   design (executive view); scope them per-allocation if managers should see only
   regional aggregates.
6. **Migrations** — schema is additive/idempotent; adopt a formal migration tool
   before further schema change.
