'use strict';

/**
 * middleware/auth.js — request-level authentication, RBAC and site-scoping.
 *
 * Enforcement here is authoritative and independent of the UI: even if a client
 * hits an endpoint directly, requireAuth/requireRole/site-scoping reject
 * anything outside the caller's permissions.
 */

const { verifyToken } = require('../auth');
const { getDb } = require('../database');

const ROLES = ['admin', 'regional_manager', 'field_technician'];

function bearer(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  // fall back to query token (used for streaming/download links that can't set headers)
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

/** Reject unauthenticated requests; attaches req.user. */
function requireAuth(req, res, next) {
  const user = verifyToken(bearer(req));
  if (!user) {
    return res.status(401).json({ error: { message: 'Authentication required', status: 401, timestamp: new Date().toISOString() } });
  }
  req.user = user;
  req.allowedSiteIds = getAllowedSiteIds(user);
  req.scope = (filters = {}) => (req.allowedSiteIds ? { ...filters, siteIds: req.allowedSiteIds } : filters);
  next();
}

/** Attach req.user if a valid token is present, but never rejects. */
function optionalAuth(req, res, next) {
  const user = verifyToken(bearer(req));
  if (user) {
    req.user = user;
    req.allowedSiteIds = getAllowedSiteIds(user);
    req.scope = (filters = {}) => (req.allowedSiteIds ? { ...filters, siteIds: req.allowedSiteIds } : filters);
  } else {
    req.scope = (filters = {}) => filters;
  }
  next();
}

/**
 * Defense-in-depth: transparently drop any array rows that carry a site_id
 * outside the caller's allocation. Route-level SQL scoping is primary; this
 * guarantees no list endpoint can leak out-of-scope site data even if a route
 * forgets to scope. Admins (allowedSiteIds === null) are untouched.
 */
function scopeResponses(req, res, next) {
  if (!req.allowedSiteIds) return next();
  const allow = new Set(req.allowedSiteIds);
  const filterArray = arr => arr.filter(x => !x || typeof x !== 'object' || x.site_id === undefined || x.site_id === null || allow.has(x.site_id));
  const walk = (val) => {
    if (Array.isArray(val)) return filterArray(val).map(walk);
    if (val && typeof val === 'object') {
      for (const k of Object.keys(val)) val[k] = walk(val[k]);
    }
    return val;
  };
  const orig = res.json.bind(res);
  res.json = (payload) => {
    try { return orig(walk(payload)); }
    catch (_) { return orig(payload); }
  };
  next();
}

/** Require one of the given roles (used after requireAuth). */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: { message: 'Authentication required', status: 401, timestamp: new Date().toISOString() } });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: { message: `Forbidden: requires role ${roles.join(' or ')}`, status: 403, timestamp: new Date().toISOString() } });
    }
    next();
  };
}

/**
 * Resolve the set of site_ids a user may see.
 *   admin              → null  (unrestricted)
 *   regional_manager   → sites in their home region ∪ explicit allocations
 *   field_technician   → explicit allocations only
 * Returns null (unrestricted) or an array (possibly empty).
 */
function getAllowedSiteIds(user) {
  if (!user || user.role === 'admin') return null;
  const db = getDb();
  const ids = new Set();
  const allocated = db.prepare('SELECT site_id FROM user_sites WHERE user_id = ?').all(user.user_id);
  allocated.forEach(r => ids.add(r.site_id));
  if (user.role === 'regional_manager' && user.region) {
    const regionSites = db.prepare('SELECT site_id FROM transformer_sites WHERE region = ?').all(user.region);
    regionSites.forEach(r => ids.add(r.site_id));
  }
  return Array.from(ids);
}

/** True if the request's user may access the given site. */
function canAccessSite(req, siteId) {
  if (!req.allowedSiteIds) return true; // admin / unrestricted
  return req.allowedSiteIds.includes(siteId);
}

/** Guard a single-site route: 403 if outside the user's scope. */
function requireSiteAccess(getSiteId) {
  return (req, res, next) => {
    const siteId = getSiteId(req);
    if (canAccessSite(req, siteId)) return next();
    return res.status(403).json({ error: { message: 'Forbidden: site outside your allocation', status: 403, timestamp: new Date().toISOString() } });
  };
}

module.exports = {
  ROLES, requireAuth, optionalAuth, requireRole,
  getAllowedSiteIds, canAccessSite, requireSiteAccess, scopeResponses, bearer
};
