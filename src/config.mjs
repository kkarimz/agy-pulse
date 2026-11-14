import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveAgyBinary, resolveDefaultDataDir } from './collector.mjs';
import { normalizePeerUrl } from './peer.mjs';

export const DEFAULT_USER_CONFIG = Object.freeze({
  profileName: '',
  label: '',
  peerUrl: '',
  agyBin: '',
  dataDir: '',
  defaultViewMode: 'overview',
  showThirdPartyQuotas: true,
  warningThresholdPercent: 20,
});

export function resolveConfigFile(dataDir, customConfigFile) {
  if (customConfigFile) return customConfigFile;
  if (process.env.AGY_PULSE_CONFIG_FILE) return process.env.AGY_PULSE_CONFIG_FILE;
  return path.join(resolveDefaultDataDir(dataDir), 'agy-pulse-config.json');
}

export function sanitizeUserConfig(raw = {}) {
  const rawThreshold = Number(raw?.warningThresholdPercent);
  const warningThresholdPercent = Number.isFinite(rawThreshold)
    ? Math.max(5, Math.min(80, Math.round(rawThreshold)))
    : DEFAULT_USER_CONFIG.warningThresholdPercent;

  const rawPeer = String(raw?.peerUrl ?? '').trim().slice(0, 200);
  const peerUrl = rawPeer ? (normalizePeerUrl(rawPeer) ?? '') : '';

  return {
    profileName: String(raw?.profileName ?? '').trim().slice(0, 60),
    label: String(raw?.label ?? '').trim().slice(0, 60),
    peerUrl,
    agyBin: String(raw?.agyBin ?? '').trim().slice(0, 300),
    dataDir: String(raw?.dataDir ?? '').trim().slice(0, 300),
    defaultViewMode: raw?.defaultViewMode === 'advanced' ? 'advanced' : 'overview',
    showThirdPartyQuotas:
      raw?.showThirdPartyQuotas === undefined ? true : Boolean(raw.showThirdPartyQuotas),
    warningThresholdPercent,
  };
}

export async function loadUserConfig(configFile) {
  try {
    const content = await fsp.readFile(configFile, 'utf8');
    const parsed = JSON.parse(content);
    return sanitizeUserConfig(parsed);
  } catch {
    return { ...DEFAULT_USER_CONFIG };
  }
}

export async function saveUserConfig(configFile, update = {}) {
  const base = update?.reset ? { ...DEFAULT_USER_CONFIG } : await loadUserConfig(configFile);
  const merged = update?.reset
    ? { ...DEFAULT_USER_CONFIG }
    : sanitizeUserConfig({ ...base, ...update });

  await fsp.mkdir(path.dirname(configFile), { recursive: true });
  const tempFile = `${configFile}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempFile, JSON.stringify(merged, null, 2), 'utf8');
  await fsp.rename(tempFile, configFile);
  return merged;
}

function checkBinaryExists(binOrCmd) {
  if (!binOrCmd) return false;
  if (binOrCmd.includes(path.sep)) {
    return fs.existsSync(binOrCmd);
  }
  const searchDirs = [
    path.join(os.homedir(), '.gemini', 'antigravity-cli', 'bin'),
    path.join(os.homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(process.env.PATH ? process.env.PATH.split(path.delimiter) : []),
  ].filter(Boolean);

  return searchDirs.some((dir) => {
    try {
      return fs.existsSync(path.join(dir, binOrCmd));
    } catch {
      return false;
    }
  });
}

export function diagnoseEnvironment({ agyBin, dataDir } = {}) {
  const resolvedDataDir = resolveDefaultDataDir(dataDir);
  const resolvedBin = resolveAgyBinary(agyBin);

  // Never read token file contents — check only boolean existence
  const oauthTokenPresent = fs.existsSync(path.join(resolvedDataDir, 'antigravity-oauth-token'));
  const databasePresent = fs.existsSync(path.join(resolvedDataDir, 'conversation_summaries.db'));
  const agyInstalled = checkBinaryExists(resolvedBin);

  return {
    agyBin: resolvedBin,
    dataDir: resolvedDataDir,
    agyInstalled,
    oauthTokenPresent,
    databasePresent,
    loginCommand: 'agy',
  };
}
