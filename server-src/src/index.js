import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import PDFDocument from 'pdfkit';
import { openDb, postVoucher, appendAudit, resolveMapping, isPeriodLocked, logError } from './db.js';

const PORT = Number(process.env.SERVER_PORT || 3777);
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), '../MTN_OfficePack/server-win11/data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'mtn-erp.db');
const BACKUP_KEY = process.env.BACKUP_KEY || 'dev-only-change-me-32-bytes-key!!';
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const db = openDb(DB_FILE);
const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  const userId = Number(req.headers['x-user-id'] || 1);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId) || { id: 1, username: 'system', role: 'admin' };
  req.user = user;
  next();
});

function hasPermission(user, permissionKey) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const role = db.prepare('SELECT id FROM roles WHERE name=?').get(user.role);
  if (!role) return false;
  const rows = db.prepare('SELECT permission_key FROM role_permissions WHERE role_id=?').all(role.id).map((r) => r.permission_key);
  return rows.includes('*') || rows.includes(permissionKey);
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!hasPermission(req.user, permissionKey)) {
      return res.status(403).json(err('AUTH_403', 'Yetkisiz erişim', `Bu işlem için ${permissionKey} yetkisi gerekir.`, 'Yönetici ile görüşün.'));
    }
    return next();
  };
}

function ensurePeriodOpen(dateValue) {
  if (isPeriodLocked(db, dateValue || new Date().toISOString().slice(0,10))) throw new Error('PERIOD_LOCKED');
}


const clients = new Set();
function publish(ev) {
  const payload = `data: ${JSON.stringify({ ...ev, ts: Date.now() })}\n\n`;
  for (const res of clients) res.write(payload);
}

function err(ref, title, reason, solution) {
  return { error: { title, reason, solution, referenceCode: ref } };
}


