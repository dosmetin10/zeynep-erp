function assert(condition, code, what, why, next) {
  if (!condition) {
    const error = new Error(`${what} | ${why} | ${next} | Ref:${code}`);
    error.refCode = code;
    throw error;
  }
}

function mustPositive(num, code, field) {
  assert(Number.isFinite(num) && num > 0, code, `${field} geçersiz`, 'Değer pozitif olmalı', `${field} alanını kontrol edin`);
}

function requireEnum(value, allowed, code, field) {
  assert(allowed.includes(value), code, `${field} geçersiz`, `İzin verilen değerler: ${allowed.join(',')}`, 'Seçimi düzeltin');
}

module.exports = { assert, mustPositive, requireEnum };
