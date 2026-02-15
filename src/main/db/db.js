const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
let app;
try { ({ app } = require('electron')); } catch { app = null; }

let db;

function getDbPath() {
  const base = app && app.getPath ? app.getPath('userData') : process.cwd();
  const dir = path.join(base, 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'mtn_erp.sqlite');
}

function openDb() {
  if (db) return db;
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedDefaultAccounts(db);
  return db;
}

function migrate(database) {
  database.exec('CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime(\'now\')))');
  const current = database.prepare('SELECT COALESCE(MAX(version),0) as v FROM schema_version').get().v;
  const migrationsDir = path.join(process.cwd(), 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  files.forEach((file) => {
    const version = Number(file.split('_')[0]);
    if (version > current) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      database.exec(sql);
      database.prepare('INSERT INTO schema_version(version) VALUES (?)').run(version);
    }
  });
}

function seedDefaultAccounts(database) {
  const accounts = [
    ['100', 'Kasa', 'asset'],
    ['102', 'Bankalar', 'asset'],
    ['120', 'Alıcılar', 'asset'],
    ['153', 'Ticari Mallar', 'asset'],
    ['320', 'Satıcılar', 'liability'],
    ['391', 'Hesaplanan KDV', 'liability'],
    ['600', 'Yurtiçi Satışlar', 'income'],
    ['620', 'Satılan Ticari Mallar Maliyeti', 'expense'],
  ];

  const insert = database.prepare('INSERT OR IGNORE INTO accounts(code,name,type) VALUES (?,?,?)');
  const tx = database.transaction(() => {
    accounts.forEach((row) => insert.run(...row));
    database.prepare('INSERT OR IGNORE INTO roles(code,name) VALUES (?,?)').run('admin', 'Yönetici');
    database.prepare('INSERT OR IGNORE INTO roles(code,name) VALUES (?,?)').run('operator', 'Operasyon');
  });
  tx();
}

function runTx(fn) {
  const database = openDb();
  return database.transaction(fn)();
}

function closeDb() {
  if (db) { db.close(); db = null; }
}

module.exports = { openDb, runTx, migrate, seedDefaultAccounts, getDbPath, closeDb };
