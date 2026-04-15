import { login, logout, restoreSession } from './modules/auth.js';
import { api } from './modules/api.js';
import { state, setJobs, setAdvisors, setMeta, setCurrentView } from './modules/state.js';
import { renderHeader, renderNav } from './modules/layout.js';
import { renderDashboardView } from './modules/dashboard.js';
import { renderDispoView } from './modules/dispo.js';
import { renderServiceView } from './modules/service.js';
import { renderDetailingView } from './modules/detailing.js';
import { renderAdminView } from './modules/admin.js';
import { openModal, closeModal } from './modules/modal.js';
import { escapeHtml, roleLabel, statusLabel, formatDate } from './modules/utils.js';

const loginScreen = document.getElementById('login-screen');
const app = document.getElementById('app');
const main = document.getElementById('main');

async function bootstrap() {
  bindStaticEvents();
  const user = await restoreSession();
  if (user) {
    await enterApp();
  }
}

function bindStaticEvents() {
  document.getElementById('login-button').addEventListener('click', onLogin);
  document.getElementById('login-password').addEventListener('keydown', event => {
    if (event.key === 'Enter') onLogin();
  });
  document.getElementById('logout-button').addEventListener('click', async () => {
    await logout();
    showLogin();
  });
}

async function onLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const error = document.getElementById('login-error');
  const button = document.getElementById('login-button');
  error.classList.add('hidden');
  button.disabled = true;
  try {
    await login(username, password);
    await enterApp();
  } catch (e) {
    console.error('Login fehlgeschlagen:', e);
    error.textContent = e.message || 'Login fehlgeschlagen';
    error.classList.remove('hidden');
  } finally {
    button.disabled = false;
  }
}

async function enterApp() {
  await loadReferenceData();
  await loadJobs();
  if (state.user.role === 'dispo_holbring') setCurrentView('dispo');
  if (state.user.role === 'kundendienstberater') setCurrentView('service');
  if (state.user.role === 'fahrzeugaufbereitung') setCurrentView('detailing');
  showApp();
  renderHeader();
  renderNav(changeView);
  renderCurrentView();
}

async function loadReferenceData() {
  const [meta, advisors] = await Promise.all([
    api('/api/meta'),
    api('/api/advisors')
  ]);
  setMeta(meta);
  setAdvisors(advisors);
  if (state.user.role === 'admin') {
    state.users = await api('/api/users');
  }
}

async function loadJobs() {
  const jobs = await api('/api/jobs');
  setJobs(jobs);
}

function showApp() {
  loginScreen.classList.add('hidden');
  app.classList.remove('hidden');
}

function showLogin() {
  app.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  document.getElementById('modal-root').innerHTML = '';
}

function changeView(view) {
  setCurrentView(view);
  renderNav(changeView);
  renderCurrentView();
}

function renderCurrentView() {
  const view = state.currentView;
  if (view === 'dashboard') main.innerHTML = renderDashboardView();
  if (view === 'dispo') main.innerHTML = renderDispoView();
  if (view === 'service') main.innerHTML = renderServiceView();
  if (view === 'detailing') main.innerHTML = renderDetailingView();
  if (view === 'admin') main.innerHTML = renderAdminView();
  bindDynamicEvents();
}

function bindDynamicEvents() {
  main.querySelectorAll('[data-action="open-create-dispo"]').forEach(btn => btn.addEventListener('click', () => openJobForm('dispo')));
  main.querySelectorAll('[data-action="open-create-service"]').forEach(btn => btn.addEventListener('click', () => openJobForm('service')));
  main.querySelectorAll('[data-status-action]').forEach(btn => btn.addEventListener('click', () => changeStatus(btn.dataset.jobId, btn.dataset.statusAction)));
  main.querySelectorAll('[data-edit-job]').forEach(btn => btn.addEventListener('click', () => {
    const job = state.jobs.find(j => String(j.id) === String(btn.dataset.editJob));
    if (job) openJobForm(job.source_type, job);
  }));
  main.querySelectorAll('[data-history-job]').forEach(btn => btn.addEventListener('click', () => openHistory(btn.dataset.historyJob)));
}

