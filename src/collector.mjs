import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const quotaCache = new Map();

export function clearQuotaCache() {
  quotaCache.clear();
}

export function resolveDefaultDataDir(customDir) {
  if (customDir) return customDir;
  if (process.env.AGY_DATA_DIR) return process.env.AGY_DATA_DIR;
  return path.join(os.homedir(), '.gemini', 'antigravity-cli');
}

export function resolveAgyBinary(customPath) {
  const candidates = [
    customPath,
    process.env.AGY_BIN,
    path.join(os.homedir(), '.gemini', 'antigravity-cli', 'bin', 'agy'),
    path.join(os.homedir(), '.local', 'bin', 'agy'),
    '/opt/homebrew/bin/agy',
    '/usr/local/bin/agy',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore inaccessible candidate paths
    }
  }
  return 'agy';
}

export function parseAgyJsonOutput(stdout) {
  const raw = String(stdout ?? '').trim();
  if (!raw) {
    throw new Error('Empty output from agy CLI');
  }

  try {
    return JSON.parse(raw);
  } catch {
    // Strip ANSI escape sequences and scan lines from bottom up for JSON object
    const cleaned = raw.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
    const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i].startsWith('{') && lines[i].endsWith('}')) {
        return JSON.parse(lines[i]);
      }
    }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Unable to locate JSON payload in agy CLI output');
  }
}

export function calculateBucketPace(bucket, nowMs = Date.now()) {
  const windowType = bucket.window === '5h' ? '5h' : 'weekly';
  const windowHours = windowType === '5h' ? 5 : 168;
  const windowDurationMs = windowHours * 3600 * 1000;

  const resetMs = Date.parse(bucket.reset_time ?? '');
  const hasValidReset = Number.isFinite(resetMs);
  const msUntilReset = hasValidReset ? Math.max(0, resetMs - nowMs) : 0;
  const elapsedMs = hasValidReset
    ? Math.max(0, Math.min(windowDurationMs, windowDurationMs - msUntilReset))
    : 0;
  const elapsedFraction = windowDurationMs > 0 ? elapsedMs / windowDurationMs : 0;

  const rawRemaining = Number(bucket.remaining_fraction ?? 0);
  const remainingFraction = Number.isFinite(rawRemaining)
    ? Math.max(0, Math.min(1, rawRemaining))
    : 0;
  const usedFraction = 1 - remainingFraction;

  const remainingPercent = Math.round(remainingFraction * 1000) / 10;
  const usedPercent = Math.round(usedFraction * 1000) / 10;
  const elapsedPercent = Math.round(elapsedFraction * 1000) / 10;
  const paceDelta = usedFraction - elapsedFraction;

  let paceStatus = 'safe';
  let paceLabel = 'Safe';
  if (remainingFraction <= 0.15 || paceDelta > 0.12) {
    paceStatus = 'burning_fast';
    paceLabel = 'Burning Fast';
  } else if (paceDelta > -0.05) {
    paceStatus = 'on_pace';
    paceLabel = 'On Pace';
  }

  let msToExhaustion = null;
  let willExhaustBeforeReset = false;
  let projectedExhaustionAt = null;
  if (usedFraction > 0.01 && elapsedMs > 60_000 && remainingFraction > 0) {
    const burnRatePerMs = usedFraction / elapsedMs;
    if (burnRatePerMs > 0) {
      msToExhaustion = Math.round(remainingFraction / burnRatePerMs);
      willExhaustBeforeReset = hasValidReset ? msToExhaustion < msUntilReset : false;
      projectedExhaustionAt = new Date(nowMs + msToExhaustion).toISOString();
    }
  } else if (remainingFraction <= 0) {
    msToExhaustion = 0;
    willExhaustBeforeReset = true;
    projectedExhaustionAt = new Date(nowMs).toISOString();
  }

  return {
    id: bucket.id,
    name: bucket.name,
    description: bucket.description ?? '',
    window: windowType,
    windowHours,
    resetTime: bucket.reset_time ?? null,
    msUntilReset,
    elapsedMs,
    elapsedFraction,
    elapsedPercent,
    remainingFraction,
    remainingPercent,
    usedFraction,
    usedPercent,
    paceDelta: Math.round(paceDelta * 1000) / 1000,
    paceStatus,
    paceLabel,
    msToExhaustion,
    willExhaustBeforeReset,
    projectedExhaustionAt,
  };
}

