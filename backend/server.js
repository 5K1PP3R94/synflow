const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = process.env.JWT_SECRET || 'synflow-secret-2026';
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || '/data/synflow.db';

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'reader',
    created_at TEXT DEFAULT (datetime('now'))
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

    pickup_customer TEXT DEFAULT '',
    pickup_address TEXT DEFAULT '',
    pickup_vehicle TEXT DEFAULT '',
    pickup_time TEXT DEFAULT '',

    customer_phone TEXT DEFAULT '',
    driver_id INTEGER,
    loaner_required INTEGER NOT NULL DEFAULT 0,
    loaner_vehicle_id INTEGER,
    status TEXT NOT NULL DEFAULT 'offen' CHECK(status IN ('offen','geplant','unterwegs','erledigt')),
    gesperrt INTEGER DEFAULT 0,
    notes TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT '',
    UNIQUE(date, slot, tour_nr),
    FOREIGN KEY(driver_id) REFERENCES drivers(id),
    FOREIGN KEY(loaner_vehicle_id) REFERENCES loaner_vehicles(id)
  );

  CREATE TABLE IF NOT EXISTS ottenschlag (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    eintraege TEXT DEFAULT '[]',
    updated_at TEXT DEFAULT (datetime('now')),
    updated_by TEXT DEFAULT ''
  );
`);

const tourColumns = db.prepare(`PRAGMA table_info(tours)`).all().map(x => x.name);
function ensureTourColumn(name, sqlType) {
  if (!tourColumns.includes(name)) db.exec(`ALTER TABLE tours ADD COLUMN ${name} ${sqlType}`);
}
ensureTourColumn('deliver_customer', "TEXT DEFAULT ''");
ensureTourColumn('deliver_address', "TEXT DEFAULT ''");
ensureTourColumn('deliver_vehicle', "TEXT DEFAULT ''");
ensureTourColumn('deliver_time', "TEXT DEFAULT ''");
ensureTourColumn('pickup_customer', "TEXT DEFAULT ''");
ensureTourColumn('pickup_address', "TEXT DEFAULT ''");
ensureTourColumn('pickup_vehicle', "TEXT DEFAULT ''");
ensureTourColumn('pickup_time', "TEXT DEFAULT ''");
ensureTourColumn('customer_phone', "TEXT DEFAULT ''");
ensureTourColumn('driver_id', 'INTEGER');
ensureTourColumn('loaner_required', 'INTEGER NOT NULL DEFAULT 0');
ensureTourColumn('loaner_vehicle_id', 'INTEGER');
ensureTourColumn('status', "TEXT NOT NULL DEFAULT 'offen'");
ensureTourColumn('notes', "TEXT DEFAULT ''");

const userCount = db.prepare('SELECT COUNT(*) c FROM users').get();
if (!userCount.c) {
  db.prepare("INSERT INTO users (username, password, role) VALUES (?, ?, 'admin')")
    .run('admin', bcrypt.hashSync('admin123', 10));
}

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../frontend/public')));

function auth(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'Benutzer nicht gefunden' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Ungültiger Token' });
  }
}

function authWriter(req, res, next) {
  auth(req, res, () => {
    if (req.user.role === 'reader') return res.status(403).json({ error: 'Keine Schreibrechte' });
    next();
  });
}

function authAdmin(req, res, next) {
  auth(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Nur für Administratoren' });
    next();
  });
}

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function mapTour(row) {
  if (!row) return null;
  const driver = row.driver_id ? { id: row.driver_id, name: row.driver_name || '' } : null;
  const loaner = row.loaner_vehicle_id ? {
    id: row.loaner_vehicle_id,
    name: row.loaner_name || '',
    plate: row.loaner_plate || ''
  } : null;
  delete row.driver_name;
  delete row.loaner_name;
  delete row.loaner_plate;
  row.driver = driver;
  row.loaner_vehicle = loaner;
  return row;
}

function emptyTour(date, slot, nr) {
  return {
    date, slot, tour_nr: nr,
    deliver_customer: '', deliver_address: '', deliver_vehicle: '', deliver_time: '',
    pickup_customer: '', pickup_address: '', pickup_vehicle: '', pickup_time: '',
    customer_phone: '', driver_id: null, loaner_required: 0, loaner_vehicle_id: null, status: 'offen',
    gesperrt: 0, notes: '', updated_at: null, updated_by: '', driver: null, loaner_vehicle: null
  };
}

const tourSelectSql = `
  SELECT t.*, d.name AS driver_name, lv.name AS loaner_name, lv.plate AS loaner_plate
  FROM tours t
  LEFT JOIN drivers d ON d.id = t.driver_id
  LEFT JOIN loaner_vehicles lv ON lv.id = t.loaner_vehicle_id
