const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { closeDb, getDbPath, openDb } = require('../src/main/db/db');
const { postVoucher, voidVoucher } = require('../src/main/services/accountingService');
const erp = require('../src/main/services/erpService');
const { restoreData } = require('../src/main/services/backupService');

function resetDb() {
  closeDb();
  const p = getDbPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
  const shm = `${p}-shm`; const wal = `${p}-wal`;
  if (fs.existsSync(shm)) fs.unlinkSync(shm);
  if (fs.existsSync(wal)) fs.unlinkSync(wal);
  openDb();
}

function seedCustomerAndProduct() {
  const c = erp.createParty({ type: 'customer', name: 'ACME' });
  const s = erp.createParty({ type: 'supplier', name: 'SUP' });
  const p = erp.createProduct({ code: 'P1', name: 'Ürün', unit: 'Adet', vatRate: 20, quantity: 100, unitCost: 50 });
  return { c, s, p };
}

test.beforeEach(() => resetDb());

test('1) voucher balance valid', () => {
  const v = postVoucher({ voucherType: 'manual', lines: [{ accountCode: '100', debit: 100 }, { accountCode: '600', credit: 100 }] });
  assert.ok(v.voucherId > 0);
});

test('2) voucher balance invalid rejected', () => {
  assert.throws(() => postVoucher({ voucherType: 'manual', lines: [{ accountCode: '100', debit: 90 }, { accountCode: '600', credit: 100 }] }));
});

test('3) sales credit creates invoice', () => {
  const { c, p } = seedCustomerAndProduct();
  const inv = erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'credit', lines: [{ productId: p.id, quantity: 2, unitPrice: 100 }] });
  assert.equal(inv.type, 'sales');
});

test('4) sales cash Dr100', () => {
  const { c, p } = seedCustomerAndProduct();
  erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'cash', lines: [{ productId: p.id, quantity: 1, unitPrice: 100 }] });
  const db = openDb();
  const line = db.prepare("SELECT * FROM journal_lines WHERE account_code='100' ORDER BY id DESC LIMIT 1").get();
  assert.ok(line.debit > 0);
});

test('5) sales bank Dr102', () => {
  const { c, p } = seedCustomerAndProduct();
  erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'bank', lines: [{ productId: p.id, quantity: 1, unitPrice: 100 }] });
  const db = openDb();
  const line = db.prepare("SELECT * FROM journal_lines WHERE account_code='102' ORDER BY id DESC LIMIT 1").get();
  assert.ok(line.debit > 0);
});

test('6) sales posts VAT 391', () => {
  const { c, p } = seedCustomerAndProduct();
  erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'credit', lines: [{ productId: p.id, quantity: 1, unitPrice: 100 }] });
  const db = openDb();
  const vat = db.prepare("SELECT SUM(credit) c FROM journal_lines WHERE account_code='391'").get().c;
  assert.ok(vat > 0);
});

test('7) sales posts revenue 600', () => {
  const { c, p } = seedCustomerAndProduct();
  erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'credit', lines: [{ productId: p.id, quantity: 1, unitPrice: 100 }] });
  const db = openDb();
  assert.ok(db.prepare("SELECT SUM(credit) c FROM journal_lines WHERE account_code='600'").get().c > 0);
});

test('8) cost voucher Dr620 Cr153', () => {
  const { c, p } = seedCustomerAndProduct();
  erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'credit', lines: [{ productId: p.id, quantity: 1, unitPrice: 100 }] });
  const db = openDb();
  assert.ok(db.prepare("SELECT SUM(debit) d FROM journal_lines WHERE account_code='620'").get().d > 0);
  assert.ok(db.prepare("SELECT SUM(credit) c FROM journal_lines WHERE account_code='153'").get().c > 0);
});

test('9) stock decreases on sales', () => {
  const { c, p } = seedCustomerAndProduct();
  erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'credit', lines: [{ productId: p.id, quantity: 4, unitPrice: 100 }] });
  const db = openDb();
  assert.equal(db.prepare('SELECT current_qty q FROM products WHERE id=?').get(p.id).q, 96);
});

test('10) negative stock blocked', () => {
  const { c, p } = seedCustomerAndProduct();
  assert.throws(() => erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'credit', lines: [{ productId: p.id, quantity: 999, unitPrice: 100 }] }));
});

test('11) collection voucher Dr100 Cr120', () => {
  const { c } = seedCustomerAndProduct();
  erp.createPayment({ type: 'collection', method: 'cash', partyId: c.id, amount: 100 });
  const db = openDb();
  assert.ok(db.prepare("SELECT SUM(debit) d FROM journal_lines WHERE account_code='100'").get().d > 0);
  assert.ok(db.prepare("SELECT SUM(credit) c FROM journal_lines WHERE account_code='120'").get().c > 0);
});

