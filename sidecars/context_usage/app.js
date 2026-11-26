(function () {
  const I18N = {
    en: {
      settingsTitle: 'Defaults',
      saved: 'Saved',
      prefLang: 'Language',
      prefCurrency: 'Currency',
      prefLimit: 'Context limit',
      prefRange: 'Timeframe',
      prefRefresh: 'Refresh',
      optAuto: 'Auto',
      optManual: 'Manual',
      autoSession: 'Auto · Active Session',
      contextTitle: 'CONTEXT',
      cwEmpty: 'No turns recorded in this session yet.',
      statusHealthy: 'Healthy',
      statusGrowing: 'Growing',
      statusHigh: 'Getting Full',
      statusCritical: 'Near Limit',
      summary: (left, turnsEst, cachePct) =>
        turnsEst
          ? `${left} free (~${turnsEst} turns left) · ${cachePct}% cached`
          : `${left} free · ${cachePct}% cached`,
      alertHigh: 'Context is getting heavy — consider /compact or a new chat soon.',
      alertCritical: 'Near limit — auto-compaction soon. Start a new chat for best quality.',
      foot: (lastIn, lastCache, cumTotal, costStr, updated) =>
        `Last: ${lastIn} + ${lastCache} cache · Session: ${cumTotal} (${costStr}) · ${updated}`,
      usageTitle: 'USAGE',
      rangeToday: 'Today',
      range7d: '7D',
      range30d: '30D',
      rangeAll: 'All',
      paceLight: 'Light',
      paceNormal: 'Normal',
      paceBusy: 'Busy',
      paceHeavy: 'Intense',
      digest: (ratio, lines, files) =>
        `${ratio}× daily avg · ~${lines} lines written · ~${files} files read`,
      costTitle: (saved) => `API-rate estimate · saved ${saved} via prompt cache`,
      kpiFresh: 'FRESH IN',
      kpiFreshSub: (files) => `~${files} code files`,
      kpiOut: 'OUTPUT',
      kpiOutSub: (turns, chats) => `${turns} turns · ${chats} chats`,
      kpiCache: 'CACHED',
      kpiCacheSub: (saved) => `saved ${saved}`,
      thModel: 'MODEL',
      thCalls: 'TURNS',
      thTokens: 'IN / OUT',
      thCost: 'EST.',
      tableEmpty: 'No usage in this timeframe.',
      footer: (n) => `${n} local sessions · 0 token overhead`,
      justNow: 'just now',
      secAgo: (n) => `${n}s ago`,
      minAgo: (n) => `${n}m ago`,
      hrAgo: (n) => `${n}h ago`,
      dayAgo: (n) => `${n}d ago`,
    },
    id: {
      settingsTitle: 'Default',
      saved: 'Tersimpan',
      prefLang: 'Bahasa',
      prefCurrency: 'Mata uang',
      prefLimit: 'Batas context',
      prefRange: 'Rentang',
      prefRefresh: 'Refresh',
      optAuto: 'Otomatis',
      optManual: 'Manual',
      autoSession: 'Otomatis · Sesi Aktif',
      contextTitle: 'CONTEXT',
      cwEmpty: 'Belum ada turn di sesi ini.',
      statusHealthy: 'Lega',
      statusGrowing: 'Mulai Padat',
      statusHigh: 'Padat',
      statusCritical: 'Hampir Penuh',
      summary: (left, turnsEst, cachePct) =>
        turnsEst
          ? `Sisa ${left} (±${turnsEst} turn lagi) · ${cachePct}% cache`
          : `Sisa ${left} · ${cachePct}% cache`,
      alertHigh: 'Context mulai berat — pertimbangkan /compact atau chat baru.',
      alertCritical: 'Hampir penuh — compaction segera terjadi. Buka chat baru agar tetap tajam.',
      foot: (lastIn, lastCache, cumTotal, costStr, updated) =>
        `Terakhir: ${lastIn} + ${lastCache} cache · Sesi: ${cumTotal} (${costStr}) · ${updated}`,
      usageTitle: 'PENGGUNAAN',
      rangeToday: 'Hari Ini',
      range7d: '7H',
      range30d: '30H',
      rangeAll: 'Semua',
      paceLight: 'Santai',
      paceNormal: 'Normal',
      paceBusy: 'Sibuk',
      paceHeavy: 'Intensif',
      digest: (ratio, lines, files) =>
        `${ratio}× rata-rata harian · ±${lines} baris kode · ±${files} file dibaca`,
      costTitle: (saved) => `Estimasi tarif API · hemat ${saved} dari cache`,
      kpiFresh: 'INPUT BARU',
      kpiFreshSub: (files) => `±${files} file kode`,
      kpiOut: 'OUTPUT AI',
      kpiOutSub: (turns, chats) => `${turns} turn · ${chats} chat`,
      kpiCache: 'CACHE',
      kpiCacheSub: (saved) => `hemat ${saved}`,
      thModel: 'MODEL',
      thCalls: 'TURN',
      thTokens: 'IN / OUT',
      thCost: 'EST.',
      tableEmpty: 'Belum ada penggunaan pada rentang ini.',
      footer: (n) => `${n} sesi lokal · 0 token overhead`,
      justNow: 'baru saja',
      secAgo: (n) => `${n}d lalu`,
      minAgo: (n) => `${n}m lalu`,
      hrAgo: (n) => `${n}j lalu`,
      dayAgo: (n) => `${n}h lalu`,
    },
  };

  const state = {
    lang: 'en',
    currency: 'auto',
    limitMode: 'auto',
    limit: 1000000,
    manualLimitOverride: false,
    range: 'today',
    refreshMs: 5000,
    session: 'auto',
    paused: false,
    lastData: null,
    timer: null,
    savedTimer: null,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    liveDot: $('live-dot'),
    btnSettings: $('btn-settings'),
    btnPause: $('btn-pause'),
    btnRefresh: $('btn-refresh'),
    settingsPanel: $('settings-panel'),
    lblSettingsTitle: $('lbl-settings-title'),
    lblSettingsSaved: $('lbl-settings-saved'),
    lblPrefLang: $('lbl-pref-lang'),
    lblPrefCurrency: $('lbl-pref-currency'),
    lblPrefLimit: $('lbl-pref-limit'),
    lblPrefRange: $('lbl-pref-range'),
    lblPrefRefresh: $('lbl-pref-refresh'),
    prefLang: $('pref-lang'),
    prefCurrency: $('pref-currency'),
    prefLimit: $('pref-limit'),
    prefRange: $('pref-range'),
    prefRefresh: $('pref-refresh'),
    sessionSelect: $('session-select'),
    cwHeading: $('cw-heading'),
    cwEmpty: $('cw-empty'),
    cwBody: $('cw-body'),
    cwPct: $('cw-pct'),
    cwStatusBadge: $('cw-status-badge'),
    cwTokensPair: $('cw-tokens-pair'),
    cwBar: $('cw-bar'),
    cwSummary: $('cw-summary'),
    cwAlert: $('cw-alert'),
    cwModelLine: $('cw-model-line'),
    sparkTooltip: $('spark-tooltip'),
    cwSparkline: $('cw-sparkline'),
    cwFoot: $('cw-foot'),
    luHeading: $('lu-heading'),
    luPaceBadge: $('lu-pace-badge'),
    luCostPill: $('lu-cost-pill'),
    luDigest: $('lu-digest'),
    lblKpiFresh: $('lbl-kpi-fresh'),
    luNewIn: $('lu-new-in'),
    luNewInSub: $('lu-new-in-sub'),
    lblKpiOut: $('lbl-kpi-out'),
    luOutput: $('lu-output'),
    luOutputSub: $('lu-output-sub'),
    lblKpiCache: $('lbl-kpi-cache'),
    luCache: $('lu-cache'),
    luCacheSub: $('lu-cache-sub'),
    thModel: $('th-model'),
    thCalls: $('th-calls'),
    thTokens: $('th-tokens'),
    thCost: $('th-cost'),
    luModelsBody: $('lu-models-body'),
    footerMeta: $('footer-meta'),
  };

  const t = () => I18N[state.lang] || I18N.en;
  const fetcher = () => (window.sidecar?.fetch ? window.sidecar.fetch : window.fetch.bind(window));

  function fmtCompact(n) {
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(Math.round(n));
  }

  function fmtInt(n) {
    return Math.round(n || 0).toLocaleString(state.lang === 'id' ? 'id-ID' : 'en-US');
  }

  const USD_TO_IDR = 16500;
  function getModelRates(modelName) {
    const m = String(modelName || '').toLowerCase();
    if (m.includes('opus')) return { in: 5.0, cache: 0.5, out: 25.0 };
    if (m.includes('sonnet')) return { in: 3.0, cache: 0.3, out: 15.0 };
    if (m.includes('haiku')) return { in: 0.8, cache: 0.08, out: 4.0 };
    if (/flash[-_]?lite|[-_](mini|nano)\b/.test(m)) return { in: 0.15, cache: 0.015, out: 0.6 };
    if (m.includes('flash') || m.includes('argon')) return { in: 0.3, cache: 0.03, out: 2.5 };
    if (m.includes('tiered-high') || m.includes('-high') || m.includes('ultra')) return { in: 2.5, cache: 0.25, out: 15.0 };
    return { in: 1.25, cache: 0.125, out: 10.0 };
  }

  function calcCost(model, newIn, cacheRead, out) {
    const r = getModelRates(model);
    return {
      costUsd: ((newIn || 0) * r.in + (cacheRead || 0) * r.cache + (out || 0) * r.out) / 1_000_000,
      savedUsd: ((cacheRead || 0) * Math.max(0, r.in - r.cache)) / 1_000_000,
    };
  }

  function fmtMoney(usd) {
    const val = Number(usd) || 0;
    const useIdr = state.currency === 'idr' || (state.currency === 'auto' && state.lang === 'id');
    if (useIdr) {
      const idr = val * USD_TO_IDR;
      if (idr >= 1_000_000) return `~Rp${(idr / 1_000_000).toFixed(2)}jt`;
      if (idr >= 1_000) return `~Rp${(idr / 1_000).toFixed(idr >= 100_000 ? 0 : 1)}rb`;
      return `~Rp${Math.round(idr)}`;
    }
    if (val >= 100) return `~$${val.toFixed(0)}`;
    if (val >= 10) return `~$${val.toFixed(1)}`;
    return `~$${val.toFixed(2)}`;
  }

  function fmtRelTime(ts, now) {
    const dict = t();
    if (!ts) return '-';
    const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
    if (diffSec < 5) return dict.justNow;
    if (diffSec < 60) return dict.secAgo(diffSec);
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return dict.minAgo(diffMin);
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return dict.hrAgo(diffHr);
    return dict.dayAgo(Math.floor(diffHr / 24));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function applyStaticStrings() {
    const dict = t();
    document.documentElement.lang = state.lang;
    els.lblSettingsTitle.textContent = dict.settingsTitle;
    els.lblSettingsSaved.textContent = dict.saved;
    els.lblPrefLang.textContent = dict.prefLang;
    els.lblPrefCurrency.textContent = dict.prefCurrency;
    els.lblPrefLimit.textContent = dict.prefLimit;
    els.lblPrefRange.textContent = dict.prefRange;
    els.lblPrefRefresh.textContent = dict.prefRefresh;
    els.prefCurrency.options[0].textContent = dict.optAuto;
    els.prefLimit.options[0].textContent = dict.optAuto;
    els.prefRefresh.options[3].textContent = dict.optManual;
    els.prefRange.options[0].textContent = dict.rangeToday;
    els.prefRange.options[1].textContent = dict.range7d;
    els.prefRange.options[2].textContent = dict.range30d;
    els.prefRange.options[3].textContent = dict.rangeAll;

    els.cwHeading.textContent = dict.contextTitle;
    els.cwEmpty.textContent = dict.cwEmpty;
    els.luHeading.textContent = dict.usageTitle;
    els.lblKpiFresh.textContent = dict.kpiFresh;
    els.lblKpiOut.textContent = dict.kpiOut;
    els.lblKpiCache.textContent = dict.kpiCache;
    els.thModel.textContent = dict.thModel;
    els.thCalls.textContent = dict.thCalls;
    els.thTokens.textContent = dict.thTokens;
    els.thCost.textContent = dict.thCost;

    document.querySelectorAll('[data-lang]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === state.lang);
    });
    document.querySelectorAll('[data-range]').forEach((btn) => {
      const r = btn.getAttribute('data-range');
      if (r === 'today') btn.textContent = dict.rangeToday;
      else if (r === '7d') btn.textContent = dict.range7d;
      else if (r === '30d') btn.textContent = dict.range30d;
      else if (r === 'all') btn.textContent = dict.rangeAll;
      btn.classList.toggle('active', r === state.range);
    });
  }

  function setLimitButtons() {
    document.querySelectorAll('[data-limit]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.getAttribute('data-limit')) === state.limit);
    });
  }

  function showSavedPill() {
    els.lblSettingsSaved.classList.remove('hidden');
    if (state.savedTimer) clearTimeout(state.savedTimer);
    state.savedTimer = setTimeout(() => els.lblSettingsSaved.classList.add('hidden'), 1600);
  }

  async function persistPrefs(partial) {
    try {
      const res = await fetcher()('/api/prefs', {
        method: 'POST',
        body: JSON.stringify(partial),
      });
      if (res.ok) {
        syncPrefsToUI(await res.json());
        showSavedPill();
      }
    } catch (err) {
      console.error('[context-usage] save prefs failed:', err);
    }
  }

  function syncPrefsToUI(prefs) {
    state.lang = prefs.lang || 'en';
    state.currency = prefs.currency || 'auto';
    state.limitMode = prefs.limitMode || 'auto';
    state.refreshMs = Number.isFinite(Number(prefs.refreshMs)) ? Number(prefs.refreshMs) : 5000;
    if (state.limitMode !== 'auto') state.limit = Number(state.limitMode);
    els.prefLang.value = state.lang;
    els.prefCurrency.value = state.currency;
    els.prefLimit.value = state.limitMode;
    els.prefRange.value = prefs.defaultRange || state.range;
    els.prefRefresh.value = String(state.refreshMs);
    applyStaticStrings();
    setLimitButtons();
    startPolling();
  }

  function renderSparkline(points) {
    const svg = els.cwSparkline;
    if (!points || points.length === 0) {
      svg.innerHTML = '';
      els.sparkTooltip.textContent = '';
      return;
    }

    const W = 320;
    const H = 44;
    const padTop = 5;
    const padBottom = 2;
    const usableH = H - padTop - padBottom;
    const maxVal = Math.max(1, ...points.map((p) => p.contextTokens));

    const coords = points.map((p, idx) => ({
      x: points.length === 1 ? W : (idx / (points.length - 1)) * W,
      y: H - padBottom - (p.contextTokens / maxVal) * usableH,
      ...p,
    }));

    const linePath = coords
      .map((c, idx) => `${idx === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      .join(' ');
    const areaPath = `${linePath} L${W},${H} L0,${H} Z`;

    svg.innerHTML = `
      <defs>
        <linearGradient id="cuAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2563eb" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#2563eb" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#cuAreaGrad)" />
      <path d="${linePath}" fill="none" stroke="#2563eb" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
    `;

    const last = coords[coords.length - 1];
    els.sparkTooltip.textContent = `T${last.turn} · ${fmtCompact(last.contextTokens)}`;

    svg.onmousemove = (e) => {
      const rect = svg.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const pt = coords[Math.min(coords.length - 1, Math.round(ratio * (coords.length - 1)))];
      if (!pt) return;
      const sign = pt.delta >= 0 ? '+' : '-';
      els.sparkTooltip.textContent = `T${pt.turn} · ${fmtCompact(pt.contextTokens)} (${sign}${fmtCompact(Math.abs(pt.delta))})`;
    };
    svg.onmouseleave = () => {
      els.sparkTooltip.textContent = `T${last.turn} · ${fmtCompact(last.contextTokens)}`;
    };
  }

  function renderSessionSelect(sessions) {
    const prevValue = state.session;
    els.sessionSelect.innerHTML = [
      `<option value="auto">${escapeHtml(t().autoSession)}</option>`,
      ...sessions.map(
        (s) =>
          `<option value="${escapeHtml(s.id)}">${escapeHtml(`${s.title} (${fmtCompact(s.contextTokens)} · ${s.turns}t)`)}</option>`
      ),
    ].join('');
    els.sessionSelect.value =
      prevValue !== 'auto' && sessions.some((s) => s.id === prevValue) ? prevValue : 'auto';
  }

  function renderContextWindow(cw, now) {
    const dict = t();
    if (!cw) {
      els.cwEmpty.classList.remove('hidden');
      els.cwBody.classList.add('hidden');
      return;
    }
    els.cwEmpty.classList.add('hidden');
    els.cwBody.classList.remove('hidden');

    if (!state.manualLimitOverride) {
      if (state.limitMode === 'auto') {
        state.limit = /claude|sonnet|opus|haiku/i.test(cw.model || '') ? 200000 : 1000000;
      } else {
        state.limit = Number(state.limitMode);
      }
      setLimitButtons();
    }

    const pct = (cw.contextTokens / state.limit) * 100;
    const clampedPct = Math.min(100, Math.max(0, pct));
    const remaining = Math.max(0, state.limit - cw.contextTokens);
    const estTurns =
      cw.avgGrowthPerTurn > 0 && remaining > 0
        ? Math.min(999, Math.max(1, Math.floor(remaining / cw.avgGrowthPerTurn)))
        : null;

    els.cwPct.textContent = `${pct.toFixed(1)}%`;
    els.cwTokensPair.textContent = `${fmtCompact(cw.contextTokens)} / ${fmtCompact(state.limit)}`;
    els.cwBar.style.width = `${clampedPct.toFixed(1)}%`;
    els.cwBar.classList.remove('warn', 'danger');
    els.cwStatusBadge.className = 'badge';
    els.cwAlert.className = 'alert-chip hidden';

    if (pct >= 90) {
      els.cwBar.classList.add('danger');
      els.cwStatusBadge.classList.add('badge-red');
      els.cwStatusBadge.textContent = dict.statusCritical;
      els.cwAlert.className = 'alert-chip danger';
      els.cwAlert.textContent = dict.alertCritical;
    } else if (pct >= 75) {
      els.cwBar.classList.add('danger');
      els.cwStatusBadge.classList.add('badge-red');
      els.cwStatusBadge.textContent = dict.statusHigh;
      els.cwAlert.className = 'alert-chip';
      els.cwAlert.textContent = dict.alertHigh;
    } else if (pct >= 50) {
      els.cwBar.classList.add('warn');
      els.cwStatusBadge.classList.add('badge-amber');
      els.cwStatusBadge.textContent = dict.statusGrowing;
    } else {
      els.cwStatusBadge.classList.add('badge-green');
      els.cwStatusBadge.textContent = dict.statusHealthy;
    }

    els.cwSummary.textContent = dict.summary(
      fmtCompact(remaining),
      estTurns,
      Math.round(cw.lastTurn.cacheHitPct)
    );

    els.cwModelLine.textContent = `${cw.model} · ${cw.turnsCount}t`;
    renderSparkline(cw.sparkline);

    const sessCostUsd =
      typeof cw.cumulative.costUsd === 'number'
        ? cw.cumulative.costUsd
        : calcCost(cw.model, cw.cumulative.newIn, cw.cumulative.cacheRead, cw.cumulative.out).costUsd;

    els.cwFoot.textContent = dict.foot(
      fmtCompact(cw.lastTurn.inputTokens),
      fmtCompact(cw.lastTurn.cacheReadTokens),
      fmtCompact(cw.cumulative.total),
      fmtMoney(sessCostUsd),
      fmtRelTime(cw.updatedAt, now)
    );
  }

  function renderLocalUsage(lu) {
    const dict = t();
    const ratio = lu.pace.ratio || 0;
    let paceLabel = dict.paceLight;
    let paceCls = 'badge-green';
    if (ratio >= 2.0) {
      paceLabel = dict.paceHeavy;
      paceCls = 'badge-red';
    } else if (ratio >= 1.2) {
      paceLabel = dict.paceBusy;
      paceCls = 'badge-amber';
    } else if (ratio >= 0.5) {
      paceLabel = dict.paceNormal;
      paceCls = 'badge-blue';
    }

    const modelsWithCost = (lu.models || []).map((m) => {
      const est = calcCost(m.model, m.newIn, m.cacheRead, m.out);
      return {
        ...m,
        costUsd: typeof m.costUsd === 'number' ? m.costUsd : est.costUsd,
        savedUsd: est.savedUsd,
      };
    });
    const totalCostUsd =
      typeof lu.costUsd === 'number'
        ? lu.costUsd
        : modelsWithCost.reduce((sum, m) => sum + m.costUsd, 0);
    const totalSavedUsd =
      typeof lu.savedUsd === 'number'
        ? lu.savedUsd
        : modelsWithCost.reduce((sum, m) => sum + m.savedUsd, 0);

    els.luPaceBadge.className = `badge ${paceCls}`;
    els.luPaceBadge.textContent = paceLabel;
    els.luCostPill.textContent = fmtMoney(totalCostUsd);
    els.luCostPill.title = dict.costTitle(fmtMoney(totalSavedUsd));
    els.luDigest.textContent = dict.digest(
      ratio.toFixed(1),
      fmtCompact(lu.equivalents.writtenCodeLines),
      fmtInt(lu.equivalents.readCodeFiles)
    );

    els.luNewIn.textContent = fmtCompact(lu.newInput);
    els.luNewInSub.textContent = dict.kpiFreshSub(fmtInt(lu.equivalents.readCodeFiles));

    els.luOutput.textContent = fmtCompact(lu.output);
    els.luOutputSub.textContent = dict.kpiOutSub(fmtInt(lu.calls), fmtInt(lu.sessionsCount));

    els.luCache.textContent = `${lu.cacheHitRate.toFixed(0)}%`;
    els.luCacheSub.textContent = dict.kpiCacheSub(fmtMoney(totalSavedUsd));

    if (modelsWithCost.length === 0) {
      els.luModelsBody.innerHTML = `<tr><td colspan="4" class="table-empty">${escapeHtml(dict.tableEmpty)}</td></tr>`;
    } else {
      els.luModelsBody.innerHTML = modelsWithCost
        .map(
          (m) => `
        <tr>
          <td>
            <div class="model-cell">
              <span class="model-name">${escapeHtml(m.model)}</span>
              <div class="model-bar"><div class="model-bar-fill" style="width:${Math.max(4, Math.round(m.sharePct))}%"></div></div>
            </div>
          </td>
          <td class="num">${fmtInt(m.calls)}</td>
          <td class="num">${fmtCompact(m.newIn)} / ${fmtCompact(m.out)}</td>
          <td class="num">${fmtMoney(m.costUsd)}</td>
        </tr>`
        )
        .join('');
    }
  }

  function renderAll() {
    if (!state.lastData) return;
    renderSessionSelect(state.lastData.sessions || []);
    renderContextWindow(state.lastData.contextWindow, state.lastData.now);
    renderLocalUsage(state.lastData.localUsage);
    els.footerMeta.textContent = t().footer(fmtInt(state.lastData.totalLocalSessions));
  }

  async function fetchAndRender() {
    try {
      const convId = window.sidecar?.conversationId || '';
      const params = new URLSearchParams({ session: state.session, range: state.range });
      if (convId) params.set('conversationId', convId);

      const res = await fetcher()(`/api/usage?${params.toString()}`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.lastData = await res.json();
      renderAll();
    } catch (err) {
      console.error('[context-usage] fetch error:', err);
    }
  }

  function startPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    if (state.refreshMs > 0) {
      state.timer = setInterval(() => {
        if (!state.paused) fetchAndRender();
      }, state.refreshMs);
    }
  }

  document.querySelectorAll('[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      state.lang = lang;
      els.prefLang.value = lang;
      applyStaticStrings();
      renderAll();
      persistPrefs({ lang });
    });
  });

  els.btnSettings.addEventListener('click', () => {
    const isHidden = els.settingsPanel.classList.toggle('hidden');
    els.btnSettings.classList.toggle('active', !isHidden);
    els.btnSettings.setAttribute('aria-expanded', String(!isHidden));
  });

  els.prefLang.addEventListener('change', () => {
    state.lang = els.prefLang.value;
    applyStaticStrings();
    renderAll();
    persistPrefs({ lang: state.lang });
  });

  els.prefCurrency.addEventListener('change', () => {
    state.currency = els.prefCurrency.value;
    renderAll();
    persistPrefs({ currency: state.currency });
  });

  els.prefLimit.addEventListener('change', () => {
    state.limitMode = els.prefLimit.value;
    state.manualLimitOverride = false;
    persistPrefs({ limitMode: state.limitMode });
    renderAll();
  });

  els.prefRange.addEventListener('change', () => {
    state.range = els.prefRange.value;
    applyStaticStrings();
    persistPrefs({ defaultRange: state.range });
    fetchAndRender();
  });

  els.prefRefresh.addEventListener('change', () => {
    state.refreshMs = Number(els.prefRefresh.value);
    persistPrefs({ refreshMs: state.refreshMs });
    startPolling();
  });

  els.btnPause.addEventListener('click', () => {
    state.paused = !state.paused;
    els.btnPause.textContent = state.paused ? '▶' : '⏸';
    els.btnPause.classList.toggle('active', state.paused);
    els.liveDot.classList.toggle('paused', state.paused);
    if (!state.paused) fetchAndRender();
  });

  els.btnRefresh.addEventListener('click', () => fetchAndRender());

  els.sessionSelect.addEventListener('change', () => {
    state.session = els.sessionSelect.value || 'auto';
    state.manualLimitOverride = false;
    fetchAndRender();
  });

  document.querySelectorAll('[data-limit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.limit = Number(btn.getAttribute('data-limit'));
      state.manualLimitOverride = true;
      setLimitButtons();
      renderAll();
    });
  });

  document.querySelectorAll('[data-range]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.range = btn.getAttribute('data-range');
      applyStaticStrings();
      fetchAndRender();
    });
  });

  async function init() {
    try {
      const res = await fetcher()('/api/prefs', { method: 'GET' });
      if (res.ok) {
        const prefs = await res.json();
        state.range = prefs.defaultRange || 'today';
        syncPrefsToUI(prefs);
      } else {
        applyStaticStrings();
        setLimitButtons();
        startPolling();
      }
    } catch {
      applyStaticStrings();
      setLimitButtons();
      startPolling();
    }
    fetchAndRender();
  }

  init();
})();
