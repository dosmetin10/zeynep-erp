import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import PDFDocument from 'pdfkit';
import { openDb, postVoucher, appendAudit } from './db.js';

const PORT = Number(process.env.SERVER_PORT || 3777);
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), '../MTN_OfficePack/server-win11/data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'mtn-erp.db');
const BACKUP_KEY = process.env.BACKUP_KEY || 'dev-only-change-me-32-bytes-key!!';
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const db = openDb(DB_FILE);
const app = express();
app.use(express.json());

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

app.post('/api/customers', (req, res) => {
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

app.post('/api/inventory/items', (req, res) => {
  const { sku, name, qty = 0, avgCost = 0 } = req.body;
  const finalSku = (sku || '').trim() || getNextStockCode();
  if (!name) return res.status(400).json(err('STK_002', 'Eksik alan', 'Stok adı zorunludur.', 'Stok adı girin.'));
  const x = db.prepare('INSERT INTO inventory_items(sku,name,qty,avg_cost) VALUES(?,?,?,?)').run(finalSku, name, qty, avgCost);
  publish({ entityType: 'inventory', entityId: x.lastInsertRowid, action: 'create' });
  res.status(201).json({ id: x.lastInsertRowid });
});

app.post('/api/sales', (req, res) => {
  const { paymentMethod, customerCode, lines } = req.body;
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
    const account = paymentMethod === 'cash' ? '100' : paymentMethod === 'bank' ? '102' : '120';
    const voucherId = postVoucher(db, {
      code: `SAT-${sale.lastInsertRowid}`,
      sourceType: 'sale', sourceId: String(sale.lastInsertRowid),
      lines: [
        { accountCode: account, dc: 'D', amount: gross },
        { accountCode: '600', dc: 'C', amount: net },
        { accountCode: '391', dc: 'C', amount: vat },
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
  const id = req.params.id;
  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(id);
  if (!sale || sale.status !== 'posted') return res.status(400).json(err('SALE_404', 'Kayıt yok', 'Sadece posted kayıt void olabilir.', 'Doğru kayıt seçin.'));
  const revId = postVoucher(db, { code: `REV-SAT-${id}`, sourceType: 'sale_reversal', sourceId: id, lines: [
    { accountCode: sale.payment_method === 'cash' ? '100' : sale.payment_method === 'bank' ? '102' : '120', dc: 'C', amount: sale.gross_total },
    { accountCode: '600', dc: 'D', amount: sale.net_total },
    { accountCode: '391', dc: 'D', amount: sale.vat_total },
  ] });
  db.prepare('UPDATE sales SET status=?, reversal_voucher_id=? WHERE id=?').run('void', revId, id);
  appendAudit(db, { eventId: crypto.randomUUID(), entityType: 'sale', entityId: id, action: 'void' });
  publish({ entityType: 'sale', entityId: id, action: 'void' });
  res.json({ ok: true, reversalVoucherId: revId });
});

app.get('/api/reports/trial-balance', (req, res) => {
  const rows = db.prepare(`SELECT account_code,
    SUM(CASE WHEN dc='D' THEN amount ELSE 0 END) AS dr,
    SUM(CASE WHEN dc='C' THEN amount ELSE 0 END) AS cr
    FROM journal_lines GROUP BY account_code ORDER BY account_code`).all();
  res.json(rows);
});



app.get('/api/inventory/low-stock', (req, res) => {
  const threshold = Math.max(0, Number(req.query.threshold || 5));
  const rows = db.prepare('SELECT id, sku, name, qty, avg_cost FROM inventory_items WHERE qty <= ? ORDER BY qty ASC, id ASC').all(threshold);
  res.json({ threshold, total: rows.length, rows });
});

app.get('/api/dashboard/summary', (req, res) => {
  const lowStockThreshold = Math.max(0, Number(req.query.lowStockThreshold || 5));
  const totals = {
    customers: db.prepare('SELECT COUNT(*) c FROM customers').get().c,
    items: db.prepare('SELECT COUNT(*) c FROM inventory_items').get().c,
    stockQty: db.prepare('SELECT COALESCE(SUM(qty),0) v FROM inventory_items').get().v,
    stockValue: db.prepare('SELECT COALESCE(SUM(qty * avg_cost),0) v FROM inventory_items').get().v,
    lowStock: db.prepare('SELECT COUNT(*) c FROM inventory_items WHERE qty <= ?').get(lowStockThreshold).c,
    monthlySales: db.prepare("SELECT COALESCE(SUM(gross_total),0) v FROM sales WHERE status='posted' AND strftime('%Y-%m', created_at)=strftime('%Y-%m','now','localtime')").get().v,
    monthlyCollections: db.prepare("SELECT COALESCE(SUM(amount),0) v FROM collection_receipts WHERE strftime('%Y-%m', created_at)=strftime('%Y-%m','now','localtime')").get().v,
  };

  const receivablesRows = db.prepare(`
    SELECT customer_code,
      SUM(CASE WHEN type='sale' THEN amount ELSE 0 END) AS sales_total,
      SUM(CASE WHEN type='collection' THEN amount ELSE 0 END) AS collections_total
    FROM (
      SELECT customer_code, gross_total AS amount, 'sale' AS type FROM sales WHERE status='posted'
      UNION ALL
      SELECT customer_code, amount, 'collection' AS type FROM collection_receipts
    ) t
    GROUP BY customer_code
  `).all();

  const receivables = receivablesRows
    .map((r) => ({
      customerCode: r.customer_code,
      outstanding: Number(r.sales_total || 0) - Number(r.collections_total || 0),
    }))
    .filter((r) => r.outstanding > 0.00001)
    .sort((a, b) => b.outstanding - a.outstanding);

  const totalReceivables = receivables.reduce((sum, r) => sum + r.outstanding, 0);

  res.json({
    lowStockThreshold,
    totals: {
      ...totals,
      totalReceivables,
    },
    topReceivables: receivables.slice(0, 10),
  });
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

app.post('/api/collections', (req, res) => {
  const { customerCode, amount, method = 'cash' } = req.body;
  if (!customerCode || Number(amount) <= 0) return res.status(400).json(err('COL_001', 'Eksik veri', 'Cari ve tutar zorunlu.', 'Geçerli cari ve tutar girin.'));
  const r = db.prepare('INSERT INTO collection_receipts(customer_code,amount,method) VALUES(?,?,?)').run(customerCode, Number(amount), method);
  postVoucher(db, { code: `TAH-${r.lastInsertRowid}`, sourceType: 'collection', sourceId: String(r.lastInsertRowid), lines: [
    { accountCode: method === 'bank' ? '102' : '100', dc: 'D', amount: Number(amount) },
    { accountCode: '120', dc: 'C', amount: Number(amount) },
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

app.post('/api/backup', (req, res) => {
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

app.use('/', express.static(path.resolve(process.cwd(), '../client-src/web')));
app.listen(PORT, '0.0.0.0', () => console.log(`MTN server ${PORT}`));
