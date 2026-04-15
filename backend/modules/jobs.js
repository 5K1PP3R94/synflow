const { getDb, ROLES, STATUS } = require('../db');

function mapJob(row) {
  return {
    ...row,
    transport_in: !!row.transport_in,
    transport_out: !!row.transport_out,
    cleaning_required: !!row.cleaning_required
  };
}

function listJobs(req, res) {
  const db = getDb();
  const role = req.user.role;
  let sql = `
    SELECT j.*, a.display_name AS advisor_name, c.display_name AS created_by_name
    FROM jobs j
    LEFT JOIN users a ON a.id = j.advisor_user_id
    LEFT JOIN users c ON c.id = j.created_by_user_id
  `;
  let params = [];

  if (role === ROLES.SERVICE) {
    sql += ' WHERE j.advisor_user_id = ?';
    params = [req.user.id];
  } else if (role === ROLES.DETAILING) {
    sql += ' WHERE j.cleaning_required = 1 AND j.status IN (?, ?, ?)';
    params = [STATUS.READY_FOR_DETAILING, STATUS.IN_DETAILING, STATUS.SERVICE_DONE];
  }

  sql += " ORDER BY COALESCE(j.cleaning_deadline, '') ASC, j.updated_at DESC, j.id DESC";
  const rows = db.prepare(sql).all(...params).map(mapJob);
  res.json(rows);
}

function createJob(req, res) {
  const db = getDb();
  const body = req.body || {};
  const sourceType = req.user.role === ROLES.SERVICE ? 'service' : (body.source_type || 'dispo');
  if (!body.customer_name?.trim() || !body.plate?.trim() || !body.vehicle_label?.trim()) {
    return res.status(400).json({ error: 'Kunde, Kennzeichen und Fahrzeug sind erforderlich' });
  }

  const advisorId = body.advisor_user_id ? Number(body.advisor_user_id) : null;
  if (advisorId) {
    const advisor = db.prepare('SELECT id FROM users WHERE id = ? AND role = ?').get(advisorId, ROLES.SERVICE);
    if (!advisor) return res.status(400).json({ error: 'Serviceberater nicht gefunden' });
  }

  let status = STATUS.NEW;
  if (sourceType === 'dispo' && body.transport_in) status = STATUS.PICKUP_PLANNED;
  if (sourceType === 'service') status = STATUS.AT_SERVICE;

  const info = db.prepare(`
    INSERT INTO jobs (
      source_type, customer_name, plate, vehicle_label, phone,
      advisor_user_id, transport_in, transport_out, pickup_address, delivery_address,
      cleaning_required, cleaning_type, cleaning_deadline,
      service_notes, dispo_notes, detailing_notes,
      status, created_by_user_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    sourceType,
    body.customer_name.trim(),
    body.plate.trim().toUpperCase(),
    body.vehicle_label.trim(),
    String(body.phone || '').trim(),
    advisorId,
    body.transport_in ? 1 : 0,
    body.transport_out ? 1 : 0,
    String(body.pickup_address || '').trim(),
    String(body.delivery_address || '').trim(),
    body.cleaning_required ? 1 : 0,
    String(body.cleaning_type || '').trim(),
    String(body.cleaning_deadline || '').trim(),
    String(body.service_notes || '').trim(),
    String(body.dispo_notes || '').trim(),
    String(body.detailing_notes || '').trim(),
    status,
    req.user.id
  );

  addHistory(info.lastInsertRowid, status, 'Vorgang angelegt', req.user.id);
  const row = getJobById(info.lastInsertRowid);
  res.json(row);
}

function getJobById(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT j.*, a.display_name AS advisor_name, c.display_name AS created_by_name
    FROM jobs j
    LEFT JOIN users a ON a.id = j.advisor_user_id
    LEFT JOIN users c ON c.id = j.created_by_user_id
    WHERE j.id = ?
  `).get(id);
  return row ? mapJob(row) : null;
}

function addHistory(jobId, status, note, changedByUserId) {
  const db = getDb();
  db.prepare('INSERT INTO job_status_history (job_id, status, note, changed_by_user_id) VALUES (?, ?, ?, ?)')
    .run(jobId, status, note || '', changedByUserId);
}

function updateStatus(req, res) {
  const db = getDb();
  const jobId = Number(req.params.id);
  const { action, note = '' } = req.body || {};
  const job = getJobById(jobId);
  if (!job) return res.status(404).json({ error: 'Vorgang nicht gefunden' });

  let nextStatus = null;
  if (action === 'mark_arrived') nextStatus = STATUS.AT_SERVICE;
  if (action === 'service_done') nextStatus = job.cleaning_required ? STATUS.READY_FOR_DETAILING : STATUS.READY_FOR_DISPO;
  if (action === 'start_detailing') nextStatus = STATUS.IN_DETAILING;
  if (action === 'detailing_done') nextStatus = STATUS.READY_FOR_DISPO;
  if (action === 'plan_delivery') nextStatus = STATUS.DELIVERY_PLANNED;
  if (action === 'complete') nextStatus = STATUS.COMPLETED;

  if (!nextStatus) return res.status(400).json({ error: 'Ungültige Aktion' });

  db.prepare('UPDATE jobs SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(nextStatus, jobId);
  addHistory(jobId, nextStatus, note, req.user.id);
  res.json(getJobById(jobId));
}

function updateJob(req, res) {
  const db = getDb();
  const jobId = Number(req.params.id);
  const body = req.body || {};
  const job = getJobById(jobId);
  if (!job) return res.status(404).json({ error: 'Vorgang nicht gefunden' });

  const advisorId = body.advisor_user_id ? Number(body.advisor_user_id) : null;
  if (advisorId) {
    const advisor = db.prepare('SELECT id FROM users WHERE id = ? AND role = ?').get(advisorId, ROLES.SERVICE);
    if (!advisor) return res.status(400).json({ error: 'Serviceberater nicht gefunden' });
  }

  db.prepare(`
    UPDATE jobs SET
      customer_name = ?,
      plate = ?,
      vehicle_label = ?,
      phone = ?,
      advisor_user_id = ?,
      transport_in = ?,
      transport_out = ?,
      pickup_address = ?,
      delivery_address = ?,
      cleaning_required = ?,
      cleaning_type = ?,
      cleaning_deadline = ?,
      service_notes = ?,
      dispo_notes = ?,
      detailing_notes = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    body.customer_name?.trim() || job.customer_name,
    (body.plate || job.plate).trim().toUpperCase(),
    body.vehicle_label?.trim() || job.vehicle_label,
    String(body.phone ?? job.phone ?? '').trim(),
    advisorId,
    body.transport_in ? 1 : 0,
    body.transport_out ? 1 : 0,
    String(body.pickup_address || '').trim(),
    String(body.delivery_address || '').trim(),
    body.cleaning_required ? 1 : 0,
    String(body.cleaning_type || '').trim(),
    String(body.cleaning_deadline || '').trim(),
    String(body.service_notes || '').trim(),
    String(body.dispo_notes || '').trim(),
    String(body.detailing_notes || '').trim(),
    jobId
  );

  res.json(getJobById(jobId));
}

function getHistory(req, res) {
  const db = getDb();
  const jobId = Number(req.params.id);
  const rows = db.prepare(`
    SELECT h.*, u.display_name AS changed_by_name
    FROM job_status_history h
    LEFT JOIN users u ON u.id = h.changed_by_user_id
    WHERE h.job_id = ?
    ORDER BY h.id DESC
  `).all(jobId);
  res.json(rows);
}

module.exports = { listJobs, createJob, updateStatus, updateJob, getHistory };
