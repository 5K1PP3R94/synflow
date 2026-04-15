import { state } from './state.js';
import { roleLabel } from './utils.js';

export function renderAdminView() {
  const users = state.users || [];
  return `
    <section class="section">
      <div class="section-head"><h2>Admin</h2><div class="badge">Modulare V7-Struktur</div></div>
      <div class="section-body">
        <div class="grid grid-3">
          <div class="card"><strong>Frontend</strong><div>app.js, api.js, layout.js, dispo.js, service.js, detailing.js, admin.js, modal.js, jobs-ui.js</div></div>
          <div class="card"><strong>Backend</strong><div>server.js, db.js, modules/auth.js, modules/jobs.js, modules/reference.js</div></div>
          <div class="card"><strong>Workflow</strong><div>Ein zentraler Job läuft durch Dispo → Service → Reinigung → Dispo.</div></div>
        </div>
        <div style="height:16px"></div>
        <div class="card">
          <strong>Benutzer</strong>
          <div style="height:10px"></div>
          ${users.length ? users.map(u => `<div style="padding:8px 0;border-bottom:1px solid var(--line)"><strong>${u.display_name}</strong> · ${roleLabel(u.role)} · ${u.username}</div>`).join('') : 'Keine Benutzer geladen.'}
        </div>
      </div>
    </section>
  `;
}
