import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..', '..');
const DAY_MS = 24 * 60 * 60 * 1000;

function readPluginVersion() {
  try {
    const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'plugin.json'), 'utf-8'));
    return typeof manifest.version === 'string' ? manifest.version : '1.0.0';
  } catch {
    return '1.0.0';
  }
}

function runPluginUpdate() {
  const beforeVersion = readPluginVersion();
  const isGitRepo = existsSync(join(PLUGIN_ROOT, '.git'));
  if (!isGitRepo) {
    return {
      ok: false,
      status: 'no-git',
      version: beforeVersion,
      message: 'Not a git repository (reinstall via git clone to enable 1-click updates).',
    };
  }
  try {
    const out = execFileSync('git', ['pull', '--ff-only'], {
      cwd: PLUGIN_ROOT,
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const afterVersion = readPluginVersion();
    const upToDate = /already up[- ]to[- ]date/i.test(out);
    if (!upToDate) {
      // Let HTTP response flush, then exit so Antigravity restarts sidecar with updated code
      setTimeout(() => process.exit(0), 600);
    }
    return {
      ok: true,
      status: upToDate ? 'up-to-date' : 'updated',
      version: afterVersion,
      output: out,
    };
  } catch (err) {
    const msg = (err.stderr || err.message || 'git pull failed').toString().trim();
    return {
      ok: false,
      status: 'error',
      version: beforeVersion,
      message: msg.slice(0, 220),
    };
  }
}

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

  // Track content weight since the last CHECKPOINT (compaction) for context breakdown
  let firstUserChars = 0;
  let segMsgChars = 0;
  let segToolChars = 0;
  let segThinkChars = 0;
  let segMediaCount = 0;
  let firstTurnContextAfterReset = 0;

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

    if (obj.type === 'CHECKPOINT') {
      segMsgChars = typeof obj.content === 'string' ? obj.content.length : 0;
      segToolChars = 0;
      segThinkChars = 0;
      segMediaCount = 0;
      firstTurnContextAfterReset = 0;
    }

    if (obj.type === 'USER_INPUT') {
      const cLen = typeof obj.content === 'string' ? obj.content.length : 0;
      if (!title && obj.content) {
        title = extractTitle(obj.content);
        firstUserChars = cLen;
      }
      segMsgChars += cLen;
      if (Array.isArray(obj.media)) segMediaCount += obj.media.length;
    } else if (obj.type === 'SYSTEM_MESSAGE') {
      segMsgChars += typeof obj.content === 'string' ? obj.content.length : 0;
    } else if (obj.type === 'GENERIC') {
      segToolChars += typeof obj.content === 'string' ? obj.content.length : 0;
    } else if (obj.type === 'PLANNER_RESPONSE') {
      if (typeof obj.content === 'string') segMsgChars += obj.content.length;
      if (typeof obj.response === 'string') segMsgChars += obj.response.length;
      if (typeof obj.thinking === 'string') segThinkChars += obj.thinking.length;
      if (Array.isArray(obj.tool_calls)) {
        segToolChars += JSON.stringify(obj.tool_calls).length;
      }
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

      if (firstTurnContextAfterReset === 0 && contextTokens > 0) {
        firstTurnContextAfterReset = contextTokens;
      }

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

  // Calibrate context breakdown to lastTurn.contextTokens
  let breakdown = null;
  if (lastTurn && lastTurn.contextTokens > 0) {
    const totalCtx = lastTurn.contextTokens;
    const firstUserEst = Math.round(firstUserChars / 4);
    const rawSystem =
      firstTurnContextAfterReset > firstUserEst
        ? firstTurnContextAfterReset - firstUserEst
        : Math.min(totalCtx, 12000);
    const systemTokens = Math.min(totalCtx, Math.max(0, rawSystem));
    const dynamicBudget = Math.max(0, totalCtx - systemTokens);

    const estMsg = Math.round(segMsgChars / 4) + segMediaCount * 1200;
    const estTool = Math.round(segToolChars / 4);
    const estThink = Math.round(segThinkChars / 4);
    const estSum = estMsg + estTool + estThink;

    let messagesTokens = 0;
    let toolsTokens = 0;
    let thinkingTokens = 0;
    if (estSum > 0 && dynamicBudget > 0) {
      messagesTokens = Math.round((estMsg / estSum) * dynamicBudget);
      toolsTokens = Math.round((estTool / estSum) * dynamicBudget);
      thinkingTokens = Math.max(0, dynamicBudget - messagesTokens - toolsTokens);
    } else {
      messagesTokens = dynamicBudget;
    }

    breakdown = {
      system: systemTokens,
      messages: messagesTokens,
      tools: toolsTokens,
      thinking: thinkingTokens,
    };
  }

  const session = {
    id: sessionId,
    title: title || `Session ${sessionId.slice(0, 8)}`,
    updatedAt: lastTurn ? Math.max(lastTurn.ts, stat.mtimeMs) : latestTs,
    turns,
    contextTurnsCount: contextTurns.length,
    avgGrowthPerTurn,
    lastTurn,
    breakdown,
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

let cachedEnvInventory = { ts: 0, data: null };
function loadEnvInventory() {
  const now = Date.now();
  if (cachedEnvInventory.data && now - cachedEnvInventory.ts < 30000) {
    return cachedEnvInventory.data;
  }

  const appDataDirs = findAppDataDirs();
  const primaryAppData = appDataDirs[0] || join(homedir(), '.gemini', 'antigravity');
  const configDir = join(homedir(), '.gemini', 'config');

  // MCP servers & tools
  const mcpDir = join(primaryAppData, 'mcp');
  const mcpServers = [];
  let mcpToolCount = 0;
  for (const name of safeReaddir(mcpDir)) {
    const dir = join(mcpDir, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const tools = safeReaddir(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''));
      if (tools.length > 0) {
        mcpServers.push({ name, count: tools.length });
        mcpToolCount += tools.length;
      }
    } catch {
      continue;
    }
  }
  mcpServers.sort((a, b) => b.count - a.count);

  // Global skills
  const skillsDir = join(configDir, 'skills');
  const skills = safeReaddir(skillsDir)
    .filter((name) => {
      try {
        return statSync(join(skillsDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();

  // Knowledge / Memory items
  const knowledgeDir = join(primaryAppData, 'knowledge');
  const memories = safeReaddir(knowledgeDir)
    .filter((name) => {
      try {
        return statSync(join(knowledgeDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();

  const data = {
    mcpToolCount,
    mcpServers,
    skillsCount: skills.length,
    skills,
    memoriesCount: memories.length,
    memories,
  };
  cachedEnvInventory = { ts: now, data };
  return data;
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
      breakdown: selected.breakdown,
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
    inventory: loadEnvInventory(),
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

app.api('/api/prefs', () => ({ ...loadPrefs(), version: readPluginVersion(), canGitUpdate: existsSync(join(PLUGIN_ROOT, '.git')) }), 'GET');
app.api('/api/prefs', (data) => ({ ...savePrefs(data), version: readPluginVersion(), canGitUpdate: existsSync(join(PLUGIN_ROOT, '.git')) }), 'POST');
app.api('/api/update', () => runPluginUpdate(), 'POST');

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
