import { escapeHtml, statusLabel, formatDate } from './utils.js';

export function jobCard(job, actionsHtml = '', extraClass = '') {
  const statusClass = ['bereit_fuer_dispo', 'reinigung_fertig', 'abgeschlossen'].includes(job.status) ? 'ready' :
    ['bereit_fuer_reinigung', 'in_reinigung'].includes(job.status) ? 'warning' : '';
  return `
    <article class="card job-card ${statusClass} ${extraClass}">
      <div class="job-top">
        <div>
          <div class="job-title">${escapeHtml(job.customer_name)}</div>
          <div class="job-sub">${escapeHtml(job.vehicle_label)} · ${escapeHtml(job.plate)}</div>
        </div>
        <span class="pill">${escapeHtml(statusLabel(job.status))}</span>
      </div>
      <div class="job-meta">
        <div class="meta-box"><label>Serviceberater</label><div>${escapeHtml(job.advisor_name || '—')}</div></div>
        <div class="meta-box"><label>Deadline Reinigung</label><div>${escapeHtml(formatDate(job.cleaning_deadline))}</div></div>
        <div class="meta-box"><label>Reinigung</label><div>${job.cleaning_required ? escapeHtml(job.cleaning_type || 'Ja') : 'Nein'}</div></div>
        <div class="meta-box"><label>Transport</label><div>${job.transport_in ? 'Abholung' : 'Kein H&B Eingang'}${job.transport_out ? ' · Auslieferung' : ''}</div></div>
      </div>
      <div>${job.phone ? `☎ ${escapeHtml(job.phone)}` : ''}</div>
      ${job.pickup_address ? `<div><span class="badge">Abholadresse</span> ${escapeHtml(job.pickup_address)}</div>` : ''}
      ${job.delivery_address ? `<div><span class="badge">Lieferadresse</span> ${escapeHtml(job.delivery_address)}</div>` : ''}
      ${job.service_notes ? `<div><span class="badge">Service</span> ${escapeHtml(job.service_notes)}</div>` : ''}
      ${job.dispo_notes ? `<div><span class="badge">Dispo</span> ${escapeHtml(job.dispo_notes)}</div>` : ''}
      ${job.detailing_notes ? `<div><span class="badge">Aufbereitung</span> ${escapeHtml(job.detailing_notes)}</div>` : ''}
      ${actionsHtml ? `<div class="actions">${actionsHtml}</div>` : ''}
    </article>
  `;
}

export function statsRow(items) {
  return `
    <section class="stats">
      ${items.map(item => `<div class="stat"><strong>${item.value}</strong><span>${item.label}</span></div>`).join('')}
    </section>
  `;
}
