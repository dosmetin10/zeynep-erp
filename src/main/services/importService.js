const fs = require('fs');
const { dialog } = require('electron');
const { openDb } = require('../db/db');

async function importLegacyJson() {
  const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (canceled || !filePaths.length) return { ok: false, message: 'İptal edildi' };

  const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  const db = openDb();
  const report = { customers: 0, stock: 0, cash: 0, errors: [] };

  db.transaction(() => {
    (raw.customers || []).forEach((c) => {
      try {
        db.prepare('INSERT INTO parties(type,name,phone,balance) VALUES (?,?,?,?)').run(c.type === 'Tedarikçi' ? 'supplier' : 'customer', c.name, c.phone || null, Number(c.balance || 0));
        report.customers += 1;
      } catch (e) { report.errors.push(`Cari: ${e.message}`); }
    });

    (raw.stock || []).forEach((s) => {
      try {
        db.prepare('INSERT INTO products(code,name,unit,current_qty,avg_cost,min_level) VALUES (?,?,?,?,?,?)').run(s.code, s.name, s.unit || 'Adet', Number(s.quantity || 0), Number(s.price || 0), 5);
        report.stock += 1;
      } catch (e) { report.errors.push(`Stok: ${e.message}`); }
    });

    (raw.cash || []).forEach((k) => {
      try {
        db.prepare('INSERT INTO payments(type,method,party_id,amount,payment_date,description) VALUES (?,?,?,?,?,?)').run(k.type === 'Gelir' ? 'collection' : 'payment', 'cash', 1, Number(k.amount || 0), k.date || new Date().toISOString(), k.description || 'Legacy');
        report.cash += 1;
      } catch (e) { report.errors.push(`Kasa: ${e.message}`); }
    });
  })();

  return { ok: true, report };
}

module.exports = { importLegacyJson };
