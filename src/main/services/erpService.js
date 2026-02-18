const { openDb } = require('../db/db');
const { postVoucher, voidVoucher } = require('./accountingService');
const { assert, mustPositive, requireEnum } = require('../../shared/validation');

function list(moduleName, search = '') {
  const db = openDb();
  const q = `%${search}%`;
  switch (moduleName) {
    case 'customers':
      return db.prepare("SELECT * FROM parties WHERE type='customer' AND name LIKE ? ORDER BY id DESC").all(q);
    case 'suppliers':
      return db.prepare("SELECT * FROM parties WHERE type='supplier' AND name LIKE ? ORDER BY id DESC").all(q);
    case 'stock':
      return db.prepare('SELECT * FROM products WHERE name LIKE ? OR code LIKE ? ORDER BY id DESC').all(q, q);
    case 'sales':
      return db.prepare("SELECT * FROM invoices WHERE type='sales' ORDER BY id DESC").all();
    default:
      return [];
  }
}

function createParty({ type, name, phone, taxNo }) {
  requireEnum(type, ['customer', 'supplier'], 'ERP-001', 'Cari tipi');
  assert(name, 'ERP-002', 'Cari kaydı başarısız', 'Unvan zorunlu', 'Unvan girin');
  const db = openDb();
  const id = db
    .prepare('INSERT INTO parties(type,name,phone,tax_no) VALUES (?,?,?,?)')
    .run(type, name, phone || null, taxNo || null).lastInsertRowid;
  return db.prepare('SELECT * FROM parties WHERE id=?').get(id);
}

function createProduct({ code, name, unit, vatRate, minLevel, quantity, unitCost }) {
  assert(code && name && unit, 'ERP-003', 'Stok kaydı başarısız', 'Zorunlu alan eksik', 'Kod/Ad/Birim girin');
  const db = openDb();
  return db.transaction(() => {
    const id = db
      .prepare('INSERT INTO products(code,name,unit,vat_rate,min_level,current_qty,avg_cost) VALUES (?,?,?,?,?,?,?)')
      .run(code, name, unit, Number(vatRate || 20), Number(minLevel || 0), Number(quantity || 0), Number(unitCost || 0)).lastInsertRowid;
    if (Number(quantity || 0) > 0) {
      db.prepare('INSERT INTO inventory_movements(product_id,warehouse_id,movement_type,quantity,unit_cost,source_type) VALUES (?,?,?,?,?,?)').run(id, 1, 'in', Number(quantity), Number(unitCost || 0), 'opening');
    }
    return db.prepare('SELECT * FROM products WHERE id=?').get(id);
  })();
}

function createSalesInvoice({ partyId, lines, collectionMethod, createdBy }) {
  const db = openDb();
  mustPositive(Number(partyId), 'ERP-004', 'Müşteri');
  assert(Array.isArray(lines) && lines.length > 0, 'ERP-005', 'Satış başarısız', 'Kalem bulunamadı', 'En az bir satır ekleyin');

  return db.transaction(() => {
    const party = db.prepare("SELECT * FROM parties WHERE id=? AND type='customer'").get(partyId);
    assert(party, 'ERP-006', 'Satış başarısız', 'Müşteri bulunamadı', 'Geçerli müşteri seçin');

    const allowNegative = db.prepare("SELECT value FROM settings WHERE key='allow_negative_stock'").get().value === 'true';
    let grossTotal = 0;
    let vatTotal = 0;
    let costTotal = 0;
    const enriched = lines.map((line) => {
      const product = db.prepare('SELECT * FROM products WHERE id=?').get(line.productId);
      assert(product, 'ERP-007', 'Satış başarısız', 'Ürün bulunamadı', 'Geçerli ürün seçin');
      mustPositive(Number(line.quantity), 'ERP-008', 'Miktar');
      mustPositive(Number(line.unitPrice), 'ERP-009', 'Birim fiyat');
      const discount = Number(line.discountRate || 0);
      const lineGross = Number(line.quantity) * Number(line.unitPrice);
      const net = lineGross * (1 - discount / 100);
      const lineVat = net * (Number(product.vat_rate) / 100);
      grossTotal += net;
      vatTotal += lineVat;
      costTotal += Number(line.quantity) * Number(product.avg_cost);
      assert(allowNegative || product.current_qty >= Number(line.quantity), 'ERP-010', 'Satış başarısız', 'Negatif stok yasak', `Stok yetersiz: ${product.code}`);
      return { product, quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), discount, lineTotal: net, vatRate: product.vat_rate };
    });

    const netTotal = grossTotal + vatTotal;
    const invoiceNo = `S-${new Date().getFullYear()}-${String(db.prepare("SELECT COUNT(*) c FROM invoices WHERE type='sales'").get().c + 1).padStart(6, '0')}`;
    const invoiceId = db
      .prepare('INSERT INTO invoices(invoice_no,type,party_id,issue_date,gross_total,vat_total,net_total) VALUES (?,?,?,?,?,?,?)')
      .run(invoiceNo, 'sales', partyId, new Date().toISOString(), grossTotal, vatTotal, netTotal).lastInsertRowid;

    const lineInsert = db.prepare('INSERT INTO invoice_lines(invoice_id,product_id,quantity,unit_price,vat_rate,discount_rate,line_total,unit_cost_snapshot) VALUES (?,?,?,?,?,?,?,?)');
    const moveInsert = db.prepare('INSERT INTO inventory_movements(product_id,warehouse_id,movement_type,quantity,unit_cost,source_type,source_id) VALUES (?,?,?,?,?,?,?)');

    enriched.forEach((row) => {
      lineInsert.run(invoiceId, row.product.id, row.quantity, row.unitPrice, row.vatRate, row.discount, row.lineTotal, row.product.avg_cost);
      db.prepare('UPDATE products SET current_qty=current_qty-? WHERE id=?').run(row.quantity, row.product.id);
      moveInsert.run(row.product.id, 1, 'out', row.quantity, row.product.avg_cost, 'sales_invoice', invoiceId);
    });

    const arAccount = collectionMethod === 'cash' ? '100' : collectionMethod === 'bank' ? '102' : '120';
    postVoucher({
      voucherType: 'sales',
      refType: 'invoice',
      refId: invoiceId,
      createdBy,
      description: `Satış ${invoiceNo}`,
      lines: [
        { accountCode: arAccount, debit: netTotal, credit: 0 },
        { accountCode: '600', debit: 0, credit: grossTotal },
        { accountCode: '391', debit: 0, credit: vatTotal },
      ],
    });

    postVoucher({
      voucherType: 'sales_cost',
      refType: 'invoice',
      refId: invoiceId,
      createdBy,
      description: `Satış maliyet ${invoiceNo}`,
      lines: [
        { accountCode: '620', debit: costTotal, credit: 0 },
        { accountCode: '153', debit: 0, credit: costTotal },
      ],
    });

    if (collectionMethod === 'credit') {
      db.prepare('UPDATE parties SET balance=balance+? WHERE id=?').run(netTotal, partyId);
    }

    return db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
  })();
}

