import { normalizeWindow } from './telemetry.mjs';

export function normalizePeerUrl(rawUrl) {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export async function fetchPeerTelemetry(peerUrl, window = 'all', {
  timeoutMs = 4000,
  fetchFn = fetch,
} = {}) {
  const origin = normalizePeerUrl(peerUrl);
  if (!origin) {
    return {
      configured: false,
      online: false,
      peerUrl: null,
      data: null,
      error: null,
    };
  }

  const activeWindow = normalizeWindow(window);
  const endpoint = `${origin}/api/peer?window=${encodeURIComponent(activeWindow)}`;

  try {
    const response = await fetchFn(endpoint, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return {
        configured: true,
        online: false,
        peerUrl: origin,
        data: null,
        error: `Peer responded with HTTP ${response.status}`,
      };
    }

    const payload = await response.json();
    return {
      configured: true,
      online: true,
      peerUrl: origin,
      data: payload,
      error: null,
    };
  } catch (err) {
    return {
      configured: true,
      online: false,
      peerUrl: origin,
      data: null,
      error: err?.message || 'Peer unreachable',
    };
  }
}
