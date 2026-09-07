'use strict';

/**
 * routes/documents.js — RAG document store API (mounted at /api/documents).
 *
 * requireAuth is mounted globally upstream, so req.user is always present here.
 * Listing/status/search are open to any authenticated user; mutations require
 * an elevated role. Upload/ingest is delegated to rag-documents.js so the
 * embedding model and vector store stay swappable.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDb } = require('../database');
const { requireRole } = require('../middleware/auth');
const ragDocs = require('../rag-documents');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'documents');
const upload = multer({ dest: UPLOAD_DIR });

const SOURCE_TYPES = ['manual', 'drawing', 'failure_history', 'sop', 'fault_log', 'other'];

function err(message, status) {
  return { error: { message, status, timestamp: new Date().toISOString() } };
}

/** documents row + its live chunk_count. */
function docWithChunks(db, id) {
  const doc = db.prepare('SELECT * FROM documents WHERE doc_id = ?').get(id);
  if (!doc) return null;
  const c = db.prepare('SELECT COUNT(*) AS c FROM document_chunks WHERE doc_id = ?').get(id).c;
  return { ...doc, chunk_count: c };
}

// GET / — list documents (filters: source_type, status, q over title/description)
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const where = [];
    const params = [];
    if (req.query.source_type) { where.push('source_type = ?'); params.push(String(req.query.source_type)); }
    if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status)); }
    if (req.query.q && String(req.query.q).trim()) {
      where.push('(title LIKE ? OR description LIKE ?)');
      const like = '%' + String(req.query.q).trim() + '%';
      params.push(like, like);
    }
    const sql = 'SELECT * FROM documents' +
      (where.length ? ' WHERE ' + where.join(' AND ') : '') +
      ' ORDER BY created_at DESC, rowid DESC';
    const data = db.prepare(sql).all(...params);
    res.json({ data, status: ragDocs.status() });
  } catch (e) { next(e); }
});

// GET /status — vector store status + embeddings availability
router.get('/status', async (req, res, next) => {
  try {
    const s = ragDocs.status();
    const embeddingsAvailable = await require('../llm').embeddingsAvailable();
    res.json({ ...s, embeddingsAvailable });
  } catch (e) { next(e); }
});

// GET /search?q=&k= — retrieval preview
router.get('/search', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(400).json(err('query param q is required', 400));
    const k = Math.min(20, Math.max(1, parseInt(req.query.k, 10) || 5));
    const results = await ragDocs.retrieve(q, k);
    res.json({ query: q, results });
  } catch (e) { next(e); }
});

// POST /reindex-all — re-ingest every document (admin only)
router.post('/reindex-all', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await ragDocs.ingestAll({ onlyPending: false });
    res.json(result);
  } catch (e) { next(e); }
});

// POST / — upload/create a document then ingest it
router.post('/', requireRole('admin', 'regional_manager'), upload.single('file'), async (req, res, next) => {
  try {
    const db = getDb();
    const body = req.body || {};
    const title = (body.title || '').toString().trim();
    const text = (body.text || '').toString();
    const description = (body.description || '').toString().trim() || null;
    const siteId = (body.site_id || '').toString().trim() || null;

    let sourceType = (body.source_type || 'other').toString().trim();
    if (!SOURCE_TYPES.includes(sourceType)) sourceType = 'other';

    const hasFile = !!req.file;
    const hasText = !!text.trim();
    // Require at least one of: uploaded file, pasted text, or (title + description).
    if (!hasFile && !hasText && !(title && description)) {
      return res.status(400).json(err('Provide a file, pasted text, or both title and description', 400));
    }

    const id = ragDocs.docId();

    let originalName = null;
    let mimeType = null;
    let sizeBytes = null;
    let storedPath = null;

    if (hasFile) {
      originalName = req.file.originalname;
      mimeType = req.file.mimetype;
      sizeBytes = req.file.size;
      storedPath = req.file.path;
    } else if (hasText) {
      // Persist pasted text to a .txt file so ingestion has a real source path.
      storedPath = path.join(UPLOAD_DIR, id + '.txt');
      fs.writeFileSync(storedPath, text, 'utf8');
      originalName = (title || id) + '.txt';
      mimeType = 'text/plain';
      sizeBytes = Buffer.byteLength(text, 'utf8');
    }

    const finalTitle = title || originalName || id;

    db.prepare(
      `INSERT INTO documents
         (doc_id, title, source_type, original_name, mime_type, size_bytes, path,
          description, site_id, uploaded_by, uploaded_by_name, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(
      id, finalTitle, sourceType, originalName, mimeType, sizeBytes, storedPath,
      description, siteId, req.user.user_id, req.user.full_name || null
    );

    await ragDocs.ingestDocument(id);

    res.status(201).json(docWithChunks(db, id));
  } catch (e) { next(e); }
});

// POST /:id/reindex — re-ingest a single document
router.post('/:id/reindex', requireRole('admin', 'regional_manager'), async (req, res, next) => {
  try {
    const db = getDb();
    const exists = db.prepare('SELECT doc_id FROM documents WHERE doc_id = ?').get(req.params.id);
    if (!exists) return res.status(404).json(err('Document not found', 404));
    await ragDocs.ingestDocument(req.params.id);
    res.json(docWithChunks(db, req.params.id));
  } catch (e) { next(e); }
});

// DELETE /:id — remove chunks, the row, and best-effort unlink the file
router.delete('/:id', requireRole('admin', 'regional_manager'), (req, res, next) => {
  try {
    const db = getDb();
    const doc = db.prepare('SELECT * FROM documents WHERE doc_id = ?').get(req.params.id);
    if (!doc) return res.status(404).json(err('Document not found', 404));
    db.prepare('DELETE FROM document_chunks WHERE doc_id = ?').run(req.params.id);
    db.prepare('DELETE FROM documents WHERE doc_id = ?').run(req.params.id);
    if (doc.path) { try { fs.unlinkSync(doc.path); } catch (_) { /* best-effort */ } }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /:id — single document + chunk_count (defined last to avoid shadowing)
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const doc = docWithChunks(db, req.params.id);
    if (!doc) return res.status(404).json(err('Document not found', 404));
    res.json(doc);
  } catch (e) { next(e); }
});

module.exports = router;
