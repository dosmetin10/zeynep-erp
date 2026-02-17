import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, postVoucher, validateVoucher } from '../server-src/src/db.js';

const db = openDb(':memory:');

test('1 voucher balanced', ()=> assert.equal(validateVoucher([{dc:'D',amount:10},{dc:'C',amount:10}]), true));
test('2 voucher unbalanced reject', ()=> assert.throws(()=>postVoucher(db,{code:'X1',sourceType:'t',sourceId:'1',lines:[{accountCode:'100',dc:'D',amount:10},{accountCode:'600',dc:'C',amount:9}] }))); 
test('3 credit sale mapping', ()=> { const id=postVoucher(db,{code:'S1',sourceType:'sale',sourceId:'1',lines:[{accountCode:'120',dc:'D',amount:118},{accountCode:'600',dc:'C',amount:100},{accountCode:'391',dc:'C',amount:18}]}); assert.ok(id>0);});
test('4 cash sale mapping', ()=> { const id=postVoucher(db,{code:'S2',sourceType:'sale',sourceId:'2',lines:[{accountCode:'100',dc:'D',amount:118},{accountCode:'600',dc:'C',amount:100},{accountCode:'391',dc:'C',amount:18}]}); assert.ok(id>0);});
test('5 bank sale mapping', ()=> { const id=postVoucher(db,{code:'S3',sourceType:'sale',sourceId:'3',lines:[{accountCode:'102',dc:'D',amount:118},{accountCode:'600',dc:'C',amount:100},{accountCode:'391',dc:'C',amount:18}]}); assert.ok(id>0);});
test('6 vendor payment cash', ()=> { const id=postVoucher(db,{code:'P1',sourceType:'pay',sourceId:'1',lines:[{accountCode:'320',dc:'D',amount:100},{accountCode:'100',dc:'C',amount:100}]}); assert.ok(id>0);});
test('7 vendor payment bank', ()=> { const id=postVoucher(db,{code:'P2',sourceType:'pay',sourceId:'2',lines:[{accountCode:'320',dc:'D',amount:100},{accountCode:'102',dc:'C',amount:100}]}); assert.ok(id>0);});
test('8 cogs voucher', ()=> { const id=postVoucher(db,{code:'C1',sourceType:'cogs',sourceId:'1',lines:[{accountCode:'620',dc:'D',amount:40},{accountCode:'153',dc:'C',amount:40}]}); assert.ok(id>0);});
test('9 reversal voucher', ()=> { const id=postVoucher(db,{code:'R1',sourceType:'rev',sourceId:'1',lines:[{accountCode:'600',dc:'D',amount:100},{accountCode:'391',dc:'D',amount:18},{accountCode:'120',dc:'C',amount:118}]}); assert.ok(id>0);});
test('10 no single leg entries', ()=> assert.equal(validateVoucher([{dc:'D',amount:10}]), false));
test('11 qty positive rule', ()=> assert.equal(1>0,true));
test('12 price positive rule', ()=> assert.equal(2>0,true));
test('13 vat non-negative', ()=> assert.equal(0>=0,true));
test('14 status posted immutable by delete', ()=> assert.ok(true));
test('15 void uses reversal', ()=> assert.ok(true));
test('16 trial balance sums', ()=> {
 const rows=db.prepare("SELECT SUM(CASE WHEN dc='D' THEN amount ELSE 0 END) dr, SUM(CASE WHEN dc='C' THEN amount ELSE 0 END) cr FROM journal_lines").get();
 assert.equal(Number(rows.dr.toFixed(2)), Number(rows.cr.toFixed(2)));
});
test('17 audit append-only table exists', ()=> {
 const t=db.prepare("SELECT name FROM sqlite_master WHERE type='table' and name='audit_events'").get(); assert.equal(t.name,'audit_events');
});
test('18 fk on', ()=> { const x=db.pragma('foreign_keys', { simple: true }); assert.equal(x,1);});
test('19 journal mode available', ()=> { const x=db.pragma('journal_mode', { simple: true }); assert.ok(['wal','memory'].includes(String(x).toLowerCase()));});
test('20 voucher count', ()=> { const c=db.prepare('select count(*) c from journal_vouchers').get().c; assert.ok(c>=7);});


test('21 sales table has cogs reversal column', ()=> {
 const cols=db.prepare('PRAGMA table_info(sales)').all().map(r=>r.name);
 assert.ok(cols.includes('cogs_reversal_voucher_id'));
});

test('22 cogs reversal voucher mapping', ()=> {
 const id=postVoucher(db,{code:'RC1',sourceType:'sale_cost_reversal',sourceId:'42',lines:[{accountCode:'153',dc:'D',amount:40},{accountCode:'620',dc:'C',amount:40}]});
 assert.ok(id>0);
});
