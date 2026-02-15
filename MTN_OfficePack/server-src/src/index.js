import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
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

app.post('/api/setup/admin', (req, res) => {
  const { username, password } = req.body;
  if (!password || password.length < 8) return res.status(400).json(err('AUTH_001', 'Geçersiz parola', 'Parola en az 8 karakter olmalı.', 'Güçlü parola girin.'));
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run(username || 'admin', hash, 'admin');
  res.json({ ok: true });
});

app.post('/api/inventory/items', (req, res) => {
  const { sku, name, qty = 0, avgCost = 0 } = req.body;
  const x = db.prepare('INSERT INTO inventory_items(sku,name,qty,avg_cost) VALUES(?,?,?,?)').run(sku, name, qty, avgCost);
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
