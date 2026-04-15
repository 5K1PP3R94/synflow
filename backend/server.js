const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const { initDb, ROLES } = require('./db');
const { login, logout, authRequired, requireRole } = require('./modules/auth');
const { listJobs, createJob, updateStatus, updateJob, getHistory } = require('./modules/jobs');
const { listAdvisors, listUsers, getWorkflowMeta } = require('./modules/reference');

initDb();

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path === '/') {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.post('/api/login', login);
app.post('/api/logout', logout);
app.get('/api/me', authRequired, (req, res) => res.json(req.user));
app.get('/api/meta', authRequired, getWorkflowMeta);
app.get('/api/advisors', authRequired, listAdvisors);
app.get('/api/users', authRequired, requireRole(ROLES.ADMIN), listUsers);
app.get('/api/jobs', authRequired, listJobs);
app.post('/api/jobs', authRequired, requireRole(ROLES.DISPO, ROLES.SERVICE), createJob);
app.put('/api/jobs/:id', authRequired, requireRole(ROLES.DISPO, ROLES.SERVICE, ROLES.DETAILING), updateJob);
app.post('/api/jobs/:id/status', authRequired, requireRole(ROLES.DISPO, ROLES.SERVICE, ROLES.DETAILING), updateStatus);
app.get('/api/jobs/:id/history', authRequired, getHistory);

app.use(express.static(path.join(__dirname, '../frontend/public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: err?.message || 'Interner Serverfehler' });
});

app.listen(PORT, () => {
  console.log(`SynFlow V7 modular läuft auf Port ${PORT}`);
});
