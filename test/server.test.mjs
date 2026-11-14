import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { clearQuotaCache } from '../src/collector.mjs';
import { buildLaunchdPlist, createAppServer, parseCliArgs } from '../src/server.mjs';

function makeMockExec() {
  return async (cmd) => {
    if (cmd === '/usage') {
      return JSON.stringify({
        status: 'SUCCESS',
        command: {
          name: 'usage',
          data: {
            description: 'Rolling windows',
            groups: [
              {
                name: 'Gemini Models',
                description: 'Hydrogen & Flash',
                buckets: [
                  {
                    id: 'gemini-weekly',
                    name: 'Weekly Limit Remaining',
                    window: 'weekly',
                    remaining_fraction: 0.89,
                    reset_time: '2026-11-20T23:57:43Z',
                  },
                  {
                    id: 'gemini-5h',
                    name: 'Five Hour Limit Remaining',
                    window: '5h',
                    remaining_fraction: 0.66,
                    reset_time: '2026-11-14T18:22:19Z',
                  },
                ],
              },
            ],
          },
        },
      });
    }
    if (cmd === '/credits') {
      return JSON.stringify({
        status: 'SUCCESS',
        command: {
          name: 'credits',
          data: { remaining_credits: 0, upgrade_uri: 'https://antigravity.google/g1-upgrade' },
        },
      });
    }
    if (cmd === '/model') {
      return JSON.stringify({
        status: 'SUCCESS',
        command: {
          name: 'model',
          data: {
            id: 'gemini-3.8-flash-medium',
            label: 'Gemini 3.8 Flash (Medium)',
            effort: 'medium',
            is_default: false,
          },
        },
      });
    }
    throw new Error(`Unknown cmd ${cmd}`);
  };
}

test('parseCliArgs and buildLaunchdPlist produce valid config and XML', () => {
  const args = parseCliArgs([
    '--port',
    '4555',
    '--host',
    '127.0.0.1',
    '--peer',
    'http://second-mac.local:4321',
    '--label',
    'Primary Mac',
    '--print-launchd',
  ]);
  assert.equal(args.port, 4555);
  assert.equal(args.host, '127.0.0.1');
  assert.equal(args.peerUrl, 'http://second-mac.local:4321');
  assert.equal(args.label, 'Primary Mac');
  assert.equal(args.printLaunchd, true);

  const plist = buildLaunchdPlist(args);
  assert.match(plist, /<string>com\.antigravity\.pulse<\/string>/);
  assert.match(plist, /<string>4555<\/string>/);
  assert.match(plist, /http:\/\/second-mac\.local:4321/);
});

