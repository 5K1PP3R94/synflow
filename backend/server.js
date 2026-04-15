const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const MODULES = {
  DISPO: 'dispo_holbring',
  DRIVER: 'holbring_driver',
  ADVISOR: 'kundendienstberater',
  DETAILING: 'fahrzeugaufbereitung'
};
const MODULE_LIST = [
  { key: MODULES.DISPO, name: 'Dispo Hol&Bring' },
  { key: MODULES.DRIVER, name: 'Hol & Bring Fahrer' },
  { key: MODULES.ADVISOR, name: 'Kundendienstberater' },
  { key: MODULES.DETAILING, name: 'Fahrzeugaufbereitung' }
];

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = process.env.JWT_SECRET || 'synflow-secret-2026';
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/data/synflow.db';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

function firstExistingPath(...candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

const FRONTEND_DIR = firstExistingPath(
  path.join(__dirname, '../frontend/public'),
  path.join(__dirname, 'public'),
  __dirname
);
const INDEX_FILE = firstExistingPath(
  path.join(FRONTEND_DIR, 'index.html'),
  path.join(__dirname, '../index.html'),
  path.join(__dirname, 'index.html')
);

if (!fs.existsSync(INDEX_FILE)) {
  throw new Error(`Frontend index.html nicht gefunden. Geprüft wurden u. a. ${INDEX_FILE}`);
}

function ensureColumn(table, name, sqlType) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${sqlType}`);
}

function ensureModulesSeed() {
  const stmt = db.prepare('INSERT OR IGNORE INTO modules (module_key, module_name) VALUES (?, ?)');
  for (const mod of MODULE_LIST) stmt.run(mod.key, mod.name);
}

function setAllPermissionsForAdmin(userId) {
  const stmt = db.prepare(`
    INSERT INTO user_module_permissions (user_id, module_key, can_view, can_edit, can_manage)
    VALUES (?, ?, 1, 1, 1)
    ON CONFLICT(user_id, module_key) DO UPDATE SET can_view = 1, can_edit = 1, can_manage = 1
  `);
  for (const mod of MODULE_LIST) stmt.run(userId, mod.key);
}

function normalizePermissionMap(raw) {
  const result = {};
  for (const mod of MODULE_LIST) {
    const val = raw?.[mod.key] || {};
    result[mod.key] = {
      can_view: !!val.can_view,
      can_edit: !!val.can_edit,
      can_manage: !!val.can_manage
    };
  }
  return result;
}

function writePermissions(userId, permissions) {
  const normalized = normalizePermissionMap(permissions);
  db.prepare('DELETE FROM user_module_permissions WHERE user_id = ?').run(userId);
  const stmt = db.prepare(`
    INSERT INTO user_module_permissions (user_id, module_key, can_view, can_edit, can_manage)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const mod of MODULE_LIST) {
    const p = normalized[mod.key];
    if (p.can_view || p.can_edit || p.can_manage) {
      stmt.run(userId, mod.key, p.can_view ? 1 : 0, p.can_edit ? 1 : 0, p.can_manage ? 1 : 0);
    }
  }
}

function getUserPermissions(userId) {
  const rows = db.prepare('SELECT module_key, can_view, can_edit, can_manage FROM user_module_permissions WHERE user_id = ?').all(userId);
  const map = {};
  for (const mod of MODULE_LIST) map[mod.key] = { can_view: false, can_edit: false, can_manage: false };
  for (const row of rows) {
    map[row.module_key] = {
      can_view: !!row.can_view,
      can_edit: !!row.can_edit,
      can_manage: !!row.can_manage
    };
  }
  return map;
}

function can(user, moduleKey, level = 'view') {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const p = user.permissions?.[moduleKey];
  if (!p) return false;
  if (level === 'view') return !!(p.can_view || p.can_edit || p.can_manage);
  if (level === 'edit') return !!(p.can_edit || p.can_manage);
  if (level === 'manage') return !!p.can_manage;
  return false;
}

// FIX #2: auth() ruft next() nur auf wenn erfolgreich authentifiziert
function auth(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, role, display_name, active, driver_id FROM users WHERE id = ?').get(decoded.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Benutzer nicht verfügbar' });
    user.permissions = getUserPermissions(user.id);
    req.user = user;
    next();
  } catch {
    // Token ungültig – KEIN next() aufrufen
    res.status(401).json({ error: 'Ungültiger Token' });
  }
}

// FIX #2: authAdmin prüft req.user erst nachdem auth() next() aufgerufen hat
function authAdmin(req, res, next) {
  auth(req, res, () => {
    if (!req.user) return; // auth() hat bereits geantwortet
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Nur für Administratoren' });
    next();
  });
}

function authModule(moduleKey, level = 'view') {
  return (req, res, next) => auth(req, res, () => {
    if (!req.user) return; // auth() hat bereits geantwortet
    if (can(req.user, moduleKey, level)) return next();
    res.status(403).json({ error: 'Keine Berechtigung' });
  });
}

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(msg);
}

function mapTour(row) {
  if (!row) return null;
  const mapped = { ...row };
  mapped.driver = mapped.driver_id ? { id: mapped.driver_id, name: mapped.driver_name || '' } : null;
  mapped.loaner_vehicle = mapped.loaner_vehicle_id ? { id: mapped.loaner_vehicle_id, name: mapped.loaner_name || '', plate: mapped.loaner_plate || '' } : null;
  mapped.linked_job = mapped.job_id ? {
    id: mapped.job_id,
    customer_name: mapped.linked_customer_name || '',
    plate: mapped.linked_plate || '',
    vehicle_label: mapped.linked_vehicle_label || '',
    status: mapped.linked_job_status || '',
    deadline: mapped.linked_deadline || ''
  } : null;
  delete mapped.driver_name;
  delete mapped.loaner_name;
  delete mapped.loaner_plate;
  delete mapped.linked_customer_name;
  delete mapped.linked_plate;
  delete mapped.linked_vehicle_label;
  delete mapped.linked_job_status;
  delete mapped.linked_deadline;
  return mapped;
}
function emptyTour(date, slot, nr) {
  return {
    date, slot, tour_nr: nr,
    deliver_customer: '', deliver_address: '', deliver_vehicle: '', deliver_time: '', deliver_phone: '',
    pickup_customer: '', pickup_address: '', pickup_vehicle: '', pickup_time: '', pickup_phone: '',
    driver_id: null, loaner_required: 0, loaner_vehicle_id: null, status: 'offen', gesperrt: 0, notes: '',
    job_id: null, tour_kind: '', updated_at: null, updated_by: '', driver: null, loaner_vehicle: null, linked_job: null
  };
}
function normalizeDispatchRefs(raw) { try { return JSON.parse(raw || '[]'); } catch { return []; } }
function normalizeDispatchSteps(raw) { try { return JSON.parse(raw || '[]'); } catch { return []; } }
function hydrateDispatchRow(row) {
  const hydrated = {
    ...row,
    driver: { id: row.driver_id, name: row.driver_name },
    deliver_refs: normalizeDispatchRefs(row.deliver_refs),
    pickup_refs: normalizeDispatchRefs(row.pickup_refs),
    steps: normalizeDispatchSteps(row.steps_json)
  };
  if (!hydrated.steps.length) {
    hydrated.steps = [
      ...hydrated.deliver_refs.map(ref => ({ type: 'deliver_tour', tour_nr: Number(ref.tour_nr) })),
      ...hydrated.pickup_refs.map(ref => ({ type: 'pickup_tour', tour_nr: Number(ref.tour_nr) }))
    ];
    if (hydrated.notes) hydrated.steps.push({ type: 'free_text', text: hydrated.notes });
  }
  return hydrated;
}

