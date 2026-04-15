export function openModal({ title, body, footer = '' }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-backdrop" id="sf-modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <h3>${title}</h3>
          <button class="btn" id="sf-modal-close">Schließen</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>
  `;
  document.getElementById('sf-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('sf-modal-backdrop')?.addEventListener('click', (event) => {
    if (event.target.id === 'sf-modal-backdrop') closeModal();
  });
}

export function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}
