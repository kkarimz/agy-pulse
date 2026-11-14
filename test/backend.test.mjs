import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  calculateBucketPace,
  clearQuotaCache,
  collectLiveQuota,
  parseAgyJsonOutput,
} from '../src/collector.mjs';
import { getQuotaHistory, recordQuotaSnapshot } from '../src/history.mjs';
import { fetchPeerTelemetry, normalizePeerUrl } from '../src/peer.mjs';
import { collectLocalTelemetry } from '../src/telemetry.mjs';

test('parseAgyJsonOutput handles clean JSON and spinner-prefixed JSON', () => {
  const clean = parseAgyJsonOutput('{"status":"SUCCESS","command":{"name":"credits","data":{"remaining_credits":5}}}');
  assert.equal(clean.command.data.remaining_credits, 5);

  const noisy = parseAgyJsonOutput('\u001b[36m⠋ Fetching...\u001b[0m\n{"status":"SUCCESS","command":{"name":"model","data":{"id":"gemini-4-argon-high"}}}');
  assert.equal(noisy.command.data.id, 'gemini-4-argon-high');
});

test('calculateBucketPace classifies Safe, On Pace, and Burning Fast accurately', () => {
  const nowMs = Date.parse('2026-11-14T15:00:00Z');

  // 5h window: 2.5h left => 50% elapsed. 90% remaining (10% used) => paceDelta = -0.40 => Safe
  const safe = calculateBucketPace({
    id: 'gemini-5h',
    name: 'Five Hour Limit Remaining',
    window: '5h',
    remaining_fraction: 0.9,
    reset_time: '2026-11-14T17:30:00Z',
  }, nowMs);
  assert.equal(safe.paceStatus, 'safe');
  assert.equal(safe.remainingPercent, 90);
  assert.equal(safe.elapsedPercent, 50);
  assert.equal(safe.willExhaustBeforeReset, false);

  // 5h window: 2.5h left => 50% elapsed. 45% remaining (55% used) => paceDelta = +0.05 => On Pace
  const onPace = calculateBucketPace({
    id: 'gemini-5h',
    name: 'Five Hour Limit Remaining',
    window: '5h',
    remaining_fraction: 0.45,
    reset_time: '2026-11-14T17:30:00Z',
  }, nowMs);
  assert.equal(onPace.paceStatus, 'on_pace');
  assert.equal(onPace.willExhaustBeforeReset, true);

  // Weekly window: 6 days left => ~14.3% elapsed. 19% remaining (81% used) => paceDelta > 0.12 => Burning Fast
  const burning = calculateBucketPace({
    id: '3p-weekly',
    name: 'Weekly Limit Remaining',
    window: 'weekly',
    remaining_fraction: 0.19,
    reset_time: '2026-11-20T15:00:00Z',
  }, nowMs);
  assert.equal(burning.paceStatus, 'burning_fast');
  assert.equal(burning.paceLabel, 'Burning Fast');
  assert.equal(burning.willExhaustBeforeReset, true);
});

test('collectLiveQuota normalizes groups, credits, model, and settings.json', async () => {
  clearQuotaCache();
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-pulse-quota-'));
  try {
    await fsp.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({ useG1Credits: true, model: 'gemini-4-argon-high' }),
      'utf8'
    );

    const mockExec = async (cmd) => {
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
            data: {
              remaining_credits: 42,
              upgrade_uri: 'https://antigravity.google/g1-upgrade',
            },
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
      throw new Error(`Unexpected command ${cmd}`);
    };

    const result = await collectLiveQuota({
      dataDir: tmpDir,
      nowMs: Date.parse('2026-11-14T15:00:00Z'),
      execFn: mockExec,
    });

    assert.equal(result.ok, true);
    assert.equal(result.groups.length, 1);
    assert.equal(result.flatBuckets[0].remainingPercent, 89);
    assert.equal(result.credits.remainingCredits, 42);
    assert.equal(result.credits.useG1Credits, true);
    assert.equal(result.activeModel.id, 'gemini-3.8-flash-medium');
    assert.equal(result.errors.length, 0);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});

