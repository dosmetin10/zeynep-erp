const fs = require('fs');
const crypto = require('crypto');
const { dialog } = require('electron');
const { openDb } = require('../db/db');
const { assert } = require('../../shared/validation');

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256');
}

function dumpDb() {
  const db = openDb();
  const tables = ['parties','products','warehouses','inventory_movements','invoices','invoice_lines','payments','accounts','journal_vouchers','journal_lines','audit_events','users','roles','user_roles','settings'];
  const out = {};
  tables.forEach((t) => { out[t] = db.prepare(`SELECT * FROM ${t}`).all(); });
  out.schema_version = db.prepare('SELECT * FROM schema_version').all();
  return out;
}

function createBackup(payload, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'), data: encrypted.toString('base64') };
}

function decryptBackup(blob, password) {
  const key = deriveKey(password, Buffer.from(blob.salt, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function healthCheck(data) {
  const acc = {};
  (data.journal_vouchers || []).forEach((v) => (acc[v.id] = { d: 0, c: 0 }));
  (data.journal_lines || []).forEach((l) => {
    if (!acc[l.voucher_id]) acc[l.voucher_id] = { d: 0, c: 0 };
    acc[l.voucher_id].d += Number(l.debit || 0);
    acc[l.voucher_id].c += Number(l.credit || 0);
  });
  Object.values(acc).forEach((x) => assert(Math.abs(x.d - x.c) < 0.0001, 'BKP-001', 'Restore reddedildi', 'Dengesiz voucher tespit edildi', 'Yedek dosyasını kontrol edin'));

  const pQty = {};
  (data.products || []).forEach((p) => (pQty[p.id] = Number(p.current_qty || 0)));
  Object.values(pQty).forEach((q) => assert(q >= 0, 'BKP-002', 'Restore reddedildi', 'Negatif stok tespit edildi', 'Veri bütünlüğünü düzeltin'));
}

async function backupCreate() {
  const { canceled, filePath } = await dialog.showSaveDialog({ filters: [{ name: 'MTN Backup', extensions: ['mtnbak'] }] });
  if (canceled || !filePath) return { ok: false, message: 'İptal edildi' };
  const payload = dumpDb();
  const encrypted = createBackup(payload, 'mtn-secure-backup');
  fs.writeFileSync(filePath, JSON.stringify(encrypted));
  return { ok: true, message: `Yedek alındı: ${filePath}` };
}

async function backupRestore() {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'MTN Backup', extensions: ['mtnbak'] }] });
  if (canceled || filePaths.length === 0) return { ok: false, message: 'İptal edildi' };
  const blob = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  const data = decryptBackup(blob, 'mtn-secure-backup');
  healthCheck(data);
  const db = openDb();
  db.transaction(() => {
    ['journal_lines','journal_vouchers','invoice_lines','invoices','payments','inventory_movements','products','parties','audit_events','users','roles','user_roles','accounts','settings','warehouses'].forEach((t) => db.prepare(`DELETE FROM ${t}`).run());

    const restoreOrder = [
      'roles',
      'users',
      'user_roles',
      'settings',
      'parties',
      'warehouses',
      'products',
      'inventory_movements',
      'invoices',
      'invoice_lines',
      'payments',
      'accounts',
      'journal_vouchers',
      'journal_lines',
      'audit_events',
    ];

    restoreOrder.forEach((table) => {
      if (!Array.isArray(data[table])) return;
      data[table].forEach((row) => {
        const keys = Object.keys(row);
        const sql = `INSERT INTO ${table}(${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
        db.prepare(sql).run(...keys.map((k) => row[k]));
      });
    });
  })();
  return { ok: true, message: 'Yedek geri yüklendi' };
}

module.exports = { backupCreate, backupRestore, healthCheck };