export async function parseSettingsFile(dataDir) {
  const settingsPath = path.join(resolveDefaultDataDir(dataDir), 'settings.json');
  try {
    const content = await fsp.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(content);
    return {
      exists: true,
      useG1Credits: Boolean(parsed.useG1Credits),
      modelSelection: parsed.model ?? null,
    };
  } catch {
    return {
      exists: false,
      useG1Credits: false,
      modelSelection: null,
    };
  }
}

async function defaultExecAgy(agyBin, commandText, timeoutMs) {
  const args = ['-p', commandText, '--output-format', 'json', '--print-timeout', '10s'];
  const env = {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/local/bin:${path.join(os.homedir(), '.local', 'bin')}:${process.env.PATH ?? ''}`,
  };
  const { stdout } = await execFileAsync(agyBin, args, {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    env,
  });
  return stdout;
}

export async function collectLiveQuota({
  agyBin,
  dataDir,
  timeoutMs = 12000,
  forceRefresh = false,
  cacheTtlMs = 30000,
  nowMs = Date.now(),
  execFn,
} = {}) {
  const resolvedBin = resolveAgyBinary(agyBin);
  const resolvedDataDir = resolveDefaultDataDir(dataDir);
  const cacheKey = `${resolvedBin}::${resolvedDataDir}`;

  if (!forceRefresh && cacheTtlMs > 0 && !execFn) {
    const cached = quotaCache.get(cacheKey);
    if (cached && nowMs - cached.cachedAt < cacheTtlMs) {
      return {
        ...cached.payload,
        fromCache: true,
      };
    }
  }

  const runner = execFn ?? ((cmd) => defaultExecAgy(resolvedBin, cmd, timeoutMs));
  const errors = [];

  const [usageRes, creditsRes, modelRes, settings] = await Promise.all([
    runner('/usage').then(parseAgyJsonOutput).catch((err) => {
      errors.push({ source: '/usage', message: err.message });
      return null;
    }),
    runner('/credits').then(parseAgyJsonOutput).catch((err) => {
      errors.push({ source: '/credits', message: err.message });
      return null;
    }),
    runner('/model').then(parseAgyJsonOutput).catch((err) => {
      errors.push({ source: '/model', message: err.message });
      return null;
    }),
    parseSettingsFile(resolvedDataDir),
  ]);

  const usageData = usageRes?.command?.data ?? {};
  const rawGroups = Array.isArray(usageData.groups) ? usageData.groups : [];
  const flatBuckets = [];

  const groups = rawGroups.map((group) => {
    const buckets = (Array.isArray(group.buckets) ? group.buckets : []).map((bucket) => {
      const normalized = calculateBucketPace(bucket, nowMs);
      flatBuckets.push({
        groupName: group.name,
        ...normalized,
      });
      return normalized;
    });

    return {
      name: group.name,
      description: group.description ?? '',
      buckets,
    };
  });

  const creditsData = creditsRes?.command?.data ?? {};
  const modelData = modelRes?.command?.data ?? {};

  const payload = {
    ok: groups.length > 0,
    fromCache: false,
    fetchedAt: new Date(nowMs).toISOString(),
    agyBin: resolvedBin,
    description: usageData.description ?? '',
    groups,
    flatBuckets,
    credits: {
      remainingCredits: Number(creditsData.remaining_credits ?? 0),
      upgradeUri: creditsData.upgrade_uri ?? 'https://antigravity.google/g1-upgrade',
      useG1Credits: settings.useG1Credits,
    },
    activeModel: {
      id: modelData.id ?? settings.modelSelection ?? null,
      label: modelData.label ?? settings.modelSelection ?? 'Unknown',
      effort: modelData.effort ?? null,
      isDefault: Boolean(modelData.is_default),
    },
    errors,
  };

  if (payload.ok && cacheTtlMs > 0 && !execFn) {
    quotaCache.set(cacheKey, {
      cachedAt: nowMs,
      payload,
    });
  }

  return payload;
}
