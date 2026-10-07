'use strict';

const http = require('http');
const https = require('https');
const Anthropic = require('@anthropic-ai/sdk');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://ollama:11434';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

let _anthropic = null;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey:'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'});
  return _anthropic;
}

// Cached Ollama availability to avoid repeated probes on every request
let _ollamaAvail = null;
let _ollamaCheckedAt = 0;
let _ollamaModel = null;
const OLLAMA_TTL_MS = 60_000;

function httpGetJson(urlStr) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const req = lib.get(urlStr, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON from Ollama: ' + body.slice(0, 80))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama health check timed out')); });
  });
}

async function checkOllama() {
  const now = Date.now();
  if (_ollamaAvail !== null && now - _ollamaCheckedAt < OLLAMA_TTL_MS) {
    return { available: _ollamaAvail, model: _ollamaModel };
  }

  try {
    const data = await httpGetJson(OLLAMA_HOST + '/api/tags');
    const modelNames = (data.models || []).map(m => m.name);
    const PREFERRED = ['llama3.1:8b', 'llama3.1', 'mistral:latest', 'mistral'];
    let chosen = null;
    for (const pref of PREFERRED) {
      const hit = modelNames.find(m => m === pref || m.startsWith(pref + ':') || m.startsWith(pref));
      if (hit) { chosen = hit; break; }
    }
    if (!chosen && modelNames.length > 0) chosen = modelNames[0];
    _ollamaAvail = !!chosen;
    _ollamaModel = chosen || null;
  } catch (_) {
    _ollamaAvail = false;
    _ollamaModel = null;
  }

  _ollamaCheckedAt = Date.now();
  return { available: _ollamaAvail, model: _ollamaModel };
}

function makeOllamaRequest(path, payload, onData, onEnd, onError) {
  const urlObj = new URL(OLLAMA_HOST + path);
  const buf = Buffer.from(JSON.stringify(payload));
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
    path: urlObj.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length },
    timeout: 60000
  };
  const lib = urlObj.protocol === 'https:' ? https : http;
  const req = lib.request(options, (res) => {
    res.on('data', onData);
    res.on('end', onEnd);
    res.on('error', onError);
  });
  req.on('error', onError);
  req.on('timeout', () => { req.destroy(); onError(new Error('Ollama request timed out')); });
  req.write(buf);
  req.end();
  return req;
}

// Stream tokens from Ollama /api/chat to the Express response as SSE
function streamOllama(model, systemPrompt, messages, res) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let partial = '';

    const payload = {
      model,
      stream: true,
      messages: [{ role: 'system', content: systemPrompt }, ...messages]
    };

    makeOllamaRequest(
      '/api/chat',
      payload,
      (chunk) => {
        partial += chunk.toString();
        const lines = partial.split('\n');
        partial = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            const token = obj.message && obj.message.content ? obj.message.content : '';
            if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
          } catch (_) {}
        }
      },
      () => {
        // Flush any remaining partial line
        if (partial.trim()) {
          try {
            const obj = JSON.parse(partial);
            const token = obj.message && obj.message.content ? obj.message.content : '';
            if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
          } catch (_) {}
        }
        if (!settled) { settled = true; resolve(); }
      },
      (err) => { if (!settled) { settled = true; reject(err); } }
    );
  });
}

// Full-text response from Ollama (non-streaming)
function chatOllama(model, systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    let body = '';
    const payload = {
      model,
      stream: false,
      messages: [{ role: 'system', content: systemPrompt }, ...messages]
    };

    makeOllamaRequest(
      '/api/chat',
      payload,
      (chunk) => { body += chunk.toString(); },
      () => {
        try {
          const obj = JSON.parse(body);
          resolve((obj.message && obj.message.content) || '');
        } catch (e) {
          reject(new Error('Invalid Ollama response: ' + body.slice(0, 100)));
        }
      },
      reject
    );
  });
}

