import { state } from './state.js';
import { jobCard, statsRow } from './jobs-ui.js';

export function renderDetailingView() {
  const visible = state.jobs.filter(j => j.cleaning_required);
  const preview = visible.filter(j => j.status === 'service_fertig');
  const ready = visible.filter(j => j.status === 'bereit_fuer_reinigung');
  const inProgress = visible.filter(j => j.status === 'in_reinigung');

  return `
    ${statsRow([
      { value: preview.length, label: 'Bald fällig' },
      { value: ready.length, label: 'Freigegeben' },
      { value: inProgress.length, label: 'In Reinigung' },
      { value: visible.length, label: 'Gesamt mit Reinigung' }
    ])}

    <section class="section">
      <div class="section-head"><h2>Fahrzeugaufbereitung</h2><div class="badge">Nur Fahrzeuge mit Reinigungsbedarf</div></div>
      <div class="section-body grid grid-2">
        ${visible.length ? visible.map(job => jobCard(job, detailingActions(job))).join('') : '<div class="empty">Keine Fahrzeuge mit Reinigungsbedarf.</div>'}
      </div>
    </section>
  `;
}

function detailingActions(job) {
  const buttons = [];
  if (job.status === 'bereit_fuer_reinigung') buttons.push(`<button class="btn btn-primary small" data-status-action="start_detailing" data-job-id="${job.id}">Reinigung starten</button>`);
  if (job.status === 'in_reinigung') buttons.push(`<button class="btn btn-primary small" data-status-action="detailing_done" data-job-id="${job.id}">Reinigung fertig</button>`);
  buttons.push(`<button class="btn btn-secondary small" data-edit-job="${job.id}">Bearbeiten</button>`);
  buttons.push(`<button class="btn small" data-history-job="${job.id}">Historie</button>`);
  return buttons.join('');
}