const VEHICLE_JOB_STATUS = {
  NEU: 'neu',
  ABHOLUNG_GEPLANT: 'abholung_geplant',
  UNTERWEGS_ZU_UNS: 'unterwegs_zu_uns',
  EINGETROFFEN: 'eingetroffen',
  BEI_SERVICEBERATER: 'bei_serviceberater',
  SERVICE_FERTIG: 'service_fertig',
  BEREIT_FUER_REINIGUNG: 'bereit_fuer_reinigung',
  IN_REINIGUNG: 'in_reinigung',
  REINIGUNG_FERTIG: 'reinigung_fertig',
  BEREIT_FUER_AUSLIEFERUNG: 'bereit_fuer_auslieferung',
  AUSLIEFERUNG_GEPLANT: 'auslieferung_geplant',
  ABGESCHLOSSEN: 'abgeschlossen'
};
const VEHICLE_JOB_STATUS_LIST = Object.values(VEHICLE_JOB_STATUS);

function listAdvisorUsers() {
  return db.prepare(`
    SELECT DISTINCT u.id, u.username, u.display_name, u.role
    FROM users u
    LEFT JOIN user_module_permissions ump ON ump.user_id = u.id AND ump.module_key = ?
    WHERE COALESCE(u.active, 1) = 1
      AND (u.role = 'admin' OR COALESCE(ump.can_view,0)=1 OR COALESCE(ump.can_edit,0)=1 OR COALESCE(ump.can_manage,0)=1)
    ORDER BY COALESCE(NULLIF(u.display_name,''), u.username)
  `).all(MODULES.ADVISOR).map(u => ({
    id: u.id,
    username: u.username,
    display_name: u.display_name || u.username,
    role: u.role
  }));
}

function mapVehicleJob(row) {
  if (!row) return null;
  return {
    ...row,
    hb_required: !!row.hb_required,
    pickup_required: !!row.pickup_required,
    delivery_required: !!row.delivery_required,
    cleaning_required: !!row.cleaning_required,
    advisor: row.advisor_user_id ? {
      id: row.advisor_user_id,
      name: row.advisor_name || row.advisor_username || ''
    } : null,
    created_by_user: row.created_by ? {
      id: row.created_by,
      name: row.created_by_name || row.created_by_username || ''
    } : null
  };
}

const vehicleJobSelectSql = `
  SELECT vj.*,
         au.username AS advisor_username,
         au.display_name AS advisor_name,
         cu.username AS created_by_username,
         cu.display_name AS created_by_name
  FROM vehicle_jobs vj
  LEFT JOIN users au ON au.id = vj.advisor_user_id
  LEFT JOIN users cu ON cu.id = vj.created_by
`;

