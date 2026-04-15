export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function roleLabel(role) {
  const map = {
    admin: 'Admin',
    dispo_holbring: 'H&B Dispo',
    kundendienstberater: 'Kundendienstberater',
    fahrzeugaufbereitung: 'Fahrzeugaufbereitung'
  };
  return map[role] || role;
}

export function statusLabel(status) {
  const map = {
    neu: 'Neu',
    abholung_geplant: 'Abholung geplant',
    unterwegs_zu_uns: 'Unterwegs zu uns',
    eingetroffen: 'Eingetroffen',
    bei_serviceberater: 'Beim Serviceberater',
    service_fertig: 'Service fertig',
    bereit_fuer_reinigung: 'Bereit für Reinigung',
    in_reinigung: 'In Reinigung',
    reinigung_fertig: 'Reinigung fertig',
    bereit_fuer_dispo: 'Bereit für Dispo',
    auslieferung_geplant: 'Auslieferung geplant',
    abgeschlossen: 'Abgeschlossen'
  };
  return map[status] || status;
}

export function formatDate(v) {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('de-AT'); } catch { return v; }
}
