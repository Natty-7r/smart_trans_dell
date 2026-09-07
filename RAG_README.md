# PRISM Transformer Prototype — RAG Edition

A writable copy of the Safaricom Ethiopia "AI-Powered Transformer Predictive Failure
Prevention" prototype, with **Retrieval-Augmented Generation (RAG)** added to the
AI Command Console and served by a **local LLM**.

- **App URL:** http://localhost:3020/  (original untouched copy still runs on 3012)
- **Local LLM:** Ollama `llama3.1:8b` on http://127.0.0.1:11434 (GPU-accelerated)
- **Retrieval:** Okapi BM25, in-process, no external service, no embeddings API

## How RAG works here

1. **Corpus** (`src/rag.js`) — 510 documents built at startup from the live SQLite
   database (100 each of sites, faults, alerts, maintenance, engineers) plus a curated
   10-doc engineering/regulatory knowledge base (IEC 60076-7, ISO 55000, ECA 1148/2019,
   the ML ensemble, ROI, edge architecture, sensor thresholds, fault taxonomy).
2. **Index** — Okapi BM25 (k1=1.5, b=0.75) with a title-match boost.
3. **Retrieve** — on each chat message, top-6 passages are selected and tagged `[S1]…[S6]`.
4. **Ground** — passages are injected into the system prompt with citation rules
   (`src/routes/ai.js` → `buildSystemPrompt`/`appendRetrievedContext`).
5. **Generate** — the local LLM streams the answer, citing sources inline as `[S#]`.
6. **Show** — the console streams a `sources` SSE event first; the UI renders a
   "Retrieved N grounding sources" panel above each answer, and highlights `[S#]` chips.

## Endpoints added
- `POST /api/ai/chat` — now retrieves + streams a `{"sources":[…]}` event before tokens.
- `GET  /api/ai/rag/status` — corpus size, term count, breakdown by type, engine info.
- `GET  /api/ai/rag/search?q=…&k=6` — retrieval-only preview (no generation).

## Run it

```bash
# 1. local LLM (already running; start only if down)
OLLAMA_HOST=127.0.0.1:11434 ollama serve &

# 2. the app
cd ~/safaricom-transformer-rag
node server.js          # serves on PORT from .env (3020)
```

Config in `.env`: `PORT=3020`, `OLLAMA_HOST=http://127.0.0.1:11434`.
If Ollama is unreachable the code falls back to the Anthropic SDK (needs `ANTHROPIC_API_KEY`).

## Files changed vs. the original prototype
- `src/rag.js` … **new** — BM25 retriever + knowledge base
- `src/routes/ai.js` … retrieval wired into `/chat`; `+/rag/status`, `+/rag/search`
- `public/index.html` … sources panel, citation chips, RAG status bar, intro copy
- `server.js` … `/health` reports the actual `PORT`
- `.env` … port 3020, local Ollama host