function createPayment({ type, method, partyId, amount, description, createdBy }) {
  requireEnum(type, ['collection', 'payment'], 'ERP-011', 'Ödeme tipi');
  requireEnum(method, ['cash', 'bank'], 'ERP-012', 'Ödeme yöntemi');
  mustPositive(Number(amount), 'ERP-013', 'Tutar');

  const db = openDb();
  return db.transaction(() => {
    const party = db.prepare('SELECT * FROM parties WHERE id=?').get(partyId);
    assert(party, 'ERP-014', 'Ödeme başarısız', 'Cari bulunamadı', 'Geçerli cari seçin');
    const paymentId = db
      .prepare('INSERT INTO payments(type,method,party_id,amount,payment_date,description) VALUES (?,?,?,?,?,?)')
      .run(type, method, partyId, amount, new Date().toISOString(), description || '').lastInsertRowid;

    const cashOrBank = method === 'cash' ? '100' : '102';
    if (type === 'collection') {
      postVoucher({
        voucherType: 'collection',
        refType: 'payment',
        refId: paymentId,
        createdBy,
        lines: [
          { accountCode: cashOrBank, debit: amount, credit: 0 },
          { accountCode: '120', debit: 0, credit: amount },
        ],
      });
      if (party.type === 'customer') db.prepare('UPDATE parties SET balance=balance-? WHERE id=?').run(amount, partyId);
    } else {
      postVoucher({
        voucherType: 'payment',
        refType: 'payment',
        refId: paymentId,
        createdBy,
        lines: [
          { accountCode: '320', debit: amount, credit: 0 },
          { accountCode: cashOrBank, debit: 0, credit: amount },
        ],
      });
      if (party.type === 'supplier') db.prepare('UPDATE parties SET balance=balance-? WHERE id=?').run(amount, partyId);
    }
    return db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  })();
}

function voidInvoice(invoiceId, createdBy, reason) {
  const db = openDb();
  return db.transaction(() => {
    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(invoiceId);
    assert(invoice && invoice.status === 'posted', 'ERP-015', 'İptal başarısız', 'Fatura bulunamadı veya iptal edilmiş', 'Geçerli fatura seçin');

    if (invoice.type === 'sales') {
      const lines = db.prepare('SELECT product_id, quantity, unit_cost_snapshot FROM invoice_lines WHERE invoice_id=?').all(invoiceId);
      const moveInsert = db.prepare('INSERT INTO inventory_movements(product_id,warehouse_id,movement_type,quantity,unit_cost,source_type,source_id) VALUES (?,?,?,?,?,?,?)');
      lines.forEach((line) => {
        db.prepare('UPDATE products SET current_qty=current_qty+? WHERE id=?').run(Number(line.quantity), line.product_id);
        moveInsert.run(line.product_id, 1, 'in', Number(line.quantity), Number(line.unit_cost_snapshot || 0), 'void_sales_invoice', invoiceId);
      });

      const hasReceivableImpact = db.prepare(`
        SELECT COUNT(*) c
        FROM journal_vouchers v
        JOIN journal_lines l ON l.voucher_id = v.id
        WHERE v.ref_type='invoice'
          AND v.ref_id=?
          AND v.voucher_type='sales'
          AND v.status='posted'
          AND l.account_code='120'
          AND l.debit > 0
      `).get(invoiceId).c > 0;

      if (hasReceivableImpact) {
        db.prepare('UPDATE parties SET balance=balance-? WHERE id=?').run(Number(invoice.net_total), invoice.party_id);
      }
    }

    db.prepare('UPDATE invoices SET status=?, void_reason=? WHERE id=?').run('void', reason || 'İptal', invoiceId);
    const vouchers = db.prepare('SELECT id FROM journal_vouchers WHERE ref_type=? AND ref_id=? AND status=?').all('invoice', invoiceId, 'posted');
    vouchers.forEach((v) => voidVoucher(v.id, createdBy, `Fatura iptal ${invoice.invoice_no}`));
    return { ok: true };
  })();
}

module.exports = { list, createParty, createProduct, createSalesInvoice, createPayment, voidInvoice };
