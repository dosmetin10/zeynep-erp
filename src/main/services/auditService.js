const crypto = require('crypto');
const { openDb } = require('../db/db');

function logAudit({ actorUserId, action, entityType, entityId, beforeJson, afterJson }) {
  const db = openDb();
  db.prepare(
    'INSERT INTO audit_events(event_id,actor_user_id,action,entity_type,entity_id,before_json,after_json) VALUES (?,?,?,?,?,?,?)',
  ).run(
    crypto.randomUUID(),
    actorUserId || null,
    action,
    entityType,
    entityId ? String(entityId) : null,
    beforeJson ? JSON.stringify(beforeJson) : null,
    afterJson ? JSON.stringify(afterJson) : null,
  );
}

module.exports = { logAudit };
