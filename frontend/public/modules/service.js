import { state } from './state.js';
import { jobCard, statsRow } from './jobs-ui.js';

export function renderServiceView() {
  const jobs = state.jobs;
  const active = jobs.filter(j => ['bei_serviceberater', 'eingetroffen', 'unterwegs_zu_uns'].includes(j.status));
  const donePending = jobs.filter(j => ['service_fertig', 'bereit_fuer_reinigung', 'bereit_fuer_dispo'].includes(j.status));

  return `
    ${statsRow([
      { value: active.length, label: 'Aktiv in Betreuung' },
      { value: donePending.length, label: 'Fertig / weitergegeben' },
      { value: jobs.filter(j => j.cleaning_required).length, label: 'Mit Reinigung' },
      { value: jobs.length, label: 'Gesamt' }
    ])}

    <section class="section">
      <div class="section-head"><h2>Serviceberater</h2><button class="btn btn-primary" data-action="open-create-service">+ Fahrzeug ohne H&B anlegen</button></div>
      <div class="section-body grid grid-2">
        ${active.length ? active.map(job => jobCard(job, serviceActions(job))).join('') : '<div class="empty">Keine aktiven Fahrzeuge.</div>'}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h3>Fertig / weitergegeben</h3><div class="badge">Nach Service an Reinigung oder Dispo</div></div>
      <div class="section-body grid grid-2">
        ${donePending.length ? donePending.map(job => jobCard(job, `<button class="btn small" data-history-job="${job.id}">Historie</button>`)).join('') : '<div class="empty">Noch keine abgeschlossenen Servicevorgänge.</div>'}
      </div>
    </section>
  `;
}

function serviceActions(job) {
  return [
    `<button class="btn btn-primary small" data-status-action="service_done" data-job-id="${job.id}">Service fertig</button>`,
    `<button class="btn btn-secondary small" data-edit-job="${job.id}">Bearbeiten</button>`,
    `<button class="btn small" data-history-job="${job.id}">Historie</button>`
  ].join('');
}
