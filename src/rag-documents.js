'use strict';

/**
 * rag-documents.js — DOCUMENT vector store for the PRISM AI Command Console.
 *
 * Parallel to rag.js (the in-process BM25 RAG over live operational data), this
 * module is the uploaded-DOCUMENT knowledge layer: it extracts text from files
 * (txt/md/csv/json/pdf) or pasted content, splits it into overlapping chunks,
 * embeds each chunk with the local embedding model (llm.embed, Ollama-backed)
 * and stores the vectors as JSON in the `document_chunks` table. Retrieval scores
 * chunks by cosine similarity in JS, with a lexical (word-overlap) fallback when
 * embeddings are unavailable or no embedded chunks exist.
 *
 * The embedding model and the vector store are kept behind these functions so
 * either can be swapped later without touching callers (the AI assistant).
 */

const fs = require('fs');
const crypto = require('crypto');
const { getDb } = require('./database');
const llm = require('./llm');

// ───────────────────────────────────────────────────────────────
// IDs
// ───────────────────────────────────────────────────────────────
function docId() { return 'DOC-' + crypto.randomBytes(6).toString('hex'); }
function chunkId() { return 'CHK-' + crypto.randomBytes(8).toString('hex'); }

// ───────────────────────────────────────────────────────────────
// Text extraction
// ───────────────────────────────────────────────────────────────
/**
 * extractText — plain text from an uploaded file.
 *   text-like (.txt/.md/.csv/.json, mime text/* or application/json) → utf8 read
 *   application/pdf → pdf-parse (lazy, guarded); '' on any failure
 *   other binary (images/drawings) → '' (caller falls back to title+description)
 */
async function extractText(filePath, mimeType, originalName) {
  if (!filePath) return '';
  const name = String(originalName || filePath).toLowerCase();
  const mime = String(mimeType || '').toLowerCase();
  const textExt = /\.(txt|md|csv|json|log|text)$/.test(name);
  const textMime = mime.startsWith('text/') || mime === 'application/json';

  if (textExt || textMime) {
    try { return fs.readFileSync(filePath, 'utf8'); }
    catch (e) { console.warn('[RAG-DOC] text read failed:', e.message); return ''; }
  }

  if (mime === 'application/pdf' || /\.pdf$/.test(name)) {
    try {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return (data && data.text) ? data.text : '';
    } catch (e) {
      console.warn('[RAG-DOC] pdf-parse failed:', e.message);
      return '';
    }
  }

  // Unknown/binary (images, CAD drawings, etc.) — not text-extractable.
  return '';
}

// ───────────────────────────────────────────────────────────────
// Chunking
// ───────────────────────────────────────────────────────────────
/**
 * chunkText — overlapping character-based chunks, cut on paragraph/sentence
 * boundaries where possible. Returns an array of non-empty strings.
 */
function chunkText(text, { chunkSize = 900, overlap = 150 } = {}) {
  const clean = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  const step = Math.max(1, chunkSize - overlap);
  const chunks = [];
  let start = 0;

  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);

    // Prefer to break on a boundary within the tail of the window.
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const searchFrom = Math.floor(window.length * 0.5);
      const para = window.lastIndexOf('\n\n');
      const sentence = Math.max(
        window.lastIndexOf('. '),
        window.lastIndexOf('.\n'),
        window.lastIndexOf('! '),
        window.lastIndexOf('? ')
      );
      const nl = window.lastIndexOf('\n');
      let cut = -1;
      if (para >= searchFrom) cut = para + 2;
      else if (sentence >= searchFrom) cut = sentence + 1;
      else if (nl >= searchFrom) cut = nl + 1;
      if (cut > 0) end = start + cut;
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);

    if (end >= clean.length) break;
    start = Math.max(start + step, end - overlap);
  }

  return chunks.filter(c => c.length);
}

// ───────────────────────────────────────────────────────────────
// Ingestion (re-indexing)
// ───────────────────────────────────────────────────────────────
function wordCount(s) {
  return String(s == null ? '' : s).trim().split(/\s+/).filter(Boolean).length;
}

function now() { return new Date().toISOString().replace('T', ' ').slice(0, 19); }

