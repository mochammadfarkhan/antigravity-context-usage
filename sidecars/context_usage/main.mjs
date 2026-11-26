import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_PREFS = {
  lang: process.env.DEFAULT_LANG === 'id' ? 'id' : 'en',
  currency: 'auto', // 'auto' | 'usd' | 'idr'
  limitMode: 'auto', // 'auto' | '200000' | '1000000'
  refreshMs: 5000, // 0 | 3000 | 5000 | 10000
  defaultRange: 'today', // 'today' | '7d' | '30d' | 'all'
};

// Estimated public API rates (USD per 1M tokens) for approximate cost tracking.
function getModelRates(modelName) {
  const m = String(modelName || '').toLowerCase();
  if (m.includes('opus')) {
    return { in: 5.0, cache: 0.5, out: 25.0 };
  }
  if (m.includes('sonnet')) {
    return { in: 3.0, cache: 0.3, out: 15.0 };
  }
  if (m.includes('haiku')) {
    return { in: 0.8, cache: 0.08, out: 4.0 };
  }
  if (/flash[-_]?lite|[-_](mini|nano)\b/.test(m)) {
    return { in: 0.15, cache: 0.015, out: 0.6 };
  }
  if (m.includes('flash') || m.includes('argon')) {
    return { in: 0.3, cache: 0.03, out: 2.5 };
  }
  if (m.includes('tiered-high') || m.includes('-high') || m.includes('ultra')) {
    return { in: 2.5, cache: 0.25, out: 15.0 };
  }
  if (m.includes('gemini') || m.includes('gpt') || /\bo[34]\b/.test(m)) {
    return { in: 1.25, cache: 0.125, out: 10.0 };
  }
  return { in: 1.25, cache: 0.125, out: 10.0 };
}

function estimateTurnCost(modelName, inputTokens, cacheReadTokens, outputTokens) {
  const r = getModelRates(modelName);
  const costUsd =
    (inputTokens * r.in + cacheReadTokens * r.cache + outputTokens * r.out) / 1_000_000;
  const savedUsd = (cacheReadTokens * Math.max(0, r.in - r.cache)) / 1_000_000;
  return { costUsd, savedUsd };
}

