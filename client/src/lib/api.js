import { syncFromServerTime } from './clock';

// Trailing slashes are stripped: paths below all start with "/", so a
// VITE_API_URL of "https://api.example.com/" would otherwise produce
// "https://api.example.com//api/drops" — which Express does not match, and
// which 404s in a way that looks like a CORS problem in the browser console.
const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor({ code, message, details, status }) {
    super(message || 'Request failed.');
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN';
    this.status = status;
    this.details = details;
  }
}

function currentUserId() {
  try {
    const raw = localStorage.getItem('drops.user');
    return raw ? JSON.parse(raw).id : null;
  } catch {
    return null;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const userId = currentUserId();

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(userId ? { 'x-user-id': String(userId) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server. Is the API running?',
      status: 0,
    });
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError({ ...(payload?.error ?? {}), status: response.status });
  }

  syncFromServerTime(payload?.serverTime);
  return payload;
}

export const api = {
  login: (username) => request('/api/auth/login', { method: 'POST', body: { username } }),
  listDrops: () => request('/api/drops'),
  createDrop: (drop) => request('/api/drops', { method: 'POST', body: drop }),
  reserve: (dropId) => request(`/api/drops/${dropId}/reserve`, { method: 'POST' }),
  purchase: (reservationId) => request(`/api/reservations/${reservationId}/purchase`, { method: 'POST' }),
  cancel: (reservationId) => request(`/api/reservations/${reservationId}/cancel`, { method: 'POST' }),
  myReservations: () => request('/api/reservations/mine'),
};
