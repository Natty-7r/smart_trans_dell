'use strict';

const path = require('path');
process.env.TT_DATABASE_FILE = path.join(require('os').tmpdir(), `tt-rag-${process.pid}.db`);
// Point embeddings at an unreachable host so the pipeline exercises its
// lexical fallback deterministically (no Ollama needed to run the test).
process.env.OLLAMA_HOST = 'http://127.0.0.1:1';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const crypto = require('crypto');

const { init, getDb } = require('../src/database');
const ragDocs = require('../src/rag-documents');

test.before(() => { init(); });
test.after(() => { try { fs.unlinkSync(process.env.TT_DATABASE_FILE); } catch (_) {} });

test('chunkText splits long text into overlapping chunks', () => {
  const text = 'Para one about oil temperature.\n\n' + 'word '.repeat(400) + '\n\nPara three about vibration.';
  const chunks = ragDocs.chunkText(text, { chunkSize: 300, overlap: 50 });
  assert.ok(chunks.length >= 2, 'produced multiple chunks');
  chunks.forEach(c => assert.ok(c.trim().length > 0, 'no empty chunks'));
});

test('cosineSim: identical=1, orthogonal=0', () => {
  const a = [1, 2, 3];
  assert.ok(Math.abs(ragDocs.cosineSim(a, a) - 1) < 1e-9);
  assert.ok(Math.abs(ragDocs.cosineSim([1, 0], [0, 1])) < 1e-9);
});

test('ingest + retrieve grounds on uploaded content (lexical fallback)', async () => {
  const db = getDb();
  const docId = 'DOC-' + crypto.randomBytes(4).toString('hex');
  db.prepare(`INSERT INTO documents (doc_id, title, source_type, description, status)
              VALUES (?, ?, 'sop', ?, 'pending')`).run(
    docId, 'Bushing Failure SOP',
    'If bushing partial discharge is detected, de-energize the transformer and inspect the HV bushing for moisture ingress and cracking.'
  );
  const result = await ragDocs.ingestDocument(docId);
  assert.notStrictEqual(result && result.ok, false, 'ingestion did not hard-fail');

  const row = db.prepare('SELECT status, chunk_count FROM documents WHERE doc_id = ?').get(docId);
  assert.strictEqual(row.status, 'indexed');
  assert.ok(row.chunk_count >= 1, 'chunks stored');

  const hits = await ragDocs.retrieve('what to do about bushing partial discharge', 3);
  assert.ok(hits.length >= 1, 'retrieved at least one chunk');
  assert.ok(hits[0].snippet.toLowerCase().includes('bushing'), 'grounded in the uploaded doc');
  assert.ok(['vector', 'lexical'].includes(hits[0].method));
});

test('status() reports the document store size', () => {
  const s = ragDocs.status();
  assert.ok(s.documents >= 1 && s.chunks >= 1);
});
