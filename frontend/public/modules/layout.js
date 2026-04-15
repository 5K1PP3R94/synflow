import { state, setCurrentView } from './state.js';
import { roleLabel } from './utils.js';

export function renderNav(onChange) {
  const nav = document.getElementById('nav');
  const items = getNavItems();
  nav.innerHTML = items.map(item => `
    <button class="${state.currentView === item.key ? 'active' : ''}" data-view="${item.key}">${item.label}</button>
  `).join('');
  nav.querySelectorAll('button').forEach(button => {
    button.addEventListener('click', () => {
      setCurrentView(button.dataset.view);
      onChange(button.dataset.view);
    });
  });
}

function getNavItems() {
  const role = state.user?.role;
  if (role === 'admin') {
    return [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'dispo', label: 'H&B Dispo' },
      { key: 'service', label: 'Serviceberater' },
      { key: 'detailing', label: 'Fahrzeugaufbereitung' },
      { key: 'admin', label: 'Admin' }
    ];
  }
  if (role === 'dispo_holbring') return [{ key: 'dashboard', label: 'Dashboard' }, { key: 'dispo', label: 'H&B Dispo' }];
  if (role === 'kundendienstberater') return [{ key: 'dashboard', label: 'Dashboard' }, { key: 'service', label: 'Serviceberater' }];
  if (role === 'fahrzeugaufbereitung') return [{ key: 'dashboard', label: 'Dashboard' }, { key: 'detailing', label: 'Fahrzeugaufbereitung' }];
  return [{ key: 'dashboard', label: 'Dashboard' }];
}

export function renderHeader() {
  document.getElementById('me-name').textContent = state.user?.display_name || '–';
  document.getElementById('me-role').textContent = roleLabel(state.user?.role || '');
}