function safeReaddir(dirPath) {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function getPrefsPath() {
  const dataDir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (dataDir) {
    return join(dataDir, 'prefs.json');
  }
  return join(__dirname, '.prefs.json');
}

function sanitizePrefs(raw) {
  const out = { ...DEFAULT_PREFS };
  if (raw && typeof raw === 'object') {
    if (raw.lang === 'en' || raw.lang === 'id') out.lang = raw.lang;
    if (['auto', 'usd', 'idr'].includes(raw.currency)) out.currency = raw.currency;
    if (['auto', '200000', '1000000'].includes(String(raw.limitMode))) {
      out.limitMode = String(raw.limitMode);
    }
    const r = Number(raw.refreshMs);
    if ([0, 3000, 5000, 10000].includes(r)) out.refreshMs = r;
    if (['today', '7d', '30d', 'all'].includes(raw.defaultRange)) {
      out.defaultRange = raw.defaultRange;
    }
  }
  return out;
}

function loadPrefs() {
  try {
    const p = getPrefsPath();
    if (!existsSync(p)) return { ...DEFAULT_PREFS };
    return sanitizePrefs(JSON.parse(readFileSync(p, 'utf-8')));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(partial) {
  const merged = sanitizePrefs({ ...loadPrefs(), ...(partial || {}) });
  try {
    const p = getPrefsPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err) {
    console.error('[context-usage] failed to save prefs:', err.message);
  }
  return merged;
}

function findAppDataDirs() {
  const dataDir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (dataDir) {
    for (let d = dataDir; d !== dirname(d); d = dirname(d)) {
      if (basename(d) !== 'sidecar_data') continue;
      const appData = dirname(d);
      if (existsSync(join(appData, 'brain'))) return [appData];
    }
  }
  const root = join(homedir(), '.gemini');
  return safeReaddir(root)
    .sort()
    .map((name) => join(root, name))
    .filter((dir) => existsSync(join(dir, 'brain')));
}

function localDateKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function extractTitle(content) {
  if (typeof content !== 'string' || !content) return '';
  let text = content;
  const match = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i.exec(text);
  if (match) text = match[1];
  text = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > 56 ? `${text.slice(0, 55)}…` : text;
}

const transcriptCache = new Map();

function parseTranscript(sessionId, filePath, stat) {
  const key = `${stat.mtimeMs}:${stat.size}`;
  const cached = transcriptCache.get(filePath);
  if (cached && cached.key === key) {
    return cached.session;
  }

  let raw = '';
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  let title = '';
  const turns = [];
  let latestTs = stat.mtimeMs;
  let totalIn = 0;
  let totalCache = 0;
  let totalOut = 0;
  let totalCostUsd = 0;
  let totalSavedUsd = 0;

  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    const ts = obj.created_at ? Date.parse(obj.created_at) : NaN;
    if (Number.isFinite(ts) && ts > latestTs) {
      latestTs = ts;
    }

    if (!title && obj.type === 'USER_INPUT' && obj.content) {
      title = extractTitle(obj.content);
    }

    const hasTokens =
      typeof obj.input_tokens === 'number' ||
      typeof obj.cache_read_tokens === 'number' ||
      typeof obj.output_tokens === 'number';

    if (hasTokens) {
      const inputTokens = Math.max(0, Number(obj.input_tokens) || 0);
      const cacheReadTokens = Math.max(0, Number(obj.cache_read_tokens) || 0);
      const outputTokens = Math.max(0, Number(obj.output_tokens) || 0);
      const contextTokens = inputTokens + cacheReadTokens;
      const model = typeof obj.model === 'string' && obj.model ? obj.model : 'unknown';
      const { costUsd, savedUsd } = estimateTurnCost(model, inputTokens, cacheReadTokens, outputTokens);

      totalIn += inputTokens;
      totalCache += cacheReadTokens;
      totalOut += outputTokens;
      totalCostUsd += costUsd;
      totalSavedUsd += savedUsd;

      turns.push({
        stepIndex: typeof obj.step_index === 'number' ? obj.step_index : turns.length,
        ts: Number.isFinite(ts) ? ts : stat.mtimeMs,
        model,
        type: obj.type || '',
        inputTokens,
        cacheReadTokens,
        outputTokens,
        contextTokens,
        costUsd,
        savedUsd,
      });
    }
  }

  const contextTurns = turns.filter((t) => t.contextTokens > 0);
  const lastTurn = contextTurns.length
    ? contextTurns[contextTurns.length - 1]
    : turns.length
      ? turns[turns.length - 1]
      : null;

  // Estimate average positive growth per turn (using recent 10 turns if available)
  let avgGrowthPerTurn = 0;
  if (contextTurns.length >= 2) {
    const recent = contextTurns.slice(-11);
    let deltaSum = 0;
    let deltaCount = 0;
    for (let i = 1; i < recent.length; i++) {
      const diff = recent[i].contextTokens - recent[i - 1].contextTokens;
      if (diff > 0) {
        deltaSum += diff;
        deltaCount++;
      }
    }
    if (deltaCount > 0) {
      avgGrowthPerTurn = Math.round(deltaSum / deltaCount);
    }
  }

  const session = {
    id: sessionId,
    title: title || `Session ${sessionId.slice(0, 8)}`,
    updatedAt: lastTurn ? Math.max(lastTurn.ts, stat.mtimeMs) : latestTs,
    turns,
    contextTurnsCount: contextTurns.length,
    avgGrowthPerTurn,
    lastTurn,
    cumulative: {
      newIn: totalIn,
      cacheRead: totalCache,
      out: totalOut,
      effectiveTotal: totalIn + totalOut,
      totalProcessed: totalIn + totalCache + totalOut,
      cacheHitPct: totalIn + totalCache > 0 ? (totalCache / (totalIn + totalCache)) * 100 : 0,
      costUsd: totalCostUsd,
      savedUsd: totalSavedUsd,
    },
  };

  transcriptCache.set(filePath, { key, session });
  return session;
}

function loadAllSessions() {
  const appDataDirs = findAppDataDirs();
  const seenPaths = new Set();
  const sessions = [];
  let totalDirs = 0;

  for (const appData of appDataDirs) {
    const brainDir = join(appData, 'brain');
    const entries = safeReaddir(brainDir);
    for (const id of entries) {
      const transcriptPath = join(brainDir, id, '.system_generated', 'logs', 'transcript.jsonl');
      let stat;
      try {
        stat = statSync(transcriptPath);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }
      totalDirs++;
      seenPaths.add(transcriptPath);
      const parsed = parseTranscript(id, transcriptPath, stat);
      if (parsed) {
        sessions.push(parsed);
      }
    }
  }

  for (const cachedPath of transcriptCache.keys()) {
    if (!seenPaths.has(cachedPath)) {
      transcriptCache.delete(cachedPath);
    }
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return { sessions, totalLocalSessions: totalDirs };
}

function downsampleSparkline(turns, maxPoints = 80) {
  const pts = turns.map((t, idx) => {
    const prev = idx > 0 ? turns[idx - 1].contextTokens : 0;
    const totalIn = t.inputTokens + t.cacheReadTokens;
    return {
      turn: idx + 1,
      contextTokens: t.contextTokens,
      delta: idx > 0 ? t.contextTokens - prev : t.contextTokens,
      cacheHitPct: totalIn > 0 ? Math.round((t.cacheReadTokens / totalIn) * 100) : 0,
      model: t.model,
      ts: t.ts,
    };
  });
  if (pts.length <= maxPoints) return pts;
  const out = [];
  const step = (pts.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    out.push(pts[Math.round(i * step)]);
  }
  return out;
}

function buildUsageSnapshot({ sessionParam = 'auto', range = 'today', conversationId = '' } = {}) {
  const now = Date.now();
  const { sessions, totalLocalSessions } = loadAllSessions();
  const sessionsWithTurns = sessions.filter((s) => s.turns.length > 0);

  let selected = null;
  let selectionMode = 'auto';

  if (sessionParam && sessionParam !== 'auto') {
    selected = sessions.find((s) => s.id === sessionParam) || null;
    if (selected) selectionMode = 'manual';
  }

  if (!selected) {
    if (conversationId) {
      const current = sessionsWithTurns.find((s) => s.id === conversationId);
      if (current) selected = current;
    }
    if (!selected && sessionsWithTurns.length > 0) {
      selected = sessionsWithTurns[0];
    }
    if (!selected && sessions.length > 0) {
      selected = sessions[0];
    }
  }

  let contextWindow = null;
  if (selected && selected.lastTurn) {
    const lt = selected.lastTurn;
    const ltTotalIn = lt.inputTokens + lt.cacheReadTokens;
    const ltCacheHitPct = ltTotalIn > 0 ? (lt.cacheReadTokens / ltTotalIn) * 100 : 0;
    const contextTurns = selected.turns.filter((t) => t.contextTokens > 0);

    contextWindow = {
      sessionId: selected.id,
      title: selected.title,
      contextTokens: lt.contextTokens,
      approxWords: Math.round(lt.contextTokens * 0.75),
      approxFiles: Math.max(1, Math.round(lt.contextTokens / 3000)),
      avgGrowthPerTurn: selected.avgGrowthPerTurn,
      model: lt.model,
      turnsCount: selected.turns.length,
      updatedAt: selected.updatedAt,
      sparkline: downsampleSparkline(contextTurns.length ? contextTurns : selected.turns, 80),
      lastTurn: {
        inputTokens: lt.inputTokens,
        cacheReadTokens: lt.cacheReadTokens,
        outputTokens: lt.outputTokens,
        cacheHitPct: ltCacheHitPct,
      },
      cumulative: {
        total: selected.cumulative.effectiveTotal,
        newIn: selected.cumulative.newIn,
        out: selected.cumulative.out,
        cacheRead: selected.cumulative.cacheRead,
        cacheHitPct: selected.cumulative.cacheHitPct,
        costUsd: selected.cumulative.costUsd,
        savedUsd: selected.cumulative.savedUsd,
      },
    };
  }

  const todayStart = startOfLocalDay(now);
  const normalizedRange = ['today', '7d', '30d', 'all'].includes(range) ? range : 'today';
  let minTs = 0;
  if (normalizedRange === 'today') minTs = todayStart;
  else if (normalizedRange === '7d') minTs = todayStart - 6 * DAY_MS;
  else if (normalizedRange === '30d') minTs = todayStart - 29 * DAY_MS;

  let newInput = 0;
  let output = 0;
  let cacheRead = 0;
  let calls = 0;
  let totalCostUsd = 0;
  let totalSavedUsd = 0;
  const activeSessionsInRange = new Set();
  const modelMap = new Map();
  const dailyEffective = new Map();
  const rangeActiveDays = new Set();

  for (const s of sessionsWithTurns) {
    for (const t of s.turns) {
      const dayKey = localDateKey(t.ts);
      dailyEffective.set(dayKey, (dailyEffective.get(dayKey) || 0) + t.inputTokens + t.outputTokens);

      if (t.ts >= minTs) {
        newInput += t.inputTokens;
        output += t.outputTokens;
        cacheRead += t.cacheReadTokens;
        calls += 1;
        totalCostUsd += t.costUsd || 0;
        totalSavedUsd += t.savedUsd || 0;
        activeSessionsInRange.add(s.id);
        rangeActiveDays.add(dayKey);

        let m = modelMap.get(t.model);
        if (!m) {
          m = { model: t.model, calls: 0, newIn: 0, out: 0, cacheRead: 0, costUsd: 0 };
          modelMap.set(t.model, m);
        }
        m.calls += 1;
        m.newIn += t.inputTokens;
        m.out += t.outputTokens;
        m.cacheRead += t.cacheReadTokens;
        m.costUsd += t.costUsd || 0;
      }
    }
  }

  const todayKey = localDateKey(now);
  const sortedDayKeys = [...dailyEffective.keys()].sort();
  const pastDayKeys = sortedDayKeys.filter((k) => k !== todayKey).slice(-30);
  const baselineKeys = pastDayKeys.length > 0 ? pastDayKeys : sortedDayKeys.slice(-30);
  const baselineTotal = baselineKeys.reduce((acc, k) => acc + (dailyEffective.get(k) || 0), 0);
  const baselineDailyAvg = baselineKeys.length > 0 ? baselineTotal / baselineKeys.length : 0;

  const rangeEffective = newInput + output;
  const rangeDivisor = normalizedRange === 'today' ? 1 : Math.max(1, rangeActiveDays.size);
  const currentDailyRate = rangeEffective / rangeDivisor;
  const paceRatio = baselineDailyAvg > 0 ? currentDailyRate / baselineDailyAvg : 0;

  const totalInputWithCache = newInput + cacheRead;
  const cacheHitRate = totalInputWithCache > 0 ? (cacheRead / totalInputWithCache) * 100 : 0;

  const models = [...modelMap.values()]
    .map((m) => ({
      ...m,
      sharePct: calls > 0 ? (m.calls / calls) * 100 : 0,
    }))
    .sort((a, b) => b.calls - a.calls || b.newIn - a.newIn);

  const sessionOptions = sessionsWithTurns.slice(0, 60).map((s) => ({
    id: s.id,
    title: s.title,
    model: s.lastTurn?.model || '',
    contextTokens: s.lastTurn?.contextTokens || 0,
    turns: s.turns.length,
    updatedAt: s.updatedAt,
  }));

  return {
    now,
    selectionMode,
    selectedSessionId: selected?.id || null,
    activeConversationId: conversationId || null,
    contextWindow,
    localUsage: {
      range: normalizedRange,
      newInput,
      output,
      cacheRead,
      totalProcessed: newInput + cacheRead + output,
      costUsd: totalCostUsd,
      savedUsd: totalSavedUsd,
      calls,
      sessionsCount: activeSessionsInRange.size,
      cacheHitRate,
      pace: {
        ratio: paceRatio,
        activeDaysCount: baselineKeys.length,
        baselineDailyAvg,
      },
      equivalents: {
        writtenCodeLines: Math.round(output / 12),
        writtenPages: Math.round(output / 500),
        readCodeFiles: Math.round(newInput / 3000),
        readWords: Math.round(newInput * 0.75),
      },
      models,
    },
    sessions: sessionOptions,
    totalLocalSessions,
  };
}

if (process.argv.includes('--selftest')) {
  const prefs = loadPrefs();
  const snap = buildUsageSnapshot({ sessionParam: 'auto', range: 'today' });
  console.log(
    JSON.stringify(
      {
        prefs,
        totalLocalSessions: snap.totalLocalSessions,
        selectedSessionId: snap.selectedSessionId,
        contextWindow: snap.contextWindow
          ? {
              contextTokens: snap.contextWindow.contextTokens,
              approxFiles: snap.contextWindow.approxFiles,
              avgGrowthPerTurn: snap.contextWindow.avgGrowthPerTurn,
              model: snap.contextWindow.model,
              turnsCount: snap.contextWindow.turnsCount,
            }
          : null,
        localUsage: {
          range: snap.localUsage.range,
          calls: snap.localUsage.calls,
          sessionsCount: snap.localUsage.sessionsCount,
          equivalents: snap.localUsage.equivalents,
          topModels: snap.localUsage.models.slice(0, 2),
        },
      },
      null,
      2
    )
  );
  process.exit(0);
}

const app = new SidecarApp();

function serveStatic(fileName, contentType) {
  return () =>
    new Response(readFileSync(join(__dirname, fileName)), {
      contentType,
      headers: { 'Cache-Control': 'no-cache' },
    });
}

app.page('/', serveStatic('index.html', 'text/html; charset=utf-8'));
app.page('/styles.css', serveStatic('styles.css', 'text/css; charset=utf-8'));
app.page('/app.js', serveStatic('app.js', 'application/javascript; charset=utf-8'));

app.api('/api/prefs', () => loadPrefs(), 'GET');
app.api('/api/prefs', (data) => savePrefs(data), 'POST');

app.api(
  '/api/usage',
  (data) => {
    const sessionParam = typeof data.session === 'string' ? data.session : 'auto';
    const range = typeof data.range === 'string' ? data.range : 'today';
    const conversationId =
      (typeof data.conversationId === 'string' && data.conversationId) ||
      app.config.conversationId ||
      '';
    return buildUsageSnapshot({ sessionParam, range, conversationId });
  },
  'GET'
);

app.run();
