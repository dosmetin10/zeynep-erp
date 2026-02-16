import Database from 'better-sqlite3';

export function openDb(file = ':memory:') {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS journal_vouchers (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  source_type TEXT NOT NULL,
  source_id TEXT,
  project_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY,
  voucher_id INTEGER NOT NULL REFERENCES journal_vouchers(id) ON DELETE RESTRICT,
  account_code TEXT NOT NULL,
  dc TEXT NOT NULL CHECK(dc IN ('D','C')),
  amount REAL NOT NULL CHECK(amount > 0),
  description TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('customer','supplier','both')),
  phone TEXT,
  city TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  avg_cost REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  movement_type TEXT NOT NULL CHECK(movement_type IN ('in','out','transfer','adjust','return')),
  qty REAL NOT NULL CHECK(qty > 0),
  unit_cost REAL NOT NULL DEFAULT 0,
  source_type TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('draft','approved','posted','void')),
  payment_method TEXT NOT NULL CHECK(payment_method IN ('credit','cash','bank')),
  customer_code TEXT NOT NULL,
  net_total REAL NOT NULL CHECK(net_total > 0),
  vat_total REAL NOT NULL CHECK(vat_total >= 0),
  gross_total REAL NOT NULL CHECK(gross_total > 0),
  voucher_id INTEGER REFERENCES journal_vouchers(id),
  reversal_voucher_id INTEGER REFERENCES journal_vouchers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sale_lines (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty REAL NOT NULL CHECK(qty > 0),
  price REAL NOT NULL CHECK(price > 0),
  vat_rate REAL NOT NULL CHECK(vat_rate >= 0)
);

CREATE TABLE IF NOT EXISTS dispatch_notes (
  id INTEGER PRIMARY KEY,
  note_no TEXT UNIQUE NOT NULL,
  customer_code TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty REAL NOT NULL CHECK(qty > 0),
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS collection_receipts (
  id INTEGER PRIMARY KEY,
  customer_code TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  method TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  actor_user_id INTEGER,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
}

export function validateVoucher(lines) {
  const dr = lines.filter(l => l.dc === 'D').reduce((a, b) => a + b.amount, 0);
  const cr = lines.filter(l => l.dc === 'C').reduce((a, b) => a + b.amount, 0);
  return Math.abs(dr - cr) < 0.00001;
}

export function postVoucher(db, { code, sourceType, sourceId, projectId = null, lines }) {
  if (!validateVoucher(lines)) throw new Error('VOUCHER_UNBALANCED');
  const tx = db.transaction(() => {
    const v = db.prepare(`INSERT INTO journal_vouchers(code,status,source_type,source_id,project_id)
      VALUES(?, 'posted', ?, ?, ?)`).run(code, sourceType, sourceId, projectId);
    const ins = db.prepare('INSERT INTO journal_lines(voucher_id,account_code,dc,amount,description) VALUES(?,?,?,?,?)');
    for (const line of lines) ins.run(v.lastInsertRowid, line.accountCode, line.dc, line.amount, line.description || null);
    return v.lastInsertRowid;
  });
  return tx();
}

export function appendAudit(db, event) {
  db.prepare(`INSERT INTO audit_events(event_id,actor_user_id,entity_type,entity_id,action,before_json,after_json)
  VALUES(?,?,?,?,?,?,?)`).run(event.eventId, event.actorUserId || null, event.entityType, String(event.entityId), event.action, event.beforeJson || null, event.afterJson || null);
}
