'use strict';

const express = require('express');
const path = require('path');
const multer = require('multer');
const Group = require('../models/Group');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
const escalations = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'groups');
const upload = multer({ dest: UPLOAD_DIR });

function forbidden(res) {
  return res.status(403).json({ error: { message: 'Forbidden: you are not a member of this group', status: 403, timestamp: new Date().toISOString() } });
}

/** Admin or a member of the group; otherwise send 403 and return false. */
function ensureMember(req, res, groupId) {
  if (req.user.role === 'admin') return true;
  if (Group.isMember(groupId, req.user.user_id)) return true;
  forbidden(res);
  return false;
}

// ── Groups router ────────────────────────────────────────────

// GET /api/groups
router.get('/', (req, res, next) => {
  try {
    res.json({ data: Group.listForUser(req.user), stats: Group.getStats() });
  } catch (err) { next(err); }
});

// POST /api/groups
router.post('/', requireRole('admin', 'regional_manager'), (req, res, next) => {
  try {
    const group = Group.create({
      name: req.body.name,
      description: req.body.description,
      scope_type: req.body.scope_type,
      scope_value: req.body.scope_value,
      created_by: req.user.user_id
    });
    res.status(201).json(group);
  } catch (err) { next(err); }
});

// GET /api/groups/:id
router.get('/:id', (req, res, next) => {
  try {
    const group = Group.findById(req.params.id);
    if (!group) { const e = new Error('Group not found'); e.status = 404; return next(e); }
    if (req.user.role !== 'admin' && !Group.isMember(req.params.id, req.user.user_id)) return forbidden(res);
    res.json(group);
  } catch (err) { next(err); }
});

// GET /api/groups/:id/messages
router.get('/:id/messages', (req, res, next) => {
  try {
    if (!ensureMember(req, res, req.params.id)) return;
    res.json({ data: Group.listMessages(req.params.id, { parentId: req.query.parent_id || null }) });
  } catch (err) { next(err); }
});

// POST /api/groups/:id/messages
router.post('/:id/messages', (req, res, next) => {
  try {
    if (!ensureMember(req, res, req.params.id)) return;
    if (!req.body.body) { const e = new Error('body is required'); e.status = 400; return next(e); }
    const message = Group.addMessage({
      groupId: req.params.id,
      parentId: req.body.parent_id || null,
      userId: req.user.user_id,
      authorName: req.user.full_name || req.user.username,
      body: req.body.body
    });
    res.status(201).json(message);
  } catch (err) { next(err); }
});

// GET /api/groups/:id/members
router.get('/:id/members', (req, res, next) => {
  try {
    if (!ensureMember(req, res, req.params.id)) return;
    const group = Group.findById(req.params.id);
    if (!group) { const e = new Error('Group not found'); e.status = 404; return next(e); }
    res.json({ data: group.members });
  } catch (err) { next(err); }
});

// POST /api/groups/:id/members
router.post('/:id/members', requireRole('admin', 'regional_manager'), (req, res, next) => {
  try {
    if (!req.body.user_id) { const e = new Error('user_id is required'); e.status = 400; return next(e); }
    res.status(201).json(Group.addMember(req.params.id, req.body.user_id, req.body.role_in_group || 'member'));
  } catch (err) { next(err); }
});

// DELETE /api/groups/:id/members/:userId
router.delete('/:id/members/:userId', requireRole('admin', 'regional_manager'), (req, res, next) => {
  try {
    res.json(Group.removeMember(req.params.id, req.params.userId));
  } catch (err) { next(err); }
});

// GET /api/groups/:id/files
router.get('/:id/files', (req, res, next) => {
  try {
    if (!ensureMember(req, res, req.params.id)) return;
    const files = Group.listFiles(req.params.id).map(f => ({
      file_id: f.file_id,
      group_id: f.group_id,
      user_id: f.user_id,
      uploader_name: f.uploader_name,
      original_name: f.original_name,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
      description: f.description,
      created_at: f.created_at,
      download_url: `/api/groups/${f.group_id}/files/${f.file_id}/download`
    }));
    res.json({ data: files });
  } catch (err) { next(err); }
});

// POST /api/groups/:id/files
router.post('/:id/files', (req, res, next) => {
  if (req.user.role !== 'admin' && !Group.isMember(req.params.id, req.user.user_id)) return forbidden(res);
  upload.single('file')(req, res, (uErr) => {
    if (uErr) return next(uErr);
    try {
      if (!req.file) { const e = new Error('file is required'); e.status = 400; return next(e); }
      const file = Group.addFile({
        groupId: req.params.id,
        userId: req.user.user_id,
        uploaderName: req.user.full_name || req.user.username,
        filename: req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        path: req.file.path,
        description: req.body.description || null
      });
      res.status(201).json({
        file_id: file.file_id,
        group_id: file.group_id,
        original_name: file.original_name,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        description: file.description,
        created_at: file.created_at,
        download_url: `/api/groups/${file.group_id}/files/${file.file_id}/download`
      });
    } catch (err) { next(err); }
  });
});

// GET /api/groups/:id/files/:fileId/download
router.get('/:id/files/:fileId/download', (req, res, next) => {
  try {
    if (!ensureMember(req, res, req.params.id)) return;
    const file = Group.getFile(req.params.fileId);
    if (!file || file.group_id !== req.params.id) { const e = new Error('File not found'); e.status = 404; return next(e); }
    res.download(file.path, file.original_name || file.filename, (dErr) => {
      if (dErr && !res.headersSent) { const e = new Error('File not found'); e.status = 404; next(e); }
    });
  } catch (err) { next(err); }
});

// ── Escalations router (mounted at /api/escalations) ─────────

// GET /api/escalations
escalations.get('/', (req, res, next) => {
  try {
    res.json({
      data: Group.listEscalations({
        status: req.query.status || undefined,
        groupId: req.query.group_id || undefined,
        siteId: req.query.site_id || undefined,
        allowedSiteIds: req.allowedSiteIds
      })
    });
  } catch (err) { next(err); }
});

// POST /api/escalations
escalations.post('/', (req, res, next) => {
  try {
    if (!req.body.title) { const e = new Error('title is required'); e.status = 400; return next(e); }
    const escalation = Group.createEscalation({
      title: req.body.title,
      description: req.body.description,
      site_id: req.body.site_id,
      alert_id: req.body.alert_id,
      fault_id: req.body.fault_id,
      group_id: req.body.group_id,
      priority: req.body.priority,
      assigned_to_role: req.body.assigned_to_role,
      raisedBy: req.user.user_id,
      raisedByName: req.user.full_name || req.user.username
    });
    res.status(201).json(escalation);
  } catch (err) { next(err); }
});

// GET /api/escalations/:id
escalations.get('/:id', (req, res, next) => {
  try {
    const escalation = Group.getEscalation(req.params.id);
    if (!escalation) { const e = new Error('Escalation not found'); e.status = 404; return next(e); }
    res.json(escalation);
  } catch (err) { next(err); }
});

// PATCH /api/escalations/:id
escalations.patch('/:id', requireRole('admin', 'regional_manager'), (req, res, next) => {
  try {
    if (req.body.status !== undefined && !['open', 'in_progress', 'resolved'].includes(req.body.status)) {
      const e = new Error('status must be one of open, in_progress, resolved'); e.status = 400; return next(e);
    }
    res.json(Group.updateEscalation(req.params.id, {
      status: req.body.status,
      resolution_notes: req.body.resolution_notes,
      assigned_to_user: req.body.assigned_to_user,
      assigned_to_role: req.body.assigned_to_role
    }));
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.escalations = escalations;