// Stream tokens from Anthropic to Express response as SSE
async function streamAnthropic(systemPrompt, messages, res) {
  const client = getAnthropic();
  const stream = client.messages.stream({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages
  });

  return new Promise((resolve, reject) => {
    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
}

// Full-text response from Anthropic (non-streaming)
async function chatAnthropic(systemPrompt, messages) {
  const client = getAnthropic();
  const resp = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages
  });
  return (resp.content[0] && resp.content[0].text) || '';
}

/**
 * streamChat — SSE stream to Express `res`. Tries Ollama first, falls back to Anthropic.
 * Caller must have already set SSE headers and called res.flushHeaders().
 */
async function streamChat(systemPrompt, messages, res) {
  const { available, model } = await checkOllama();
  let ollamaFailed = false;

  if (available && model) {
    try {
      await streamOllama(model, systemPrompt, messages, res);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
      return;
    } catch (err) {
      console.warn('[LLM] Ollama stream failed, falling back to Anthropic:', err.message);
      ollamaFailed = true;
      // Only fall through if nothing has been written yet — the SSE socket is still clean
      // since Ollama errors early (connection refused) before any data is sent.
      if (res.writableEnded) return;
    }
  }

  try {
    await streamAnthropic(systemPrompt, messages, res);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  } catch (err) {
    console.error('[LLM] Anthropic stream failed:', err.message);
    if (!res.writableEnded) {
      const msg = ollamaFailed
        ? 'Both Ollama and Anthropic are unavailable. Check ANTHROPIC_API_KEY and Ollama connectivity.'
        : 'AI service temporarily unavailable. Please check ANTHROPIC_API_KEY.';
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    }
  }
}

/**
 * chat — returns full text string. Tries Ollama first, falls back to Anthropic.
 */
async function chat(systemPrompt, messages) {
  const { available, model } = await checkOllama();
  if (available && model) {
    try {
      return await chatOllama(model, systemPrompt, messages);
    } catch (err) {
      console.warn('[LLM] Ollama chat failed, falling back to Anthropic:', err.message);
    }
  }
  return chatAnthropic(systemPrompt, messages);
}

// ─────────────────────────────────────────────────────────────
// Embeddings (for the RAG document vector store) — Ollama-backed.
// Returns an array of float vectors, or null if embeddings are unavailable
// (callers fall back to lexical retrieval). Keeps the embedding model behind
// this single function so it can be swapped without touching the RAG pipeline.
// ─────────────────────────────────────────────────────────────
function httpPostJson(urlStr, payload) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlStr);
    const lib = urlObj.protocol === 'https:' ? https : http;
    const buf = Buffer.from(JSON.stringify(payload));
    const req = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length },
      timeout: 30000
    }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid JSON: ' + body.slice(0, 80))); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Embedding request timed out')); });
    req.write(buf); req.end();
  });
}

async function embed(texts) {
  const inputs = Array.isArray(texts) ? texts : [texts];
  if (!inputs.length) return [];
  try {
    // Preferred batch endpoint (Ollama >= 0.3)
    const data = await httpPostJson(OLLAMA_HOST + '/api/embed', { model: EMBEDDING_MODEL, input: inputs });
    if (data && Array.isArray(data.embeddings)) return data.embeddings;
  } catch (_) { /* fall through to per-item legacy endpoint */ }
  try {
    const out = [];
    for (const t of inputs) {
      const d = await httpPostJson(OLLAMA_HOST + '/api/embeddings', { model: EMBEDDING_MODEL, prompt: t });
      if (!d || !Array.isArray(d.embedding)) return null;
      out.push(d.embedding);
    }
    return out;
  } catch (_) {
    return null;
  }
}

async function embeddingsAvailable() {
  const v = await embed(['healthcheck']);
  return Array.isArray(v) && v.length > 0 && Array.isArray(v[0]);
}

module.exports = { streamChat, chat, checkOllama, embed, embeddingsAvailable, EMBEDDING_MODEL };
