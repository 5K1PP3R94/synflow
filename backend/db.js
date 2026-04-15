const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || '/data/synflow.db';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

const ROLES = {
  ADMIN: 'admin',
  DISPO: 'dispo_holbring',
  SERVICE: 'kundendienstberater',
  DETAILING: 'fahrzeugaufbereitung'
};

const STATUS = {
  NEW: 'neu',
  PICKUP_PLANNED: 'abholung_geplant',
  IN_TRANSIT: 'unterwegs_zu_uns',
  ARRIVED: 'eingetroffen',
  AT_SERVICE: 'bei_serviceberater',
  SERVICE_DONE: 'service_fertig',
  READY_FOR_DETAILING: 'bereit_fuer_reinigung',
  IN_DETAILING: 'in_reinigung',
  DETAILING_DONE: 'reinigung_fertig',
  READY_FOR_DISPO: 'bereit_fuer_dispo',
  DELIVERY_PLANNED: 'auslieferung_geplant',
  COMPLETED: 'abgeschlossen'
};

function tableExists(name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  return !!row;
}

function ensureColumn(table, name, sqlType) {
  if (!tableExists(table)) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sqlType}`);
  }
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'admin',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL DEFAULT 'dispo',
      customer_name TEXT NOT NULL DEFAULT '',
      plate TEXT NOT NULL DEFAULT '',
      vehicle_label TEXT NOT NULL DEFAULT '',
      phone TEXT DEFAULT '',
      advisor_user_id INTEGER,
      transport_in INTEGER NOT NULL DEFAULT 0,
      transport_out INTEGER NOT NULL DEFAULT 0,
      pickup_address TEXT DEFAULT '',
      delivery_address TEXT DEFAULT '',
      cleaning_required INTEGER NOT NULL DEFAULT 0,
      cleaning_type TEXT DEFAULT '',
      cleaning_deadline TEXT DEFAULT '',
      service_notes TEXT DEFAULT '',
      dispo_notes TEXT DEFAULT '',
      detailing_notes TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'neu',
      created_by_user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(advisor_user_id) REFERENCES users(id),
      FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS job_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      note TEXT DEFAULT '',
      changed_by_user_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY(changed_by_user_id) REFERENCES users(id)
    );
  `);

  // Migration safety for older volumes / prototypes
  ensureColumn('users', 'display_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'admin'");
  ensureColumn('users', 'active', "INTEGER NOT NULL DEFAULT 1");
  ensureColumn('users', 'created_at', "TEXT DEFAULT (datetime('now'))");

  ensureColumn('jobs', 'source_type', "TEXT NOT NULL DEFAULT 'dispo'");
  ensureColumn('jobs', 'customer_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('jobs', 'plate', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('jobs', 'vehicle_label', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('jobs', 'phone', "TEXT DEFAULT ''");
  ensureColumn('jobs', 'advisor_user_id', "INTEGER");
  ensureColumn('jobs', 'transport_in', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('jobs', 'transport_out', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('jobs', 'pickup_address', "TEXT DEFAULT ''");
  ensureColumn('jobs', 'delivery_address', "TEXT DEFAULT ''");
  ensureColumn('jobs', 'cleaning_required', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('jobs', 'cleaning_type', "TEXT DEFAULT ''");
  ensureColumn('jobs', 'cleaning_deadline', "TEXT DEFAULT ''");
  ensureColumn('jobs', 'service_notes', "TEXT DEFAULT ''");
  ensureColumn('jobs', 'dispo_notes', "TEXT DEFAULT ''");
  ensureColumn('jobs', 'detailing_notes', "TEXT DEFAULT ''");
  ensureColumn('jobs', 'status', "TEXT NOT NULL DEFAULT 'neu'");
  ensureColumn('jobs', 'created_by_user_id', "INTEGER");
  ensureColumn('jobs', 'created_at', "TEXT DEFAULT (datetime('now'))");
  ensureColumn('jobs', 'updated_at', "TEXT DEFAULT (datetime('now'))");

  ensureColumn('job_status_history', 'note', "TEXT DEFAULT ''");
  ensureColumn('job_status_history', 'changed_by_user_id', "INTEGER");
  ensureColumn('job_status_history', 'created_at', "TEXT DEFAULT (datetime('now'))");

  // Normalize legacy/empty values so app queries do not explode
  db.exec(`
    UPDATE users SET display_name = COALESCE(NULLIF(display_name, ''), username);
    UPDATE users SET role = COALESCE(NULLIF(role, ''), 'admin');
    UPDATE users SET active = COALESCE(active, 1);

    UPDATE jobs SET
      source_type = COALESCE(NULLIF(source_type, ''), 'dispo'),
      customer_name = COALESCE(customer_name, ''),
      plate = COALESCE(plate, ''),
      vehicle_label = COALESCE(vehicle_label, ''),
      phone = COALESCE(phone, ''),
      transport_in = COALESCE(transport_in, 0),
      transport_out = COALESCE(transport_out, 0),
      pickup_address = COALESCE(pickup_address, ''),
      delivery_address = COALESCE(delivery_address, ''),
      cleaning_required = COALESCE(cleaning_required, 0),
      cleaning_type = COALESCE(cleaning_type, ''),
      cleaning_deadline = COALESCE(cleaning_deadline, ''),
      service_notes = COALESCE(service_notes, ''),
      dispo_notes = COALESCE(dispo_notes, ''),
      detailing_notes = COALESCE(detailing_notes, ''),
      status = COALESCE(NULLIF(status, ''), 'neu'),
      updated_at = COALESCE(updated_at, datetime('now'));
  `);

  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (!count) {
    const seed = db.prepare('INSERT INTO users (username, password, display_name, role, active) VALUES (?, ?, ?, ?, 1)');
    seed.run('admin', bcrypt.hashSync('admin123', 10), 'Admin', ROLES.ADMIN);
    seed.run('dispo', bcrypt.hashSync('demo123', 10), 'H&B Dispo', ROLES.DISPO);
    seed.run('anna', bcrypt.hashSync('demo123', 10), 'Anna Berger', ROLES.SERVICE);
    seed.run('clean', bcrypt.hashSync('demo123', 10), 'Aufbereitung', ROLES.DETAILING);
  }

  // Ensure required demo users exist even on older DBs
  const users = db.prepare('SELECT username FROM users').all().map(r => r.username);
  const seed = db.prepare('INSERT INTO users (username, password, display_name, role, active) VALUES (?, ?, ?, ?, 1)');
  if (!users.includes('admin')) seed.run('admin', bcrypt.hashSync('admin123', 10), 'Admin', ROLES.ADMIN);
  if (!users.includes('dispo')) seed.run('dispo', bcrypt.hashSync('demo123', 10), 'H&B Dispo', ROLES.DISPO);
  if (!users.includes('anna')) seed.run('anna', bcrypt.hashSync('demo123', 10), 'Anna Berger', ROLES.SERVICE);
  if (!users.includes('clean')) seed.run('clean', bcrypt.hashSync('demo123', 10), 'Aufbereitung', ROLES.DETAILING);
}

function getDb() {
  return db;
}

module.exports = { getDb, initDb, ROLES, STATUS };