test('collectLocalTelemetry aggregates SQLite metadata and JSONL transcript tokens by window', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-pulse-telemetry-'));
  try {
    const convId = 'conv-1234-abcd';
    const logDir = path.join(tmpDir, 'brain', convId, '.system_generated', 'logs');
    await fsp.mkdir(logDir, { recursive: true });

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(tmpDir, 'conversation_summaries.db'));
    db.exec(`
      CREATE TABLE conversation_summaries (
        conversation_id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        step_count INTEGER NOT NULL DEFAULT 0,
        last_modified_time DATETIME NOT NULL,
        workspace_uris TEXT NOT NULL DEFAULT '',
        agent_name TEXT NOT NULL DEFAULT '',
        parent_conversation_id TEXT NOT NULL DEFAULT '',
        killed NUMERIC NOT NULL DEFAULT 0
      );
    `);
    db.prepare(
      'INSERT INTO conversation_summaries (conversation_id, title, step_count, last_modified_time, workspace_uris) VALUES (?, ?, ?, ?, ?)'
    ).run(convId, 'Build Quota Dashboard', 12, '2026-11-14 14:10:00+00:00', '["file:///workspace/agy-pulse"]');
    db.close();

    const lines = [
      JSON.stringify({
        type: 'USER_INPUT',
        created_at: '2026-11-14T14:00:00Z',
        content: 'Build app',
      }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-14T14:05:00Z',
        model: 'gemini-4-argon-high',
        input_tokens: 1000,
        cache_read_tokens: 3000,
        output_tokens: 500,
        tool_calls: [{ name: 'run_command' }, { name: 'write_file' }],
      }),
      JSON.stringify({
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-01T10:00:00Z',
        model: 'gemini-3.8-flash-medium',
        input_tokens: 400,
        cache_read_tokens: 0,
        output_tokens: 100,
        tool_calls: [],
      }),
    ];
    await fsp.writeFile(path.join(logDir, 'transcript.jsonl'), `${lines.join('\n')}\n`, 'utf8');

    const nowMs = Date.parse('2026-11-14T15:00:00Z');
    const recent = await collectLocalTelemetry({ dataDir: tmpDir, window: '5h', nowMs });
    assert.equal(recent.totals.inputTokens, 1000);
    assert.equal(recent.totals.cacheReadTokens, 3000);
    assert.equal(recent.totals.outputTokens, 500);
    assert.equal(recent.totals.totalTokens, 4500);
    assert.equal(recent.totals.cacheEfficiencyPercent, 75);
    assert.equal(recent.totals.toolCallsCount, 2);
    assert.equal(recent.recentConversations[0].title, 'Build Quota Dashboard');
    assert.equal(recent.recentConversations[0].workspaceName, 'agy-pulse');

    const all = await collectLocalTelemetry({ dataDir: tmpDir, window: 'all', nowMs });
    assert.equal(all.totals.totalTokens, 5000);
    assert.equal(all.byModel.length, 2);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});

test('recordQuotaSnapshot persists and deduplicates snapshots cleanly', async () => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agy-pulse-history-'));
  const historyFile = path.join(tmpDir, 'agy-pulse-history.json');
  try {
    const sample = {
      ok: true,
      flatBuckets: [{ id: 'gemini-5h', remainingPercent: 66.2 }],
      credits: { remainingCredits: 0 },
    };
    const t0 = Date.parse('2026-11-14T14:00:00Z');
    await recordQuotaSnapshot(historyFile, sample, { nowMs: t0 });
    // Within 60s and unchanged => deduplicated
    await recordQuotaSnapshot(historyFile, sample, { nowMs: t0 + 15_000 });
    let history = await getQuotaHistory(historyFile);
    assert.equal(history.length, 1);

    // Value changed => recorded immediately
    const changed = {
      ok: true,
      flatBuckets: [{ id: 'gemini-5h', remainingPercent: 64.5 }],
      credits: { remainingCredits: 0 },
    };
    await recordQuotaSnapshot(historyFile, changed, { nowMs: t0 + 20_000 });
    history = await getQuotaHistory(historyFile);
    assert.equal(history.length, 2);
    assert.equal(history[1].buckets['gemini-5h'], 64.5);
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
});

test('fetchPeerTelemetry handles URL normalization, online peer, and offline peer gracefully', async () => {
  assert.equal(normalizePeerUrl('second-mac.local:4321'), 'http://second-mac.local:4321');
  assert.equal(normalizePeerUrl(''), null);

  const online = await fetchPeerTelemetry('http://10.0.0.50:4321', '24h', {
    fetchFn: async (url) => {
      assert.equal(url, 'http://10.0.0.50:4321/api/peer?window=24h');
      return {
        ok: true,
        json: async () => ({ machine: { hostname: 'second-mac' }, telemetry: { totals: { totalTokens: 9000 } } }),
      };
    },
  });
  assert.equal(online.configured, true);
  assert.equal(online.online, true);
  assert.equal(online.data.machine.hostname, 'second-mac');

  const offline = await fetchPeerTelemetry('http://10.0.0.50:4321', '24h', {
    fetchFn: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(offline.configured, true);
  assert.equal(offline.online, false);
  assert.match(offline.error, /ECONNREFUSED/);
});
