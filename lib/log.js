import { query } from './db';

// Writes one row to activity_logs. Never throws (logging must not break sending).
export async function logActivity({ level = 'info', action, entityType = null, entityId = null, message, meta = {} }) {
  try {
    await query(
      `INSERT INTO activity_logs (level, action, entity_type, entity_id, message, meta)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [level, action, entityType, entityId ? String(entityId) : null, message, meta]
    );
  } catch (e) {
    console.error('logActivity failed:', e.message);
  }
}
