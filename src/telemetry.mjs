import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';
import { resolveDefaultDataDir } from './collector.mjs';

const execFileAsync = promisify(execFile);

const WINDOW_DURATIONS_MS = {
  '5h': 5 * 3600 * 1000,
  '24h': 24 * 3600 * 1000,
  '7d': 7 * 24 * 3600 * 1000,
  all: 0,
};

export function normalizeWindow(windowStr) {
  if (windowStr === '5h' || windowStr === '24h' || windowStr === '7d' || windowStr === 'all') {
    return windowStr;
  }
  return 'all';
}

function parseSqliteTimestamp(ts) {
  if (!ts) return 0;
  const iso = String(ts).includes('T') ? String(ts) : String(ts).replace(' ', 'T');
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseWorkspaceName(workspaceUris) {
  if (!workspaceUris) return '';
  try {
    const parsed = JSON.parse(workspaceUris);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = String(parsed[0]).replace(/^file:\/\//, '');
      return path.basename(first) || first;
    }
  } catch {
    const raw = String(workspaceUris).replace(/^file:\/\//, '');
    return path.basename(raw) || raw;
  }
  return '';
}

async function readConversationMetadata(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return new Map();
  }

  const sql = `
    SELECT
      conversation_id,
      title,
      step_count,
      last_modified_time,
      workspace_uris,
      agent_name,
      parent_conversation_id,
      killed
    FROM conversation_summaries
    ORDER BY last_modified_time DESC
  `;

  let rows = [];
  try {
    const sqlite = await import('node:sqlite');
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      rows = db.prepare(sql).all();
    } finally {
      db.close();
    }
  } catch {
    // Fallback for Node 20.x environments without node:sqlite
    try {
      const { stdout } = await execFileAsync('sqlite3', ['-readonly', '-json', dbPath, sql], {
        timeout: 5000,
        maxBuffer: 8 * 1024 * 1024,
      });
      rows = stdout.trim() ? JSON.parse(stdout) : [];
    } catch {
      rows = [];
    }
  }

  const map = new Map();
  for (const row of rows) {
    if (!row.conversation_id) continue;
    map.set(row.conversation_id, {
      conversationId: row.conversation_id,
      title: row.title || 'Untitled Conversation',
      stepCount: Number(row.step_count ?? 0),
      lastModifiedTime: row.last_modified_time || null,
      lastModifiedMs: parseSqliteTimestamp(row.last_modified_time),
      workspaceName: parseWorkspaceName(row.workspace_uris),
      workspaceUris: row.workspace_uris || '',
      agentName: row.agent_name || '',
      parentConversationId: row.parent_conversation_id || '',
      killed: Boolean(row.killed),
    });
  }
  return map;
}

