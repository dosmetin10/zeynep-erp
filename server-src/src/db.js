import Database from 'better-sqlite3';

export function openDb(file = ':memory:') {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  initSchema(db);
  seedDefaults(db);
  return db;
}

function initSchema(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS company (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tax_no TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  UNIQUE(role_id, permission_key)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fiscal_periods (
  id INTEGER PRIMARY KEY,
  period_key TEXT UNIQUE NOT NULL,
  is_closed INTEGER NOT NULL DEFAULT 0,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','income','expense','vat')),
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS account_mappings (
  id INTEGER PRIMARY KEY,
  mapping_key TEXT UNIQUE NOT NULL,
  account_code TEXT NOT NULL REFERENCES accounts(code)
);
CREATE TABLE IF NOT EXISTS journal_vouchers (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  source_type TEXT NOT NULL,
  source_id TEXT,
  project_id TEXT,
  voucher_date TEXT NOT NULL DEFAULT (date('now')),
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
  min_risk_limit REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  avg_cost REAL NOT NULL DEFAULT 0,
  min_qty REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  warehouse_id INTEGER REFERENCES warehouses(id),
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

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  offer_no TEXT UNIQUE NOT NULL,
  customer_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  offer_id INTEGER REFERENCES offers(id),
  customer_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT UNIQUE NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  invoice_type TEXT NOT NULL CHECK(invoice_type IN ('sales','purchase','sales_return','purchase_return')),
  partner_code TEXT NOT NULL,
  net_total REAL NOT NULL,
  vat_total REAL NOT NULL,
  gross_total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  voucher_id INTEGER REFERENCES journal_vouchers(id),
  reversal_voucher_id INTEGER REFERENCES journal_vouchers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty REAL NOT NULL CHECK(qty > 0),
  price REAL NOT NULL CHECK(price >= 0),
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
CREATE TABLE IF NOT EXISTS purchase_invoices (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT UNIQUE NOT NULL,
  supplier_code TEXT NOT NULL,
  net_total REAL NOT NULL CHECK(net_total > 0),
  vat_total REAL NOT NULL CHECK(vat_total >= 0),
  gross_total REAL NOT NULL CHECK(gross_total > 0),
  status TEXT NOT NULL DEFAULT 'posted',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS purchase_lines (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE RESTRICT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty REAL NOT NULL CHECK(qty > 0),
  price REAL NOT NULL CHECK(price > 0),
  vat_rate REAL NOT NULL CHECK(vat_rate >= 0)
);
CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY,
  supplier_code TEXT NOT NULL,
  amount REAL NOT NULL CHECK(amount > 0),
  method TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS expense_receipts (
  id INTEGER PRIMARY KEY,
  expense_type TEXT NOT NULL,
  description TEXT,
  amount REAL NOT NULL CHECK(amount > 0),
  method TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cash_accounts (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cash_txns (
  id INTEGER PRIMARY KEY,
  cash_account_id INTEGER NOT NULL REFERENCES cash_accounts(id),
  txn_type TEXT NOT NULL CHECK(txn_type IN ('collection','payment','adjust')),
  amount REAL NOT NULL CHECK(amount > 0),
  source_type TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY,
  bank_name TEXT NOT NULL,
  iban TEXT UNIQUE,
  balance REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS bank_transactions (
  id INTEGER PRIMARY KEY,
  bank_name TEXT NOT NULL,
  iban TEXT,
  tx_type TEXT NOT NULL CHECK(tx_type IN ('deposit','withdraw')),
  amount REAL NOT NULL CHECK(amount > 0),
  description TEXT,
  is_reconciled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_transfers (
  id INTEGER PRIMARY KEY,
  transfer_no TEXT UNIQUE NOT NULL,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  qty REAL NOT NULL CHECK(qty > 0),
  from_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  to_warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
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
CREATE TABLE IF NOT EXISTS error_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  route TEXT,
  method TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_code, created_at);
CREATE INDEX IF NOT EXISTS idx_journal_source ON journal_vouchers(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_collections_customer ON collection_receipts(customer_code, created_at);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_code, created_at);
`);
}

function seedDefaults(db) {
  db.prepare("INSERT OR IGNORE INTO company(id,name) VALUES(1,'MTN ERP')").run();

  const roles = ['admin', 'accounting', 'cashier', 'stock'];
  const insRole = db.prepare('INSERT OR IGNORE INTO roles(name) VALUES(?)');
  for (const r of roles) insRole.run(r);

  const permissions = {
    admin: ['*'],
    accounting: ['customers.read','customers.write','sales.write','purchase.write','reports.read','period.close'],
    cashier: ['collections.write','payments.write','cash.read','cash.write','bank.read'],
    stock: ['inventory.read','inventory.write','transfer.write'],
  };
  const getRole = db.prepare('SELECT id,name FROM roles').all();
  const insPerm = db.prepare('INSERT OR IGNORE INTO role_permissions(role_id,permission_key) VALUES(?,?)');
  for (const role of getRole) {
    for (const perm of (permissions[role.name] || [])) insPerm.run(role.id, perm);
  }

  const defaultAccounts = [
    ['100', 'Kasa', 'asset'],
    ['102', 'Bankalar', 'asset'],
    ['120', 'Alıcılar', 'asset'],
    ['153', 'Ticari Mallar', 'asset'],
    ['191', 'İndirilecek KDV', 'vat'],
    ['320', 'Satıcılar', 'liability'],
    ['391', 'Hesaplanan KDV', 'vat'],
    ['600', 'Yurtiçi Satışlar', 'income'],
    ['620', 'Satılan Malın Maliyeti', 'expense'],
    ['770', 'Genel Yönetim Giderleri', 'expense'],
  ];
  const insAcc = db.prepare('INSERT OR IGNORE INTO accounts(code,name,type) VALUES(?,?,?)');
  for (const a of defaultAccounts) insAcc.run(...a);

  const mappings = [
    ['sales.receivable', '120'],
    ['sales.revenue', '600'],
    ['sales.vat', '391'],
    ['sales.cash', '100'],
    ['sales.bank', '102'],
    ['purchase.vendor', '320'],
    ['purchase.stock', '153'],
    ['purchase.vat', '191'],
    ['expense.main', '770'],
  ];
  const insMap = db.prepare('INSERT OR IGNORE INTO account_mappings(mapping_key,account_code) VALUES(?,?)');
  for (const m of mappings) insMap.run(...m);

  db.prepare("INSERT OR IGNORE INTO cash_accounts(code,name,balance) VALUES('KASA001','Merkez Kasa',0)").run();
  db.prepare("INSERT OR IGNORE INTO warehouses(code,name) VALUES('D01','Ana Depo')").run();
}

export function validateVoucher(lines) {
  const dr = lines.filter((l) => l.dc === 'D').reduce((a, b) => a + b.amount, 0);
  const cr = lines.filter((l) => l.dc === 'C').reduce((a, b) => a + b.amount, 0);
  return Math.abs(dr - cr) < 0.00001;
}

export function resolveMapping(db, key, fallbackCode = null) {
  const row = db.prepare('SELECT account_code FROM account_mappings WHERE mapping_key=?').get(key);
  if (row?.account_code) return row.account_code;
  if (fallbackCode) return fallbackCode;
  throw new Error(`MAPPING_MISSING:${key}`);
}

export function isPeriodLocked(db, dateIso) {
  const d = new Date(dateIso || Date.now());
  const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const row = db.prepare('SELECT is_closed FROM fiscal_periods WHERE period_key=?').get(period);
  return Number(row?.is_closed || 0) === 1;
}

export function postVoucher(db, { code, sourceType, sourceId, projectId = null, voucherDate = null, lines }) {
  if (!validateVoucher(lines)) throw new Error('VOUCHER_UNBALANCED');
  if (voucherDate && isPeriodLocked(db, voucherDate)) throw new Error('PERIOD_LOCKED');
  const tx = db.transaction(() => {
    const v = db.prepare(`INSERT INTO journal_vouchers(code,status,source_type,source_id,project_id,voucher_date)
      VALUES(?, 'posted', ?, ?, ?, COALESCE(?, date('now')))`).run(code, sourceType, sourceId, projectId, voucherDate);
    const ins = db.prepare('INSERT INTO journal_lines(voucher_id,account_code,dc,amount,description) VALUES(?,?,?,?,?)');
    for (const line of lines) ins.run(v.lastInsertRowid, line.accountCode, line.dc, line.amount, line.description || null);
    return v.lastInsertRowid;
  });
  return tx();
}

export function appendAudit(db, event) {
  db.prepare(`INSERT INTO audit_events(event_id,actor_user_id,entity_type,entity_id,action,before_json,after_json)
  VALUES(?,?,?,?,?,?,?)`).run(
    event.eventId,
    event.actorUserId || null,
    event.entityType,
    String(event.entityId),
    event.action,
    event.beforeJson || null,
    event.afterJson || null,
  );
}

export function logError(db, { userId = null, route = null, method = null, message, stack = null }) {
  db.prepare('INSERT INTO error_logs(user_id,route,method,message,stack) VALUES(?,?,?,?,?)')
    .run(userId, route, method, String(message || 'unknown'), stack || null);
}
