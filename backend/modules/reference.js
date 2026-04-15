const { getDb, ROLES, STATUS } = require('../db');

function listAdvisors(req, res) {
  const db = getDb();
  const rows = db.prepare('SELECT id, display_name FROM users WHERE role = ? AND active = 1 ORDER BY display_name').all(ROLES.SERVICE);
  res.json(rows);
}

function listUsers(req, res) {
  const db = getDb();
  const rows = db.prepare('SELECT id, username, display_name, role, active FROM users ORDER BY role, display_name').all();
  res.json(rows);
}

function getWorkflowMeta(req, res) {
  res.json({
    statuses: STATUS,
    roles: ROLES,
    cleaningTypes: [
      'Innenreinigung',
      'Außenreinigung',
      'Innen + Außen',
      'Aufbereitung komplett'
    ]
  });
}

module.exports = { listAdvisors, listUsers, getWorkflowMeta };
