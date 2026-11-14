import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  collectLiveQuota,
  clearQuotaCache,
  resolveAgyBinary,
  resolveDefaultDataDir,
} from './collector.mjs';
import {
  diagnoseEnvironment,
  loadUserConfig,
  resolveConfigFile,
  saveUserConfig,
} from './config.mjs';
import {
  getQuotaHistory,
  recordQuotaSnapshot,
  resolveHistoryFile,
} from './history.mjs';
import { fetchPeerTelemetry, normalizePeerUrl } from './peer.mjs';
import { collectLocalTelemetry, normalizeWindow } from './telemetry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

export function parseCliArgs(argv = process.argv.slice(2)) {
  const parsed = {
    port: Number(process.env.PORT ?? 4321),
    host: process.env.HOST ?? '0.0.0.0',
    peerUrl: process.env.PEER_MAC_URL ?? '',
    label: process.env.MAC_LABEL ?? os.hostname().replace(/\.local$/i, ''),
    dataDir: process.env.AGY_DATA_DIR ?? '',
    agyBin: process.env.AGY_BIN ?? '',
    printLaunchd: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' && argv[i + 1]) {
      parsed.port = Number(argv[++i]);
    } else if (arg.startsWith('--port=')) {
      parsed.port = Number(arg.split('=')[1]);
    } else if (arg === '--host' && argv[i + 1]) {
      parsed.host = argv[++i];
    } else if (arg.startsWith('--host=')) {
      parsed.host = arg.split('=')[1];
    } else if (arg === '--peer' && argv[i + 1]) {
      parsed.peerUrl = argv[++i];
    } else if (arg.startsWith('--peer=')) {
      parsed.peerUrl = arg.split('=')[1];
    } else if (arg === '--label' && argv[i + 1]) {
      parsed.label = argv[++i];
    } else if (arg.startsWith('--label=')) {
      parsed.label = arg.split('=')[1];
    } else if (arg === '--data-dir' && argv[i + 1]) {
      parsed.dataDir = argv[++i];
    } else if (arg.startsWith('--data-dir=')) {
      parsed.dataDir = arg.split('=')[1];
    } else if (arg === '--agy-bin' && argv[i + 1]) {
      parsed.agyBin = argv[++i];
    } else if (arg === '--print-launchd') {
      parsed.printLaunchd = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    }
  }

  if (!Number.isFinite(parsed.port) || parsed.port < 0 || parsed.port > 65535) {
    parsed.port = 4321;
  }

  return parsed;
}

export function getLanIpv4() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}

function resolveStableNodePath() {
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return process.execPath;
}

export function buildLaunchdPlist({
  nodePath = resolveStableNodePath(),
  serverPath = __filename,
  port = 4321,
  host = '0.0.0.0',
  peerUrl = '',
  label = os.hostname().replace(/\.local$/i, ''),
  logDir = path.join(os.homedir(), 'Library', 'Logs'),
} = {}) {
  const escapeXml = (str) =>
    String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

  const pathEnv = `/opt/homebrew/bin:/usr/local/bin:${path.join(os.homedir(), '.local', 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.antigravity.pulse</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(serverPath)}</string>
    <string>--port</string>
    <string>${escapeXml(String(port))}</string>
    <string>--host</string>
    <string>${escapeXml(host)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(PROJECT_ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(pathEnv)}</string>
    <key>PORT</key>
    <string>${escapeXml(String(port))}</string>
    <key>HOST</key>
    <string>${escapeXml(host)}</string>
    <key>MAC_LABEL</key>
    <string>${escapeXml(label)}</string>
    <key>PEER_MAC_URL</key>
    <string>${escapeXml(peerUrl || '')}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(logDir, 'agy-pulse.out.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(logDir, 'agy-pulse.err.log'))}</string>
</dict>
</plist>
`;
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req, maxBytes = 65536) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error('Request body too large');
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

