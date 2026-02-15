const { openDb } = require('../db/db');
const { assert } = require('../../shared/validation');

function nextVoucherNo(db) {
  const count = db.prepare('SELECT COUNT(*) c FROM journal_vouchers').get().c + 1;
  return `JV-${new Date().getFullYear()}-${String(count).padStart(6, '0')}`;
}

function postVoucher({ voucherType, refType, refId, description, createdBy, lines }) {
  const db = openDb();
  return db.transaction(() => {
    const debit = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
    const credit = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
    assert(Math.abs(debit - credit) < 0.0001, 'ACC-001', 'Fiş dengesiz', 'Borç ve alacak eşit değil', 'Fiş satırlarını düzeltin');

    const voucherNo = nextVoucherNo(db);
    const voucherId = db
      .prepare('INSERT INTO journal_vouchers(voucher_no,voucher_type,ref_type,ref_id,description,created_by) VALUES (?,?,?,?,?,?)')
      .run(voucherNo, voucherType, refType || null, refId || null, description || '', createdBy || null).lastInsertRowid;

    const insert = db.prepare('INSERT INTO journal_lines(voucher_id,account_code,debit,credit,line_no,description) VALUES (?,?,?,?,?,?)');
    lines.forEach((line, idx) => {
      assert(line.accountCode, 'ACC-002', 'Hesap kodu eksik', 'Fiş satırında hesap kodu yok', 'Hesap planından seçim yapın');
      insert.run(voucherId, line.accountCode, Number(line.debit || 0), Number(line.credit || 0), idx + 1, line.description || '');
    });

    return { voucherId, voucherNo };
  })();
}

function voidVoucher(voucherId, createdBy, reason = 'İptal') {
  const db = openDb();
  return db.transaction(() => {
    const voucher = db.prepare('SELECT * FROM journal_vouchers WHERE id=?').get(voucherId);
    assert(voucher && voucher.status === 'posted', 'ACC-003', 'Fiş iptal edilemedi', 'Kayıt bulunamadı veya zaten iptal', 'Geçerli fiş seçin');

    const lines = db.prepare('SELECT * FROM journal_lines WHERE voucher_id=? ORDER BY line_no').all(voucherId);
    const reversal = lines.map((line) => ({
      accountCode: line.account_code,
      debit: line.credit,
      credit: line.debit,
      description: `Reversal ${voucher.voucher_no}`,
    }));

    const reversePosted = postVoucher({
      voucherType: 'reversal',
      refType: 'voucher',
      refId: voucherId,
      description: reason,
      createdBy,
      lines: reversal,
    });

    db.prepare('UPDATE journal_vouchers SET status=?, void_of_voucher_id=? WHERE id=?').run('void', reversePosted.voucherId, voucherId);
    return reversePosted;
  })();
}

module.exports = { postVoucher, voidVoucher };
