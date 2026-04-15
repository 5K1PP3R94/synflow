import { state } from './state.js';
import { statsRow } from './jobs-ui.js';
import { roleLabel } from './utils.js';

export function renderDashboardView() {
  const jobs = state.jobs;
  return `
    ${statsRow([
      { value: jobs.length, label: 'Aktive Vorgänge' },
      { value: jobs.filter(j => j.cleaning_required).length, label: 'Mit Reinigung' },
      { value: jobs.filter(j => j.status === 'bereit_fuer_dispo').length, label: 'Bereit für Dispo' },
      { value: jobs.filter(j => j.status === 'abgeschlossen').length, label: 'Abgeschlossen' }
    ])}

    <section class="section">
      <div class="section-head"><h2>Willkommen</h2><div class="badge">${roleLabel(state.user.role)}</div></div>
      <div class="section-body grid grid-2">
        <div class="card">
          <strong>Was diese V7.1 zeigt</strong>
          <p>Die App ist jetzt wirklich modular aufgebaut. Frontend und Backend sind in einzelne Dateien zerlegt und der zentrale Workflow läuft über einen gemeinsamen Fahrzeugvorgang.</p>
        </div>
        <div class="card">
          <strong>Was du testen kannst</strong>
          <p>Vorgänge anlegen, Status zwischen Dispo, Service und Aufbereitung weiterreichen und prüfen, ob die richtigen Rollen jeweils nur ihre relevante Liste sehen.</p>
        </div>
      </div>
    </section>
  `;
}
