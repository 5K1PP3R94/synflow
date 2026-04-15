const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb, ROLES } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'synflow-secret-2026';

function createToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: '7d' });
}

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    active: !!user.active
  };
}

function login(req, res) {
  const db = getDb();
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!user || !user.active || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Ungültige Zugangsdaten' });
  }
  const token = createToken(user.id);
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    path: '/',
    maxAge: 7 * 24 * 3600 * 1000
  });
  res.json(serializeUser(user));
}

function logout(req, res) {
  res.clearCookie('token', { path: '/' });
  res.json({ ok: true });
}

function authRequired(req, res, next) {
  const db = getDb();
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Nicht angemeldet' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Benutzer nicht verfügbar' });
    req.user = serializeUser(user);
    next();
  } catch {
    res.status(401).json({ error: 'Ungültiger Token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
    if (req.user.role === ROLES.ADMIN || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Keine Berechtigung' });
  };
}

module.exports = { login, logout, authRequired, requireRole, serializeUser, ROLES };
