const STORAGE_THEME_KEY = 'agy_pulse_theme';
const STORAGE_PEER_KEY = 'agy_pulse_peer_url';
const STORAGE_VIEW_KEY = 'agy_pulse_view_mode';

const state = {
  viewMode: localStorage.getItem(STORAGE_VIEW_KEY) === 'advanced' ? 'advanced' : 'overview',
  hasManualViewChoice: localStorage.getItem(STORAGE_VIEW_KEY) !== null,
  window: 'all',
  peerUrl: localStorage.getItem(STORAGE_PEER_KEY) || '',
  qaOverride: 'auto',
  autoRefreshMs: 60000,
  searchQuery: '',
  summary: null,
  config: null,
  diagnostics: null,
  lastError: null,
  timerId: null,
  countdownTimerId: null,
};

const el = {
  machinePill: document.getElementById('machine-pill'),
  profilePill: document.getElementById('profile-pill'),
  networkSubtitle: document.getElementById('network-subtitle'),
  modelPill: document.getElementById('model-pill'),
  creditsPill: document.getElementById('credits-pill'),
  viewBtnOverview: document.getElementById('view-btn-overview'),
  viewBtnAdvanced: document.getElementById('view-btn-advanced'),
  windowControlGroup: document.getElementById('window-control-group'),
  viewOverview: document.getElementById('view-overview'),
  viewAdvanced: document.getElementById('view-advanced'),
  overviewToAdvancedBtn: document.getElementById('overview-to-advanced-btn'),
  overviewGemini5hGrid: document.getElementById('overview-gemini-5h-grid'),
  overviewGeminiWeeklyGrid: document.getElementById('overview-gemini-weekly-grid'),
  overview3pSection: document.getElementById('overview-3p-section'),
  overview3p5hGrid: document.getElementById('overview-3p-5h-grid'),
  overview3pWeeklyGrid: document.getElementById('overview-3p-weekly-grid'),
  overviewSummaryStrip: document.getElementById('overview-summary-strip'),
  refreshBtn: document.getElementById('refresh-btn'),
  refreshLabel: document.getElementById('refresh-label'),
  themeToggle: document.getElementById('theme-toggle'),
  themeIcon: document.getElementById('theme-icon'),
  themeLabel: document.getElementById('theme-label'),
  settingsOpenBtn: document.getElementById('settings-open-btn'),
  autoRefreshSelect: document.getElementById('auto-refresh-select'),
  qaStateSelect: document.getElementById('qa-state-select'),

  stateLoading: document.getElementById('state-loading'),
  stateError: document.getElementById('state-error'),
  stateEmpty: document.getElementById('state-empty'),
  statePopulated: document.getElementById('state-populated'),

  errorTitle: document.getElementById('error-title'),
  errorMessage: document.getElementById('error-message'),
  errorRetryBtn: document.getElementById('error-retry-btn'),
  errorSettingsBtn: document.getElementById('error-settings-btn'),
  emptyMessage: document.getElementById('empty-message'),
  emptyResetWindow: document.getElementById('empty-reset-window'),

  quotaWarningBanner: document.getElementById('quota-warning-banner'),
  lowQuotaAlertBanner: document.getElementById('low-quota-alert-banner'),
  quotaPolicyDesc: document.getElementById('quota-policy-desc'),
  quotaGroupsGrid: document.getElementById('quota-groups-grid'),
  telemetrySection: document.getElementById('telemetry-section'),
  conversationsSection: document.getElementById('conversations-section'),
  kpiGrid: document.getElementById('kpi-grid'),
  historyCountBadge: document.getElementById('history-count-badge'),
  quotaHistoryChart: document.getElementById('quota-history-chart'),
  quotaHistoryLegend: document.getElementById('quota-history-legend'),
  windowBadge: document.getElementById('window-badge'),
  modelBreakdownList: document.getElementById('model-breakdown-list'),

  peerForm: document.getElementById('peer-form'),
  peerUrlInput: document.getElementById('peer-url-input'),
  peerClearBtn: document.getElementById('peer-clear-btn'),
  crossMacBody: document.getElementById('cross-mac-body'),

  conversationSearch: document.getElementById('conversation-search'),
  conversationsTbody: document.getElementById('conversations-tbody'),
  lastUpdatedText: document.getElementById('last-updated-text'),
  g1PolicyText: document.getElementById('g1-policy-text'),

  settingsModal: document.getElementById('settings-modal'),
  settingsCloseX: document.getElementById('settings-close-x'),
  settingsCloseBtn: document.getElementById('settings-close-btn'),
  settingsResetBtn: document.getElementById('settings-reset-btn'),
  settingsForm: document.getElementById('settings-form'),
  settingsDiagnostics: document.getElementById('settings-diagnostics'),
  settingsFeedback: document.getElementById('settings-feedback'),
  cfgProfileName: document.getElementById('cfg-profile-name'),
  cfgMacLabel: document.getElementById('cfg-mac-label'),
  cfgPeerUrl: document.getElementById('cfg-peer-url'),
  cfgDefaultView: document.getElementById('cfg-default-view'),
  cfgWarningThreshold: document.getElementById('cfg-warning-threshold'),
  cfgShow3p: document.getElementById('cfg-show-3p'),
  cfgAgyBin: document.getElementById('cfg-agy-bin'),
  cfgDataDir: document.getElementById('cfg-data-dir'),
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatCompactNumber(num) {
  const n = Number(num ?? 0);
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'Resetting now';
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatLocalDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getPaceGlyph(status) {
  if (status === 'burning_fast') return '▲';
  if (status === 'on_pace') return '◐';
  return '●';
}

function applyTheme(theme) {
  const resolved = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', resolved);
  el.themeIcon.textContent = resolved === 'light' ? '🌙' : '☀️';
  el.themeLabel.textContent = resolved === 'light' ? 'Dark' : 'Light';
  localStorage.setItem(STORAGE_THEME_KEY, resolved);
}

function initTheme() {
  const saved = localStorage.getItem(STORAGE_THEME_KEY);
  if (saved === 'light' || saved === 'dark') {
    applyTheme(saved);
    return;
  }
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  applyTheme(prefersLight ? 'light' : 'dark');
}

function applyViewMode(mode, persistChoice = false) {
  const resolved = mode === 'advanced' ? 'advanced' : 'overview';
  state.viewMode = resolved;
  if (persistChoice) {
    state.hasManualViewChoice = true;
    localStorage.setItem(STORAGE_VIEW_KEY, resolved);
  }
  el.viewBtnOverview.classList.toggle('active', resolved === 'overview');
  el.viewBtnAdvanced.classList.toggle('active', resolved === 'advanced');
  el.windowControlGroup.classList.toggle('hidden', resolved === 'overview');
  syncViewState();
}

function syncViewState() {
  const mode = state.qaOverride;
  el.stateLoading.classList.add('hidden');
  el.stateError.classList.add('hidden');
  el.statePopulated.classList.add('hidden');
  el.stateEmpty.classList.add('hidden');

  if (mode === 'loading' || (!state.summary && !state.lastError && mode === 'auto')) {
    el.stateLoading.classList.remove('hidden');
    return;
  }

  if (mode === 'error' || (state.lastError && mode === 'auto')) {
    el.errorTitle.textContent = 'Could not retrieve live quota data';
    el.errorMessage.textContent = state.lastError || 'Simulated Error preview: agy CLI is unreachable.';
    el.stateError.classList.remove('hidden');
    return;
  }

  el.statePopulated.classList.remove('hidden');
  const showAdvanced = state.viewMode === 'advanced' || mode === 'empty';
  el.viewOverview.classList.toggle('hidden', showAdvanced);
  el.viewAdvanced.classList.toggle('hidden', !showAdvanced);

  const totals = state.summary?.telemetry?.totals;
  const isEmpty = mode === 'empty' || (totals && totals.plannerSteps === 0 && totals.conversationsCount === 0);

  if (isEmpty) {
    el.stateEmpty.classList.remove('hidden');
    el.telemetrySection.classList.add('hidden');
    el.conversationsSection.classList.add('hidden');
  } else {
    el.stateEmpty.classList.add('hidden');
    el.telemetrySection.classList.remove('hidden');
    el.conversationsSection.classList.remove('hidden');
  }
}

function renderOverviewBucketCard(bucket) {
  const remainingPct = Math.max(0, Math.min(100, Number(bucket.remainingPercent ?? 0)));
  const usedPct = Math.max(0, Math.min(100, Number(bucket.usedPercent ?? 100 - remainingPct)));
  const resetMs = Date.parse(bucket.resetTime ?? '');
  const msLeft = Number.isFinite(resetMs) ? Math.max(0, resetMs - Date.now()) : bucket.msUntilReset;

  return `
    <article class="card overview-card">
      <div class="overview-card-top">
        <div>
          <div class="overview-card-title">${escapeHtml(bucket.groupName)}</div>
          <div class="overview-card-window">${escapeHtml(bucket.name)}</div>
        </div>
        <span class="pace-badge pace-${escapeHtml(bucket.paceStatus)}">
          ${getPaceGlyph(bucket.paceStatus)} ${escapeHtml(bucket.paceLabel)}
        </span>
      </div>
      <div class="overview-pct-row">
        <div>
          <span class="overview-pct">${remainingPct.toFixed(0)}%</span>
          <span class="muted small"> left</span>
        </div>
        <span class="overview-pct-sub">${usedPct.toFixed(0)}% used</span>
      </div>
      <div class="overview-bar-track" aria-label="${remainingPct.toFixed(0)}% remaining">
        <div class="overview-bar-fill ${escapeHtml(bucket.paceStatus)}" style="width: ${remainingPct}%"></div>
      </div>
      <div class="overview-reset-row">
        <span class="countdown-text" data-reset-iso="${escapeHtml(bucket.resetTime || '')}">
          Resets in ${formatCountdown(msLeft)}
        </span>
        <span>${escapeHtml(formatLocalDateTime(bucket.resetTime))}</span>
      </div>
    </article>
  `;
}

function isThirdPartyBucket(item) {
  const id = String(item?.id ?? '');
  const label = `${item?.groupName ?? ''} ${item?.name ?? ''}`;
  return id.startsWith('3p-') || /claude|gpt/i.test(label);
}

function renderSimpleOverview(summary) {
  const config = summary?.config ?? {};
  const show3p = config.showThirdPartyQuotas !== false;
  el.overview3pSection.classList.toggle('hidden', !show3p);

  const buckets = summary?.quota?.flatBuckets ?? [];
  const gemini5h = buckets.filter((b) => !isThirdPartyBucket(b) && b.window === '5h');
  const geminiWeekly = buckets.filter((b) => !isThirdPartyBucket(b) && b.window !== '5h');
  const thirdParty5h = buckets.filter((b) => isThirdPartyBucket(b) && b.window === '5h');
  const thirdPartyWeekly = buckets.filter((b) => isThirdPartyBucket(b) && b.window !== '5h');

  el.overviewGemini5hGrid.innerHTML =
    gemini5h.length > 0
      ? gemini5h.map(renderOverviewBucketCard).join('')
      : '<div class="card"><p class="muted small">No Gemini 5-hour rolling buckets returned.</p></div>';

  el.overviewGeminiWeeklyGrid.innerHTML =
    geminiWeekly.length > 0
      ? geminiWeekly.map(renderOverviewBucketCard).join('')
      : '<div class="card"><p class="muted small">No Gemini weekly baseline buckets returned.</p></div>';

  if (show3p) {
    el.overview3p5hGrid.innerHTML =
      thirdParty5h.length > 0
        ? thirdParty5h.map(renderOverviewBucketCard).join('')
        : '<div class="card"><p class="muted small">No Claude &amp; GPT 5-hour buckets returned.</p></div>';

    el.overview3pWeeklyGrid.innerHTML =
      thirdPartyWeekly.length > 0
        ? thirdPartyWeekly.map(renderOverviewBucketCard).join('')
        : '<div class="card"><p class="muted small">No Claude &amp; GPT weekly buckets returned.</p></div>';
  }

  const threshold = Number(config.warningThresholdPercent ?? 20);
  const lowBuckets = buckets.filter(
    (b) => (show3p || !isThirdPartyBucket(b)) && Number(b.remainingPercent ?? 100) <= threshold
  );
  if (lowBuckets.length > 0) {
    const labels = lowBuckets
      .map((b) => `${b.groupName} (${b.window === '5h' ? '5h' : 'Weekly'}: ${b.remainingPercent.toFixed(0)}%)`)
      .join(' · ');
    el.lowQuotaAlertBanner.textContent = `▲ Low Quota Alert (≤ ${threshold}%): ${labels}`;
    el.lowQuotaAlertBanner.classList.remove('hidden');
  } else {
    el.lowQuotaAlertBanner.classList.add('hidden');
  }

  const modelLabel = summary?.quota?.activeModel?.label || summary?.quota?.activeModel?.id || 'Unknown';
  const credits = summary?.quota?.credits?.remainingCredits ?? 0;
  const localTotals = summary?.telemetry?.totals ?? {};
  const peer = summary?.peer;
  const peerSummary =
    peer?.configured && peer?.online
      ? ` · Peer (${escapeHtml(peer.data?.machine?.label || 'Mac')}): ${formatCompactNumber(peer.data?.telemetry?.totals?.totalTokens)} tok`
      : '';

  el.overviewSummaryStrip.innerHTML = `
    <div class="overview-strip-item">
      <span class="kpi-label">Active Model</span>
      <strong>${escapeHtml(modelLabel)}</strong>
    </div>
    <div class="overview-strip-item">
      <span class="kpi-label">G1 AI Credits</span>
      <strong>${credits} remaining</strong>
    </div>
    <div class="overview-strip-item">
      <span class="kpi-label">Local Mac Usage</span>
      <strong>${formatCompactNumber(localTotals.totalTokens)} tok · ${localTotals.conversationsCount ?? 0} sessions${peerSummary}</strong>
    </div>
  `;
}

function renderQuotaGroups(quota, config = {}) {
  if (!quota || !Array.isArray(quota.groups) || quota.groups.length === 0) {
    el.quotaGroupsGrid.innerHTML = `
      <div class="card">
        <h3>No quota buckets returned</h3>
        <p class="muted small">Check that <code>agy -p "/usage"</code> works on this Mac.</p>
      </div>
    `;
    return;
  }

  if (quota.description) {
    el.quotaPolicyDesc.textContent = quota.description;
  }

  if (Array.isArray(quota.errors) && quota.errors.length > 0) {
    el.quotaWarningBanner.textContent = `Partial CLI warnings: ${quota.errors.map((e) => `${e.source}: ${e.message}`).join(' · ')}`;
    el.quotaWarningBanner.classList.remove('hidden');
  } else {
    el.quotaWarningBanner.classList.add('hidden');
  }

  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const show3p = config?.showThirdPartyQuotas !== false;

  const sortedGroups = [...quota.groups]
    .filter((g) => show3p || !isThirdPartyBucket({ groupName: g.name }))
    .sort((a, b) => {
      const a3p = isThirdPartyBucket({ groupName: a.name }) ? 1 : 0;
      const b3p = isThirdPartyBucket({ groupName: b.name }) ? 1 : 0;
      return a3p - b3p;
    });

  el.quotaGroupsGrid.innerHTML = sortedGroups
    .map((group) => {
      const bucketsHtml = group.buckets
        .map((bucket) => {
          const remainingPct = Math.max(0, Math.min(100, Number(bucket.remainingPercent ?? 0)));
          const elapsedPct = Math.max(0, Math.min(100, Number(bucket.elapsedPercent ?? 0)));
          const dashOffset = circumference * (1 - remainingPct / 100);
          const strokeColor =
            bucket.paceStatus === 'burning_fast'
              ? 'var(--burn-fg)'
              : bucket.paceStatus === 'on_pace'
                ? 'var(--pace-fg)'
                : 'var(--safe-fg)';
          const resetMs = Date.parse(bucket.resetTime ?? '');
          const msLeft = Number.isFinite(resetMs) ? Math.max(0, resetMs - Date.now()) : bucket.msUntilReset;

          return `
            <div class="bucket-row">
              <div class="gauge-wrap">
                <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
                  <circle cx="38" cy="38" r="${radius}" fill="none" stroke="var(--bg-subtle)" stroke-width="7"></circle>
                  <circle
                    cx="38"
                    cy="38"
                    r="${radius}"
                    fill="none"
                    stroke="${strokeColor}"
                    stroke-width="7"
                    stroke-linecap="round"
                    stroke-dasharray="${circumference.toFixed(2)}"
                    stroke-dashoffset="${dashOffset.toFixed(2)}"
                    transform="rotate(-90 38 38)"
                  ></circle>
                </svg>
                <span class="gauge-value">${remainingPct.toFixed(0)}%</span>
              </div>
              <div>
                <div class="bucket-head">
                  <span class="bucket-name">${escapeHtml(bucket.name)}</span>
                  <span class="pace-badge pace-${escapeHtml(bucket.paceStatus)}">
                    ${getPaceGlyph(bucket.paceStatus)} ${escapeHtml(bucket.paceLabel)}
                  </span>
                </div>
                <div class="pace-bar-track" title="Remaining: ${remainingPct}% · Window elapsed: ${elapsedPct}%">
                  <div class="pace-bar-fill ${escapeHtml(bucket.paceStatus)}" style="width: ${remainingPct}%"></div>
                  <div class="elapsed-marker" style="left: ${elapsedPct}%" title="Window elapsed: ${elapsedPct.toFixed(1)}%"></div>
                </div>
                <div class="bucket-meta">
                  <span class="countdown-text" data-reset-iso="${escapeHtml(bucket.resetTime || '')}">
                    Resets in ${formatCountdown(msLeft)}
                  </span>
                  <span>${escapeHtml(formatLocalDateTime(bucket.resetTime))}</span>
                </div>
                ${
                  bucket.willExhaustBeforeReset && bucket.msToExhaustion !== null
                    ? `<div class="exhaustion-warn">At current pace, exhausted in ~${formatCountdown(bucket.msToExhaustion)} (before reset)</div>`
                    : ''
                }
              </div>
            </div>
          `;
        })
        .join('');

      return `
        <article class="card">
          <div class="group-card-head">
            <h3>${escapeHtml(group.name)}</h3>
            <p class="muted small">${escapeHtml(group.description)}</p>
          </div>
          <div class="buckets-stack">${bucketsHtml}</div>
        </article>
      `;
    })
    .join('');
}

function renderKpis(telemetry) {
  const totals = telemetry?.totals ?? {};
  const cards = [
    {
      label: 'Total Tokens',
      value: formatCompactNumber(totals.totalTokens),
      sub: `${totals.plannerSteps ?? 0} planner steps · ${totals.toolCallsCount ?? 0} tool calls`,
    },
    {
      label: 'Uncached Input',
      value: formatCompactNumber(totals.inputTokens),
      sub: 'Fresh prompt tokens billed to quota',
    },
    {
      label: 'Cache Read Tokens',
      value: formatCompactNumber(totals.cacheReadTokens),
      sub: `${Number(totals.cacheEfficiencyPercent ?? 0).toFixed(1)}% prompt cache hit rate`,
    },
    {
      label: 'Output Tokens',
      value: formatCompactNumber(totals.outputTokens),
      sub: `${totals.conversationsCount ?? 0} active conversations in window`,
    },
  ];

  el.kpiGrid.innerHTML = cards
    .map(
      (c) => `
      <article class="card kpi-card">
        <div class="kpi-label">${escapeHtml(c.label)}</div>
        <div class="kpi-value">${escapeHtml(c.value)}</div>
        <div class="kpi-sub">${escapeHtml(c.sub)}</div>
      </article>
    `
    )
    .join('');
}

function renderHistoryChart(snapshots) {
  el.historyCountBadge.textContent = `${snapshots.length} pts`;
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    el.quotaHistoryChart.innerHTML = '<p class="muted small">Snapshot history will build automatically on each refresh.</p>';
    el.quotaHistoryLegend.innerHTML = '';
    return;
  }

  const seriesMeta = [
    { id: 'gemini-weekly', label: 'Gemini Weekly', color: '#38bdf8' },
    { id: 'gemini-5h', label: 'Gemini 5h', color: '#34d399' },
    { id: 'gemini-argon-wtu-weekly', label: 'Argon Weekly', color: '#818cf8' },
    { id: '3p-weekly', label: 'Claude/GPT Weekly', color: '#fb7185' },
    { id: '3p-5h', label: 'Claude/GPT 5h', color: '#fbbf24' },
  ];

  const width = 560;
  const height = 200;
  const padL = 36;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const yTicks = [0, 25, 50, 75, 100];
  const gridLines = yTicks
    .map((val) => {
      const y = padT + plotH * (1 - val / 100);
      return `
        <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="3 3" />
        <text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="var(--text-muted)">${val}%</text>
      `;
    })
    .join('');

  const paths = seriesMeta
    .map((series) => {
      const points = snapshots
        .map((snap, idx) => {
          const val = snap.buckets?.[series.id];
          if (typeof val !== 'number') return null;
          const x = snapshots.length === 1 ? padL + plotW / 2 : padL + (idx / (snapshots.length - 1)) * plotW;
          const y = padT + plotH * (1 - Math.max(0, Math.min(100, val)) / 100);
          return { x, y, val };
        })
        .filter(Boolean);

      if (points.length === 0) return '';
      if (points.length === 1) {
        return `<circle cx="${points[0].x}" cy="${points[0].y}" r="4.5" fill="${series.color}" />`;
      }
      const d = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      return `<path d="${d}" fill="none" stroke="${series.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />`;
    })
    .join('');

  const firstTime = formatLocalDateTime(snapshots[0].timestamp);
  const lastTime = formatLocalDateTime(snapshots[snapshots.length - 1].timestamp);

  el.quotaHistoryChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="205" role="img" aria-label="Quota snapshot history chart">
      ${gridLines}
      ${paths}
      <text x="${padL}" y="${height - 6}" font-size="10" fill="var(--text-muted)">${escapeHtml(firstTime)}</text>
      <text x="${width - padR}" y="${height - 6}" text-anchor="end" font-size="10" fill="var(--text-muted)">${escapeHtml(lastTime)}</text>
    </svg>
  `;

  el.quotaHistoryLegend.innerHTML = seriesMeta
    .map(
      (s) => `
      <span class="legend-item">
        <span class="legend-swatch" style="background: ${s.color}"></span>
        <span>${escapeHtml(s.label)}</span>
      </span>
    `
    )
    .join('');
}

function renderModelBreakdown(telemetry) {
  el.windowBadge.textContent = `Window: ${state.window.toUpperCase()}`;
  const models = telemetry?.byModel ?? [];
  if (models.length === 0) {
    el.modelBreakdownList.innerHTML = '<p class="muted small">No model token usage recorded in this window.</p>';
    return;
  }

  const maxTokens = Math.max(...models.map((m) => m.totalTokens), 1);

  el.modelBreakdownList.innerHTML = models
    .slice(0, 8)
    .map((m) => {
      const total = Math.max(m.totalTokens, 1);
      const scale = (m.totalTokens / maxTokens) * 100;
      const inPct = (m.inputTokens / total) * scale;
      const cachePct = (m.cacheReadTokens / total) * scale;
      const outPct = (m.outputTokens / total) * scale;

      return `
        <div>
          <div class="model-row-head">
            <strong>${escapeHtml(m.model)}</strong>
            <span class="muted">${formatCompactNumber(m.totalTokens)} tok · ${m.steps} steps · ${m.cacheEfficiencyPercent}% cache</span>
          </div>
          <div class="stacked-bar" title="Input: ${m.inputTokens.toLocaleString()} | Cache: ${m.cacheReadTokens.toLocaleString()} | Output: ${m.outputTokens.toLocaleString()}">
            <div class="bar-seg-input" style="width: ${inPct.toFixed(2)}%"></div>
            <div class="bar-seg-cache" style="width: ${cachePct.toFixed(2)}%"></div>
            <div class="bar-seg-output" style="width: ${outPct.toFixed(2)}%"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderCrossMac(machine, telemetry, peer) {
  const localStats = telemetry?.totals ?? {};
  const lanHint = machine?.lanUrl || machine?.localUrl || 'http://localhost:4321';

  const localHtml = `
    <div class="mac-panel">
      <div class="bucket-head">
        <strong>This Mac · ${escapeHtml(machine?.label || machine?.hostname || 'Local')}</strong>
        <span class="pace-badge pace-safe">● Online</span>
      </div>
      <div class="muted small">${escapeHtml(machine?.platform || 'darwin')} (${escapeHtml(machine?.arch || '')}) · Open from other Mac: <code>${escapeHtml(lanHint)}</code></div>
      <div class="mac-stats-grid">
        <div class="mac-stat-box"><div class="muted small">Total Tokens</div><strong>${formatCompactNumber(localStats.totalTokens)}</strong></div>
        <div class="mac-stat-box"><div class="muted small">Cache Hit</div><strong>${Number(localStats.cacheEfficiencyPercent ?? 0).toFixed(1)}%</strong></div>
        <div class="mac-stat-box"><div class="muted small">Planner Steps</div><strong>${localStats.plannerSteps ?? 0}</strong></div>
        <div class="mac-stat-box"><div class="muted small">Conversations</div><strong>${localStats.conversationsCount ?? 0}</strong></div>
      </div>
    </div>
  `;

  let peerHtml = '';
  if (!peer?.configured) {
    peerHtml = `
      <div class="mac-panel">
        <div class="bucket-head">
          <strong>Second Mac (Peer)</strong>
          <span class="pill pill-neutral">Not Linked</span>
        </div>
        <p class="muted small">
          Run <code>agy-pulse</code> on another Mac with <code>./run.sh</code>, then enter its LAN/Tailscale URL above (e.g., <code>http://second-mac.local:4321</code>) to see side-by-side token usage.
        </p>
        <p class="muted small">
          Or open <code>${escapeHtml(lanHint)}</code> directly from another device's browser on your LAN to view this Mac's dashboard with zero extra setup.
        </p>
      </div>
    `;
  } else if (!peer.online) {
    peerHtml = `
      <div class="mac-panel">
        <div class="bucket-head">
          <strong>Peer Mac · ${escapeHtml(peer.peerUrl)}</strong>
          <span class="pace-badge pace-on_pace">◐ Offline / Asleep</span>
        </div>
        <p class="muted small">${escapeHtml(peer.error || 'Unable to reach peer Mac')}</p>
        <p class="muted small">Live subscription quotas above still reflect your full account across both Macs.</p>
      </div>
    `;
  } else {
    const pm = peer.data?.machine ?? {};
    const pt = peer.data?.telemetry?.totals ?? {};
    peerHtml = `
      <div class="mac-panel">
        <div class="bucket-head">
          <strong>Peer Mac · ${escapeHtml(pm.label || pm.hostname || peer.peerUrl)}</strong>
          <span class="pace-badge pace-safe">● Online</span>
        </div>
        <div class="muted small">${escapeHtml(peer.peerUrl)} · ${escapeHtml(pm.platform || '')} (${escapeHtml(pm.arch || '')})</div>
        <div class="mac-stats-grid">
          <div class="mac-stat-box"><div class="muted small">Total Tokens</div><strong>${formatCompactNumber(pt.totalTokens)}</strong></div>
          <div class="mac-stat-box"><div class="muted small">Cache Hit</div><strong>${Number(pt.cacheEfficiencyPercent ?? 0).toFixed(1)}%</strong></div>
          <div class="mac-stat-box"><div class="muted small">Planner Steps</div><strong>${pt.plannerSteps ?? 0}</strong></div>
          <div class="mac-stat-box"><div class="muted small">Conversations</div><strong>${pt.conversationsCount ?? 0}</strong></div>
        </div>
      </div>
    `;
  }

  el.crossMacBody.innerHTML = `<div class="cross-mac-grid">${localHtml}${peerHtml}</div>`;
}

function renderConversations(telemetry) {
  const rows = telemetry?.recentConversations ?? [];
  const q = state.searchQuery.trim().toLowerCase();
  const filtered = q
    ? rows.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.workspaceName.toLowerCase().includes(q) ||
          r.models.join(' ').toLowerCase().includes(q)
      )
    : rows;

  if (filtered.length === 0) {
    el.conversationsTbody.innerHTML =
      '<tr><td colspan="9" class="muted">No matching local conversations found.</td></tr>';
    return;
  }

  el.conversationsTbody.innerHTML = filtered
    .map(
      (c) => `
      <tr>
        <td><strong>${escapeHtml(c.title)}</strong></td>
        <td>${c.workspaceName ? `<code>${escapeHtml(c.workspaceName)}</code>` : '<span class="muted">—</span>'}</td>
        <td class="small">${c.models.length > 0 ? escapeHtml(c.models.join(', ')) : '<span class="muted">—</span>'}</td>
        <td class="num">${c.plannerSteps || c.stepCount}</td>
        <td class="num">${formatCompactNumber(c.inputTokens)}</td>
        <td class="num">${formatCompactNumber(c.cacheReadTokens)}</td>
        <td class="num">${formatCompactNumber(c.outputTokens)}</td>
        <td class="num">${Number(c.cacheEfficiencyPercent ?? 0).toFixed(1)}%</td>
        <td class="small muted">${escapeHtml(formatLocalDateTime(c.lastActiveAt))}</td>
      </tr>
    `
    )
    .join('');
}

function renderSummary(summary) {
  state.summary = summary;
  state.config = summary.config ?? state.config;
  state.diagnostics = summary.diagnostics ?? state.diagnostics;
  state.lastError = null;

  const { machine, quota, telemetry, history, peer, config } = summary;
  el.machinePill.textContent = machine.label || machine.hostname;
  if (config?.profileName) {
    el.profilePill.textContent = config.profileName;
    el.profilePill.classList.remove('hidden');
  } else {
    el.profilePill.classList.add('hidden');
  }

  if (!state.hasManualViewChoice && config?.defaultViewMode) {
    state.viewMode = config.defaultViewMode === 'advanced' ? 'advanced' : 'overview';
    el.viewBtnOverview.classList.toggle('active', state.viewMode === 'overview');
    el.viewBtnAdvanced.classList.toggle('active', state.viewMode === 'advanced');
    el.windowControlGroup.classList.toggle('hidden', state.viewMode === 'overview');
  }

  el.networkSubtitle.textContent = machine.lanUrl
    ? `Local: ${machine.localUrl} · Share with other Mac: ${machine.lanUrl}`
    : `Local: ${machine.localUrl}`;

  const modelLabel = quota?.activeModel?.label || quota?.activeModel?.id || 'Unknown';
  el.modelPill.textContent = `Model: ${modelLabel}`;

  const credits = quota?.credits?.remainingCredits ?? 0;
  el.creditsPill.textContent = `G1 Credits: ${credits}`;
  if (quota?.credits?.upgradeUri) {
    el.creditsPill.href = quota.credits.upgradeUri;
  }

  el.lastUpdatedText.textContent = `Last updated: ${formatLocalDateTime(summary.generatedAt)}${quota?.fromCache ? ' (cached)' : ''}`;
  el.g1PolicyText.textContent = `Overage fallback (useG1Credits): ${quota?.credits?.useG1Credits ? 'Enabled' : 'Disabled'}`;

  if (localStorage.getItem(STORAGE_PEER_KEY) === null && machine.defaultPeerUrl) {
    el.peerUrlInput.value = machine.defaultPeerUrl;
  }

  renderSimpleOverview(summary);
  renderQuotaGroups(quota, config);
  renderKpis(telemetry);
  renderHistoryChart(history || []);
  renderModelBreakdown(telemetry);
  renderCrossMac(machine, telemetry, peer);
  renderConversations(telemetry);
  syncViewState();
}

async function fetchSummary({ forceRefresh = false } = {}) {
  el.refreshBtn.disabled = true;
  el.refreshLabel.textContent = 'Refreshing...';

  try {
    const params = new URLSearchParams({
      window: state.window,
      refresh: forceRefresh ? '1' : '0',
    });
    if (state.peerUrl) {
      params.set('peer', state.peerUrl);
    } else if (localStorage.getItem(STORAGE_PEER_KEY) === '') {
      params.set('peer', '');
    }

    const res = await fetch(`/api/summary?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }
    const payload = await res.json();
    if (!payload.quota?.ok && (!payload.quota?.groups || payload.quota.groups.length === 0)) {
      const msg = payload.quota?.errors?.map((e) => e.message).join('; ') || 'agy CLI returned no quota buckets';
      throw new Error(msg);
    }
    renderSummary(payload);
  } catch (err) {
    state.lastError = err?.message || 'Unable to load Antigravity Pulse API';
    syncViewState();
  } finally {
    el.refreshBtn.disabled = false;
    el.refreshLabel.textContent = 'Refresh';
  }
}

function resetAutoRefreshTimer() {
  if (state.timerId) {
    clearInterval(state.timerId);
    state.timerId = null;
  }
  if (state.autoRefreshMs > 0) {
    state.timerId = setInterval(() => fetchSummary({ forceRefresh: true }), state.autoRefreshMs);
  }
}

function startCountdownTicker() {
  if (state.countdownTimerId) clearInterval(state.countdownTimerId);
  state.countdownTimerId = setInterval(() => {
    const nodes = document.querySelectorAll('.countdown-text[data-reset-iso]');
    const now = Date.now();
    for (const node of nodes) {
      const iso = node.getAttribute('data-reset-iso');
      if (!iso) continue;
      const ms = Date.parse(iso);
      if (Number.isFinite(ms)) {
        node.textContent = `Resets in ${formatCountdown(Math.max(0, ms - now))}`;
      }
    }
  }, 1000);
}

function renderDiagnostics(diag) {
  if (!diag) {
    el.settingsDiagnostics.innerHTML = '<p class="muted small">Checking environment...</p>';
    return;
  }
  const badge = (ok, yesText, noText) =>
    ok
      ? `<span class="pace-badge pace-safe">● ${yesText}</span>`
      : `<span class="pace-badge pace-burning_fast">▲ ${noText}</span>`;

  el.settingsDiagnostics.innerHTML = `
    <div class="diag-item">
      <span class="muted">agy CLI Binary</span>
      ${badge(diag.agyInstalled, 'Found', 'Not Found')}
      <code class="small">${escapeHtml(diag.agyBin)}</code>
    </div>
    <div class="diag-item">
      <span class="muted">Google OAuth Session</span>
      ${badge(diag.oauthTokenPresent, 'Signed In', 'Sign In Needed')}
      <span class="muted small">Run <code>${escapeHtml(diag.loginCommand || 'agy')}</code> to login</span>
    </div>
    <div class="diag-item">
      <span class="muted">Local SQLite Telemetry</span>
      ${badge(diag.databasePresent, 'Available', 'Not Created Yet')}
      <code class="small">${escapeHtml(diag.dataDir)}</code>
    </div>
  `;
}

function populateSettingsForm(cfg = {}) {
  el.cfgProfileName.value = cfg.profileName || '';
  el.cfgMacLabel.value = cfg.label || '';
  el.cfgPeerUrl.value = cfg.peerUrl || '';
  el.cfgDefaultView.value = cfg.defaultViewMode === 'advanced' ? 'advanced' : 'overview';
  el.cfgWarningThreshold.value = String(cfg.warningThresholdPercent ?? 20);
  el.cfgShow3p.checked = cfg.showThirdPartyQuotas !== false;
  el.cfgAgyBin.value = cfg.agyBin || '';
  el.cfgDataDir.value = cfg.dataDir || '';
}

async function openSettingsModal() {
  el.settingsFeedback.classList.add('hidden');
  el.settingsModal.classList.remove('hidden');
  if (state.config) populateSettingsForm(state.config);
  renderDiagnostics(state.diagnostics);

  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      state.config = data.config;
      state.diagnostics = data.diagnostics;
      populateSettingsForm(data.config);
      renderDiagnostics(data.diagnostics);
    }
  } catch {
    // Keep last known diagnostics if server is restarting
  }
}

function closeSettingsModal() {
  el.settingsModal.classList.add('hidden');
}

async function submitSettings(body) {
  el.settingsFeedback.classList.add('hidden');
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  state.config = data.config;
  state.diagnostics = data.diagnostics;
  populateSettingsForm(data.config);
  renderDiagnostics(data.diagnostics);
  if (data.config?.peerUrl) {
    state.peerUrl = data.config.peerUrl;
    el.peerUrlInput.value = data.config.peerUrl;
    localStorage.setItem(STORAGE_PEER_KEY, data.config.peerUrl);
  }
  applyViewMode(data.config?.defaultViewMode || 'overview', true);
  closeSettingsModal();
  await fetchSummary({ forceRefresh: true });
}

function wireEvents() {
  el.viewBtnOverview.addEventListener('click', () => applyViewMode('overview', true));
  el.viewBtnAdvanced.addEventListener('click', () => applyViewMode('advanced', true));
  el.overviewToAdvancedBtn.addEventListener('click', () => applyViewMode('advanced', true));

  el.settingsOpenBtn.addEventListener('click', openSettingsModal);
  el.errorSettingsBtn.addEventListener('click', openSettingsModal);
  el.settingsCloseX.addEventListener('click', closeSettingsModal);
  el.settingsCloseBtn.addEventListener('click', closeSettingsModal);
  el.settingsModal.addEventListener('click', (e) => {
    if (e.target === el.settingsModal) closeSettingsModal();
  });

  el.settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await submitSettings({
        profileName: el.cfgProfileName.value,
        label: el.cfgMacLabel.value,
        peerUrl: el.cfgPeerUrl.value,
        defaultViewMode: el.cfgDefaultView.value,
        warningThresholdPercent: Number(el.cfgWarningThreshold.value),
        showThirdPartyQuotas: el.cfgShow3p.checked,
        agyBin: el.cfgAgyBin.value,
        dataDir: el.cfgDataDir.value,
      });
    } catch (err) {
      el.settingsFeedback.textContent = `Could not save settings: ${err.message}`;
      el.settingsFeedback.classList.remove('hidden');
    }
  });

  el.settingsResetBtn.addEventListener('click', async () => {
    try {
      await submitSettings({ reset: true });
    } catch (err) {
      el.settingsFeedback.textContent = `Could not reset settings: ${err.message}`;
      el.settingsFeedback.classList.remove('hidden');
    }
  });

  el.themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'light' ? 'dark' : 'light');
  });

  document.querySelectorAll('.seg-btn[data-window]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn[data-window]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.window = btn.getAttribute('data-window') || 'all';
      fetchSummary({ forceRefresh: false });
    });
  });

  el.autoRefreshSelect.addEventListener('change', () => {
    state.autoRefreshMs = Number(el.autoRefreshSelect.value) || 0;
    resetAutoRefreshTimer();
  });

  el.refreshBtn.addEventListener('click', () => fetchSummary({ forceRefresh: true }));
  el.errorRetryBtn.addEventListener('click', () => {
    state.qaOverride = 'auto';
    el.qaStateSelect.value = 'auto';
    fetchSummary({ forceRefresh: true });
  });

  el.emptyResetWindow.addEventListener('click', () => {
    state.qaOverride = 'auto';
    el.qaStateSelect.value = 'auto';
    state.window = 'all';
    document.querySelectorAll('.seg-btn[data-window]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-window') === 'all');
    });
    fetchSummary({ forceRefresh: false });
  });

  el.peerUrlInput.value = state.peerUrl;
  el.peerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    state.peerUrl = el.peerUrlInput.value.trim();
    localStorage.setItem(STORAGE_PEER_KEY, state.peerUrl);
    fetchSummary({ forceRefresh: false });
  });

  el.peerClearBtn.addEventListener('click', () => {
    state.peerUrl = '';
    el.peerUrlInput.value = '';
    localStorage.setItem(STORAGE_PEER_KEY, '');
    fetchSummary({ forceRefresh: false });
  });

  el.conversationSearch.addEventListener('input', () => {
    state.searchQuery = el.conversationSearch.value;
    if (state.summary) {
      renderConversations(state.summary.telemetry);
    }
  });

  el.qaStateSelect.addEventListener('change', () => {
    state.qaOverride = el.qaStateSelect.value;
    syncViewState();
  });
}

initTheme();
wireEvents();
applyViewMode(state.viewMode);
startCountdownTicker();
resetAutoRefreshTimer();
fetchSummary({ forceRefresh: false });