async function parseTranscriptFile(filePath, cutoffMs) {
  const stats = {
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    plannerSteps: 0,
    toolCallsCount: 0,
    lastActiveMs: 0,
    byModel: new Map(),
    timelinePoints: [],
  };

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line || !line.includes('"PLANNER_RESPONSE"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type !== 'PLANNER_RESPONSE') continue;

      const createdMs = Date.parse(entry.created_at ?? '');
      if (cutoffMs > 0 && (!Number.isFinite(createdMs) || createdMs < cutoffMs)) {
        continue;
      }

      const inputTokens = Number(entry.input_tokens ?? 0);
      const cacheReadTokens = Number(entry.cache_read_tokens ?? 0);
      const outputTokens = Number(entry.output_tokens ?? 0);
      const toolCalls = Array.isArray(entry.tool_calls) ? entry.tool_calls.length : 0;
      const model = entry.model || 'unknown';

      stats.inputTokens += inputTokens;
      stats.cacheReadTokens += cacheReadTokens;
      stats.outputTokens += outputTokens;
      stats.plannerSteps += 1;
      stats.toolCallsCount += toolCalls;
      if (Number.isFinite(createdMs) && createdMs > stats.lastActiveMs) {
        stats.lastActiveMs = createdMs;
      }

      let modelBucket = stats.byModel.get(model);
      if (!modelBucket) {
        modelBucket = {
          model,
          inputTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
          steps: 0,
          toolCalls: 0,
        };
        stats.byModel.set(model, modelBucket);
      }
      modelBucket.inputTokens += inputTokens;
      modelBucket.cacheReadTokens += cacheReadTokens;
      modelBucket.outputTokens += outputTokens;
      modelBucket.steps += 1;
      modelBucket.toolCalls += toolCalls;

      if (Number.isFinite(createdMs)) {
        stats.timelinePoints.push({
          tsMs: createdMs,
          tokens: inputTokens + cacheReadTokens + outputTokens,
          inputTokens,
          cacheReadTokens,
          outputTokens,
        });
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }

  return stats;
}

function computeCacheEfficiency(inputTokens, cacheReadTokens) {
  const promptTotal = inputTokens + cacheReadTokens;
  if (promptTotal <= 0) return 0;
  return Math.round((cacheReadTokens / promptTotal) * 1000) / 10;
}

function formatTimeBucketKey(tsMs, useHourly) {
  const d = new Date(tsMs);
  if (useHourly) {
    return `${d.toISOString().slice(0, 13)}:00Z`;
  }
  return d.toISOString().slice(0, 10);
}

export async function collectLocalTelemetry({
  dataDir,
  window = 'all',
  nowMs = Date.now(),
  maxConversations = 40,
} = {}) {
  const resolvedDataDir = resolveDefaultDataDir(dataDir);
  const activeWindow = normalizeWindow(window);
  const durationMs = WINDOW_DURATIONS_MS[activeWindow];
  const cutoffMs = durationMs > 0 ? nowMs - durationMs : 0;
  const useHourlyBuckets = activeWindow === '5h' || activeWindow === '24h';

  const dbPath = path.join(resolvedDataDir, 'conversation_summaries.db');
  const brainDir = path.join(resolvedDataDir, 'brain');

  const metadataMap = await readConversationMetadata(dbPath);
  const modelMap = new Map();
  const timeBucketMap = new Map();
  const conversations = [];

  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalOutputTokens = 0;
  let totalPlannerSteps = 0;
  let totalToolCalls = 0;
  let activeConversationsCount = 0;

  let brainEntries = [];
  try {
    brainEntries = await fsp.readdir(brainDir, { withFileTypes: true });
  } catch {
    brainEntries = [];
  }

  const seenConversationIds = new Set();

  await Promise.all(
    brainEntries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const conversationId = entry.name;
        const transcriptPath = path.join(brainDir, conversationId, '.system_generated', 'logs', 'transcript.jsonl');
        if (!fs.existsSync(transcriptPath)) return;

        const stats = await parseTranscriptFile(transcriptPath, cutoffMs);
        if (stats.plannerSteps === 0) return;

        seenConversationIds.add(conversationId);
        activeConversationsCount += 1;
        totalInputTokens += stats.inputTokens;
        totalCacheReadTokens += stats.cacheReadTokens;
        totalOutputTokens += stats.outputTokens;
        totalPlannerSteps += stats.plannerSteps;
        totalToolCalls += stats.toolCallsCount;

        for (const [modelName, mStats] of stats.byModel.entries()) {
          let agg = modelMap.get(modelName);
          if (!agg) {
            agg = {
              model: modelName,
              inputTokens: 0,
              cacheReadTokens: 0,
              outputTokens: 0,
              steps: 0,
              toolCalls: 0,
            };
            modelMap.set(modelName, agg);
          }
          agg.inputTokens += mStats.inputTokens;
          agg.cacheReadTokens += mStats.cacheReadTokens;
          agg.outputTokens += mStats.outputTokens;
          agg.steps += mStats.steps;
          agg.toolCalls += mStats.toolCalls;
        }

        for (const pt of stats.timelinePoints) {
          const key = formatTimeBucketKey(pt.tsMs, useHourlyBuckets);
          let tb = timeBucketMap.get(key);
          if (!tb) {
            tb = {
              bucket: key,
              inputTokens: 0,
              cacheReadTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              steps: 0,
            };
            timeBucketMap.set(key, tb);
          }
          tb.inputTokens += pt.inputTokens;
          tb.cacheReadTokens += pt.cacheReadTokens;
          tb.outputTokens += pt.outputTokens;
          tb.totalTokens += pt.tokens;
          tb.steps += 1;
        }

        const meta = metadataMap.get(conversationId);
        const convTotalTokens = stats.inputTokens + stats.cacheReadTokens + stats.outputTokens;
        const primaryModels = Array.from(stats.byModel.values())
          .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
          .map((m) => m.model);

        conversations.push({
          conversationId,
          title: meta?.title || `Session ${conversationId.slice(0, 8)}`,
          workspaceName: meta?.workspaceName || '',
          stepCount: meta?.stepCount || stats.plannerSteps,
          plannerSteps: stats.plannerSteps,
          toolCallsCount: stats.toolCallsCount,
          inputTokens: stats.inputTokens,
          cacheReadTokens: stats.cacheReadTokens,
          outputTokens: stats.outputTokens,
          totalTokens: convTotalTokens,
          cacheEfficiencyPercent: computeCacheEfficiency(stats.inputTokens, stats.cacheReadTokens),
          models: primaryModels,
          lastActiveAt: stats.lastActiveMs > 0
            ? new Date(stats.lastActiveMs).toISOString()
            : (meta?.lastModifiedTime ?? null),
          lastActiveMs: stats.lastActiveMs || meta?.lastModifiedMs || 0,
        });
      })
  );

  // Include recent SQLite conversations that may not have transcript steps in window when window === 'all'
  if (activeWindow === 'all') {
    for (const [conversationId, meta] of metadataMap.entries()) {
      if (seenConversationIds.has(conversationId)) continue;
      if (meta.stepCount <= 0) continue;
      conversations.push({
        conversationId,
        title: meta.title,
        workspaceName: meta.workspaceName,
        stepCount: meta.stepCount,
        plannerSteps: 0,
        toolCallsCount: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheEfficiencyPercent: 0,
        models: [],
        lastActiveAt: meta.lastModifiedTime,
        lastActiveMs: meta.lastModifiedMs,
      });
    }
  }

  conversations.sort((a, b) => b.lastActiveMs - a.lastActiveMs);

  const byModel = Array.from(modelMap.values())
    .map((m) => {
      const totalTokens = m.inputTokens + m.cacheReadTokens + m.outputTokens;
      return {
        ...m,
        totalTokens,
        cacheEfficiencyPercent: computeCacheEfficiency(m.inputTokens, m.cacheReadTokens),
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);

  const timeline = Array.from(timeBucketMap.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));

  const totalTokens = totalInputTokens + totalCacheReadTokens + totalOutputTokens;

  return {
    window: activeWindow,
    dataDir: resolvedDataDir,
    hasDatabase: fs.existsSync(dbPath),
    hasBrainDir: fs.existsSync(brainDir),
    totals: {
      inputTokens: totalInputTokens,
      cacheReadTokens: totalCacheReadTokens,
      outputTokens: totalOutputTokens,
      totalTokens,
      cacheEfficiencyPercent: computeCacheEfficiency(totalInputTokens, totalCacheReadTokens),
      plannerSteps: totalPlannerSteps,
      toolCallsCount: totalToolCalls,
      conversationsCount: activeConversationsCount,
      indexedConversationsCount: metadataMap.size,
    },
    byModel,
    timeline,
    recentConversations: conversations.slice(0, maxConversations),
  };
}
