import { state } from './state.js';
import { jobCard, statsRow } from './jobs-ui.js';

export function renderDispoView() {
  const jobs = state.jobs;
  const awaitingPickup = jobs.filter(j => ['neu', 'abholung_geplant'].includes(j.status));
  const atService = jobs.filter(j => ['bei_serviceberater', 'bereit_fuer_reinigung', 'in_reinigung'].includes(j.status));
  const readyForDispo = jobs.filter(j => ['bereit_fuer_dispo', 'reinigung_fertig', 'service_fertig'].includes(j.status));
  const completed = jobs.filter(j => j.status === 'abgeschlossen');

  return `
    ${statsRow([
      { value: awaitingPickup.length, label: 'Offen / zu planen' },
      { value: atService.length, label: 'Bei Service / Reinigung' },
      { value: readyForDispo.length, label: 'Wieder disponierbar' },
      { value: completed.length, label: 'Abgeschlossen' }
    ])}

    <section class="section">
      <div class="section-head"><h2>H&B Dispo</h2><button class="btn btn-primary" data-action="open-create-dispo">+ Vorgang anlegen</button></div>
      <div class="section-body grid grid-2">
        ${awaitingPickup.length ? awaitingPickup.map(job => jobCard(job, dispoActions(job))).join('') : '<div class="empty">Keine offenen Abholungen.</div>'}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h3>Warten auf Werkstatt / Reinigung</h3><div class="badge">Dispo sieht den Fortschritt</div></div>
      <div class="section-body grid grid-2">
        ${atService.length ? atService.map(job => jobCard(job)).join('') : '<div class="empty">Aktuell keine Fahrzeuge in diesem Status.</div>'}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h3>Wieder disponierbar</h3><div class="badge">Lieferung kann geplant werden</div></div>
      <div class="section-body grid grid-2">
        ${readyForDispo.length ? readyForDispo.map(job => jobCard(job, readyActions(job))).join('') : '<div class="empty">Noch nichts für die Rücklieferung bereit.</div>'}
      </div>
    </section>
  `;
}

function dispoActions(job) {
  const buttons = [];
  if (job.status === 'neu' || job.status === 'abholung_geplant') buttons.push(`<button class="btn btn-primary small" data-status-action="mark_arrived" data-job-id="${job.id}">Als eingetroffen markieren</button>`);
  buttons.push(`<button class="btn btn-secondary small" data-edit-job="${job.id}">Bearbeiten</button>`);
  buttons.push(`<button class="btn small" data-history-job="${job.id}">Historie</button>`);
  return buttons.join('');
}

function readyActions(job) {
  const buttons = [];
  if (job.status !== 'auslieferung_geplant') buttons.push(`<button class="btn btn-primary small" data-status-action="plan_delivery" data-job-id="${job.id}">Auslieferung planen</button>`);
  buttons.push(`<button class="btn btn-secondary small" data-status-action="complete" data-job-id="${job.id}">Abschließen</button>`);
  buttons.push(`<button class="btn small" data-history-job="${job.id}">Historie</button>`);
  return buttons.join('');
}