test('HTTP server serves API endpoints, peer federation, and 4-state static UI', async () => {
  clearQuotaCache();
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-pulse-srv-'));
  const peerTmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-pulse-peer-'));

  let mainServer;
  let peerServer;
  try {
    const convDir = path.join(peerTmpDir, 'brain', 'peer-conv', '.system_generated', 'logs');
    await fsp.mkdir(convDir, { recursive: true });
    await fsp.writeFile(
      path.join(convDir, 'transcript.jsonl'),
      `${JSON.stringify({
        type: 'PLANNER_RESPONSE',
        created_at: new Date().toISOString(),
        model: 'gemini-4-argon-high',
        input_tokens: 2000,
        cache_read_tokens: 6000,
        output_tokens: 500,
        tool_calls: [{ name: 'read_file' }],
      })}\n`,
      'utf8'
    );

    peerServer = createAppServer({
      port: 0,
      label: 'Secondary Mac Peer',
      dataDir: peerTmpDir,
      configFile: path.join(peerTmpDir, 'config.json'),
      historyFile: path.join(peerTmpDir, 'history.json'),
      execFn: makeMockExec(),
    });
    await new Promise((resolve) => peerServer.listen(0, '127.0.0.1', resolve));
    const peerPort = peerServer.address().port;

    mainServer = createAppServer({
      port: 0,
      label: 'Primary Mac Host',
      dataDir: tmpDir,
      configFile: path.join(tmpDir, 'config.json'),
      historyFile: path.join(tmpDir, 'history.json'),
      peerUrl: `http://127.0.0.1:${peerPort}`,
      execFn: makeMockExec(),
    });
    await new Promise((resolve) => mainServer.listen(0, '127.0.0.1', resolve));
    const mainPort = mainServer.address().port;
    const base = `http://127.0.0.1:${mainPort}`;

    const cfgGetRes = await fetch(`${base}/api/config`);
    assert.equal(cfgGetRes.status, 200);
    const cfgInitial = await cfgGetRes.json();
    assert.equal(cfgInitial.config.defaultViewMode, 'overview');
    assert.equal(cfgInitial.config.warningThresholdPercent, 20);
    assert.equal(typeof cfgInitial.diagnostics.agyInstalled, 'boolean');

    const cfgPostRes = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileName: 'Personal Pro',
        label: 'Custom Work Mac',
        warningThresholdPercent: 30,
        showThirdPartyQuotas: false,
      }),
    });
    assert.equal(cfgPostRes.status, 200);
    const cfgSaved = await cfgPostRes.json();
    assert.equal(cfgSaved.ok, true);
    assert.equal(cfgSaved.config.profileName, 'Personal Pro');
    assert.equal(cfgSaved.config.label, 'Custom Work Mac');
    assert.equal(cfgSaved.config.warningThresholdPercent, 30);
    assert.equal(cfgSaved.config.showThirdPartyQuotas, false);

    const healthRes = await fetch(`${base}/api/health`);
    assert.equal(healthRes.status, 200);
    const health = await healthRes.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.label, 'Custom Work Mac');
    assert.equal(health.profileName, 'Personal Pro');

    const summaryRes = await fetch(`${base}/api/summary?window=all`);
    assert.equal(summaryRes.status, 200);
    const summary = await summaryRes.json();
    assert.equal(summary.quota.ok, true);
    assert.equal(summary.quota.flatBuckets.length, 2);
    assert.equal(summary.history.length, 1);
    assert.equal(summary.peer.configured, true);
    assert.equal(summary.peer.online, true);
    assert.equal(summary.peer.data.machine.label, 'Secondary Mac Peer');
    assert.equal(summary.peer.data.telemetry.totals.totalTokens, 8500);

    const historyRes = await fetch(`${base}/api/history`);
    assert.equal(historyRes.status, 200);
    const historyJson = await historyRes.json();
    assert.equal(historyJson.snapshots.length, 1);

    const htmlRes = await fetch(`${base}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /id="view-btn-overview"/);
    assert.match(html, /id="view-btn-advanced"/);
    assert.match(html, /id="view-overview"/);
    assert.match(html, /id="overview-gemini-section"/);
    assert.match(html, /id="overview-gemini-5h-grid"/);
    assert.match(html, /id="overview-gemini-weekly-grid"/);
    assert.match(html, /id="overview-3p-section"/);
    assert.match(html, /id="overview-3p-5h-grid"/);
    assert.match(html, /id="overview-3p-weekly-grid"/);
    assert.match(html, /id="view-advanced"/);
    assert.match(html, /id="state-loading"/);
    assert.match(html, /id="state-empty"/);
    assert.match(html, /id="state-populated"/);
    assert.match(html, /id="state-error"/);
    assert.match(html, /id="theme-toggle"/);
    assert.match(html, /id="settings-open-btn"/);
    assert.match(html, /id="settings-modal"/);

    const cssRes = await fetch(`${base}/styles.css`);
    assert.equal(cssRes.status, 200);
    const jsRes = await fetch(`${base}/app.js`);
    assert.equal(jsRes.status, 200);
    const iconRes = await fetch(`${base}/icon.svg`);
    assert.equal(iconRes.status, 200);
  } finally {
    await new Promise((resolve) => (mainServer ? mainServer.close(resolve) : resolve()));
    await new Promise((resolve) => (peerServer ? peerServer.close(resolve) : resolve()));
    await fsp.rm(tmpDir, { recursive: true, force: true });
    await fsp.rm(peerTmpDir, { recursive: true, force: true });
  }
});