`;

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Alle Felder erforderlich' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
  }
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 3600 * 1000
  });
  res.json({ username: user.username, role: user.role });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

app.put('/api/me/password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Alle Felder erforderlich' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Neues Passwort mind. 6 Zeichen' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Aktuelles Passwort falsch' });
  }
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ ok: true });
});

app.get('/api/users', authAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all());
});

app.post('/api/users', authAdmin, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !['admin', 'writer', 'reader'].includes(role)) {
    return res.status(400).json({ error: 'Ungültige Eingabe' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Passwort mind. 6 Zeichen' });
  try {
    const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
      .run(username, bcrypt.hashSync(password, 10), role);
    res.json({ id: result.lastInsertRowid, username, role });
  } catch {
    res.status(409).json({ error: 'Benutzername bereits vergeben' });
  }
});

app.put('/api/users/:id', authAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { role, newPassword } = req.body;
  if (role && !['admin', 'writer', 'reader'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle' });
  if (newPassword && newPassword.length < 6) return res.status(400).json({ error: 'Passwort mind. 6 Zeichen' });
  if (role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (newPassword) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', authAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Eigenen Benutzer nicht löschbar' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.get('/api/drivers', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM drivers ORDER BY active DESC, name').all());
});

app.post('/api/drivers', authAdmin, (req, res) => {
  const { name, phone = '', notes = '', active = 1 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  try {
    const result = db.prepare('INSERT INTO drivers (name, phone, notes, active) VALUES (?, ?, ?, ?)')
      .run(name.trim(), phone.trim(), notes.trim(), active ? 1 : 0);
    const row = db.prepare('SELECT * FROM drivers WHERE id = ?').get(result.lastInsertRowid);
    broadcast('drivers_updated', row);
    res.json(row);
  } catch {
    res.status(409).json({ error: 'Fahrer existiert bereits' });
  }
});

app.put('/api/drivers/:id', authAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, phone = '', notes = '', active = 1 } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  try {
    db.prepare('UPDATE drivers SET name = ?, phone = ?, notes = ?, active = ? WHERE id = ?')
      .run(name.trim(), phone.trim(), notes.trim(), active ? 1 : 0, id);
    const row = db.prepare('SELECT * FROM drivers WHERE id = ?').get(id);
    broadcast('drivers_updated', row);
    res.json(row);
  } catch {
    res.status(409).json({ error: 'Fahrername bereits vergeben' });
  }
});

app.delete('/api/drivers/:id', authAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE tours SET driver_id = NULL WHERE driver_id = ?').run(id);
  db.prepare('DELETE FROM drivers WHERE id = ?').run(id);
  broadcast('drivers_updated', { deleted: id });
  res.json({ ok: true });
});

app.get('/api/loaners', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM loaner_vehicles ORDER BY status, name').all());
});

app.post('/api/loaners', authAdmin, (req, res) => {
  const { name, plate = '', status = 'verfuegbar', notes = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  if (!['verfuegbar', 'werkstatt', 'reserviert', 'deaktiviert'].includes(status)) {
    return res.status(400).json({ error: 'Ungültiger Status' });
  }
  try {
    const result = db.prepare('INSERT INTO loaner_vehicles (name, plate, status, notes) VALUES (?, ?, ?, ?)')
      .run(name.trim(), plate.trim(), status, notes.trim());
    const row = db.prepare('SELECT * FROM loaner_vehicles WHERE id = ?').get(result.lastInsertRowid);
    broadcast('loaners_updated', row);
    res.json(row);
  } catch {
    res.status(409).json({ error: 'Leihwagen existiert bereits' });
  }
});

app.put('/api/loaners/:id', authAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { name, plate = '', status = 'verfuegbar', notes = '' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name erforderlich' });
  if (!['verfuegbar', 'werkstatt', 'reserviert', 'deaktiviert'].includes(status)) {
    return res.status(400).json({ error: 'Ungültiger Status' });
  }
  try {
    db.prepare('UPDATE loaner_vehicles SET name = ?, plate = ?, status = ?, notes = ? WHERE id = ?')
      .run(name.trim(), plate.trim(), status, notes.trim(), id);
    const row = db.prepare('SELECT * FROM loaner_vehicles WHERE id = ?').get(id);
    broadcast('loaners_updated', row);
    res.json(row);
  } catch {
    res.status(409).json({ error: 'Leihwagenname bereits vergeben' });
  }
});

app.delete('/api/loaners/:id', authAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE tours SET loaner_vehicle_id = NULL WHERE loaner_vehicle_id = ?').run(id);
  db.prepare('DELETE FROM loaner_vehicles WHERE id = ?').run(id);
  broadcast('loaners_updated', { deleted: id });
  res.json({ ok: true });
});

app.get('/api/meta', auth, (req, res) => {
  const drivers = db.prepare('SELECT * FROM drivers WHERE active = 1 ORDER BY name').all();
  const loaners = db.prepare(`SELECT * FROM loaner_vehicles WHERE status != 'deaktiviert' ORDER BY name`).all();
  res.json({ drivers, loaners });
});

app.get('/api/tours/:date', auth, (req, res) => {
  const { date } = req.params;
  const rows = db.prepare(`${tourSelectSql} WHERE t.date = ? ORDER BY t.slot, t.tour_nr`).all(date).map(r => mapTour(r));
  const result = { vormittag: [], nachmittag: [] };
  for (const slot of ['vormittag', 'nachmittag']) {
    for (let nr = 1; nr <= 4; nr++) {
      result[slot].push(rows.find(r => r.slot === slot && r.tour_nr === nr) || emptyTour(date, slot, nr));
    }
  }
  res.json(result);
});

app.put('/api/tours/:date/:slot/:nr', authWriter, (req, res) => {
  const { date, slot, nr } = req.params;
  if (!['vormittag', 'nachmittag'].includes(slot)) return res.status(400).json({ error: 'Ungültiger Slot' });
  if (![1,2,3,4].includes(Number(nr))) return res.status(400).json({ error: 'Ungültige Tournummer' });

  const b = req.body || {};
  const driverId = b.driver_id ? Number(b.driver_id) : null;
  const loanerRequired = b.loaner_required ? 1 : 0;
  const loanerId = loanerRequired && b.loaner_vehicle_id ? Number(b.loaner_vehicle_id) : null;
  const status = b.status || 'offen';
  if (!['offen','geplant','unterwegs','erledigt'].includes(status)) {
    return res.status(400).json({ error: 'Ungültiger Status' });
  }

  if (driverId) {
    const exists = db.prepare('SELECT id FROM drivers WHERE id = ?').get(driverId);
    if (!exists) return res.status(400).json({ error: 'Fahrer nicht gefunden' });
  }
  if (loanerId) {
    const loaner = db.prepare('SELECT id, status FROM loaner_vehicles WHERE id = ?').get(loanerId);
    if (!loaner) return res.status(400).json({ error: 'Leihwagen nicht gefunden' });
    if (loaner.status === 'deaktiviert') return res.status(400).json({ error: 'Leihwagen ist deaktiviert' });
  }

  db.prepare(`
    INSERT INTO tours (
      date, slot, tour_nr,
      deliver_customer, deliver_address, deliver_vehicle, deliver_time,
      pickup_customer, pickup_address, pickup_vehicle, pickup_time,
      customer_phone, driver_id, loaner_required, loaner_vehicle_id, status, gesperrt, notes,
      updated_at, updated_by
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?
    )
    ON CONFLICT(date, slot, tour_nr) DO UPDATE SET
      deliver_customer = excluded.deliver_customer,
      deliver_address = excluded.deliver_address,
      deliver_vehicle = excluded.deliver_vehicle,
      deliver_time = excluded.deliver_time,
      pickup_customer = excluded.pickup_customer,
      pickup_address = excluded.pickup_address,
      pickup_vehicle = excluded.pickup_vehicle,
      pickup_time = excluded.pickup_time,
      customer_phone = excluded.customer_phone,
      driver_id = excluded.driver_id,
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
    (b.pickup_customer || '').trim(),
    (b.pickup_address || '').trim(),
    (b.pickup_vehicle || '').trim(),
    (b.pickup_time || '').trim(),
    (b.customer_phone || '').trim(),
    driverId,
    loanerRequired,
    loanerId,
    status,
    b.gesperrt ? 1 : 0,
    (b.notes || '').trim(),
    req.user.username
  );

  const updated = mapTour(db.prepare(`${tourSelectSql} WHERE t.date = ? AND t.slot = ? AND t.tour_nr = ?`).get(date, slot, Number(nr)));
  broadcast('tour_updated', updated);
  res.json(updated);
});

app.get('/api/ottenschlag/:date', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM ottenschlag WHERE date = ?').get(req.params.date);
  res.json(row ? { ...row, eintraege: JSON.parse(row.eintraege) } : { date: req.params.date, eintraege: [] });
});

app.put('/api/ottenschlag/:date', authWriter, (req, res) => {
  const { date } = req.params;
  const { eintraege } = req.body;
  if (!Array.isArray(eintraege)) return res.status(400).json({ error: 'Ungültige Daten' });
  db.prepare(`
    INSERT INTO ottenschlag (date, eintraege, updated_at, updated_by)
    VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(date) DO UPDATE SET
      eintraege = excluded.eintraege,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(date, JSON.stringify(eintraege), req.user.username);
  const updated = db.prepare('SELECT * FROM ottenschlag WHERE date = ?').get(date);
  broadcast('ottenschlag_updated', { ...updated, eintraege: JSON.parse(updated.eintraege) });
  res.json({ ok: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

server.listen(PORT, () => {
  console.log(`SynFlow läuft auf Port ${PORT}`);
});