async function serveStaticFile(res, reqPathname) {
  const cleanPath = reqPathname === '/' ? '/index.html' : reqPathname;
  const targetPath = path.resolve(PUBLIC_DIR, `.${cleanPath}`);
  if (!targetPath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const stat = await fsp.stat(targetPath);
    if (!stat.isFile()) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const ext = path.extname(targetPath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const data = await fsp.readFile(targetPath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
      'Content-Length': data.length,
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

export function createAppServer(options = {}) {
  const baseDataDir = resolveDefaultDataDir(options.dataDir);
  const baseAgyBin = resolveAgyBinary(options.agyBin);
  const configFile = resolveConfigFile(baseDataDir, options.configFile);
  const defaultPeerUrl = normalizePeerUrl(options.peerUrl);
  const baseLabel = options.label || os.hostname().replace(/\.local$/i, '');
  const startedAtMs = Date.now();
  const execFn = options.execFn;
  const fetchFn = options.fetchFn ?? fetch;

  const resolveRuntime = async () => {
    const userConfig = await loadUserConfig(configFile);
    const dataDir = userConfig.dataDir || baseDataDir;
    const agyBin = userConfig.agyBin ? resolveAgyBinary(userConfig.agyBin) : baseAgyBin;
    const historyFile = options.historyFile || resolveHistoryFile(dataDir);
    const label = userConfig.label || baseLabel;
    const peerUrl = userConfig.peerUrl ? normalizePeerUrl(userConfig.peerUrl) : defaultPeerUrl;
    return {
      userConfig,
      dataDir,
      agyBin,
      historyFile,
      label,
      peerUrl,
    };
  };

  const getMachineInfo = (actualPort, runtime) => {
    const lanIp = getLanIpv4();
    const effectivePort = actualPort ?? options.port ?? 4321;
    return {
      status: 'ok',
      appName: 'Antigravity Pulse',
      version: '1.0.0',
      hostname: os.hostname(),
      label: runtime.label,
      profileName: runtime.userConfig.profileName || null,
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      lanIp,
      port: effectivePort,
      localUrl: `http://localhost:${effectivePort}`,
      lanUrl: lanIp ? `http://${lanIp}:${effectivePort}` : null,
      uptimeSeconds: Math.round((Date.now() - startedAtMs) / 1000),
      agyBin: runtime.agyBin,
      dataDir: runtime.dataDir,
      defaultPeerUrl: runtime.peerUrl,
    };
  };

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const address = server.address();
    const boundPort = typeof address === 'object' && address ? address.port : (options.port ?? 4321);

    try {
      const runtime = await resolveRuntime();

      if (pathname === '/api/config') {
        if (req.method === 'GET') {
          sendJson(res, 200, {
            config: runtime.userConfig,
            diagnostics: diagnoseEnvironment({ agyBin: runtime.agyBin, dataDir: runtime.dataDir }),
          });
          return;
        }
        if (req.method === 'POST') {
          let body;
          try {
            body = await readJsonBody(req);
          } catch (err) {
            sendJson(res, 400, { error: err?.message || 'Invalid JSON body' });
            return;
          }
          const updated = await saveUserConfig(configFile, body);
          clearQuotaCache();
          const nextDataDir = updated.dataDir || baseDataDir;
          const nextAgyBin = updated.agyBin ? resolveAgyBinary(updated.agyBin) : baseAgyBin;
          sendJson(res, 200, {
            ok: true,
            config: updated,
            diagnostics: diagnoseEnvironment({ agyBin: nextAgyBin, dataDir: nextDataDir }),
          });
          return;
        }
      }

      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method Not Allowed' });
        return;
      }

      if (pathname === '/api/health') {
        sendJson(res, 200, getMachineInfo(boundPort, runtime));
        return;
      }

      if (pathname === '/api/history') {
        const limit = Number(url.searchParams.get('limit') ?? 120);
        const snapshots = await getQuotaHistory(runtime.historyFile, Number.isFinite(limit) ? limit : 120);
        sendJson(res, 200, { snapshots });
        return;
      }

      if (pathname === '/api/peer') {
        const window = normalizeWindow(url.searchParams.get('window'));
        const telemetry = await collectLocalTelemetry({ dataDir: runtime.dataDir, window });
        sendJson(res, 200, {
          machine: getMachineInfo(boundPort, runtime),
          telemetry,
        });
        return;
      }

      if (pathname === '/api/summary') {
        const window = normalizeWindow(url.searchParams.get('window'));
        const forceRefresh = url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true';
        const peerOverride = url.searchParams.get('peer');
        const activePeer = peerOverride !== null ? normalizePeerUrl(peerOverride) : runtime.peerUrl;

        const [quota, telemetry, peer] = await Promise.all([
          collectLiveQuota({
            agyBin: runtime.agyBin,
            dataDir: runtime.dataDir,
            forceRefresh,
            execFn,
          }),
          collectLocalTelemetry({ dataDir: runtime.dataDir, window }),
          fetchPeerTelemetry(activePeer, window, { fetchFn }),
        ]);

        const history = await recordQuotaSnapshot(runtime.historyFile, quota);

        sendJson(res, 200, {
          generatedAt: new Date().toISOString(),
          machine: getMachineInfo(boundPort, runtime),
          config: runtime.userConfig,
          diagnostics: diagnoseEnvironment({ agyBin: runtime.agyBin, dataDir: runtime.dataDir }),
          quota,
          telemetry,
          history,
          peer,
        });
        return;
      }

      await serveStaticFile(res, pathname);
    } catch (err) {
      sendJson(res, 500, {
        error: err?.message || 'Internal Server Error',
      });
    }
  });

  return server;
}

function printHelp() {
  console.log(`Antigravity Pulse (agy-pulse) v1.0.0

Usage:
  node src/server.mjs [options]

Options:
  --port <number>      Port to listen on (default: 4321, env: PORT)
  --host <address>     Bind host (default: 0.0.0.0, env: HOST)
  --peer <url>         Optional second Mac URL for side-by-side comparison (env: PEER_MAC_URL)
  --label <name>       Friendly machine label (default: hostname, env: MAC_LABEL)
  --data-dir <path>    Antigravity data directory (default: ~/.gemini/antigravity-cli, env: AGY_DATA_DIR)
  --agy-bin <path>     Path to agy binary (env: AGY_BIN)
  --print-launchd      Print a ready-to-use macOS launchd plist to stdout and exit
  --help, -h           Show this help message
`);
}

function isExecutedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isExecutedDirectly()) {
  const args = parseCliArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.printLaunchd) {
    process.stdout.write(buildLaunchdPlist(args));
    process.exit(0);
  }

  const server = createAppServer(args);
  server.listen(args.port, args.host, () => {
    const lanIp = getLanIpv4();
    console.log(`Antigravity Pulse (${args.label}) listening on:`);
    console.log(`  Local:   http://localhost:${args.port}`);
    if (lanIp) {
      console.log(`  Network: http://${lanIp}:${args.port}`);
    }
    if (args.peerUrl) {
      console.log(`  Peer:    ${normalizePeerUrl(args.peerUrl) ?? args.peerUrl}`);
    }
  });
}