test('12) supplier payment Dr320 Cr102', () => {
  const { s } = seedCustomerAndProduct();
  erp.createPayment({ type: 'payment', method: 'bank', partyId: s.id, amount: 120 });
  const db = openDb();
  assert.ok(db.prepare("SELECT SUM(debit) d FROM journal_lines WHERE account_code='320'").get().d > 0);
  assert.ok(db.prepare("SELECT SUM(credit) c FROM journal_lines WHERE account_code='102'").get().c > 0);
});

test('13) void voucher creates reversal', () => {
  const v = postVoucher({ voucherType: 'manual', lines: [{ accountCode: '100', debit: 10 }, { accountCode: '600', credit: 10 }] });
  const rv = voidVoucher(v.voucherId, null, 'iptal');
  assert.ok(rv.voucherId > 0);
});

test('14) void invoice marks invoice void', () => {
  const { c, p } = seedCustomerAndProduct();
  const inv = erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'credit', lines: [{ productId: p.id, quantity: 1, unitPrice: 100 }] });
  erp.voidInvoice(inv.id, null, 'test');
  const db = openDb();
  assert.equal(db.prepare('SELECT status FROM invoices WHERE id=?').get(inv.id).status, 'void');
});

test('15) every voucher remains balanced', () => {
  const { c, p } = seedCustomerAndProduct();
  erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'credit', lines: [{ productId: p.id, quantity: 2, unitPrice: 100 }] });
  erp.createPayment({ type: 'collection', method: 'bank', partyId: c.id, amount: 50 });
  const db = openDb();
  const ids = db.prepare('SELECT id FROM journal_vouchers').all().map(x => x.id);
  ids.forEach((id) => {
    const d = db.prepare('SELECT COALESCE(SUM(debit),0) s FROM journal_lines WHERE voucher_id=?').get(id).s;
    const c = db.prepare('SELECT COALESCE(SUM(credit),0) s FROM journal_lines WHERE voucher_id=?').get(id).s;
    assert.ok(Math.abs(d - c) < 0.0001);
  });
});


test('16) void credit sales restores stock and customer balance', () => {
  const { c, p } = seedCustomerAndProduct();
  const inv = erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'credit', lines: [{ productId: p.id, quantity: 3, unitPrice: 100 }] });
  erp.voidInvoice(inv.id, null, 'test');

  const db = openDb();
  assert.equal(db.prepare('SELECT current_qty q FROM products WHERE id=?').get(p.id).q, 100);
  assert.equal(db.prepare('SELECT balance b FROM parties WHERE id=?').get(c.id).b, 0);
  const reversalMove = db.prepare("SELECT COUNT(*) c FROM inventory_movements WHERE source_type='void_sales_invoice' AND source_id=?").get(inv.id).c;
  assert.ok(reversalMove > 0);
});

test('17) void cash sales does not reduce customer balance below zero', () => {
  const { c, p } = seedCustomerAndProduct();
  const inv = erp.createSalesInvoice({ partyId: c.id, collectionMethod: 'cash', lines: [{ productId: p.id, quantity: 2, unitPrice: 100 }] });
  erp.voidInvoice(inv.id, null, 'test');

  const db = openDb();
  assert.equal(db.prepare('SELECT balance b FROM parties WHERE id=?').get(c.id).b, 0);
});

test('18) restoreData inserts users before FK-linked journal_vouchers and audit_events', () => {
  const db = openDb();

  const backupData = {
    journal_vouchers: [
      {
        id: 1,
        voucher_no: 'JV-000001',
        voucher_type: 'manual',
        ref_type: null,
        ref_id: null,
        status: 'posted',
        description: 'test',
        created_by: 1,
        created_at: '2024-01-01T00:00:00.000Z',
        void_of_voucher_id: null,
      },
    ],
    journal_lines: [
      { id: 1, voucher_id: 1, account_code: '100', debit: 100, credit: 0, line_no: 1, description: 'd' },
      { id: 2, voucher_id: 1, account_code: '600', debit: 0, credit: 100, line_no: 2, description: 'c' },
    ],
    audit_events: [
      {
        event_id: 'evt-1',
        actor_user_id: 1,
        action: 'create',
        entity_type: 'invoice',
        entity_id: '1',
        before_json: null,
        after_json: '{}',
        created_at: '2024-01-01T00:00:00.000Z',
      },
    ],
    users: [
      { id: 1, username: 'admin', password_hash: 'hash', is_active: 1, created_at: '2024-01-01T00:00:00.000Z' },
    ],
    roles: [{ id: 1, code: 'admin', name: 'Yönetici' }],
    user_roles: [{ user_id: 1, role_id: 1 }],
    settings: [],
    parties: [],
    warehouses: [],
    products: [],
    inventory_movements: [],
    invoices: [],
    invoice_lines: [],
    payments: [],
    accounts: [{ code: '100', name: 'Kasa', type: 'asset' }, { code: '600', name: 'Yurtiçi Satışlar', type: 'income' }],
  };

  assert.doesNotThrow(() => {
    db.transaction(() => {
      restoreData(db, backupData);
    })();
  });

  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM journal_vouchers').get().c, 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM audit_events').get().c, 1);
});
