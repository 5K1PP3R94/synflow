import { api } from './api.js';
import { setUser } from './state.js';

export async function login(username, password) {
  const user = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  setUser(user);
  return user;
}

export async function logout() {
  await api('/api/logout', { method: 'POST' });
  setUser(null);
}

export async function restoreSession() {
  try {
    const user = await api('/api/me');
    setUser(user);
    return user;
  } catch {
    return null;
  }
}