function nextCode(prefix, values) {
  let max = 0;
  for (const v of values) {
    const m = String(v || '').match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function getNextCustomerCode() {
  const rows = db.prepare('SELECT code FROM customers').all();
  return nextCode('CR', rows.map(r => r.code));
}

function getNextStockCode() {
  const rows = db.prepare('SELECT sku FROM inventory_items').all();
  return nextCode('STK', rows.map(r => r.sku));
}


function getNextPurchaseInvoiceNo() {
  const rows = db.prepare('SELECT invoice_no FROM purchase_invoices').all();
  return nextCode('ALS', rows.map(r => r.invoice_no));
}

function getNextTransferCode() {
  const rows = db.prepare('SELECT transfer_no FROM stock_transfers').all();
  return nextCode('TRF', rows.map(r => r.transfer_no));
}


app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

app.get('/api/health-check', (req, res) => {
  const unbalanced = db.prepare(`SELECT voucher_id FROM (
    SELECT voucher_id,
      SUM(CASE WHEN dc='D' THEN amount ELSE 0 END) dr,
      SUM(CASE WHEN dc='C' THEN amount ELSE 0 END) cr
    FROM journal_lines GROUP BY voucher_id
  ) WHERE ABS(dr-cr) > 0.00001`).all();
  const negativeStock = db.prepare('SELECT id,sku,qty FROM inventory_items WHERE qty < 0').all();
  const fkBroken = db.prepare('PRAGMA foreign_key_check').all();
  res.json({ ok: unbalanced.length === 0 && negativeStock.length === 0 && fkBroken.length === 0, unbalanced, negativeStock, fkBroken });
});



app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json(err('AUTH_002', 'Giriş başarısız', 'Kullanıcı adı veya parola hatalı.', 'Bilgilerinizi kontrol edin.'));
  }
  res.json({ token: `local-${user.id}`, user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/settings/account-mappings', requirePermission('reports.read'), (req, res) => {
  const rows = db.prepare('SELECT am.*, a.name as account_name FROM account_mappings am LEFT JOIN accounts a ON a.code=am.account_code ORDER BY am.mapping_key').all();
  res.json({ rows });
});

app.put('/api/settings/account-mappings/:key', requirePermission('accounting.write'), (req, res) => {
  const key = String(req.params.key);
  const { accountCode } = req.body;
  if (!accountCode) return res.status(400).json(err('MAP_001', 'Eksik veri', 'Hesap kodu zorunlu.', 'Geçerli hesap kodu girin.'));
  const acc = db.prepare('SELECT code FROM accounts WHERE code=?').get(accountCode);
  if (!acc) return res.status(400).json(err('MAP_002', 'Hesap bulunamadı', 'Hesap kodu sistemde yok.', 'Hesap planını kontrol edin.'));
  db.prepare('INSERT INTO account_mappings(mapping_key,account_code) VALUES(?,?) ON CONFLICT(mapping_key) DO UPDATE SET account_code=excluded.account_code').run(key, accountCode);
  appendAudit(db, { eventId: crypto.randomUUID(), actorUserId: req.user.id, entityType: 'account_mapping', entityId: key, action: 'update', afterJson: JSON.stringify({ accountCode }) });
  res.json({ ok: true });
});

app.get('/api/period-locks', requirePermission('reports.read'), (req, res) => {
  const rows = db.prepare('SELECT * FROM fiscal_periods ORDER BY period_key DESC').all();
  res.json({ rows });
});

app.post('/api/period-locks/:periodKey/close', requirePermission('period.close'), (req, res) => {
  const periodKey = String(req.params.periodKey);
  db.prepare("INSERT INTO fiscal_periods(period_key,is_closed,closed_by,closed_at) VALUES(?,1,?,datetime('now')) ON CONFLICT(period_key) DO UPDATE SET is_closed=1, closed_by=excluded.closed_by, closed_at=excluded.closed_at").run(periodKey, req.user.id);
  appendAudit(db, { eventId: crypto.randomUUID(), actorUserId: req.user.id, entityType: 'period', entityId: periodKey, action: 'close' });
  res.json({ ok: true });
});

app.post('/api/period-locks/:periodKey/open', requirePermission('period.close'), (req, res) => {
  const periodKey = String(req.params.periodKey);
  db.prepare('INSERT INTO fiscal_periods(period_key,is_closed) VALUES(?,0) ON CONFLICT(period_key) DO UPDATE SET is_closed=0').run(periodKey);
  appendAudit(db, { eventId: crypto.randomUUID(), actorUserId: req.user.id, entityType: 'period', entityId: periodKey, action: 'open' });
  res.json({ ok: true });
});


app.get('/api/codes/next', (req, res) => {
  const type = String(req.query.type || '');
  if (type === 'customer') return res.json({ code: getNextCustomerCode() });
  if (type === 'stock') return res.json({ code: getNextStockCode() });
  return res.status(400).json(err('CODE_001', 'Kod tipi hatalı', 'type parametresi customer veya stock olmalı.', 'Doğru kod tipini gönderin.'));
});

app.post('/api/setup/admin', (req, res) => {
  const { username, password } = req.body;
  if (!password || password.length < 8) return res.status(400).json(err('AUTH_001', 'Geçersiz parola', 'Parola en az 8 karakter olmalı.', 'Güçlü parola girin.'));
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run(username || 'admin', hash, 'admin');
  res.json({ ok: true });
});


app.get('/api/customers', (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const q = String(req.query.q || '').trim();
  const where = q ? 'WHERE code LIKE ? OR name LIKE ? OR city LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) c FROM customers ${where}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM customers ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ page, pageSize, total, rows });
});

app.post('/api/customers', requirePermission('customers.write'), (req, res) => {
  const { code, name, type = 'customer', phone = null, city = null } = req.body;
  const finalCode = (code || '').trim() || getNextCustomerCode();
  if (!name) return res.status(400).json(err('CAR_001', 'Eksik alan', 'Kod ve ad zorunludur.', 'Cari kodu ve adını girin.'));
  try {
    const r = db.prepare('INSERT INTO customers(code,name,type,phone,city) VALUES(?,?,?,?,?)').run(finalCode, name, type, phone, city);
    appendAudit(db, { eventId: crypto.randomUUID(), entityType: 'customer', entityId: r.lastInsertRowid, action: 'create', afterJson: JSON.stringify(req.body) });
    publish({ entityType: 'customer', entityId: r.lastInsertRowid, action: 'create' });
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json(err('CAR_002', 'Cari kayıt hatası', e.message, 'Kod tekrarını kontrol edin.'));
  }
});

app.put('/api/customers/:id', (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
  if (!old) return res.status(404).json(err('CAR_404', 'Cari yok', 'Kayıt bulunamadı.', 'Listeyi yenileyin.'));
  const payload = { ...old, ...req.body };
  db.prepare('UPDATE customers SET code=?, name=?, type=?, phone=?, city=? WHERE id=?')
    .run(payload.code, payload.name, payload.type, payload.phone || null, payload.city || null, id);
  appendAudit(db, { eventId: crypto.randomUUID(), entityType: 'customer', entityId: id, action: 'update', beforeJson: JSON.stringify(old), afterJson: JSON.stringify(payload) });
  publish({ entityType: 'customer', entityId: id, action: 'update' });
  res.json({ ok: true });
});

app.get('/api/inventory/items', (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const q = String(req.query.q || '').trim();
  const where = q ? 'WHERE sku LIKE ? OR name LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) c FROM inventory_items ${where}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM inventory_items ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
  res.json({ page, pageSize, total, rows });
});

app.get('/api/sales', (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const total = db.prepare('SELECT COUNT(*) c FROM sales').get().c;
  const rows = db.prepare('SELECT * FROM sales ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  res.json({ page, pageSize, total, rows });
});

app.post('/api/inventory/items', requirePermission('inventory.write'), (req, res) => {
  const { sku, name, qty = 0, avgCost = 0 } = req.body;
  const finalSku = (sku || '').trim() || getNextStockCode();
  if (!name) return res.status(400).json(err('STK_002', 'Eksik alan', 'Stok adı zorunludur.', 'Stok adı girin.'));
  const x = db.prepare('INSERT INTO inventory_items(sku,name,qty,avg_cost) VALUES(?,?,?,?)').run(finalSku, name, qty, avgCost);
  publish({ entityType: 'inventory', entityId: x.lastInsertRowid, action: 'create' });
  res.status(201).json({ id: x.lastInsertRowid });
});

app.post('/api/sales', requirePermission('sales.write'), (req, res) => {
  const { paymentMethod, customerCode, lines } = req.body;
  try { ensurePeriodOpen(req.body.date); } catch (e) { return res.status(400).json(err('PER_001', 'Dönem kilidi', 'Kapanan döneme kayıt yapılamaz.', 'Açık dönemde işlem yapın veya yöneticiye başvurun.')); }
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json(err('SALE_001', 'Satır eksik', 'Satış satırı yok.', 'En az bir satır ekleyin.'));
  let net = 0; let vat = 0; let cogs = 0;
  const saleLines = [];
  const tx = db.transaction(() => {
    for (const l of lines) {
      if (l.qty <= 0 || l.price <= 0) throw new Error('VALIDATION');
      const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(l.itemId);
      if (!item) throw new Error('ITEM_MISSING');
      if (item.qty < l.qty) throw new Error('NEGATIVE_STOCK');
      const ln = l.qty * l.price;
      const lv = ln * l.vatRate;
      net += ln; vat += lv;
      cogs += item.avg_cost * l.qty;
      saleLines.push({ ...l, net: ln, vat: lv, cost: item.avg_cost * l.qty });
      db.prepare('UPDATE inventory_items SET qty = qty - ? WHERE id=?').run(l.qty, l.itemId);
      db.prepare('INSERT INTO inventory_movements(item_id,movement_type,qty,unit_cost,source_type) VALUES(?,?,?,?,?)').run(l.itemId, 'out', l.qty, item.avg_cost, 'sale');
    }
    const gross = net + vat;
    const sale = db.prepare('INSERT INTO sales(status,payment_method,customer_code,net_total,vat_total,gross_total) VALUES(?,?,?,?,?,?)')
      .run('posted', paymentMethod, customerCode, net, vat, gross);
    const account = paymentMethod === 'cash' ? resolveMapping(db, 'sales.cash', '100') : paymentMethod === 'bank' ? resolveMapping(db, 'sales.bank', '102') : resolveMapping(db, 'sales.receivable', '120');
    const voucherId = postVoucher(db, {
      code: `SAT-${sale.lastInsertRowid}`,
      sourceType: 'sale', sourceId: String(sale.lastInsertRowid),
      lines: [
        { accountCode: account, dc: 'D', amount: gross },
        { accountCode: resolveMapping(db, 'sales.revenue', '600'), dc: 'C', amount: net },
        { accountCode: resolveMapping(db, 'sales.vat', '391'), dc: 'C', amount: vat },
      ],
    });
    if (cogs > 0) {
      postVoucher(db, { code: `COGS-${sale.lastInsertRowid}`, sourceType: 'sale_cost', sourceId: String(sale.lastInsertRowid), lines: [
        { accountCode: '620', dc: 'D', amount: cogs },
        { accountCode: '153', dc: 'C', amount: cogs },
      ] });
    }
    db.prepare('UPDATE sales SET voucher_id=? WHERE id=?').run(voucherId, sale.lastInsertRowid);
    const ins = db.prepare('INSERT INTO sale_lines(sale_id,item_id,qty,price,vat_rate) VALUES(?,?,?,?,?)');
    for (const l of saleLines) ins.run(sale.lastInsertRowid, l.itemId, l.qty, l.price, l.vatRate);
    appendAudit(db, { eventId: crypto.randomUUID(), entityType: 'sale', entityId: sale.lastInsertRowid, action: 'posted', afterJson: JSON.stringify({ gross }) });
    publish({ entityType: 'sale', entityId: sale.lastInsertRowid, action: 'posted' });
    return sale.lastInsertRowid;
  });
  try {
    res.status(201).json({ id: tx() });
  } catch (e) {
    if (e.message === 'NEGATIVE_STOCK') return res.status(400).json(err('STK_001', 'Negatif stok', 'Yeterli stok yok.', 'Stok giriş yapın veya miktarı azaltın.'));
    return res.status(400).json(err('GEN_001', 'Doğrulama hatası', e.message, 'Verileri kontrol edin.'));
  }
});

app.post('/api/sales/:id/void', (req, res) => {
  const id = Number(req.params.id);
  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(id);
  if (!sale || sale.status !== 'posted') return res.status(400).json(err('SALE_404', 'Kayıt yok', 'Sadece posted kayıt void olabilir.', 'Doğru kayıt seçin.'));

  const tx = db.transaction(() => {
    const saleLines = db.prepare('SELECT * FROM sale_lines WHERE sale_id=?').all(id);
    for (const l of saleLines) {
      const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(l.item_id);
      if (!item) throw new Error('ITEM_MISSING');
      db.prepare('UPDATE inventory_items SET qty=qty+? WHERE id=?').run(Number(l.qty), Number(l.item_id));
      db.prepare('INSERT INTO inventory_movements(item_id,movement_type,qty,unit_cost,source_type,source_id) VALUES(?,?,?,?,?,?)')
        .run(Number(l.item_id), 'return', Number(l.qty), Number(item.avg_cost || 0), 'sale_void', String(id));
    }

    const revId = postVoucher(db, { code: `REV-SAT-${id}`, sourceType: 'sale_reversal', sourceId: String(id), lines: [
      { accountCode: sale.payment_method === 'cash' ? '100' : sale.payment_method === 'bank' ? '102' : '120', dc: 'C', amount: sale.gross_total },
      { accountCode: '600', dc: 'D', amount: sale.net_total },
      { accountCode: '391', dc: 'D', amount: sale.vat_total },
    ] });

    const cogsLines = db.prepare(`SELECT SUM(im.qty * im.unit_cost) cogs
      FROM inventory_movements im
      WHERE im.source_type='sale' AND im.source_id=?`).get(String(id));
    const cogsAmount = Number(cogsLines?.cogs || 0);
    if (cogsAmount > 0) {
      postVoucher(db, { code: `REV-COGS-${id}`, sourceType: 'sale_cost_reversal', sourceId: String(id), lines: [
        { accountCode: '153', dc: 'D', amount: cogsAmount },
        { accountCode: '620', dc: 'C', amount: cogsAmount },
      ] });
    }

    db.prepare('UPDATE sales SET status=?, reversal_voucher_id=? WHERE id=?').run('void', revId, id);
    appendAudit(db, { eventId: crypto.randomUUID(), entityType: 'sale', entityId: id, action: 'void', beforeJson: JSON.stringify(sale) });
    publish({ entityType: 'sale', entityId: id, action: 'void' });
    return revId;
  });

  try {
    const revId = tx();
    res.json({ ok: true, reversalVoucherId: revId });
  } catch (e) {
    res.status(400).json(err('SALE_VOID_001', 'İptal hatası', e.message, 'Kayıtları kontrol edip tekrar deneyin.'));
  }
});

app.get('/api/reports/trial-balance', (req, res) => {
  const rows = db.prepare(`SELECT account_code,
    SUM(CASE WHEN dc='D' THEN amount ELSE 0 END) AS dr,
    SUM(CASE WHEN dc='C' THEN amount ELSE 0 END) AS cr
    FROM journal_lines GROUP BY account_code ORDER BY account_code`).all();
  res.json(rows);
});



app.get('/api/reports/journal', requirePermission('reports.read'), (req, res) => {
  const from = String(req.query.from || '1900-01-01');
  const to = String(req.query.to || '2999-12-31');
  const rows = db.prepare(`SELECT v.id as voucher_id,v.code,v.voucher_date,v.source_type,v.source_id,l.account_code,l.dc,l.amount,l.description
    FROM journal_vouchers v
    JOIN journal_lines l ON l.voucher_id=v.id
    WHERE v.voucher_date BETWEEN ? AND ?
    ORDER BY v.voucher_date,v.id,l.id`).all(from, to);
  res.json({ rows });
});

app.get('/api/reports/ledger', requirePermission('reports.read'), (req, res) => {
  const accountCode = String(req.query.accountCode || '');
  if (!accountCode) return res.status(400).json(err('LED_001', 'Eksik parametre', 'accountCode zorunlu.', 'Hesap kodu seçin.'));
  const rows = db.prepare(`SELECT v.voucher_date,v.code,l.dc,l.amount,l.description
    FROM journal_lines l JOIN journal_vouchers v ON v.id=l.voucher_id
    WHERE l.account_code=? ORDER BY v.voucher_date,v.id,l.id`).all(accountCode);
  const balance = rows.reduce((a,r)=>a + (r.dc==='D'?Number(r.amount): -Number(r.amount)),0);
  res.json({ accountCode, balance, rows });
});

app.get('/api/reports/vat-summary', requirePermission('reports.read'), (req, res) => {
  const outVat = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM journal_lines WHERE account_code=? AND dc='C'").get(resolveMapping(db,'sales.vat','391')).t;
  const inVat = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM journal_lines WHERE account_code=? AND dc='D'").get(resolveMapping(db,'purchase.vat','191')).t;
  res.json({ outputVat: outVat, inputVat: inVat, payableVat: Number(outVat) - Number(inVat) });
});

app.get('/api/reports/customer-aging', requirePermission('reports.read'), (req, res) => {
  const code = String(req.query.customerCode || '');
  const base = code ? 'WHERE customer_code=?' : '';
  const args = code ? [code] : [];
  const sales = db.prepare(`SELECT customer_code, created_at as dt, gross_total as amount FROM sales ${base}`).all(...args);
  const cols = db.prepare(`SELECT customer_code, created_at as dt, -amount as amount FROM collection_receipts ${base}`).all(...args);
  const now = Date.now();
  const buckets = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
  for (const r of [...sales, ...cols]) {
    const days = Math.floor((now - new Date(r.dt).getTime()) / (1000*60*60*24));
    if (days <= 30) buckets['0_30'] += Number(r.amount);
    else if (days <= 60) buckets['31_60'] += Number(r.amount);
    else if (days <= 90) buckets['61_90'] += Number(r.amount);
    else buckets['90_plus'] += Number(r.amount);
  }
  res.json({ customerCode: code || null, buckets });
});

app.get('/api/reports/stock-status', requirePermission('reports.read'), (req, res) => {
  const rows = db.prepare('SELECT id,sku,name,qty,min_qty,avg_cost,(qty*avg_cost) as stock_value, CASE WHEN qty<=min_qty THEN 1 ELSE 0 END as min_alert FROM inventory_items ORDER BY name').all();
  res.json({ rows });
});

app.get('/api/reports/cash-bank', requirePermission('reports.read'), (req, res) => {
  const cashIn = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM cash_txns WHERE txn_type='collection'").get().t;
  const cashOut = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM cash_txns WHERE txn_type='payment'").get().t;
  const bankIn = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM bank_transactions WHERE tx_type='deposit'").get().t;
  const bankOut = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM bank_transactions WHERE tx_type='withdraw'").get().t;
  res.json({ cashIn, cashOut, cashBalance: Number(cashIn) - Number(cashOut), bankIn, bankOut, bankBalance: Number(bankIn) - Number(bankOut) });
});


app.get('/api/dispatch-notes', (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const total = db.prepare('SELECT COUNT(*) c FROM dispatch_notes').get().c;
  const rows = db.prepare('SELECT * FROM dispatch_notes ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  res.json({ page, pageSize, total, rows });
});

app.post('/api/dispatch-notes', (req, res) => {
  const { noteNo, customerCode, itemId, qty, kind = 'İrsaliye' } = req.body;
  if (!customerCode || !itemId || Number(qty) <= 0) return res.status(400).json(err('DIS_001', 'Eksik veri', 'İrsaliye alanları eksik.', 'Cari, stok, miktar girin.'));
  const note = (noteNo || '').trim() || `IRS-${Date.now()}`;
  const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(itemId);
  if (!item) return res.status(400).json(err('DIS_002', 'Stok yok', 'Stok bulunamadı.', 'Geçerli stok seçin.'));
  if (item.qty < Number(qty)) return res.status(400).json(err('DIS_003', 'Negatif stok', 'Yeterli stok yok.', 'Miktarı düşürün veya giriş yapın.'));
  const tx = db.transaction(() => {
    db.prepare('UPDATE inventory_items SET qty=qty-? WHERE id=?').run(Number(qty), itemId);
    const r = db.prepare('INSERT INTO dispatch_notes(note_no,customer_code,item_id,qty,kind,status) VALUES(?,?,?,?,?,?)')
      .run(note, customerCode, itemId, Number(qty), kind, 'posted');
    publish({ entityType: 'dispatch', entityId: r.lastInsertRowid, action: 'posted' });
    return r.lastInsertRowid;
  });
  res.status(201).json({ id: tx() });
});

app.get('/api/collections', (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const total = db.prepare('SELECT COUNT(*) c FROM collection_receipts').get().c;
  const rows = db.prepare('SELECT * FROM collection_receipts ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  res.json({ page, pageSize, total, rows });
});

app.post('/api/collections', requirePermission('collections.write'), (req, res) => {
  const { customerCode, amount, method = 'cash' } = req.body;
  try { ensurePeriodOpen(req.body.date); } catch (e) { return res.status(400).json(err('PER_001', 'Dönem kilidi', 'Kapanan döneme kayıt yapılamaz.', 'Açık dönemde işlem yapın veya yöneticiye başvurun.')); }
  if (!customerCode || Number(amount) <= 0) return res.status(400).json(err('COL_001', 'Eksik veri', 'Cari ve tutar zorunlu.', 'Geçerli cari ve tutar girin.'));
  const r = db.prepare('INSERT INTO collection_receipts(customer_code,amount,method) VALUES(?,?,?)').run(customerCode, Number(amount), method);
  postVoucher(db, { code: `TAH-${r.lastInsertRowid}`, sourceType: 'collection', sourceId: String(r.lastInsertRowid), lines: [
    { accountCode: method === 'bank' ? resolveMapping(db, 'sales.bank', '102') : resolveMapping(db, 'sales.cash', '100'), dc: 'D', amount: Number(amount) },
    { accountCode: resolveMapping(db, 'sales.receivable', '120'), dc: 'C', amount: Number(amount) },
  ]});
  publish({ entityType: 'collection', entityId: r.lastInsertRowid, action: 'create' });
  res.status(201).json({ id: r.lastInsertRowid });
});

app.get('/api/collections/:id/pdf', (req, res) => {
  const row = db.prepare('SELECT * FROM collection_receipts WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json(err('COL_404', 'Makbuz yok', 'Kayıt bulunamadı.', 'Listeyi yenileyin.'));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=tahsilat-makbuzu-${row.id}.pdf`);
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);
  doc.fontSize(22).fillColor('#0b3d5e').text('MTN ENERJİ - TAHSİLAT MAKBuzu'.toUpperCase());
  doc.moveDown();
  doc.fontSize(12).fillColor('#000').text(`Makbuz No: TM-${row.id}`);
  doc.text(`Cari Kod: ${row.customer_code}`);
  doc.text(`Tutar: ${row.amount.toFixed(2)} TL`);
  doc.text(`Yöntem: ${row.method}`);
  doc.text(`Tarih: ${row.created_at}`);
  doc.moveDown();
  doc.fontSize(10).fillColor('#666').text('Bu makbuz sistem tarafından üretilmiştir.');
  doc.end();
});



app.get('/api/purchases', (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const total = db.prepare('SELECT COUNT(*) c FROM purchase_invoices').get().c;
  const rows = db.prepare('SELECT * FROM purchase_invoices ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  res.json({ page, pageSize, total, rows });
});

app.post('/api/purchases', requirePermission('purchase.write'), (req, res) => {
  const { supplierCode, invoiceNo, lines } = req.body;
  try { ensurePeriodOpen(req.body.date); } catch (e) { return res.status(400).json(err('PER_001', 'Dönem kilidi', 'Kapanan döneme kayıt yapılamaz.', 'Açık dönemde işlem yapın veya yöneticiye başvurun.')); }
  if (!supplierCode || !Array.isArray(lines) || !lines.length) return res.status(400).json(err('PUR_001', 'Eksik veri', 'Tedarikçi ve satırlar zorunlu.', 'Geçerli kayıt girin.'));
  const finalInvoiceNo = (invoiceNo || '').trim() || getNextPurchaseInvoiceNo();
  let net = 0; let vat = 0;
  const tx = db.transaction(() => {
    const purchase = db.prepare('INSERT INTO purchase_invoices(invoice_no,supplier_code,net_total,vat_total,gross_total,status) VALUES(?,?,?,?,?,?)')
      .run(finalInvoiceNo, supplierCode, 0, 0, 0, 'posted');
    const ins = db.prepare('INSERT INTO purchase_lines(purchase_id,item_id,qty,price,vat_rate) VALUES(?,?,?,?,?)');
    for (const l of lines) {
      if (Number(l.qty) <= 0 || Number(l.price) <= 0) throw new Error('PUR_LINE');
      const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(Number(l.itemId));
      if (!item) throw new Error('PUR_ITEM');
      const ln = Number(l.qty) * Number(l.price);
      const lv = ln * Number(l.vatRate || 0);
      net += ln; vat += lv;
      ins.run(purchase.lastInsertRowid, Number(l.itemId), Number(l.qty), Number(l.price), Number(l.vatRate || 0));
      const prevQty = Number(item.qty || 0);
      const prevVal = prevQty * Number(item.avg_cost || 0);
      const newQty = prevQty + Number(l.qty);
      const newAvg = newQty > 0 ? (prevVal + ln) / newQty : Number(item.avg_cost || 0);
      db.prepare('UPDATE inventory_items SET qty=?, avg_cost=? WHERE id=?').run(newQty, newAvg, Number(l.itemId));
      db.prepare('INSERT INTO inventory_movements(item_id,movement_type,qty,unit_cost,source_type,source_id) VALUES(?,?,?,?,?,?)')
        .run(Number(l.itemId), 'in', Number(l.qty), Number(l.price), 'purchase', String(purchase.lastInsertRowid));
    }
    const gross = net + vat;
    db.prepare('UPDATE purchase_invoices SET net_total=?, vat_total=?, gross_total=? WHERE id=?').run(net, vat, gross, purchase.lastInsertRowid);
    postVoucher(db, { code: `ALS-${purchase.lastInsertRowid}`, sourceType: 'purchase', sourceId: String(purchase.lastInsertRowid), lines: [
      { accountCode: '153', dc: 'D', amount: net },
      { accountCode: '191', dc: 'D', amount: vat },
      { accountCode: '320', dc: 'C', amount: gross },
    ]});
    publish({ entityType: 'purchase', entityId: purchase.lastInsertRowid, action: 'posted' });
    return purchase.lastInsertRowid;
  });
  try {
    res.status(201).json({ id: tx() });
  } catch (e) {
    res.status(400).json(err('PUR_002', 'Alış kaydı hatası', e.message, 'Kalemleri kontrol edin.'));
  }
});


app.get('/api/purchases/:id/pdf', (req, res) => {
  const pur = db.prepare('SELECT * FROM purchase_invoices WHERE id=?').get(Number(req.params.id));
  if (!pur) return res.status(404).json(err('PUR_PDF_404', 'Alış kaydı yok', 'Fatura bulunamadı.', 'Listeyi yenileyin.'));
  const lines = db.prepare('SELECT * FROM purchase_lines WHERE purchase_id=?').all(pur.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=alis-${pur.id}.pdf`);
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);
  doc.fontSize(20).fillColor('#0b3d5e').text('MTN ENERJİ - ALIŞ FATURASI');
  doc.moveDown(0.5).fontSize(11).fillColor('#000');
  doc.text(`Fatura No: ${pur.invoice_no}`);
  doc.text(`Tedarikçi Kod: ${pur.supplier_code}`);
  doc.text(`Tarih: ${pur.created_at}`);
  doc.moveDown();
  doc.text('Kalemler:');
  for (const l of lines) doc.text(`- Stok#${l.item_id} | Miktar: ${l.qty} | Fiyat: ${l.price} | KDV: ${l.vat_rate}`);
  doc.moveDown();
  doc.fontSize(12).text(`Ara Toplam: ${pur.net_total.toFixed(2)} TL`);
  doc.text(`KDV: ${pur.vat_total.toFixed(2)} TL`);
  doc.fontSize(14).text(`Genel Toplam: ${pur.gross_total.toFixed(2)} TL`);
  doc.end();
});

app.get('/api/payments', (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const total = db.prepare('SELECT COUNT(*) c FROM supplier_payments').get().c;
  const rows = db.prepare('SELECT * FROM supplier_payments ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  res.json({ page, pageSize, total, rows });
});

app.post('/api/payments', requirePermission('payments.write'), (req, res) => {
  const { supplierCode, amount, method = 'bank' } = req.body;
  try { ensurePeriodOpen(req.body.date); } catch (e) { return res.status(400).json(err('PER_001', 'Dönem kilidi', 'Kapanan döneme kayıt yapılamaz.', 'Açık dönemde işlem yapın veya yöneticiye başvurun.')); }
  if (!supplierCode || Number(amount) <= 0) return res.status(400).json(err('PAY_001', 'Eksik veri', 'Tedarikçi ve tutar zorunlu.', 'Geçerli kayıt girin.'));
  const r = db.prepare('INSERT INTO supplier_payments(supplier_code,amount,method) VALUES(?,?,?)').run(supplierCode, Number(amount), method);
  postVoucher(db, { code: `ODE-${r.lastInsertRowid}`, sourceType: 'supplier_payment', sourceId: String(r.lastInsertRowid), lines: [
    { accountCode: resolveMapping(db, 'purchase.vendor', '320'), dc: 'D', amount: Number(amount) },
    { accountCode: method === 'cash' ? resolveMapping(db, 'sales.cash', '100') : resolveMapping(db, 'sales.bank', '102'), dc: 'C', amount: Number(amount) },
  ]});
  publish({ entityType: 'payment', entityId: r.lastInsertRowid, action: 'create' });
  res.status(201).json({ id: r.lastInsertRowid });
});

app.get('/api/expenses', (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const total = db.prepare('SELECT COUNT(*) c FROM expense_receipts').get().c;
  const rows = db.prepare('SELECT * FROM expense_receipts ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  res.json({ page, pageSize, total, rows });
});

app.post('/api/expenses', (req, res) => {
  const { expenseType, description = '', amount, method = 'bank' } = req.body;
  if (!expenseType || Number(amount) <= 0) return res.status(400).json(err('EXP_001', 'Eksik veri', 'Masraf türü ve tutar zorunlu.', 'Geçerli masraf girin.'));
  const r = db.prepare('INSERT INTO expense_receipts(expense_type,description,amount,method) VALUES(?,?,?,?)')
    .run(expenseType, description, Number(amount), method);
  postVoucher(db, { code: `MSR-${r.lastInsertRowid}`, sourceType: 'expense', sourceId: String(r.lastInsertRowid), lines: [
    { accountCode: resolveMapping(db, 'expense.main', '770'), dc: 'D', amount: Number(amount) },
    { accountCode: method === 'cash' ? resolveMapping(db, 'sales.cash', '100') : resolveMapping(db, 'sales.bank', '102'), dc: 'C', amount: Number(amount) },
  ]});
  publish({ entityType: 'expense', entityId: r.lastInsertRowid, action: 'create' });
  res.status(201).json({ id: r.lastInsertRowid });
});

app.get('/api/bank-transactions', (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const total = db.prepare('SELECT COUNT(*) c FROM bank_transactions').get().c;
  const rows = db.prepare('SELECT * FROM bank_transactions ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  res.json({ page, pageSize, total, rows });
});

app.post('/api/bank-transactions', (req, res) => {
  const { bankName, iban = null, txType = 'deposit', amount, description = '' } = req.body;
  if (!bankName || Number(amount) <= 0) return res.status(400).json(err('BNK_001', 'Eksik veri', 'Banka adı ve tutar zorunlu.', 'Geçerli işlem girin.'));
  const r = db.prepare('INSERT INTO bank_transactions(bank_name,iban,tx_type,amount,description) VALUES(?,?,?,?,?)')
    .run(bankName, iban, txType, Number(amount), description);
  postVoucher(db, { code: `BNK-${r.lastInsertRowid}`, sourceType: 'bank_tx', sourceId: String(r.lastInsertRowid), lines: txType === 'deposit' ? [
    { accountCode: '102', dc: 'D', amount: Number(amount) },
    { accountCode: '100', dc: 'C', amount: Number(amount) },
  ] : [
    { accountCode: '100', dc: 'D', amount: Number(amount) },
    { accountCode: '102', dc: 'C', amount: Number(amount) },
  ]});
  publish({ entityType: 'bank', entityId: r.lastInsertRowid, action: 'create' });
  res.status(201).json({ id: r.lastInsertRowid });
});


app.post('/api/bank-transactions/:id/reconcile', requirePermission('bank.read'), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE bank_transactions SET is_reconciled=1 WHERE id=?').run(id);
  appendAudit(db, { eventId: crypto.randomUUID(), actorUserId: req.user.id, entityType: 'bank_tx', entityId: id, action: 'reconcile' });
  res.json({ ok: true });
});

app.get('/api/warehouses', (req, res) => {
  const rows = db.prepare('SELECT * FROM warehouses ORDER BY id DESC').all();
  res.json({ rows });
});

app.post('/api/warehouses', (req, res) => {
  const { code, name } = req.body;
  if (!code || !name) return res.status(400).json(err('WH_001', 'Eksik veri', 'Depo kodu ve adı zorunlu.', 'Depo bilgilerini girin.'));
  const r = db.prepare('INSERT INTO warehouses(code,name) VALUES(?,?)').run(String(code).trim(), String(name).trim());
  publish({ entityType: 'warehouse', entityId: r.lastInsertRowid, action: 'create' });
  res.status(201).json({ id: r.lastInsertRowid });
});

app.get('/api/stock-transfers', (req, res) => {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const total = db.prepare('SELECT COUNT(*) c FROM stock_transfers').get().c;
  const rows = db.prepare('SELECT * FROM stock_transfers ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
  res.json({ page, pageSize, total, rows });
});

app.post('/api/stock-transfers', (req, res) => {
  const { transferNo, itemId, qty, fromWarehouseId, toWarehouseId } = req.body;
  if (Number(itemId) <= 0 || Number(qty) <= 0 || Number(fromWarehouseId) <= 0 || Number(toWarehouseId) <= 0) {
    return res.status(400).json(err('TRF_001', 'Eksik veri', 'Transfer alanları zorunludur.', 'Geçerli transfer bilgisi girin.'));
  }
  if (Number(fromWarehouseId) === Number(toWarehouseId)) return res.status(400).json(err('TRF_002', 'Hatalı transfer', 'Kaynak ve hedef depo aynı olamaz.', 'Farklı depo seçin.'));
  const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(Number(itemId));
  if (!item) return res.status(400).json(err('TRF_003', 'Stok bulunamadı', 'Seçili stok yok.', 'Geçerli stok seçin.'));
  if (Number(item.qty) < Number(qty)) return res.status(400).json(err('TRF_004', 'Yetersiz stok', 'Transfer için stok yetersiz.', 'Miktarı azaltın.'));
  const finalTransferNo = (transferNo || '').trim() || getNextTransferCode();
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO stock_transfers(transfer_no,item_id,qty,from_warehouse_id,to_warehouse_id) VALUES(?,?,?,?,?)')
      .run(finalTransferNo, Number(itemId), Number(qty), Number(fromWarehouseId), Number(toWarehouseId));
    db.prepare('INSERT INTO inventory_movements(item_id,movement_type,qty,unit_cost,source_type,source_id) VALUES(?,?,?,?,?,?)')
      .run(Number(itemId), 'transfer', Number(qty), Number(item.avg_cost || 0), 'stock_transfer', finalTransferNo);
    return r.lastInsertRowid;
  });
  const id = tx();
  publish({ entityType: 'transfer', entityId: id, action: 'create' });
  res.status(201).json({ id });
});

app.get('/api/reports/summary', (req, res) => {
  const sales = db.prepare("SELECT COALESCE(SUM(gross_total),0) total FROM sales WHERE status='posted'").get().total;
  const purchases = db.prepare("SELECT COALESCE(SUM(gross_total),0) total FROM purchase_invoices WHERE status='posted'").get().total;
  const collections = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM collection_receipts').get().total;
  const payments = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM supplier_payments').get().total;
  const expenses = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM expense_receipts').get().total;
  const stockValue = db.prepare('SELECT COALESCE(SUM(qty * avg_cost),0) total FROM inventory_items').get().total;
  res.json({ sales, purchases, collections, payments, expenses, stockValue, cashFlow: collections - payments - expenses });
});


app.get('/api/reports/profit-summary', (req, res) => {
  const salesNet = db.prepare("SELECT COALESCE(SUM(net_total),0) total FROM sales WHERE status='posted'").get().total;
  const purchaseNet = db.prepare("SELECT COALESCE(SUM(net_total),0) total FROM purchase_invoices WHERE status='posted'").get().total;
  const expenses = db.prepare('SELECT COALESCE(SUM(amount),0) total FROM expense_receipts').get().total;
  const grossProfit = Number(salesNet) - Number(purchaseNet);
  const operatingProfit = grossProfit - Number(expenses);
  res.json({ salesNet, purchaseNet, expenses, grossProfit, operatingProfit });
});

app.get('/api/suppliers/:code/movements', (req, res) => {
  const code = String(req.params.code);
  const purchases = db.prepare("SELECT created_at as date, 'ALIS' as type, gross_total as amount, id as ref_id FROM purchase_invoices WHERE supplier_code=?").all(code);
  const payments = db.prepare("SELECT created_at as date, 'ODEME' as type, amount, id as ref_id FROM supplier_payments WHERE supplier_code=?").all(code);
  const rows = [...purchases, ...payments].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  res.json({ rows });
});



app.post('/api/offers', requirePermission('sales.write'), (req, res) => {
  const { offerNo, customerCode } = req.body;
  if (!customerCode) return res.status(400).json(err('OFF_001', 'Eksik veri', 'Cari kodu zorunlu.', 'Cari seçin.'));
  const no = (offerNo || '').trim() || `TKL-${Date.now()}`;
  const r = db.prepare('INSERT INTO offers(offer_no,customer_code,status) VALUES(?,?,?)').run(no, customerCode, 'open');
  res.status(201).json({ id: r.lastInsertRowid, offerNo: no });
});

app.post('/api/orders', requirePermission('sales.write'), (req, res) => {
  const { orderNo, offerId, customerCode } = req.body;
  if (!customerCode) return res.status(400).json(err('ORD_001', 'Eksik veri', 'Cari kodu zorunlu.', 'Cari seçin.'));
  const no = (orderNo || '').trim() || `SIP-${Date.now()}`;
  const r = db.prepare('INSERT INTO orders(order_no,offer_id,customer_code,status) VALUES(?,?,?,?)').run(no, offerId || null, customerCode, 'open');
  if (offerId) db.prepare('UPDATE offers SET status=? WHERE id=?').run('ordered', offerId);
  res.status(201).json({ id: r.lastInsertRowid, orderNo: no });
});

app.post('/api/invoices/from-order/:orderId', requirePermission('sales.write'), (req, res) => {
  const orderId = Number(req.params.orderId);
  const { lines = [], paymentMethod = 'credit', invoiceNo = null } = req.body;
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order) return res.status(404).json(err('INV_404', 'Sipariş yok', 'Sipariş bulunamadı.', 'Listeyi yenileyin.'));
  const already = db.prepare("SELECT id FROM invoices WHERE order_id=? AND invoice_type='sales' AND status='posted'").get(orderId);
  if (already) return res.status(400).json(err('INV_002', 'Mükerrer üretim', 'Aynı siparişten ikinci fatura kesilemez.', 'Mevcut faturayı kullanın.'));
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json(err('INV_003', 'Satır eksik', 'Fatura satırı zorunlu.', 'En az bir satır ekleyin.'));
  try { ensurePeriodOpen(req.body.date); } catch (e) { return res.status(400).json(err('PER_001', 'Dönem kilidi', 'Kapanan döneme kayıt yapılamaz.', 'Açık dönemde işlem yapın veya yöneticiye başvurun.')); }

  let net = 0; let vat = 0;
  const tx = db.transaction(() => {
    const sale = db.prepare('INSERT INTO sales(status,payment_method,customer_code,net_total,vat_total,gross_total) VALUES(?,?,?,?,?,?)')
      .run('draft', paymentMethod, order.customer_code, 1, 0, 1);
    const ins = db.prepare('INSERT INTO sale_lines(sale_id,item_id,qty,price,vat_rate) VALUES(?,?,?,?,?)');
    for (const l of lines) {
      if (Number(l.qty) <= 0 || Number(l.price) <= 0) throw new Error('VALIDATION');
      const item = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(Number(l.itemId));
      if (!item || Number(item.qty) < Number(l.qty)) throw new Error('NEGATIVE_STOCK');
      const ln = Number(l.qty) * Number(l.price);
      const lv = ln * Number(l.vatRate || 0);
      net += ln; vat += lv;
      db.prepare('UPDATE inventory_items SET qty=qty-? WHERE id=?').run(Number(l.qty), Number(l.itemId));
      db.prepare('INSERT INTO inventory_movements(item_id,movement_type,qty,unit_cost,source_type,source_id) VALUES(?,?,?,?,?,?)')
        .run(Number(l.itemId), 'out', Number(l.qty), Number(item.avg_cost || 0), 'invoice_sales', String(sale.lastInsertRowid));
      ins.run(sale.lastInsertRowid, Number(l.itemId), Number(l.qty), Number(l.price), Number(l.vatRate || 0));
    }
    const gross = net + vat;
    const recAcc = paymentMethod === 'cash' ? resolveMapping(db, 'sales.cash', '100') : paymentMethod === 'bank' ? resolveMapping(db, 'sales.bank', '102') : resolveMapping(db, 'sales.receivable', '120');
    const voucherId = postVoucher(db, { code: `INV-SAT-${sale.lastInsertRowid}`, sourceType: 'invoice_sales', sourceId: String(sale.lastInsertRowid), lines: [
      { accountCode: recAcc, dc: 'D', amount: gross },
      { accountCode: resolveMapping(db, 'sales.revenue', '600'), dc: 'C', amount: net },
      { accountCode: resolveMapping(db, 'sales.vat', '391'), dc: 'C', amount: vat },
    ]});
    db.prepare('UPDATE sales SET status=?, net_total=?, vat_total=?, gross_total=?, voucher_id=? WHERE id=?').run('posted', net, vat, gross, voucherId, sale.lastInsertRowid);
    const no = (invoiceNo || '').trim() || `FTR-${Date.now()}`;
    const inv = db.prepare('INSERT INTO invoices(invoice_no,order_id,invoice_type,partner_code,net_total,vat_total,gross_total,status,voucher_id) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(no, orderId, 'sales', order.customer_code, net, vat, gross, 'posted', voucherId);
    db.prepare('UPDATE orders SET status=? WHERE id=?').run('invoiced', orderId);
    appendAudit(db, { eventId: crypto.randomUUID(), actorUserId: req.user.id, entityType: 'invoice', entityId: inv.lastInsertRowid, action: 'create', afterJson: JSON.stringify({ orderId, net, gross }) });
    return { saleId: sale.lastInsertRowid, invoiceId: inv.lastInsertRowid };
  });

  try { const r = tx(); res.status(201).json(r); }
  catch (e) { res.status(400).json(err('INV_004', 'Fatura oluşturma hatası', e.message, 'Satırları/stokları kontrol edin.')); }
});

app.get('/api/customers/:code/movements', (req, res) => {
  const code = String(req.params.code);
  const sales = db.prepare("SELECT created_at as date, 'SATIS' as type, gross_total as amount, payment_method as method, id as ref_id FROM sales WHERE customer_code=?").all(code);
  const collections = db.prepare("SELECT created_at as date, 'TAHSILAT' as type, amount, method, id as ref_id FROM collection_receipts WHERE customer_code=?").all(code);
  const rows = [...sales, ...collections].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  res.json({ rows });
});

app.get('/api/sales/:id/pdf', (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(Number(req.params.id));
  if (!sale) return res.status(404).json(err('SALE_PDF_404', 'Satış yok', 'Satış kaydı bulunamadı.', 'Listeyi yenileyin.'));
  const lines = db.prepare('SELECT * FROM sale_lines WHERE sale_id=?').all(sale.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=satis-${sale.id}.pdf`);
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);
  doc.fontSize(20).fillColor('#0b3d5e').text('MTN ENERJİ - SATIŞ BELGESİ');
  doc.moveDown(0.5).fontSize(11).fillColor('#000');
  doc.text(`Belge No: SAT-${sale.id}`);
  doc.text(`Cari Kod: ${sale.customer_code}`);
  doc.text(`Tarih: ${sale.created_at}`);
  doc.text(`Ödeme: ${sale.payment_method}`);
  doc.moveDown();
  doc.text('Kalemler:');
  for (const l of lines) doc.text(`- Stok#${l.item_id} | Miktar: ${l.qty} | Fiyat: ${l.price} | KDV: ${l.vat_rate}`);
  doc.moveDown();
  doc.fontSize(12).text(`Ara Toplam: ${sale.net_total.toFixed(2)} TL`);
  doc.text(`KDV: ${sale.vat_total.toFixed(2)} TL`);
  doc.fontSize(14).text(`Genel Toplam: ${sale.gross_total.toFixed(2)} TL`);
  doc.end();
});

app.get('/api/dispatch-notes/:id/pdf', (req, res) => {
  const row = db.prepare('SELECT * FROM dispatch_notes WHERE id=?').get(Number(req.params.id));
  if (!row) return res.status(404).json(err('DIS_PDF_404', 'İrsaliye yok', 'Kayıt bulunamadı.', 'Listeyi yenileyin.'));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=irsaliye-${row.id}.pdf`);
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);
  doc.fontSize(20).fillColor('#0b3d5e').text('MTN ENERJİ - İRSALİYE');
  doc.moveDown(0.5).fontSize(11).fillColor('#000');
  doc.text(`İrsaliye No: ${row.note_no}`);
  doc.text(`Cari Kod: ${row.customer_code}`);
  doc.text(`Stok ID: ${row.item_id}`);
  doc.text(`Miktar: ${row.qty}`);
  doc.text(`Tür: ${row.kind}`);
  doc.text(`Tarih: ${row.created_at}`);
  doc.end();
});

app.post('/api/backup', requirePermission('reports.read'), (req, res) => {
  const plain = fs.readFileSync(DB_FILE);
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(BACKUP_KEY).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, enc]);
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  const out = path.join(BACKUP_DIR, `backup-${Date.now()}.bin`);
  fs.writeFileSync(out, payload);
  fs.writeFileSync(`${out}.sha256`, hash);
  res.json({ file: out, hash });
});


app.use((error, req, res, _next) => {
  logError(db, { userId: req.user?.id || null, route: req.originalUrl, method: req.method, message: error.message, stack: error.stack });
  res.status(500).json(err('GEN_500', 'Beklenmeyen hata', error.message, 'İşlemi tekrar deneyin.'));
});

app.post('/api/restore', requirePermission('period.close'), (req, res) => {
  const { file } = req.body;
  if (!file || !fs.existsSync(file)) return res.status(400).json(err('RST_001', 'Dosya yok', 'Yedek dosyası bulunamadı.', 'Geçerli dosya gönderin.'));
  const payload = fs.readFileSync(file);
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const enc = payload.subarray(28);
  const key = crypto.createHash('sha256').update(BACKUP_KEY).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  fs.writeFileSync(DB_FILE, plain);
  appendAudit(db, { eventId: crypto.randomUUID(), actorUserId: req.user.id, entityType: 'backup', entityId: file, action: 'restore' });
  res.json({ ok: true });
});

app.get('/api/error-logs', requirePermission('reports.read'), (req, res) => {
  const rows = db.prepare('SELECT * FROM error_logs ORDER BY id DESC LIMIT 500').all();
  res.json({ rows });
});

app.use('/', express.static(path.resolve(process.cwd(), '../client-src/web')));
app.listen(PORT, '0.0.0.0', () => console.log(`MTN server ${PORT}`));