/**
 * ingestDocument — the core (re)indexer for a single document. Idempotent:
 * existing chunks for the doc are deleted first so re-ingestion is safe.
 */
async function ingestDocument(id) {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM documents WHERE doc_id = ?').get(id);
  if (!doc) { const e = new Error('Document not found'); e.status = 404; throw e; }

  try {
    let source = '';
    if (doc.path) {
      source = await extractText(doc.path, doc.mime_type, doc.original_name);
    }
    if (!source || !source.trim()) {
      source = `${doc.title || ''}\n${doc.description || ''}`.trim();
    }

    const chunks = chunkText(source, {});

    // Always start clean so this supports re-ingestion.
    db.prepare('DELETE FROM document_chunks WHERE doc_id = ?').run(id);

    // Embeddings — null when unavailable so lexical fallback still works.
    let vectors = null;
    if (chunks.length) {
      try { vectors = await llm.embed(chunks); }
      catch (e) { console.warn('[RAG-DOC] embed failed:', e.message); vectors = null; }
    }
    const embedModel = (vectors && vectors.length) ? llm.EMBEDDING_MODEL : null;

    const insert = db.prepare(
      `INSERT INTO document_chunks
         (chunk_id, doc_id, chunk_index, content, token_count, embedding, embed_model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertAll = db.transaction((rows) => {
      for (const r of rows) {
        insert.run(r.chunk_id, r.doc_id, r.chunk_index, r.content, r.token_count, r.embedding, r.embed_model);
      }
    });

    const rows = chunks.map((content, i) => {
      const vec = vectors && Array.isArray(vectors[i]) ? vectors[i] : null;
      return {
        chunk_id: chunkId(),
        doc_id: id,
        chunk_index: i,
        content,
        token_count: wordCount(content),
        embedding: vec ? JSON.stringify(vec) : null,
        embed_model: vec ? llm.EMBEDDING_MODEL : null
      };
    });
    insertAll(rows);

    db.prepare(
      `UPDATE documents
          SET status = 'indexed', char_count = ?, chunk_count = ?, embed_model = ?,
              indexed_at = ?, error = NULL
        WHERE doc_id = ?`
    ).run(source.length, rows.length, embedModel, now(), id);

    return {
      ok: true,
      doc_id: id,
      status: 'indexed',
      char_count: source.length,
      chunk_count: rows.length,
      embedded: !!embedModel,
      embed_model: embedModel
    };
  } catch (err) {
    try {
      db.prepare("UPDATE documents SET status = 'failed', error = ? WHERE doc_id = ?")
        .run(String(err && err.message ? err.message : err), id);
    } catch (e) { console.warn('[RAG-DOC] failed to record error:', e.message); }
    return { ok: false, doc_id: id, error: String(err && err.message ? err.message : err) };
  }
}

/**
 * ingestAll — incremental/re-ingestion entry point. Iterates documents (all, or
 * only status pending/failed when onlyPending) and ingests each.
 */
async function ingestAll({ onlyPending = false } = {}) {
  const db = getDb();
  const rows = onlyPending
    ? db.prepare("SELECT doc_id FROM documents WHERE status IN ('pending', 'failed')").all()
    : db.prepare('SELECT doc_id FROM documents').all();

  let indexed = 0;
  let failed = 0;
  for (const r of rows) {
    const res = await ingestDocument(r.doc_id);
    if (res && res.ok) indexed += 1; else failed += 1;
  }
  return { indexed, failed };
}

// ───────────────────────────────────────────────────────────────
// Similarity / retrieval
// ───────────────────────────────────────────────────────────────
/** cosineSim — cosine similarity of two float arrays (0 if either norm is 0). */
function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const STOPWORDS = new Set(
  ('a an the of to in on at for and or is are was were be been being with by from as this ' +
   'that these those it its into over under up down out about which who what when where how ' +
   'why not no do does did has have had will would can could should may might must than then ' +
   'there here your you our we they them their his her he she i me my us if but so such also ' +
   'per via any all each some more most only just very much many both')
    .split(/\s+/)
);

function tokenize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .split(/\s+/)
    .map(t => t.replace(/^\.+|\.+$/g, ''))
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

/** Simple TF word-overlap score of a query against chunk content. */
function lexicalScore(qtokens, content) {
  const q = new Set(qtokens);
  if (!q.size) return 0;
  const ctoks = tokenize(content);
  if (!ctoks.length) return 0;
  const tf = new Map();
  for (const t of ctoks) if (q.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
  let score = 0;
  for (const c of tf.values()) score += 1 + Math.log(c);
  return score / Math.sqrt(ctoks.length); // length-normalise
}

function snippetOf(content) {
  const s = String(content || '').trim();
  return s.length > 240 ? s.slice(0, 240) : s;
}

/**
 * retrieve — query-time retriever for the AI assistant.
 *   1. Try embeddings: embed the query, score every embedded chunk by cosineSim,
 *      take top-k (method 'vector').
 *   2. Fall back to lexical word-overlap over all chunks (method 'lexical') when
 *      embeddings are unavailable or no embedded chunks exist.
 * Returns [] when there are no chunks.
 */
async function retrieve(query, k = 5) {
  const db = getDb();
  const q = String(query == null ? '' : query).trim();
  if (!q) return [];

  const total = db.prepare('SELECT COUNT(*) AS c FROM document_chunks').get().c;
  if (!total) return [];

  const join =
    `SELECT dc.doc_id, dc.chunk_index, dc.content, dc.embedding,
            d.title, d.source_type
       FROM document_chunks dc
       JOIN documents d ON d.doc_id = dc.doc_id`;

  // ── 1. Vector path ──
  const embeddedCount = db.prepare('SELECT COUNT(*) AS c FROM document_chunks WHERE embedding IS NOT NULL').get().c;
  if (embeddedCount > 0) {
    let qvec = null;
    try { qvec = await llm.embed([q]); }
    catch (e) { console.warn('[RAG-DOC] query embed failed:', e.message); qvec = null; }

    if (qvec && Array.isArray(qvec[0])) {
      const rows = db.prepare(join + ' WHERE dc.embedding IS NOT NULL').all();
      const scored = [];
      for (const r of rows) {
        let vec;
        try { vec = JSON.parse(r.embedding); } catch (_) { continue; }
        const s = cosineSim(qvec[0], vec);
        if (s > 0) scored.push({ r, s });
      }
      scored.sort((a, b) => b.s - a.s);
      return scored.slice(0, k).map(({ r, s }) => ({
        doc_id: r.doc_id,
        title: r.title,
        source_type: r.source_type,
        chunk_index: r.chunk_index,
        snippet: snippetOf(r.content),
        score: Math.round(s * 1000) / 1000,
        method: 'vector'
      }));
    }
  }

  // ── 2. Lexical fallback ──
  const qtokens = tokenize(q);
  const rows = db.prepare(join).all();
  const scored = [];
  for (const r of rows) {
    const s = lexicalScore(qtokens, r.content);
    if (s > 0) scored.push({ r, s });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map(({ r, s }) => ({
    doc_id: r.doc_id,
    title: r.title,
    source_type: r.source_type,
    chunk_index: r.chunk_index,
    snippet: snippetOf(r.content),
    score: Math.round(s * 1000) / 1000,
    method: 'lexical'
  }));
}

// ───────────────────────────────────────────────────────────────
// Status
// ───────────────────────────────────────────────────────────────
function status() {
  const db = getDb();
  const documents = db.prepare('SELECT COUNT(*) AS c FROM documents').get().c;
  const indexed = db.prepare("SELECT COUNT(*) AS c FROM documents WHERE status = 'indexed'").get().c;
  const chunks = db.prepare('SELECT COUNT(*) AS c FROM document_chunks').get().c;
  const embeddedChunks = db.prepare('SELECT COUNT(*) AS c FROM document_chunks WHERE embedding IS NOT NULL').get().c;
  return {
    documents,
    indexed,
    chunks,
    embeddedChunks,
    embedModel: llm.EMBEDDING_MODEL
  };
}

module.exports = {
  docId,
  extractText,
  chunkText,
  ingestDocument,
  ingestAll,
  cosineSim,
  retrieve,
  status
};