function createVehicleHistory(jobId, fromStatus, toStatus, userId, note = '') {
  db.prepare(`
    INSERT INTO vehicle_job_history (job_id, from_status, to_status, note, changed_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(jobId, fromStatus || '', toStatus, String(note || '').trim(), userId || null);
}

function sanitizeVehicleJobBody(body = {}) {
  const status = VEHICLE_JOB_STATUS_LIST.includes(body.status) ? body.status : VEHICLE_JOB_STATUS.NEU;
  return {
    customer_name: String(body.customer_name || '').trim(),
    plate: String(body.plate || '').trim().toUpperCase(),
    vehicle_label: String(body.vehicle_label || '').trim(),
    phone: String(body.phone || '').trim(),
    advisor_user_id: body.advisor_user_id ? Number(body.advisor_user_id) : null,
    hb_required: body.hb_required ? 1 : 0,
    pickup_required: body.pickup_required ? 1 : 0,
    delivery_required: body.delivery_required ? 1 : 0,
    cleaning_required: body.cleaning_required ? 1 : 0,
    cleaning_type: String(body.cleaning_type || '').trim(),
    deadline: String(body.deadline || '').trim(),
    notes: String(body.notes || '').trim(),
    service_notes: String(body.service_notes || '').trim(),
    detailing_notes: String(body.detailing_notes || '').trim(),
    status
  };
}


function syncVehicleJobFromTour(tour, changedByUserId) {
  const jobId = tour?.job_id ? Number(tour.job_id) : null;
  if (!jobId) return null;
  const job = db.prepare('SELECT * FROM vehicle_jobs WHERE id = ?').get(jobId);
  if (!job) return null;

  const kind = String(tour.tour_kind || '').trim();
  if (!['pickup', 'delivery'].includes(kind)) return null;

  let nextStatus = null;
  let note = '';
  if (kind === 'pickup') {
    if (tour.status === 'geplant') {
      nextStatus = VEHICLE_JOB_STATUS.ABHOLUNG_GEPLANT;
      note = `Abholung geplant · Tour ${tour.tour_nr} ${tour.slot}`;
    } else if (tour.status === 'unterwegs') {
      nextStatus = VEHICLE_JOB_STATUS.UNTERWEGS_ZU_UNS;
      note = `Abholung unterwegs · Tour ${tour.tour_nr} ${tour.slot}`;
    } else if (tour.status === 'erledigt') {
      nextStatus = job.advisor_user_id ? VEHICLE_JOB_STATUS.BEI_SERVICEBERATER : VEHICLE_JOB_STATUS.EINGETROFFEN;
      note = `Abholung abgeschlossen · Tour ${tour.tour_nr} ${tour.slot}`;
    } else if (tour.status === 'offen') {
      nextStatus = VEHICLE_JOB_STATUS.NEU;
      note = `Abholung wieder offen · Tour ${tour.tour_nr} ${tour.slot}`;
    }
  } else if (kind === 'delivery') {
    if (tour.status === 'geplant' || tour.status === 'unterwegs') {
      nextStatus = VEHICLE_JOB_STATUS.AUSLIEFERUNG_GEPLANT;
      note = `Auslieferung geplant · Tour ${tour.tour_nr} ${tour.slot}`;
    } else if (tour.status === 'erledigt') {
      nextStatus = VEHICLE_JOB_STATUS.ABGESCHLOSSEN;
      note = `Auslieferung abgeschlossen · Tour ${tour.tour_nr} ${tour.slot}`;
    } else if (tour.status === 'offen') {
      nextStatus = job.cleaning_required
        ? (job.status === VEHICLE_JOB_STATUS.REINIGUNG_FERTIG ? VEHICLE_JOB_STATUS.BEREIT_FUER_AUSLIEFERUNG : job.status)
        : VEHICLE_JOB_STATUS.BEREIT_FUER_AUSLIEFERUNG;
      note = `Auslieferung wieder offen · Tour ${tour.tour_nr} ${tour.slot}`;
    }
  }

  if (!nextStatus || nextStatus === job.status) {
    const current = db.prepare(`${vehicleJobSelectSql} WHERE vj.id = ?`).get(jobId);
    return current ? mapVehicleJob(current) : null;
  }

  db.prepare("UPDATE vehicle_jobs SET status = ?, updated_at = datetime('now') WHERE id = ?").run(nextStatus, jobId);
  createVehicleHistory(jobId, job.status, nextStatus, changedByUserId, note);
  const row = db.prepare(`${vehicleJobSelectSql} WHERE vj.id = ?`).get(jobId);
  const mapped = mapVehicleJob(row);
  broadcast('vehicle_job_updated', mapped);
  return mapped;
}

const tourSelectSql = `
  SELECT t.*, d.name AS driver_name, lv.name AS loaner_name, lv.plate AS loaner_plate,
         vj.customer_name AS linked_customer_name, vj.plate AS linked_plate, vj.vehicle_label AS linked_vehicle_label,
         vj.status AS linked_job_status, vj.deadline AS linked_deadline
  FROM tours t
  LEFT JOIN drivers d ON d.id = t.driver_id
  LEFT JOIN loaner_vehicles lv ON lv.id = t.loaner_vehicle_id
  LEFT JOIN vehicle_jobs vj ON vj.id = t.job_id
`;

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'reader',
    display_name TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    driver_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS modules (
    module_key TEXT PRIMARY KEY,
    module_name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_module_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    module_key TEXT NOT NULL,
    can_view INTEGER NOT NULL DEFAULT 0,
    can_edit INTEGER NOT NULL DEFAULT 0,
    can_manage INTEGER NOT NULL DEFAULT 0,
    UNIQUE(user_id, module_key),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(module_key) REFERENCES modules(module_key) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    phone TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS loaner_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    plate TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'verfuegbar' CHECK(status IN ('verfuegbar','werkstatt','reserviert','deaktiviert')),
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    slot TEXT NOT NULL CHECK(slot IN ('vormittag','nachmittag')),
    tour_nr INTEGER NOT NULL CHECK(tour_nr BETWEEN 1 AND 4),
    deliver_customer TEXT DEFAULT '',
    deliver_address TEXT DEFAULT '',
    deliver_vehicle TEXT DEFAULT '',
    deliver_time TEXT DEFAULT '',
    deliver_phone TEXT DEFAULT '',
    pickup_customer TEXT DEFAULT '',
    pickup_address TEXT DEFAULT '',
    pickup_vehicle TEXT DEFAULT '',
    pickup_time TEXT DEFAULT '',
    pickup_phone TEXT DEFAULT '',
    driver_id INTEGER,
    job_id INTEGER,
    tour_kind TEXT DEFAULT '',
    loaner_required INTEGER NOT NULL DEFAULT 0,
    loaner_vehicle_id INTEGER,
    status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','geplant','unterwegs','erledigt')),
    gesperrt INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT '',
    UNIQUE(date, slot, tour_nr),
    FOREIGN KEY(driver_id) REFERENCES drivers(id),
    FOREIGN KEY(job_id) REFERENCES vehicle_jobs(id),
    FOREIGN KEY(loaner_vehicle_id) REFERENCES loaner_vehicles(id)
  );

  CREATE TABLE IF NOT EXISTS ottenschlag (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    eintraege TEXT DEFAULT '[]',
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS dispatch_sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    slot TEXT NOT NULL CHECK(slot IN ('vormittag','nachmittag')),
    driver_id INTEGER NOT NULL,
    deliver_refs TEXT DEFAULT '[]',
    pickup_refs TEXT DEFAULT '[]',
    steps_json TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT '',
    UNIQUE(date, slot, driver_id),
    FOREIGN KEY(driver_id) REFERENCES drivers(id)
  );
  CREATE TABLE IF NOT EXISTS vehicle_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL DEFAULT '',
    plate TEXT NOT NULL DEFAULT '',
    vehicle_label TEXT NOT NULL DEFAULT '',
    phone TEXT DEFAULT '',
    advisor_user_id INTEGER,
    hb_required INTEGER NOT NULL DEFAULT 1,
    pickup_required INTEGER NOT NULL DEFAULT 1,
    delivery_required INTEGER NOT NULL DEFAULT 1,
    cleaning_required INTEGER NOT NULL DEFAULT 0,
    cleaning_type TEXT DEFAULT '',
    deadline TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'neu',
    notes TEXT DEFAULT '',
    service_notes TEXT DEFAULT '',
    detailing_notes TEXT DEFAULT '',
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(advisor_user_id) REFERENCES users(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS vehicle_job_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    from_status TEXT DEFAULT '',
    to_status TEXT NOT NULL,
    note TEXT DEFAULT '',
    changed_by INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(job_id) REFERENCES vehicle_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY(changed_by) REFERENCES users(id)
  );

`);

// FIX #3: gesperrt-Spalte wird jetzt auch per ensureColumn abgesichert
ensureColumn('users', 'display_name', "TEXT DEFAULT ''");
ensureColumn('users', 'active', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'driver_id', 'INTEGER');
ensureColumn('tours', 'deliver_customer', "TEXT DEFAULT ''");
ensureColumn('tours', 'deliver_address', "TEXT DEFAULT ''");
ensureColumn('tours', 'deliver_vehicle', "TEXT DEFAULT ''");
ensureColumn('tours', 'deliver_time', "TEXT DEFAULT ''");
ensureColumn('tours', 'deliver_phone', "TEXT DEFAULT ''");
ensureColumn('tours', 'pickup_customer', "TEXT DEFAULT ''");
ensureColumn('tours', 'pickup_address', "TEXT DEFAULT ''");
ensureColumn('tours', 'pickup_vehicle', "TEXT DEFAULT ''");
ensureColumn('tours', 'pickup_time', "TEXT DEFAULT ''");
ensureColumn('tours', 'pickup_phone', "TEXT DEFAULT ''");
ensureColumn('tours', 'driver_id', 'INTEGER');
ensureColumn('tours', 'job_id', 'INTEGER');
ensureColumn('tours', 'tour_kind', "TEXT DEFAULT ''");
ensureColumn('tours', 'loaner_required', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('tours', 'loaner_vehicle_id', 'INTEGER');
ensureColumn('tours', 'status', "TEXT NOT NULL DEFAULT 'offen'");
ensureColumn('tours', 'notes', "TEXT DEFAULT ''");
ensureColumn('tours', 'gesperrt', 'INTEGER DEFAULT 0'); // FIX #3
ensureColumn('dispatch_sheets', 'steps_json', "TEXT DEFAULT '[]'");

ensureColumn('vehicle_jobs', 'customer_name', "TEXT NOT NULL DEFAULT ''");
ensureColumn('vehicle_jobs', 'plate', "TEXT NOT NULL DEFAULT ''");
ensureColumn('vehicle_jobs', 'vehicle_label', "TEXT NOT NULL DEFAULT ''");
ensureColumn('vehicle_jobs', 'phone', "TEXT DEFAULT ''");
ensureColumn('vehicle_jobs', 'advisor_user_id', 'INTEGER');
ensureColumn('vehicle_jobs', 'hb_required', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('vehicle_jobs', 'pickup_required', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('vehicle_jobs', 'delivery_required', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('vehicle_jobs', 'cleaning_required', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('vehicle_jobs', 'cleaning_type', "TEXT DEFAULT ''");
ensureColumn('vehicle_jobs', 'deadline', "TEXT DEFAULT ''");
ensureColumn('vehicle_jobs', 'status', "TEXT NOT NULL DEFAULT 'neu'");
ensureColumn('vehicle_jobs', 'notes', "TEXT DEFAULT ''");
ensureColumn('vehicle_jobs', 'service_notes', "TEXT DEFAULT ''");
ensureColumn('vehicle_jobs', 'detailing_notes', "TEXT DEFAULT ''");
ensureColumn('vehicle_jobs', 'created_by', 'INTEGER');
ensureColumn('vehicle_jobs', 'created_at', "TEXT DEFAULT (datetime('now'))");
ensureColumn('vehicle_jobs', 'updated_at', "TEXT DEFAULT (datetime('now'))");
ensureColumn('vehicle_job_history', 'from_status', "TEXT DEFAULT ''");
ensureColumn('vehicle_job_history', 'to_status', "TEXT NOT NULL DEFAULT 'neu'");
ensureColumn('vehicle_job_history', 'note', "TEXT DEFAULT ''");
ensureColumn('vehicle_job_history', 'changed_by', 'INTEGER');
ensureColumn('vehicle_job_history', 'created_at', "TEXT DEFAULT (datetime('now'))");


ensureModulesSeed();
const userCount = db.prepare('SELECT COUNT(*) c FROM users').get();
if (!userCount.c) {
  const info = db.prepare("INSERT INTO users (username, password, role, display_name, active) VALUES (?, ?, 'admin', 'Administrator', 1)")
    .run(String(ADMIN_USERNAME).trim() || 'admin', bcrypt.hashSync(String(ADMIN_PASSWORD), 10));
  setAllPermissionsForAdmin(info.lastInsertRowid);
}
for (const admin of db.prepare("SELECT id FROM users WHERE role = 'admin'").all()) setAllPermissionsForAdmin(admin.id);

if (JWT_SECRET === 'synflow-secret-2026') {
  console.warn('WARNUNG: Standard-JWT_SECRET aktiv. Bitte in Produktion unbedingt ändern.');
}
if (ADMIN_PASSWORD === 'admin123') {
  console.warn('WARNUNG: Standard-Admin-Passwort aktiv. Bitte nach dem ersten Login sofort ändern.');
}

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});
app.use(express.static(FRONTEND_DIR));

// Auth Routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Alle Felder erforderlich' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.active || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
  }
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !!req.secure,
    maxAge: 7 * 24 * 3600 * 1000
  });
  const permissions = getUserPermissions(user.id);
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    display_name: user.display_name || user.username,
    active: !!user.active,
    driver_id: user.driver_id || null,
    permissions
  });
});
app.post('/api/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({
  id: req.user.id,
  username: req.user.username,
  role: req.user.role,
  display_name: req.user.display_name || req.user.username,
  active: !!req.user.active,
  driver_id: req.user.driver_id || null,
  permissions: req.user.permissions,
  modules: MODULE_LIST
}));
app.put('/api/me/password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Alle Felder erforderlich' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Neues Passwort mind. 6 Zeichen' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password)) return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ ok: true });
});

