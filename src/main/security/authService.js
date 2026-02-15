const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { openDb } = require('../db/db');
const { assert } = require('../../shared/validation');

const sessions = new Map();

function hasAnyUser() {
  const db = openDb();
  return db.prepare('SELECT COUNT(*) as c FROM users').get().c > 0;
}

function setupAdmin({ username, password }) {
  assert(username && password, 'AUTH-001', 'Admin oluşturulamadı', 'Eksik bilgi', 'Kullanıcı adı ve parola girin');
  assert(!hasAnyUser(), 'AUTH-002', 'Admin zaten mevcut', 'İlk kurulum daha önce tamamlanmış', 'Giriş ekranını kullanın');

  const db = openDb();
  const hash = bcrypt.hashSync(password, 10);
  const tx = db.transaction(() => {
    const userId = db.prepare('INSERT INTO users(username,password_hash) VALUES (?,?)').run(username, hash).lastInsertRowid;
    const adminRole = db.prepare('SELECT id FROM roles WHERE code=?').get('admin');
    db.prepare('INSERT INTO user_roles(user_id,role_id) VALUES (?,?)').run(userId, adminRole.id);
  });
  tx();
  return { ok: true };
}

function login({ username, password }) {
  const db = openDb();
  const user = db.prepare('SELECT * FROM users WHERE username=? AND is_active=1').get(username);
  assert(user, 'AUTH-003', 'Giriş başarısız', 'Kullanıcı bulunamadı', 'Bilgileri doğrulayın');
  assert(bcrypt.compareSync(password, user.password_hash), 'AUTH-004', 'Giriş başarısız', 'Parola eşleşmedi', 'Bilgileri doğrulayın');

  const roles = db
    .prepare('SELECT r.code FROM roles r JOIN user_roles ur ON ur.role_id=r.id WHERE ur.user_id=?')
    .all(user.id)
    .map((x) => x.code);

  const token = crypto.randomUUID();
  sessions.set(token, { userId: user.id, username: user.username, roles });
  return { token, user: { id: user.id, username: user.username, roles } };
}

function requireSession(token) {
  const session = sessions.get(token);
  assert(session, 'AUTH-005', 'Yetkisiz işlem', 'Aktif oturum yok', 'Tekrar giriş yapın');
  return session;
}

function requireRole(token, role) {
  const session = requireSession(token);
  assert(session.roles.includes(role) || session.roles.includes('admin'), 'AUTH-006', 'Yetki reddedildi', 'Rol yetersiz', 'Yöneticiye başvurun');
  return session;
}

module.exports = { hasAnyUser, setupAdmin, login, requireSession, requireRole };
