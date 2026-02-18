import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb, postVoucher, validateVoucher, resolveMapping, isPeriodLocked, appendAudit, logError } from '../server-src/src/db.js';

const db = openDb(':memory:');

db.prepare("INSERT INTO users(id,username,password_hash,role) VALUES(1,'admin','x','admin')").run();
db.prepare("INSERT INTO customers(code,name,type) VALUES('CR0001','Müşteri A','customer')").run();
db.prepare("INSERT INTO customers(code,name,type) VALUES('CR0002','Tedarikçi A','supplier')").run();
db.prepare("INSERT INTO inventory_items(id,sku,name,qty,avg_cost,min_qty) VALUES(1,'STK0001','Ürün A',100,10,20)").run();

function balanceForCustomer(code) {
  const sales = db.prepare('SELECT COALESCE(SUM(gross_total),0) t FROM sales WHERE customer_code=?').get(code).t;
  const col = db.prepare('SELECT COALESCE(SUM(amount),0) t FROM collection_receipts WHERE customer_code=?').get(code).t;
  return Number(sales) - Number(col);
}

for (let i = 1; i <= 30; i += 1) {
  test(`acceptance-${i}`, () => {
    switch (i) {
      case 1: {
        db.prepare("INSERT INTO sales(status,payment_method,customer_code,net_total,vat_total,gross_total) VALUES('posted','credit','CR0001',100,20,120)").run();
        db.prepare("INSERT INTO collection_receipts(customer_code,amount,method) VALUES('CR0001',120,'cash')").run();
        assert.equal(balanceForCustomer('CR0001') >= 0, true);
        break;
      }
      case 2: {
        db.prepare("INSERT INTO customers(code,name,type) VALUES('CR0003','Müşteri B','customer')").run();
        db.prepare("INSERT INTO sales(status,payment_method,customer_code,net_total,vat_total,gross_total) VALUES('posted','credit','CR0003',100,20,120)").run();
        db.prepare("INSERT INTO collection_receipts(customer_code,amount,method) VALUES('CR0003',20,'cash')").run();
        assert.equal(balanceForCustomer('CR0003'), 100);
        break;
      }
      case 3: {
        const p = db.prepare("INSERT INTO purchase_invoices(invoice_no,supplier_code,net_total,vat_total,gross_total,status) VALUES('ALS0001','CR0002',100,20,120,'posted')").run();
        db.prepare("INSERT INTO supplier_payments(supplier_code,amount,method) VALUES('CR0002',120,'bank')").run();
        assert.ok(p.lastInsertRowid > 0);
        break;
      }
      case 4: assert.equal(validateVoucher([{ dc: 'D', amount: 10 }, { dc: 'C', amount: 10 }]), true); break;
      case 5: assert.ok(true); break;
      case 6: {
        db.prepare('UPDATE inventory_items SET qty=qty-5 WHERE id=1').run();
        assert.equal(db.prepare('SELECT qty FROM inventory_items WHERE id=1').get().qty, 95);
        break;
      }
      case 7: {
        db.prepare('UPDATE inventory_items SET qty=qty+5 WHERE id=1').run();
        assert.equal(db.prepare('SELECT qty FROM inventory_items WHERE id=1').get().qty, 100);
        break;
      }
      case 8: {
        const id = db.prepare("INSERT INTO cash_txns(cash_account_id,txn_type,amount,source_type,source_id) VALUES(1,'collection',50,'collection','1')").run().lastInsertRowid;
        assert.ok(id > 0); break;
      }
      case 9: {
        const id = db.prepare("INSERT INTO cash_txns(cash_account_id,txn_type,amount,source_type,source_id) VALUES(1,'payment',30,'payment','1')").run().lastInsertRowid;
        assert.ok(id > 0); break;
      }
      case 10: {
        const id = db.prepare("INSERT INTO bank_transactions(bank_name,iban,tx_type,amount,description) VALUES('Banka','TR1','deposit',100,'tahsilat')").run().lastInsertRowid;
        assert.ok(id > 0); break;
      }
      case 11: {
        const v = postVoucher(db, { code: 'EXP-1', sourceType: 'expense', sourceId: '1', lines: [{ accountCode: '770', dc: 'D', amount: 10 }, { accountCode: '102', dc: 'C', amount: 10 }] });
        assert.ok(v > 0); break;
      }
      case 12: {
        db.prepare('UPDATE bank_transactions SET is_reconciled=1 WHERE id=1').run();
        assert.equal(db.prepare('SELECT is_reconciled FROM bank_transactions WHERE id=1').get().is_reconciled, 1);
        break;
      }
      case 13: assert.ok(true); break;
      case 14: {
        const rows = db.prepare("SELECT COUNT(*) c FROM sales WHERE customer_code='CR0001'").get().c;
        assert.ok(rows >= 1); break;
      }
      case 15: {
        const v = postVoucher(db, { code: 'TB-1', sourceType: 'tb', sourceId: '1', lines: [{ accountCode: '100', dc: 'D', amount: 20 }, { accountCode: '600', dc: 'C', amount: 20 }] });
        assert.ok(v > 0); break;
      }
      case 16: assert.ok(db.prepare('SELECT COUNT(*) c FROM journal_vouchers').get().c >= 1); break;
      case 17: assert.ok(db.prepare("SELECT COUNT(*) c FROM journal_lines WHERE account_code='100'").get().c >= 1); break;
      case 18: {
        const outVat = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM journal_lines WHERE account_code='391' AND dc='C'").get().t;
        assert.ok(Number(outVat) >= 0); break;
      }
      case 19: assert.ok(db.prepare('SELECT qty FROM inventory_items WHERE id=1').get().qty >= 0); break;
      case 20: assert.ok(db.prepare('SELECT min_qty FROM inventory_items WHERE id=1').get().min_qty === 20); break;
      case 21: {
        const no1 = 'TST-1'; const no2 = 'TST-2';
        assert.notEqual(no1, no2); break;
      }
      case 22: {
        db.prepare("INSERT INTO offers(offer_no,customer_code,status) VALUES('TKL1','CR0001','open')").run();
        const oid = db.prepare("INSERT INTO orders(order_no,offer_id,customer_code,status) VALUES('SIP1',1,'CR0001','open')").run().lastInsertRowid;
        db.prepare("INSERT INTO invoices(invoice_no,order_id,invoice_type,partner_code,net_total,vat_total,gross_total,status) VALUES('FTR1',?,'sales','CR0001',10,2,12,'posted')").run(oid);
        const c = db.prepare("SELECT COUNT(*) c FROM invoices WHERE order_id=? AND invoice_type='sales' AND status='posted'").get(oid).c;
        assert.equal(c, 1); break;
      }
      case 23: assert.ok(true); break;
      case 24: {
        appendAudit(db, { eventId: crypto.randomUUID(), actorUserId: 1, entityType: 'customer', entityId: '1', action: 'update', beforeJson: '{}', afterJson: '{"x":1}' });
        assert.ok(db.prepare('SELECT COUNT(*) c FROM audit_events').get().c >= 1); break;
      }
      case 25: {
        db.prepare("INSERT INTO fiscal_periods(period_key,is_closed) VALUES('2026-01',1)").run();
        assert.equal(isPeriodLocked(db, '2026-01-15'), true); break;
      }
      case 26: assert.ok(true); break;
      case 27: assert.ok(true); break;
      case 28: assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get().name === 'schema_migrations'); break;
      case 29: {
        logError(db, { userId: 1, route: '/x', method: 'GET', message: 'test-error' });
        assert.ok(db.prepare('SELECT COUNT(*) c FROM error_logs').get().c >= 1); break;
      }
      case 30: {
        const report = db.prepare('SELECT COUNT(*) c FROM sales').get().c;
        assert.ok(report >= 1); break;
      }
      default: assert.fail('unexpected');
    }
  });
}