// Users & Permissions
app.get('/api/modules', authAdmin, (req, res) => res.json(MODULE_LIST));
app.get('/api/users', authAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, display_name, active, driver_id, created_at FROM users ORDER BY username').all();
  res.json(users.map(user => ({ ...user, permissions: getUserPermissions(user.id) })));
});
app.post('/api/users', authAdmin, (req, res) => {
  const { username, password, display_name = '', active = 1, driver_id = null, permissions = {} } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  if (password.length < 6) return res.status(400).json({ error: 'Passwort mind. 6 Zeichen' });
  const normalized = normalizePermissionMap(permissions);
  const hasAny = Object.values(normalized).some(p => p.can_view || p.can_edit || p.can_manage);
  if (!hasAny) return res.status(400).json({ error: 'Mindestens ein Bereich muss zugewiesen werden' });
  if (driver_id && !db.prepare('SELECT id FROM drivers WHERE id = ?').get(Number(driver_id))) return res.status(400).json({ error: 'Fahrer nicht gefunden' });
  try {
    const info = db.prepare("INSERT INTO users (username, password, role, display_name, active, driver_id) VALUES (?, ?, 'module_user', ?, ?, ?)")
      .run(username.trim(), bcrypt.hashSync(password, 10), String(display_name || '').trim(), active ? 1 : 0, driver_id ? Number(driver_id) : null);
    writePermissions(info.lastInsertRowid, normalized);
    const user = db.prepare('SELECT id, username, role, display_name, active, driver_id, created_at FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.json({ ...user, permissions: getUserPermissions(user.id) });
  } catch {
    res.status(409).json({ error: 'Benutzername bereits vergeben' });
  }
});
app.put('/api/users/:id', authAdmin, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  const { display_name = '', active = 1, driver_id = null, permissions = null, newPassword = undefined } = req.body;
  if (driver_id && !db.prepare('SELECT id FROM drivers WHERE id = ?').get(Number(driver_id))) return res.status(400).json({ error: 'Fahrer nicht gefunden' });
  db.prepare('UPDATE users SET display_name = ?, active = ?, driver_id = ? WHERE id = ?')
    .run(String(display_name || '').trim(), active ? 1 : 0, driver_id ? Number(driver_id) : null, id);
  if (typeof newPassword === 'string' && newPassword.length) {
    if (newPassword.length < 6) return res.status(400).json({ error: 'Passwort mind. 6 Zeichen' });
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), id);
  }
  if (permissions && existing.role !== 'admin') writePermissions(id, permissions);
  if (existing.role === 'admin') setAllPermissionsForAdmin(id);
  const user = db.prepare('SELECT id, username, role, display_name, active, driver_id, created_at FROM users WHERE id = ?').get(id);
  res.json({ ...user, permissions: getUserPermissions(id) });
});
app.delete('/api/users/:id', authAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Eigenen Benutzer nicht löschbar' });
  // CASCADE erledigt user_module_permissions, explizit für Klarheit trotzdem drin
  db.prepare('DELETE FROM user_module_permissions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Drivers & Loaners
app.get('/api/drivers', authModule(MODULES.DISPO, 'view'), (req, res) => res.json(db.prepare('SELECT * FROM drivers ORDER BY active DESC, name').all()));
app.post('/api/drivers', authModule(MODULES.DISPO, 'manage'), (req, res) => {
  const { name, phone = '', notes = '', active = 1 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  try {
    const result = db.prepare('INSERT INTO drivers (name, phone, notes, active) VALUES (?, ?, ?, ?)').run(name.trim(), phone.trim(), notes.trim(), active ? 1 : 0);
    const row = db.prepare('SELECT * FROM drivers WHERE id = ?').get(result.lastInsertRowid);
    broadcast('drivers_updated', row);
    res.json(row);
  } catch {
    res.status(409).json({ error: 'Fahrer existiert bereits' });
  }
});
app.put('/api/drivers/:id', authModule(MODULES.DISPO, 'manage'), (req, res) => {
  const id = Number(req.params.id);
  const { name, phone = '', notes = '', active = 1 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  try {
    db.prepare('UPDATE drivers SET name = ?, phone = ?, notes = ?, active = ? WHERE id = ?').run(name.trim(), phone.trim(), notes.trim(), active ? 1 : 0, id);
    const row = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
    broadcast('drivers_updated', row);
    res.json(row);
  } catch {
    res.status(409).json({ error: 'Fahrername bereits vergeben' });
  }
});
app.delete('/api/drivers/:id', authModule(MODULES.DISPO, 'manage'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM drivers WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Fahrer nicht gefunden' });

  // FIX #8: Betroffene Touren ermitteln BEVOR wir löschen, dann Broadcast senden
  const affectedTours = db.prepare(`${tourSelectSql} WHERE t.driver_id = ?`).all(id).map(mapTour);

  db.prepare('UPDATE tours SET driver_id = NULL WHERE driver_id = ?').run(id);
  db.prepare('UPDATE users SET driver_id = NULL WHERE driver_id = ?').run(id);
  db.prepare('DELETE FROM dispatch_sheets WHERE driver_id = ?').run(id);
  db.prepare('DELETE FROM drivers WHERE id = ?').run(id);

  broadcast('drivers_updated', { deleted: id });

  // FIX #8: Alle betroffenen Touren nochmal laden und broadcasten (driver_id ist jetzt NULL)
  for (const t of affectedTours) {
    const updated = db.prepare(`${tourSelectSql} WHERE t.date = ? AND t.slot = ? AND t.tour_nr = ?`).get(t.date, t.slot, t.tour_nr);
    if (updated) broadcast('tour_updated', mapTour(updated));
  }

  res.json({ ok: true });
});

app.get('/api/loaners', authModule(MODULES.DISPO, 'view'), (req, res) => res.json(db.prepare('SELECT * FROM loaner_vehicles ORDER BY status, name').all()));
app.post('/api/loaners', authModule(MODULES.DISPO, 'manage'), (req, res) => {
  const { name, plate = '', status = 'verfuegbar', notes = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  if (!['verfuegbar', 'werkstatt', 'reserviert', 'deaktiviert'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
  try {
    const result = db.prepare('INSERT INTO loaner_vehicles (name, plate, status, notes) VALUES (?, ?, ?, ?)').run(name.trim(), plate.trim(), status, notes.trim());
    const row = db.prepare('SELECT * FROM loaner_vehicles WHERE id = ?').get(result.lastInsertRowid);
    broadcast('loaners_updated', row);
    res.json(row);
  } catch {
    res.status(409).json({ error: 'Leihwagen existiert bereits' });
  }
});
app.put('/api/loaners/:id', authModule(MODULES.DISPO, 'manage'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM loaner_vehicles WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Leihwagen nicht gefunden' });
  const { name, plate = '', status = 'verfuegbar', notes = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  if (!['verfuegbar', 'werkstatt', 'reserviert', 'deaktiviert'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
  try {
    db.prepare('UPDATE loaner_vehicles SET name = ?, plate = ?, status = ?, notes = ? WHERE id = ?').run(name.trim(), plate.trim(), status, notes.trim(), id);
    const row = db.prepare('SELECT * FROM loaner_vehicles WHERE id = ?').get(id);
    broadcast('loaners_updated', row);
    res.json(row);
  } catch {
    res.status(409).json({ error: 'Leihwagenname bereits vergeben' });
  }
});
app.delete('/api/loaners/:id', authModule(MODULES.DISPO, 'manage'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM loaner_vehicles WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Leihwagen nicht gefunden' });

  const affectedTours = db.prepare(`${tourSelectSql} WHERE t.loaner_vehicle_id = ?`).all(id).map(mapTour);
  db.prepare('UPDATE tours SET loaner_vehicle_id = NULL, loaner_required = CASE WHEN loaner_required = 1 THEN 0 ELSE loaner_required END WHERE loaner_vehicle_id = ?').run(id);
  db.prepare('DELETE FROM loaner_vehicles WHERE id = ?').run(id);
  broadcast('loaners_updated', { deleted: id });
  for (const t of affectedTours) {
    const updated = db.prepare(`${tourSelectSql} WHERE t.date = ? AND t.slot = ? AND t.tour_nr = ?`).get(t.date, t.slot, t.tour_nr);
    if (updated) broadcast('tour_updated', mapTour(updated));
  }
  res.json({ ok: true });
});

app.get('/api/meta', auth, (req, res) => {
  const response = {};
  if (can(req.user, MODULES.DISPO, 'view') || can(req.user, MODULES.DRIVER, 'view')) {
    response.drivers = db.prepare('SELECT * FROM drivers ORDER BY COALESCE(active, 1) DESC, name').all();
  }
  if (can(req.user, MODULES.DISPO, 'view')) {
    response.loaners = db.prepare("SELECT * FROM loaner_vehicles WHERE status != 'deaktiviert' ORDER BY name").all();
  }
  if (can(req.user, MODULES.DISPO, 'view') || can(req.user, MODULES.ADVISOR, 'view') || can(req.user, MODULES.DETAILING, 'view')) {
    response.advisors = listAdvisorUsers();
  }
  res.json(response);
});


// Vehicle Jobs
app.get('/api/vehicle-job-meta', auth, (req, res) => {
  res.json({ advisors: listAdvisorUsers(), statuses: VEHICLE_JOB_STATUS_LIST });
});

app.get('/api/vehicle-jobs', auth, (req, res) => {
  const clauses = [];
  const params = [];
  const roleScoped = !can(req.user, MODULES.DISPO, 'view');
  if (roleScoped && can(req.user, MODULES.ADVISOR, 'view')) {
    clauses.push('vj.advisor_user_id = ?');
    params.push(req.user.id);
  } else if (roleScoped && can(req.user, MODULES.DETAILING, 'view')) {
    clauses.push('COALESCE(vj.cleaning_required,0) = 1');
  } else if (!can(req.user, MODULES.DISPO, 'view') && !can(req.user, MODULES.ADVISOR, 'view') && !can(req.user, MODULES.DETAILING, 'view')) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  if (req.query.status) {
    clauses.push('vj.status = ?');
    params.push(String(req.query.status));
  }
  if (req.query.only_cleaning === '1') clauses.push('COALESCE(vj.cleaning_required,0) = 1');
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`${vehicleJobSelectSql}${where} ORDER BY CASE WHEN COALESCE(vj.deadline,'')='' THEN 1 ELSE 0 END, vj.deadline ASC, vj.updated_at DESC, vj.id DESC`).all(...params).map(mapVehicleJob);
  res.json(rows);
});

app.get('/api/vehicle-jobs/:id/history', auth, (req, res) => {
  const job = db.prepare('SELECT id, advisor_user_id, cleaning_required FROM vehicle_jobs WHERE id = ?').get(Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Fahrzeugvorgang nicht gefunden' });
  if (!(can(req.user, MODULES.DISPO, 'view') || (can(req.user, MODULES.ADVISOR, 'view') && job.advisor_user_id === req.user.id) || can(req.user, MODULES.DETAILING, 'view'))) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const rows = db.prepare(`
    SELECT h.*, u.username, u.display_name
    FROM vehicle_job_history h
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.job_id = ?
    ORDER BY h.created_at DESC, h.id DESC
  `).all(Number(req.params.id)).map(r => ({
    ...r,
    changed_by_name: r.display_name || r.username || 'System'
  }));
  res.json(rows);
});

app.post('/api/vehicle-jobs', auth, (req, res) => {
  if (!(can(req.user, MODULES.DISPO, 'edit') || can(req.user, MODULES.ADVISOR, 'edit'))) {
    return res.status(403).json({ error: 'Keine Berechtigung' });
  }
  const b = sanitizeVehicleJobBody(req.body || {});
  if (!b.customer_name || !b.plate) return res.status(400).json({ error: 'Kunde und Kennzeichen sind erforderlich' });
  if (can(req.user, MODULES.ADVISOR, 'edit') && !can(req.user, MODULES.DISPO, 'edit') && !b.advisor_user_id) b.advisor_user_id = req.user.id;
  if (b.advisor_user_id && !db.prepare('SELECT id FROM users WHERE id = ? AND COALESCE(active,1)=1').get(b.advisor_user_id)) {
    return res.status(400).json({ error: 'Serviceberater nicht gefunden' });
  }
  const info = db.prepare(`
    INSERT INTO vehicle_jobs (
      customer_name, plate, vehicle_label, phone, advisor_user_id,
      hb_required, pickup_required, delivery_required,
      cleaning_required, cleaning_type, deadline, status,
      notes, service_notes, detailing_notes, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    b.customer_name, b.plate, b.vehicle_label, b.phone, b.advisor_user_id,
    b.hb_required, b.pickup_required, b.delivery_required,
    b.cleaning_required, b.cleaning_type, b.deadline, b.status,
    b.notes, b.service_notes, b.detailing_notes, req.user.id
  );
  createVehicleHistory(info.lastInsertRowid, '', b.status, req.user.id, 'Vorgang angelegt');
  const row = db.prepare(`${vehicleJobSelectSql} WHERE vj.id = ?`).get(info.lastInsertRowid);
  const mapped = mapVehicleJob(row);
  broadcast('vehicle_job_updated', mapped);
  res.json(mapped);
});

app.put('/api/vehicle-jobs/:id', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM vehicle_jobs WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Fahrzeugvorgang nicht gefunden' });
  const serviceOwn = can(req.user, MODULES.ADVISOR, 'edit') && existing.advisor_user_id === req.user.id;
  const dispoEdit = can(req.user, MODULES.DISPO, 'edit');
  if (!(dispoEdit || serviceOwn)) return res.status(403).json({ error: 'Keine Berechtigung' });
  const b = sanitizeVehicleJobBody({ ...existing, ...req.body });
  if (!b.customer_name || !b.plate) return res.status(400).json({ error: 'Kunde und Kennzeichen sind erforderlich' });
  if (serviceOwn && !dispoEdit) b.hb_required = existing.hb_required;
  if (b.advisor_user_id && !db.prepare('SELECT id FROM users WHERE id = ? AND COALESCE(active,1)=1').get(b.advisor_user_id)) {
    return res.status(400).json({ error: 'Serviceberater nicht gefunden' });
  }
  db.prepare(`
    UPDATE vehicle_jobs SET
      customer_name = ?, plate = ?, vehicle_label = ?, phone = ?, advisor_user_id = ?,
      hb_required = ?, pickup_required = ?, delivery_required = ?,
      cleaning_required = ?, cleaning_type = ?, deadline = ?, status = ?,
      notes = ?, service_notes = ?, detailing_notes = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    b.customer_name, b.plate, b.vehicle_label, b.phone, b.advisor_user_id,
    b.hb_required, b.pickup_required, b.delivery_required,
    b.cleaning_required, b.cleaning_type, b.deadline, b.status,
    b.notes, b.service_notes, b.detailing_notes, existing.id
  );
  if (existing.status !== b.status) createVehicleHistory(existing.id, existing.status, b.status, req.user.id, 'Status über Bearbeiten geändert');
  const row = db.prepare(`${vehicleJobSelectSql} WHERE vj.id = ?`).get(existing.id);
  const mapped = mapVehicleJob(row);
  broadcast('vehicle_job_updated', mapped);
  res.json(mapped);
});

app.post('/api/vehicle-jobs/:id/status', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM vehicle_jobs WHERE id = ?').get(Number(req.params.id));
  if (!existing) return res.status(404).json({ error: 'Fahrzeugvorgang nicht gefunden' });
  const nextStatus = String(req.body?.status || '');
  const note = String(req.body?.note || '').trim();
  if (!VEHICLE_JOB_STATUS_LIST.includes(nextStatus)) return res.status(400).json({ error: 'Ungültiger Status' });
  const dispoEdit = can(req.user, MODULES.DISPO, 'edit');
  const serviceOwn = can(req.user, MODULES.ADVISOR, 'edit') && existing.advisor_user_id === req.user.id;
  const detailingEdit = can(req.user, MODULES.DETAILING, 'edit') || can(req.user, MODULES.DETAILING, 'manage');
  if (!(dispoEdit || serviceOwn || detailingEdit)) return res.status(403).json({ error: 'Keine Berechtigung' });
  db.prepare('UPDATE vehicle_jobs SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(nextStatus, existing.id);
  createVehicleHistory(existing.id, existing.status, nextStatus, req.user.id, note);
  const row = db.prepare(`${vehicleJobSelectSql} WHERE vj.id = ?`).get(existing.id);
  const mapped = mapVehicleJob(row);
  broadcast('vehicle_job_updated', mapped);
  res.json(mapped);
});

// Tours & Ottenschlag
app.get('/api/tours/:date', authModule(MODULES.DISPO, 'view'), (req, res) => {
  const rows = db.prepare(`${tourSelectSql} WHERE t.date = ? ORDER BY t.slot, t.tour_nr`).all(req.params.date).map(mapTour);
  const result = { vormittag: [], nachmittag: [] };
  for (const slot of ['vormittag', 'nachmittag']) {
    for (let nr = 1; nr <= 4; nr++) result[slot].push(rows.find(r => r.slot === slot && r.tour_nr === nr) || emptyTour(req.params.date, slot, nr));
  }
  res.json(result);
});
app.put('/api/tours/:date/:slot/:nr', authModule(MODULES.DISPO, 'edit'), (req, res) => {
  const { date, slot, nr } = req.params;
  if (!['vormittag', 'nachmittag'].includes(slot)) return res.status(400).json({ error: 'Ungültiger Slot' });
  if (![1,2,3,4].includes(Number(nr))) return res.status(400).json({ error: 'Ungültige Tournummer' });
  const b = req.body || {};
  const driverId = b.driver_id ? Number(b.driver_id) : null;
  const jobId = b.job_id ? Number(b.job_id) : null;
  const tourKind = ['pickup','delivery'].includes(String(b.tour_kind || '')) ? String(b.tour_kind) : '';
  const loanerRequired = b.loaner_required ? 1 : 0;
  // FIX #7: loaner_vehicle_id wird nur übernommen wenn loaner_required UND Select-Wert gesetzt
  const loanerId = loanerRequired && b.loaner_vehicle_id ? Number(b.loaner_vehicle_id) : null;
  const status = b.status || 'offen';
  if (!['offen', 'geplant', 'unterwegs', 'erledigt'].includes(status)) return res.status(400).json({ error: 'Ungültiger Status' });
  if (driverId && !db.prepare('SELECT id FROM drivers WHERE id = ?').get(driverId)) return res.status(400).json({ error: 'Fahrer nicht gefunden' });
  if (jobId && !db.prepare('SELECT id FROM vehicle_jobs WHERE id = ?').get(jobId)) return res.status(400).json({ error: 'Fahrzeugvorgang nicht gefunden' });
  if (jobId && !tourKind) return res.status(400).json({ error: 'Bitte Tourtyp für den verknüpften Fahrzeugvorgang wählen' });
  if (!jobId && tourKind) return res.status(400).json({ error: 'Bitte zuerst einen Fahrzeugvorgang wählen' });
  if (loanerId) {
    const loaner = db.prepare('SELECT id, status FROM loaner_vehicles WHERE id = ?').get(loanerId);
    if (!loaner) return res.status(400).json({ error: 'Leihwagen nicht gefunden' });
    if (loaner.status === 'deaktiviert') return res.status(400).json({ error: 'Leihwagen ist deaktiviert' });
  }
  db.prepare(`
    INSERT INTO tours (
      date, slot, tour_nr,
      deliver_customer, deliver_address, deliver_vehicle, deliver_time, deliver_phone,
      pickup_customer, pickup_address, pickup_vehicle, pickup_time, pickup_phone,
      driver_id, job_id, tour_kind, loaner_required, loaner_vehicle_id, status, gesperrt, notes,
      updated_at, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(date, slot, tour_nr) DO UPDATE SET
      deliver_customer = excluded.deliver_customer,
      deliver_address = excluded.deliver_address,
      deliver_vehicle = excluded.deliver_vehicle,
      deliver_time = excluded.deliver_time,
      deliver_phone = excluded.deliver_phone,
      pickup_customer = excluded.pickup_customer,
      pickup_address = excluded.pickup_address,
      pickup_vehicle = excluded.pickup_vehicle,
      pickup_time = excluded.pickup_time,
      pickup_phone = excluded.pickup_phone,
      driver_id = excluded.driver_id,
      job_id = excluded.job_id,
      tour_kind = excluded.tour_kind,
      loaner_required = excluded.loaner_required,
      loaner_vehicle_id = excluded.loaner_vehicle_id,
      status = excluded.status,
      gesperrt = excluded.gesperrt,
      notes = excluded.notes,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(
    date, slot, Number(nr),
    (b.deliver_customer || '').trim(),
    (b.deliver_address || '').trim(),
    (b.deliver_vehicle || '').trim(),
    (b.deliver_time || '').trim(),
    (b.deliver_phone || '').trim(),
    (b.pickup_customer || '').trim(),
    (b.pickup_address || '').trim(),
    (b.pickup_vehicle || '').trim(),
    (b.pickup_time || '').trim(),
    (b.pickup_phone || '').trim(),
    driverId, jobId, tourKind, loanerRequired, loanerId, status, b.gesperrt ? 1 : 0, (b.notes || '').trim(), req.user.username
  );
  const updated = mapTour(db.prepare(`${tourSelectSql} WHERE t.date = ? AND t.slot = ? AND t.tour_nr = ?`).get(date, slot, Number(nr)));
  syncVehicleJobFromTour(updated, req.user.id);
  broadcast('tour_updated', updated);
  res.json(updated);
});
app.get('/api/ottenschlag/:date', authModule(MODULES.DISPO, 'view'), (req, res) => {
  const row = db.prepare('SELECT * FROM ottenschlag WHERE date = ?').get(req.params.date);
  res.json(row ? { ...row, eintraege: JSON.parse(row.eintraege) } : { date: req.params.date, eintraege: [], updated_at: null, updated_by: '' });
});
app.put('/api/ottenschlag/:date', authModule(MODULES.DISPO, 'edit'), (req, res) => {
  const { eintraege } = req.body;
  if (!Array.isArray(eintraege)) return res.status(400).json({ error: 'Ungültige Daten' });
  db.prepare(`
    INSERT INTO ottenschlag (date, eintraege, updated_at, updated_by)
    VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(date) DO UPDATE SET
      eintraege = excluded.eintraege,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(req.params.date, JSON.stringify(eintraege), req.user.username);
  const updated = db.prepare('SELECT * FROM ottenschlag WHERE date = ?').get(req.params.date);
  broadcast('ottenschlag_updated', { ...updated, eintraege: JSON.parse(updated.eintraege) });
  res.json({ ok: true });
});

// Dispatch
app.get('/api/dispatch/:date', authModule(MODULES.DISPO, 'view'), (req, res) => {
  const rows = db.prepare(`
    SELECT ds.*, d.name AS driver_name
    FROM dispatch_sheets ds
    JOIN drivers d ON d.id = ds.driver_id
    WHERE ds.date = ?
    ORDER BY ds.slot, d.name
  `).all(req.params.date).map(hydrateDispatchRow);
  res.json(rows);
});
app.put('/api/dispatch/:date/:slot/:driverId', authModule(MODULES.DISPO, 'edit'), (req, res) => {
  const { date, slot, driverId } = req.params;
  if (!['vormittag', 'nachmittag'].includes(slot)) return res.status(400).json({ error: 'Ungültiger Slot' });
  const driver = db.prepare('SELECT id, name FROM drivers WHERE id = ?').get(Number(driverId));
  if (!driver) return res.status(400).json({ error: 'Fahrer nicht gefunden' });
  const steps = Array.isArray(req.body?.steps) ? req.body.steps : [];
  const validTourNr = (v) => Number.isInteger(Number(v)) && [1,2,3,4].includes(Number(v));
  const normalizedSteps = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') return res.status(400).json({ error: 'Ungültige Schritte' });
    if (step.type === 'deliver_tour' || step.type === 'pickup_tour') {
      if (!validTourNr(step.tour_nr)) return res.status(400).json({ error: 'Ungültige Tourreferenzen' });
      normalizedSteps.push({ type: step.type, tour_nr: Number(step.tour_nr) });
    } else if (step.type === 'free_text') {
      const txt = String(step.text || '').trim();
      if (txt) normalizedSteps.push({ type: 'free_text', text: txt });
    } else {
      return res.status(400).json({ error: 'Ungültiger Schritt-Typ' });
    }
  }
  const deliverRefs = normalizedSteps.filter(s => s.type === 'deliver_tour').map(s => ({ tour_nr: s.tour_nr }));
  const pickupRefs = normalizedSteps.filter(s => s.type === 'pickup_tour').map(s => ({ tour_nr: s.tour_nr }));
  const notes = normalizedSteps.filter(s => s.type === 'free_text').map(s => s.text).join('\n');
  db.prepare(`
    INSERT INTO dispatch_sheets (date, slot, driver_id, deliver_refs, pickup_refs, steps_json, notes, updated_at, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(date, slot, driver_id) DO UPDATE SET
      deliver_refs = excluded.deliver_refs,
      pickup_refs = excluded.pickup_refs,
      steps_json = excluded.steps_json,
      notes = excluded.notes,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(date, slot, Number(driverId), JSON.stringify(deliverRefs), JSON.stringify(pickupRefs), JSON.stringify(normalizedSteps), notes, req.user.username);
  const updated = db.prepare(`
    SELECT ds.*, d.name AS driver_name
    FROM dispatch_sheets ds JOIN drivers d ON d.id = ds.driver_id
    WHERE ds.date = ? AND ds.slot = ? AND ds.driver_id = ?
  `).get(date, slot, Number(driverId));
  const payload = hydrateDispatchRow(updated);
  broadcast('dispatch_updated', payload);
  res.json(payload);
});

// FIX #9: my-dispatch mit klarem Fehler wenn kein Fahrer verknüpft
app.get('/api/my-dispatch/:date', authModule(MODULES.DRIVER, 'view'), (req, res) => {
  let driverId = req.user.driver_id ? Number(req.user.driver_id) : null;

  // Fallback: Suche per display_name ODER username – aber nur wenn kein driver_id gesetzt
  if (!driverId) {
    const names = [req.user.display_name, req.user.username].filter(Boolean);
    for (const name of names) {
      const found = db.prepare('SELECT id FROM drivers WHERE name = ? AND active = 1').get(name);
      if (found) { driverId = found.id; break; }
    }
  }

  if (!driverId) {
    // Klare Antwort: kein Fahrer verknüpft, aber kein Fehler
    return res.json({ driver: null, sheets: [], tours: [], hint: 'Kein Fahrer mit diesem Benutzer verknüpft. Bitte einen Administrator bitten, den Benutzer mit einem Fahrer zu verknüpfen.' });
  }

  const driver = db.prepare('SELECT * FROM drivers WHERE id = ?').get(driverId);
  if (!driver) return res.json({ driver: null, sheets: [], tours: [], hint: 'Fahrer nicht mehr vorhanden.' });

  const sheets = db.prepare(`
    SELECT ds.*, d.name AS driver_name
    FROM dispatch_sheets ds JOIN drivers d ON d.id = ds.driver_id
    WHERE ds.date = ? AND ds.driver_id = ?
    ORDER BY ds.slot
  `).all(req.params.date, driverId).map(hydrateDispatchRow);
  const tours = db.prepare(`${tourSelectSql} WHERE t.date = ? AND t.driver_id = ? ORDER BY t.slot, t.tour_nr`).all(req.params.date, driverId).map(mapTour);
  res.json({ driver, sheets, tours });
});

app.get('*', (req, res) => res.sendFile(INDEX_FILE));
server.listen(PORT, () => console.log(`SynFlow läuft auf Port ${PORT} · Frontend: ${FRONTEND_DIR}`));