function openJobForm(mode, job = null) {
  const isServiceUser = state.user.role === 'kundendienstberater';
  const title = job ? 'Vorgang bearbeiten' : mode === 'service' ? 'Service-Fahrzeug anlegen' : 'Dispo-Vorgang anlegen';
  const advisorOptions = state.advisors.map(a => `<option value="${a.id}" ${String(job?.advisor_user_id || (isServiceUser ? state.user.id : '')) === String(a.id) ? 'selected' : ''}>${escapeHtml(a.display_name)}</option>`).join('');
  const cleaningTypes = (state.meta?.cleaningTypes || []).map(type => `<option value="${escapeHtml(type)}" ${job?.cleaning_type === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('');
  openModal({
    title,
    body: `
      <form id="job-form" class="grid">
        <div class="form-grid">
          <div class="field"><label>Kundenname</label><input name="customer_name" value="${escapeHtml(job?.customer_name || '')}" required></div>
          <div class="field"><label>Kennzeichen</label><input name="plate" value="${escapeHtml(job?.plate || '')}" required></div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Fahrzeug</label><input name="vehicle_label" value="${escapeHtml(job?.vehicle_label || '')}" required></div>
          <div class="field"><label>Telefon</label><input name="phone" value="${escapeHtml(job?.phone || '')}"></div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Serviceberater</label><select name="advisor_user_id" ${isServiceUser ? 'disabled' : ''}><option value="">Bitte wählen</option>${advisorOptions}</select></div>
          <div class="field"><label>Reinigungsart</label><select name="cleaning_type"><option value="">Keine Auswahl</option>${cleaningTypes}</select></div>
        </div>
        <div class="form-grid">
          <div class="field"><label><input type="checkbox" name="transport_in" ${job?.transport_in ? 'checked' : mode === 'dispo' ? 'checked' : ''}> Abholung zu uns</label></div>
          <div class="field"><label><input type="checkbox" name="transport_out" ${job?.transport_out ? 'checked' : ''}> Auslieferung zurück</label></div>
        </div>
        <div class="form-grid">
          <div class="field"><label><input type="checkbox" name="cleaning_required" ${job?.cleaning_required ? 'checked' : ''}> Reinigung erforderlich</label></div>
          <div class="field"><label>Bis wann fertig</label><input type="date" name="cleaning_deadline" value="${escapeHtml(job?.cleaning_deadline || '')}"></div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Abholadresse</label><textarea name="pickup_address">${escapeHtml(job?.pickup_address || '')}</textarea></div>
          <div class="field"><label>Lieferadresse</label><textarea name="delivery_address">${escapeHtml(job?.delivery_address || '')}</textarea></div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Dispo-Notiz</label><textarea name="dispo_notes">${escapeHtml(job?.dispo_notes || '')}</textarea></div>
          <div class="field"><label>Service-/Aufbereitungsnotiz</label><textarea name="service_notes">${escapeHtml(job?.service_notes || job?.detailing_notes || '')}</textarea></div>
        </div>
      </form>
      <div id="job-form-error" class="error hidden"></div>
    `,
    footer: `
      <button class="btn" id="job-cancel">Abbrechen</button>
      <button class="btn btn-primary" id="job-save">Speichern</button>
    `
  });

  document.getElementById('job-cancel').addEventListener('click', closeModal);
  document.getElementById('job-save').addEventListener('click', async () => {
    const form = document.getElementById('job-form');
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.transport_in = form.transport_in.checked;
    payload.transport_out = form.transport_out.checked;
    payload.cleaning_required = form.cleaning_required.checked;
    if (isServiceUser) payload.advisor_user_id = String(state.user.id);
    payload.source_type = mode;
    payload.detailing_notes = job?.detailing_notes || '';
    try {
      if (job) {
        await api(`/api/jobs/${job.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/api/jobs', { method: 'POST', body: JSON.stringify(payload) });
      }
      closeModal();
      await refreshView();
    } catch (e) {
      const error = document.getElementById('job-form-error');
      error.textContent = e.message;
      error.classList.remove('hidden');
    }
  });
}

async function changeStatus(jobId, action) {
  await api(`/api/jobs/${jobId}/status`, {
    method: 'POST',
    body: JSON.stringify({ action })
  });
  await refreshView();
}

async function openHistory(jobId) {
  const job = state.jobs.find(j => String(j.id) === String(jobId));
  const history = await api(`/api/jobs/${jobId}/history`);
  openModal({
    title: `Historie · ${escapeHtml(job?.customer_name || '')}`,
    body: `
      <div class="timeline">
        ${history.length ? history.map(item => `
          <div class="timeline-item">
            <strong>${escapeHtml(statusLabel(item.status))}</strong>
            <small>${escapeHtml(item.changed_by_name || '—')} · ${escapeHtml(item.created_at)}</small>
            ${item.note ? `<div>${escapeHtml(item.note)}</div>` : ''}
          </div>
        `).join('') : '<div class="empty">Keine Historie vorhanden.</div>'}
      </div>
    `
  });
}

async function refreshView() {
  await loadJobs();
  renderCurrentView();
}

bootstrap();
