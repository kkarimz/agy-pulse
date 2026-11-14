import fsp from 'node:fs/promises';
import path from 'node:path';
import { resolveDefaultDataDir } from './collector.mjs';

export function resolveHistoryFile(dataDir, customHistoryFile) {
  if (customHistoryFile) return customHistoryFile;
  if (process.env.AGY_PULSE_HISTORY_FILE) return process.env.AGY_PULSE_HISTORY_FILE;
  return path.join(resolveDefaultDataDir(dataDir), 'agy-pulse-history.json');
}

export async function getQuotaHistory(historyFile, limit = 120) {
  try {
    const raw = await fsp.readFile(historyFile, 'utf8');
    const parsed = JSON.parse(raw);
    const snapshots = Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
    if (limit > 0 && snapshots.length > limit) {
      return snapshots.slice(-limit);
    }
    return snapshots;
  } catch {
    return [];
  }
}

export async function recordQuotaSnapshot(historyFile, liveQuota, {
  maxEntries = 500,
  minIntervalMs = 60_000,
  nowMs = Date.now(),
} = {}) {
  if (!liveQuota?.ok || !Array.isArray(liveQuota.flatBuckets) || liveQuota.flatBuckets.length === 0) {
    return getQuotaHistory(historyFile);
  }

  const buckets = {};
  for (const bucket of liveQuota.flatBuckets) {
    if (bucket.id) {
      buckets[bucket.id] = bucket.remainingPercent;
    }
  }

  const existing = await getQuotaHistory(historyFile, 0);
  const latest = existing.length > 0 ? existing[existing.length - 1] : null;

  let shouldAppend = !latest;
  if (latest) {
    const lastMs = Date.parse(latest.timestamp ?? '');
    const elapsed = Number.isFinite(lastMs) ? nowMs - lastMs : minIntervalMs;
    const changed = Object.entries(buckets).some(([id, pct]) => {
      const prev = latest.buckets?.[id];
      return typeof prev !== 'number' || Math.abs(prev - pct) >= 0.1;
    });
    shouldAppend = elapsed >= minIntervalMs || changed;
  }

  if (!shouldAppend) {
    return existing.slice(-120);
  }

  const next = [
    ...existing,
    {
      timestamp: new Date(nowMs).toISOString(),
      buckets,
      remainingCredits: liveQuota.credits?.remainingCredits ?? 0,
    },
  ];

  const trimmed = next.length > maxEntries ? next.slice(-maxEntries) : next;

  await fsp.mkdir(path.dirname(historyFile), { recursive: true });
  const tempFile = `${historyFile}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempFile, JSON.stringify({ snapshots: trimmed }, null, 2), 'utf8');
  await fsp.rename(tempFile, historyFile);

  return trimmed.slice(-120);
}
