// ============================================================================
// AEGIS // GLOBAL STRATEGIC SITUATION ROOM — MAIN APPLICATION CONTROLLER
// ============================================================================

import {
  NODES,
  INITIAL_ARCS,
  SATELLITES,
  INTERCEPT_POOL,
  TRACE_ROUTES,
  formatCoord,
  randomHex,
} from './data.js';
import { WorldMapEngine } from './mapEngine.js';
import { LiveFeedManager } from './liveFeeds.js';
import { RadarWidget, SpectrumWidget, SparklineWidget } from './widgets.js';
import { PanelLayoutManager } from './panelLayout.js';
import { sfx } from './audio.js';
import {
  escapeHtml,
  invalidateThemePalette,
  formatMgrs,
  buildExternalSourceUrl,
} from './utils.js';
import { SUBSEA_CABLES } from './subseaCables.js';

const HUD_STORAGE_KEY = 'aegis-hud-state-v1';
const ALL_LIVE_KEYS = ['liveSats', 'quakes', 'eonet', 'aircraft', 'bgp', 'gdacs', 'meteo', 'wiki', 'solar'];
const VALID_THEMES = ['cyan', 'amber', 'emerald', 'crimson'];
const CLI_COMMANDS = [
  'help',
  'trace',
  'focus',
  'feed',
  'live',
  'refresh',
  'spectrum',
  'mode',
  'ops',
  'cables',
  'terminator',
  'maponly',
  'resetlayout',
  'panels',
  'theme',
  'defcon',
  'alert',
  'ping',
  'clear',
  'status',
];

// ----------------------------------------------------------------------------
// APPLICATION STATE
// ----------------------------------------------------------------------------
const state = {
  defcon: 3,
  alertActive: false,
  leftOpen: true,
  rightOpen: true,
  spyOpsEnabled: true,
  opsMode: 'live',
  opsQuery: '',
  nodeFilter: 'ALL',
  logFilter: 'ALL',
  selectedNodeId: 'zurich',
  selectedSatId: null,
  selectedLive: null,
  pendingFocus: null,
  traceTimers: [],
  logs: [],
  decryptPct: 74,
  threatIndex: 38.2,
  cmdHistory: [],
  cmdHistIdx: -1,
  cmdDraft: '',
  hydrating: true,
};

// ----------------------------------------------------------------------------
// DOM REFERENCES
// ----------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const els = {
  worldCanvas: $('worldCanvas'),
  radarCanvas: $('radarCanvas'),
  spectrumCanvas: $('spectrumCanvas'),
  sparkCanvas: $('sparkCanvas'),
  opsPanelTitle: $('opsPanelTitle'),
  opsModeTabs: $('opsModeTabs'),
  opsSearchInput: $('opsSearchInput'),
  opsSearchClear: $('opsSearchClear'),
  opsList: $('opsList'),
  opsCountMeta: $('opsCountMeta'),
  satList: $('satList'),
  logFeed: $('logFeed'),
  coordReadout: $('coordReadout'),
  mapTooltip: $('mapTooltip'),
  mapBanner: $('mapBanner'),
  bannerTag: $('bannerTag'),
  bannerMsg: $('bannerMsg'),
  bannerProgress: $('bannerProgress'),
  mapProjectionLabel: $('mapProjectionLabel'),
  mapTelemetryLine: $('mapTelemetryLine'),
  alertVignette: $('alertVignette'),
  defconBtn: $('defconBtn'),
  defconVal: $('defconVal'),
  defconPips: $('defconPips'),
  btnMode2D: $('btnMode2D'),
  btnMode3D: $('btnMode3D'),
  btnToggleLeft: $('btnToggleLeft'),
  btnToggleRight: $('btnToggleRight'),
  btnMapOnly: $('btnMapOnly'),
  opsGrid: $('opsGrid'),
  leftCol: $('leftCol'),
  rightCol: $('rightCol'),
  leftColResizer: $('leftColResizer'),
  rightColResizer: $('rightColResizer'),
  dockLeftBtn: $('dockLeftBtn'),
  dockRightBtn: $('dockRightBtn'),
  btnAutoRotate: $('btnAutoRotate'),
  btnTrace: $('btnTrace'),
  btnSimAlert: $('btnSimAlert'),
  btnAudio: $('btnAudio'),
  btnCrt: $('btnCrt'),
  btnFullscreen: $('btnFullscreen'),
  cmdForm: $('cmdForm'),
  cmdInput: $('cmdInput'),
  cmdHint: $('cmdHint'),
  fpsReadout: $('fpsReadout'),
  // Dossier elements
  dossierLed: $('dossierLed'),
  dossierCode: $('dossierCode'),
  dossierOp: $('dossierOp'),
  dossierLoc: $('dossierLoc'),
  dossierCoords: $('dossierCoords'),
  dossierSeverity: $('dossierSeverity'),
  dossierCipher: $('dossierCipher'),
  dossierBrief: $('dossierBrief'),
  dossierSignal: $('dossierSignal'),
  dossierFreq: $('dossierFreq'),
  dossierStatus: $('dossierStatus'),
  dossierActions: $('dossierActions'),
  btnDossierSource: $('btnDossierSource'),
  spectrumTitle: $('spectrumTitle'),
  spectrumLed: $('spectrumLed'),
  spectrumModes: $('spectrumModes'),
  radarRngTag: $('radarRngTag'),
  // Telemetry meters & labels
  labelDecrypt: $('labelDecrypt'),
  labelSigint: $('labelSigint'),
  labelMesh: $('labelMesh'),
  meterDecrypt: $('meterDecrypt'),
  valDecrypt: $('valDecrypt'),
  meterSigint: $('meterSigint'),
  valSigint: $('valSigint'),
  meterMesh: $('meterMesh'),
  valMesh: $('valMesh'),
  meterThreat: $('meterThreat'),
  valThreat: $('valThreat'),
  meterSolar: $('meterSolar'),
  valSolar: $('valSolar'),
  meterBgp: $('meterBgp'),
  valBgp: $('valBgp'),
  dossierWeatherVal: $('dossierWeatherVal'),
  satLockMeta: $('satLockMeta'),
  feedSwitchboard: $('feedSwitchboard'),
  btnRefreshFeeds: $('btnRefreshFeeds'),
  btnToggleFeedTray: $('btnToggleFeedTray'),
  feedTraySummary: $('feedTraySummary'),
  feedTrayChevron: $('feedTrayChevron'),
  btnFeedsAll: $('btnFeedsAll'),
  btnFeedsLiveOnly: $('btnFeedsLiveOnly'),
  btnFeedsClear: $('btnFeedsClear'),
};

// ----------------------------------------------------------------------------
// INITIALIZE ENGINE & WIDGETS
// ----------------------------------------------------------------------------
const radar = new RadarWidget(els.radarCanvas);
const spectrum = new SpectrumWidget(els.spectrumCanvas);
const sparkline = new SparklineWidget(els.sparkCanvas);

const liveFeeds = new LiveFeedManager({
  onUpdate: () => {
    syncFeedSwitchboard();
    renderSatList();
    if (state.opsMode === 'live') renderOpsList();
    refreshSelectedLiveDossier();
    updateTelemetryMeters({ pushSpark: false });
    if (state.pendingFocus) {
      if (focusTargetByQuery(state.pendingFocus, { silentNotFound: true })) {
        state.pendingFocus = null;
      }
    }
  },
  onLog: (sev, msg) => pushLog(sev, msg, true),
  onBgpPulse: (_col, info) => {
    if (info?.isWithdraw) spectrum.boost(0.28);
  },
});

const mapEngine = new WorldMapEngine(els.worldCanvas, {
  nodes: NODES,
  arcs: INITIAL_ARCS,
  satellites: SATELLITES,
  liveFeeds,
  onSelectNode: (node) => {
    selectNode(node.id, false);
  },
  onSelectSat: (sat) => {
    selectSat(sat.id, false);
  },
  onSelectLive: (kind, item) => {
    selectLiveItem(kind, item, false);
  },
  onHover: (hit, mx, my) => {
    renderTooltip(hit, mx, my);
  },
  onCoords: (lat, lon) => {
    const ns = lat >= 0 ? 'N' : 'S';
    const ew = lon >= 0 ? 'E' : 'W';
    const mgrs = formatMgrs(lat, lon) || 'N/A';
    els.coordReadout.textContent = `LAT ${lat >= 0 ? '+' : '-'}${Math.abs(lat).toFixed(4)}°${ns}  LON ${lon >= 0 ? '+' : '-'}${Math.abs(lon).toFixed(4)}°${ew}  //  MGRS ${mgrs}`;
  },
});

const panelLayout = new PanelLayoutManager({
  opsGrid: els.opsGrid,
  leftCol: els.leftCol,
  rightCol: els.rightCol,
  onResize: () => {
    mapEngine.resize();
    spectrum.resize();
  },
  onClick: () => sfx.playClick(),
  onLog: (sev, msg) => pushLog(sev, msg),
});

// ----------------------------------------------------------------------------
// PERSISTENCE (localStorage + URL QUERY PARAMS)
// ----------------------------------------------------------------------------
function saveHudState() {
  if (state.hydrating) return;
  try {
    const payload = {
      theme: document.documentElement.getAttribute('data-theme') || 'cyan',
      mode: mapEngine.mode,
      defcon: state.defcon,
      crt: document.body.classList.contains('crt-enabled'),
      leftOpen: state.leftOpen,
      rightOpen: state.rightOpen,
      opsMode: state.opsMode,
      spyOpsEnabled: state.spyOpsEnabled,
      feeds: { ...liveFeeds.enabled },
      layers: {
        nodes: Boolean(mapEngine.layers.nodes),
        arcs: Boolean(mapEngine.layers.arcs),
        satellites: Boolean(mapEngine.layers.satellites),
        sigint: Boolean(mapEngine.layers.sigint),
        grid: Boolean(mapEngine.layers.grid),
        scan: Boolean(mapEngine.layers.scan),
        terminator: Boolean(mapEngine.layers.terminator),
        cables: Boolean(mapEngine.layers.cables),
      },
      spectrumMode: spectrum.mode,
    };
    localStorage.setItem(HUD_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

function loadSavedHudState() {
  try {
    const raw = localStorage.getItem(HUD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function syncUrlParams(extra = {}) {
  if (state.hydrating || typeof window === 'undefined' || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    params.set('mode', mapEngine.mode);
    params.set('theme', document.documentElement.getAttribute('data-theme') || 'cyan');
    params.set('ops', state.opsMode);
    if (state.defcon !== 3) params.set('defcon', String(state.defcon));
    else params.delete('defcon');

    if (extra.feedsPreset) {
      params.set('feeds', extra.feedsPreset);
    } else if (params.has('feeds')) {
      const allLiveOn = ALL_LIVE_KEYS.every((k) => liveFeeds.enabled[k]);
      const allLiveOff = ALL_LIVE_KEYS.every((k) => !liveFeeds.enabled[k]);
      if (!state.spyOpsEnabled && allLiveOn) params.set('feeds', 'live');
      else if (state.spyOpsEnabled && allLiveOn) params.set('feeds', 'all');
      else if (!state.spyOpsEnabled && allLiveOff) params.set('feeds', 'none');
      else params.delete('feeds');
    }

    window.history.replaceState(null, '', url.toString());
  } catch {
    // ignore URL errors
  }
}

function hydrateInitialConfig() {
  const saved = loadSavedHudState() || {};
  const params = new URLSearchParams(window.location.search);

  const paramModeRaw = (params.get('mode') || '').toLowerCase();
  const paramMode =
    paramModeRaw === '3d' || paramModeRaw === 'globe'
      ? '3d'
      : paramModeRaw === '2d' || paramModeRaw === 'map'
      ? '2d'
      : null;

  const paramThemeRaw = (params.get('theme') || '').toLowerCase();
  const paramTheme = VALID_THEMES.includes(paramThemeRaw) ? paramThemeRaw : null;

  const paramFeedsRaw = (params.get('feeds') || '').toLowerCase();
  const paramFeeds = ['live', 'all', 'none'].includes(paramFeedsRaw) ? paramFeedsRaw : null;

  const paramOpsRaw = (params.get('ops') || '').toLowerCase();
  const paramOps = paramOpsRaw === 'live' || paramOpsRaw === 'sim' ? paramOpsRaw : null;

  const paramDefconNum = parseInt(params.get('defcon') || '', 10);
  const paramDefcon = paramDefconNum >= 1 && paramDefconNum <= 5 ? paramDefconNum : null;

  const paramFocus = (params.get('focus') || '').trim();

  // Apply theme
  const theme = paramTheme || (VALID_THEMES.includes(saved.theme) ? saved.theme : 'cyan');
  setTheme(theme, { silent: true });

  // Apply CRT preference
  const crtEnabled = typeof saved.crt === 'boolean' ? saved.crt : true;
  document.body.classList.toggle('crt-enabled', crtEnabled);
  els.btnCrt.classList.toggle('active', crtEnabled);
  els.btnCrt.setAttribute('aria-pressed', String(crtEnabled));

  // Apply sidebar open/closed states
  const leftOpen = typeof saved.leftOpen === 'boolean' ? saved.leftOpen : true;
  const rightOpen = typeof saved.rightOpen === 'boolean' ? saved.rightOpen : true;
  setSidebars({ left: leftOpen, right: rightOpen }, { silent: true });

  // Apply projection mode
  const mode = paramMode || (saved.mode === '3d' ? '3d' : '2d');
  setProjectionMode(mode, { silent: true });

  // Apply DEFCON
  const defcon = paramDefcon || (saved.defcon >= 1 && saved.defcon <= 5 ? saved.defcon : 3);
  setDefcon(defcon, { silent: true });

  // Apply spectrum mode
  const specMode = ['goes', 'bgp', 'rf'].includes(saved.spectrumMode) ? saved.spectrumMode : 'goes';
  setSpectrumMode(specMode, { silent: true });

  // Apply layer toggles from saved state
  if (saved.layers && typeof saved.layers === 'object') {
    for (const [layer, enabled] of Object.entries(saved.layers)) {
      if (layer in mapEngine.layers && typeof enabled === 'boolean') {
        mapEngine.setLayer(layer, enabled);
        document.querySelector(`.layer-pill[data-layer="${layer}"]`)?.classList.toggle('active', enabled);
      }
    }
  }

  // Apply feeds & spyOps from saved state
  if (saved.feeds && typeof saved.feeds === 'object') {
    for (const k of ALL_LIVE_KEYS) {
      if (typeof saved.feeds[k] === 'boolean') {
        liveFeeds.setEnabled(k, saved.feeds[k]);
        mapEngine.setLayer(k, saved.feeds[k]);
      }
    }
  }
  if (typeof saved.spyOpsEnabled === 'boolean') {
    state.spyOpsEnabled = saved.spyOpsEnabled;
    if (!saved.layers) {
      mapEngine.setLayer('nodes', state.spyOpsEnabled);
      mapEngine.setLayer('arcs', state.spyOpsEnabled);
      mapEngine.setLayer('sigint', state.spyOpsEnabled);
      ['nodes', 'arcs', 'sigint'].forEach((l) => {
        document.querySelector(`.layer-pill[data-layer="${l}"]`)?.classList.toggle('active', state.spyOpsEnabled);
      });
    }
  }

  // URL ?feeds=live|all|none overrides saved feed/spyOps config
  if (paramFeeds === 'live') {
    applyFeedPreset('live', { silent: true });
  } else if (paramFeeds === 'all') {
    applyFeedPreset('all', { silent: true });
  } else if (paramFeeds === 'none') {
    applyFeedPreset('none', { silent: true });
  }

  // Sync spyOpsEnabled with actual nodes/arcs/sigint layer state
  state.spyOpsEnabled = Boolean(mapEngine.layers.nodes || mapEngine.layers.arcs || mapEngine.layers.sigint);

  // Apply opsMode (URL ?ops > ?feeds=live > saved > default 'live')
  const opsMode =
    paramOps ||
    (paramFeeds === 'live' ? 'live' : saved.opsMode === 'sim' || saved.opsMode === 'live' ? saved.opsMode : 'live');
  setOpsMode(opsMode, { silent: true });

  if (paramFocus) {
    state.pendingFocus = paramFocus;
  }
}

// ----------------------------------------------------------------------------
// LIVE WORLD OPS CLOCKS
// ----------------------------------------------------------------------------
const tzFormatters = {
  utc: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
  langley: new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }),
  london: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }),
  moscow: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false }),
  tokyo: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }),
};

function updateClocks() {
  const now = new Date();
  $('clockUtc').textContent = `${tzFormatters.utc.format(now)}Z`;
  $('clockLangley').textContent = tzFormatters.langley.format(now);
  $('clockLondon').textContent = tzFormatters.london.format(now);
  $('clockMoscow').textContent = tzFormatters.moscow.format(now);
  $('clockTokyo').textContent = tzFormatters.tokyo.format(now);
}

// ----------------------------------------------------------------------------
// OPERATIONS / LIVE ANOMALIES LIST & SATELLITES LIST
// ----------------------------------------------------------------------------
function setOpsMode(mode, { silent = false } = {}) {
  if (mode !== 'live' && mode !== 'sim') return;
  state.opsMode = mode;
  els.opsModeTabs?.querySelectorAll('button[data-ops-mode]').forEach((b) => {
    b.classList.toggle('active', b.dataset.opsMode === mode);
  });
  if (els.opsPanelTitle) {
    els.opsPanelTitle.textContent = mode === 'live' ? 'LIVE ANOMALIES' : 'ACTIVE OPERATIONS';
  }
  renderOpsList();
  if (!silent) {
    sfx.playClick();
    saveHudState();
    syncUrlParams();
  }
}

function renderOpsList() {
  const query = state.opsQuery.trim().toLowerCase();

  if (state.opsMode === 'live') {
    const all = liveFeeds.getLiveAnomalies();
    const critCount = all.filter((a) => a.type === 'CRITICAL').length;
    els.opsCountMeta.textContent = `${all.length} LIVE // ${critCount} CRIT`;

    const filtered = all.filter((a) => {
      if (state.nodeFilter !== 'ALL' && a.type !== state.nodeFilter) return false;
      if (!query) return true;
      return (
        String(a.title || '').toLowerCase().includes(query) ||
        String(a.sub || '').toLowerCase().includes(query) ||
        String(a.code || '').toLowerCase().includes(query) ||
        String(a.badge || '').toLowerCase().includes(query) ||
        String(a.status || '').toLowerCase().includes(query)
      );
    });

    if (filtered.length === 0) {
      const anyLoading = ALL_LIVE_KEYS.some(
        (k) => liveFeeds.enabled[k] && (liveFeeds.status[k]?.state === 'loading' || liveFeeds.status[k]?.state === 'idle')
      );
      const emptyMsg =
        all.length === 0 && !query && state.nodeFilter === 'ALL' && anyLoading
          ? 'SYNCING LIVE OSINT TELEMETRY...'
          : 'NO MATCHING ANOMALIES — ADJUST FILTER';
      els.opsList.innerHTML = `<div class="ops-empty">${escapeHtml(emptyMsg)}</div>`;
      return;
    }

    els.opsList.innerHTML = filtered
      .map((a) => {
        const isSelected = state.selectedLive?.kind === a.kind && state.selectedLive.id === a.id;
        return `
      <div class="op-card ${isSelected ? 'selected' : ''}" data-live-kind="${escapeHtml(a.kind)}" data-live-id="${escapeHtml(a.id)}" data-type="${escapeHtml(a.type)}">
        <div class="op-card-name"><span class="op-card-badge">${escapeHtml(a.badge)}</span>${escapeHtml(a.title)}</div>
        <div class="op-card-code">${escapeHtml(a.code)}</div>
        <div class="op-card-sub">${escapeHtml(a.sub)}</div>
        <div class="op-card-sig">${escapeHtml(a.status)}</div>
      </div>`;
      })
      .join('');
    return;
  }

  // SIM scenario operations mode
  const critCount = NODES.filter((n) => n.type === 'CRITICAL').length;
  els.opsCountMeta.textContent = `${NODES.length} NODES // ${critCount} CRIT`;

  const filtered = NODES.filter((n) => {
    if (state.nodeFilter !== 'ALL' && n.type !== state.nodeFilter) return false;
    if (!query) return true;
    return (
      n.opName.toLowerCase().includes(query) ||
      n.city.toLowerCase().includes(query) ||
      n.country.toLowerCase().includes(query) ||
      n.code.toLowerCase().includes(query) ||
      n.status.toLowerCase().includes(query)
    );
  });

  if (filtered.length === 0) {
    els.opsList.innerHTML = `<div class="ops-empty">NO MATCHING OPERATIONS — ADJUST FILTER</div>`;
    return;
  }

  els.opsList.innerHTML = filtered
    .map(
      (n) => `
      <div class="op-card ${state.selectedNodeId === n.id ? 'selected' : ''}" data-id="${escapeHtml(n.id)}" data-type="${escapeHtml(n.type)}">
        <div class="op-card-name">${escapeHtml(n.opName)}</div>
        <div class="op-card-code">${escapeHtml(n.code)}</div>
        <div class="op-card-sub">${escapeHtml(n.city)}, ${escapeHtml(n.country)}</div>
        <div class="op-card-sig">${escapeHtml(n.status)}</div>
      </div>`
    )
    .join('');
}

let _satListSig = '';
function renderSatList() {
  const useLive = liveFeeds.enabled.liveSats && liveFeeds.data.liveSats.length > 0;
  const list = useLive ? liveFeeds.data.liveSats : mapEngine.satellites;
  els.satLockMeta.textContent = useLive ? `LIVE NORAD // ${list.length}` : `SIM // ${list.length}`;

  const sig = `${useLive ? 'L' : 'S'}:${list.map((s) => s.id).join(',')}`;
  const now = performance.now();

  if (sig !== _satListSig) {
    _satListSig = sig;
    els.satList.innerHTML = list
      .map((s) => {
        const latStr = `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}`;
        const lonStr = `${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}`;
        const isSelected = useLive
          ? state.selectedLive?.kind === 'liveSat' && state.selectedLive.id === s.id
          : state.selectedSatId === s.id;
        const lockPct = useLive
          ? s.noradId === 25544
            ? 99
            : 95
          : Math.min(99, Math.max(76, Math.round(s.lock + Math.sin(now * 0.002 + s.phaseOffset) * 3)));
        const rightLabel = useLive ? `${s.altKm} KM` : s.orbit;
        const dataAttr = useLive ? `data-live-sat="${escapeHtml(s.id)}"` : `data-sat="${escapeHtml(s.id)}"`;
        const metricText = useLive ? `${s.velKms}k/s` : `${lockPct}%`;
        return `
      <div class="sat-row ${isSelected ? 'selected' : ''}" ${dataAttr}>
        <div class="sat-name">${escapeHtml(s.name)}</div>
        <div class="sat-orbit">${escapeHtml(rightLabel)}</div>
        <div class="sat-coords">${escapeHtml(latStr)} ${escapeHtml(lonStr)}</div>
        <div class="sat-bar-wrap">
          <div class="sat-bar"><i style="width:${lockPct}%"></i></div>
          <span class="sat-coords">${escapeHtml(metricText)}</span>
        </div>
      </div>`;
      })
      .join('');
    return;
  }

  // Update existing DOM nodes in place so clicking a row across the 1s tick never drops the click
  const rows = els.satList.children;
  for (let i = 0; i < list.length && i < rows.length; i++) {
    const s = list[i];
    const row = rows[i];
    const isSelected = useLive
      ? state.selectedLive?.kind === 'liveSat' && state.selectedLive.id === s.id
      : state.selectedSatId === s.id;
    row.classList.toggle('selected', isSelected);

    const latStr = `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}`;
    const lockPct = useLive
      ? s.noradId === 25544
        ? 99
        : 95
      : Math.min(99, Math.max(76, Math.round(s.lock + Math.sin(now * 0.002 + s.phaseOffset) * 3)));

    const orbitEl = row.querySelector('.sat-orbit');
    if (orbitEl) orbitEl.textContent = useLive ? `${s.altKm} KM` : s.orbit;

    const coordEls = row.querySelectorAll('.sat-coords');
    if (coordEls[0]) coordEls[0].textContent = `${latStr} ${lonStr}`;
    if (coordEls[1]) coordEls[1].textContent = useLive ? `${s.velKms}k/s` : `${lockPct}%`;

    const barEl = row.querySelector('.sat-bar i');
    if (barEl) barEl.style.width = `${lockPct}%`;
  }
}

// ----------------------------------------------------------------------------
// TARGET DOSSIER SELECTION & LIVE RE-BINDING
// ----------------------------------------------------------------------------
let _rfSubtitle = '14.285 MHz';
function setSpectrumSubtitle(label) {
  _rfSubtitle = label;
  if (spectrum.mode === 'rf') {
    els.spectrumTitle.textContent = `RF // ${label}`;
  }
}

function setSpectrumMode(mode, { silent = false } = {}) {
  if (!['goes', 'bgp', 'rf'].includes(mode)) return;
  spectrum.setMode(mode);
  els.spectrumModes.querySelectorAll('.micro-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.spec === mode);
  });
  if (mode === 'goes') {
    els.spectrumTitle.textContent = 'GOES SOLAR FLUX';
    els.spectrumLed.className = 'led led-ok';
  } else if (mode === 'bgp') {
    els.spectrumTitle.textContent = 'RIPE BGP SPECTRUM';
    els.spectrumLed.className = 'led led-accent';
  } else {
    els.spectrumTitle.textContent = `RF // ${_rfSubtitle}`;
    els.spectrumLed.className = 'led led-accent';
  }
  if (!silent) {
    sfx.playClick();
    saveHudState();
  }
}

function updateDossierSourceLink(kind, item) {
  if (!els.btnDossierSource || !els.dossierActions) return;
  const src = kind ? buildExternalSourceUrl(kind, item) : null;
  if (src && src.url) {
    els.btnDossierSource.href = src.url;
    els.btnDossierSource.textContent = src.label || 'OPEN SOURCE ↗';
    els.btnDossierSource.classList.remove('hidden');
    els.dossierActions.classList.add('has-source');
  } else {
    els.btnDossierSource.href = '#';
    els.btnDossierSource.classList.add('hidden');
    els.dossierActions.classList.remove('has-source');
  }
}

let _wxSeq = 0;
async function updateDossierWeather(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const seq = ++_wxSeq;
  els.dossierWeatherVal.textContent = 'FETCHING METEO...';
  const wx = await liveFeeds.fetchPointWeather(lat, lon);
  if (seq !== _wxSeq) return;
  if (!wx) {
    els.dossierWeatherVal.textContent = 'METEO N/A';
    return;
  }
  els.dossierWeatherVal.textContent = `${wx.tempC}°C • ${wx.windKmh}km/h • ${wx.pressureHpa}hPa • ${wx.condition}`;
}

function selectNode(id, syncMap = true) {
  const node = NODES.find((n) => n.id === id);
  if (!node) return;
  state.selectedNodeId = id;
  state.selectedSatId = null;
  state.selectedLive = null;

  if (syncMap) mapEngine.selectNode(id, true);
  if (!state.hydrating) sfx.playLock();
  radar.setTargetType(node.type);
  spectrum.boost(0.65);

  els.dossierCode.textContent = `LOCKED // ${node.code}`;
  els.dossierOp.textContent = node.opName;
  els.dossierLoc.textContent = `${node.city}, ${node.country}`;
  els.dossierCoords.textContent = formatCoord(node.lat, node.lon);
  els.dossierBrief.textContent = node.brief;
  els.dossierSignal.textContent = node.signal;
  els.dossierFreq.textContent = node.freq;
  els.dossierStatus.textContent = node.status;
  els.dossierCipher.textContent = node.cipher;
  setSpectrumSubtitle(node.freq);
  els.radarRngTag.textContent = node.type === 'CRITICAL' ? 'RNG 25KM' : 'RNG 50KM';

  const pillMap = {
    CRITICAL: ['crit', 'CRITICAL', 'led-crit'],
    WARNING: ['warn', 'WARNING', 'led-warn'],
    ALLIED: ['ally', 'ALLIED', 'led-accent'],
    COVERT: ['cvrt', 'COVERT', 'led-accent'],
  };
  const [cls, label, ledCls] = pillMap[node.type] || ['ally', node.type, 'led-accent'];
  els.dossierSeverity.className = `status-pill ${cls}`;
  els.dossierSeverity.textContent = label;
  els.dossierLed.className = `led ${ledCls}`;
  updateDossierSourceLink(null, null);

  renderOpsList();
  renderSatList();
  updateDossierWeather(node.lat, node.lon);
}

function selectSat(id, syncMap = true) {
  const sat = mapEngine.satellites.find((s) => s.id === id);
  if (!sat) return;
  state.selectedSatId = id;
  state.selectedNodeId = null;
  state.selectedLive = null;

  if (syncMap) mapEngine.selectSat(id);
  sfx.playLock();
  radar.setTargetType('SAT');
  spectrum.boost(0.5);

  els.dossierCode.textContent = `ORBITAL // ${sat.name.split(' ')[0]}`;
  els.dossierOp.textContent = sat.name;
  els.dossierLoc.textContent = sat.orbit;
  els.dossierCoords.textContent = formatCoord(sat.lat, sat.lon);
  els.dossierBrief.textContent = `${sat.mission}. Live optical/RF swath radius ${sat.footprintDeg}° (~${Math.round(sat.footprintDeg * 111)} km). Automated laser crosslink active.`;
  els.dossierSignal.textContent = `${sat.lock}% LOCK`;
  els.dossierFreq.textContent = '26.80 GHz';
  els.dossierStatus.textContent = 'TRACKING';
  els.dossierCipher.textContent = 'OPTICAL-QKD';
  setSpectrumSubtitle('26.80 GHz');
  els.radarRngTag.textContent = `SWATH ${sat.footprintDeg}°`;

  els.dossierSeverity.className = 'status-pill sat';
  els.dossierSeverity.textContent = 'ORBITAL';
  els.dossierLed.className = 'led led-ok';
  updateDossierSourceLink(null, null);

  renderOpsList();
  renderSatList();
  updateDossierWeather(sat.lat, sat.lon);
}

function applyLiveDossierFields(kind, item, { updateRadar = false } = {}) {
  if (!item) return;

  if (kind === 'liveSat') {
    if (updateRadar) radar.setTargetType('SAT');
    els.dossierCode.textContent = `NORAD // #${item.noradId}`;
    els.dossierOp.textContent = item.name;
    els.dossierLoc.textContent = `ALT ${item.altKm} KM • INCL ${Number(item.inclination || 0).toFixed(1)}°`;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `${item.mission}. Real-time SGP4 orbital propagation from live CelesTrak NORAD GP elements.${item.visibility ? ` Illumination: ${item.visibility}.` : ''}`;
    els.dossierSignal.textContent = `${item.velKms} km/s`;
    els.dossierFreq.textContent = item.noradId === 25544 ? '145.800 MHz' : '2.245 GHz';
    els.dossierStatus.textContent = 'LIVE SGP4';
    els.dossierCipher.textContent = 'NORAD-LIVE';
    setSpectrumSubtitle(els.dossierFreq.textContent);
    els.radarRngTag.textContent = `SWATH ${item.footprintDeg}°`;
    els.dossierSeverity.className = 'status-pill sat';
    els.dossierSeverity.textContent = 'LIVE ORBIT';
    els.dossierLed.className = 'led led-ok';
  } else if (kind === 'quake') {
    if (updateRadar) radar.setTargetType(item.mag >= 5 ? 'CRITICAL' : 'WARNING');
    const utcStr = tzFormatters.utc.format(new Date(item.time)) + 'Z';
    els.dossierCode.textContent = `USGS // M${item.mag.toFixed(1)}`;
    els.dossierOp.textContent = `SEISMIC M${item.mag.toFixed(1)} EVENT`;
    els.dossierLoc.textContent = String(item.place || 'SEISMIC REGION').toUpperCase();
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live USGS seismic telemetry recorded at ${utcStr}. Focal depth ${item.depthKm} km. Tsunami flag: ${item.tsunami ? 'ACTIVE WARNING' : 'NONE'}.`;
    els.dossierSignal.textContent = `M ${item.mag.toFixed(1)}`;
    els.dossierFreq.textContent = `${item.depthKm} KM`;
    els.dossierStatus.textContent = item.tsunami ? 'TSUNAMI' : 'RECORDED';
    els.dossierCipher.textContent = 'USGS-LIVE';
    setSpectrumSubtitle('0.5-12 Hz');
    els.radarRngTag.textContent = `DEPTH ${item.depthKm}K`;
    els.dossierSeverity.className = `status-pill ${item.mag >= 5 ? 'crit' : 'warn'}`;
    els.dossierSeverity.textContent = item.mag >= 5 ? 'MAJOR' : 'SEISMIC';
    els.dossierLed.className = `led ${item.mag >= 5 ? 'led-crit' : 'led-warn'}`;
  } else if (kind === 'eonet') {
    if (updateRadar) radar.setTargetType(item.categoryId === 'volcanoes' ? 'CRITICAL' : 'WARNING');
    els.dossierCode.textContent = `NASA // ${item.source}`;
    els.dossierOp.textContent = item.categoryTitle;
    els.dossierLoc.textContent = String(item.title || '').toUpperCase();
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live NASA Earth Observatory Natural Event Tracker (EONET). Active ${String(item.categoryTitle || 'natural').toLowerCase()} anomaly reported ${item.date ? item.date.slice(0, 16).replace('T', ' ') + 'Z' : 'recently'}.`;
    els.dossierSignal.textContent = 'OPEN';
    els.dossierFreq.textContent = item.source;
    els.dossierStatus.textContent = 'MONITORING';
    els.dossierCipher.textContent = 'EONET-V3';
    setSpectrumSubtitle('MODIS/VIIRS');
    els.radarRngTag.textContent = 'EOS SCAN';
    els.dossierSeverity.className = `status-pill ${item.categoryId === 'volcanoes' ? 'crit' : 'warn'}`;
    els.dossierSeverity.textContent = 'LIVE HAZARD';
    els.dossierLed.className = `led ${item.categoryId === 'volcanoes' ? 'led-crit' : 'led-warn'}`;
  } else if (kind === 'aircraft') {
    if (updateRadar) radar.setTargetType(item.emergency ? 'CRITICAL' : 'ALLIED');
    els.dossierCode.textContent = `ADS-B // ${item.hex}`;
    els.dossierOp.textContent = `${item.callsign} [${item.type}]`;
    els.dossierLoc.textContent = `REG ${item.reg} • SQUAWK ${item.squawk}`;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live ADS-B military/tactical transponder signal. Barometric altitude ${Number(item.altFt || 0).toLocaleString()} ft, ground speed ${item.gsKts} kts, heading ${item.trackDeg !== null && item.trackDeg !== undefined ? Math.round(item.trackDeg) + '°' : 'N/A'}.`;
    els.dossierSignal.textContent = `${Number(item.altFt || 0).toLocaleString()} FT`;
    els.dossierFreq.textContent = `${item.gsKts} KTS`;
    els.dossierStatus.textContent = item.emergency || `HDG ${item.trackDeg !== null && item.trackDeg !== undefined ? Math.round(item.trackDeg) + '°' : '--'}`;
    els.dossierCipher.textContent = '1090-ES';
    setSpectrumSubtitle('1090 MHz');
    els.radarRngTag.textContent = `FL${Math.round((item.altFt || 0) / 100)}`;
    els.dossierSeverity.className = `status-pill ${item.emergency ? 'crit' : 'ally'}`;
    els.dossierSeverity.textContent = item.emergency ? 'EMERGENCY' : 'MIL ADS-B';
    els.dossierLed.className = `led ${item.emergency ? 'led-crit' : 'led-accent'}`;
  } else if (kind === 'bgp') {
    if (updateRadar) radar.setTargetType('COVERT');
    els.dossierCode.textContent = `RIPE // ${item.code}`;
    els.dossierOp.textContent = `${item.city} IXP (${item.ixp})`;
    els.dossierLoc.textContent = String(item.host || '').toUpperCase();
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live RIPE RIS BGP Route Collector streaming real-time global internet peering updates. Latest prefix: ${item.lastPrefix || 'Awaiting frame'} via ${item.lastAsn || 'AS?'}.`;
    els.dossierSignal.textContent = `${item.msgCount} PKTS`;
    els.dossierFreq.textContent = item.lastAsn || 'BGP-4';
    els.dossierStatus.textContent = `${liveFeeds.data.bgpRate}/s`;
    els.dossierCipher.textContent = 'TCP-179';
    setSpectrumSubtitle('BGP-4');
    els.radarRngTag.textContent = item.code;
    els.dossierSeverity.className = 'status-pill cvrt';
    els.dossierSeverity.textContent = 'LIVE BGP';
    els.dossierLed.className = 'led led-accent';
  } else if (kind === 'gdacs') {
    const isRed = item.alertLevel === 'Red';
    const isOrange = item.alertLevel === 'Orange';
    if (updateRadar) radar.setTargetType(isRed ? 'CRITICAL' : isOrange ? 'WARNING' : 'SAT');
    els.dossierCode.textContent = `GDACS // ${item.eventType}`;
    els.dossierOp.textContent = String(item.name || '').toUpperCase();
    els.dossierLoc.textContent = `${String(item.country || '').toUpperCase()} • ${item.typeLabel}`;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `UN/EU Global Disaster Alert & Coordination System (${item.source}). ${item.severityText || 'Active humanitarian crisis event under international monitoring.'}`;
    els.dossierSignal.textContent = String(item.alertLevel || 'GREEN').toUpperCase();
    els.dossierFreq.textContent = item.source;
    els.dossierStatus.textContent = item.isCurrent ? 'ACTIVE' : 'RECENT';
    els.dossierCipher.textContent = 'UN-GDACS';
    setSpectrumSubtitle(item.typeLabel);
    els.radarRngTag.textContent = String(item.alertLevel || 'ALERT').toUpperCase();
    els.dossierSeverity.className = `status-pill ${isRed ? 'crit' : isOrange ? 'warn' : 'sat'}`;
    els.dossierSeverity.textContent = `${String(item.alertLevel || 'GREEN').toUpperCase()} ALERT`;
    els.dossierLed.className = `led ${isRed ? 'led-crit' : isOrange ? 'led-warn' : 'led-ok'}`;
  } else if (kind === 'meteo') {
    if (updateRadar) radar.setTargetType('ALLIED');
    els.dossierCode.textContent = 'METEO // WMO';
    els.dossierOp.textContent = `${item.name} ATMOSPHERIC`;
    els.dossierLoc.textContent = item.condition;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live Open-Meteo surface telemetry: ${item.tempC}°C, wind ${item.windKmh} km/h from ${item.windDir}°, barometric pressure ${item.pressureHpa} hPa.`;
    els.dossierSignal.textContent = `${item.tempC}°C`;
    els.dossierFreq.textContent = `${item.windKmh} km/h`;
    els.dossierStatus.textContent = `${item.pressureHpa} hPa`;
    els.dossierCipher.textContent = 'OPEN-METEO';
    setSpectrumSubtitle('ATMOS');
    els.radarRngTag.textContent = `${item.windDir}° WND`;
    els.dossierSeverity.className = 'status-pill ally';
    els.dossierSeverity.textContent = 'LIVE WX';
    els.dossierLed.className = 'led led-accent';
  } else if (kind === 'wiki') {
    if (updateRadar) radar.setTargetType('ALLIED');
    els.dossierCode.textContent = `WIKI // ${item.lang}`;
    els.dossierOp.textContent = `WIKIPEDIA [${item.lang}] STREAM`;
    els.dossierLoc.textContent = item.city;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live real-time human knowledge edit stream. Latest article: "${item.lastTitle || 'Syncing...'}" edited by ${item.lastUser || 'contributor'}.`;
    els.dossierSignal.textContent = `${item.recentCount} EDITS`;
    els.dossierFreq.textContent = `${item.lang}.WIKI`;
    els.dossierStatus.textContent = 'STREAMING';
    els.dossierCipher.textContent = 'MEDIAWIKI';
    setSpectrumSubtitle('WIKI');
    els.radarRngTag.textContent = `${item.lang} HUB`;
    els.dossierSeverity.className = 'status-pill ally';
    els.dossierSeverity.textContent = 'LIVE PULSE';
    els.dossierLed.className = 'led led-accent';
  } else if (kind === 'cable') {
    if (updateRadar) radar.setTargetType('ALLIED');
    els.dossierCode.textContent = `SUBSEA // ${item.code || 'CBL'}`;
    els.dossierOp.textContent = item.name;
    els.dossierLoc.textContent = `${item.region} • RFS ${item.rfs}`;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Subsea optical fiber trunk (${item.capacity}, Ready For Service ${item.rfs}). Landing points: ${item.landing}.`;
    els.dossierSignal.textContent = item.capacity;
    els.dossierFreq.textContent = `RFS ${item.rfs}`;
    els.dossierStatus.textContent = 'IN SERVICE';
    els.dossierCipher.textContent = 'SUBSEA-OPTIC';
    setSpectrumSubtitle('DWDM-C');
    els.radarRngTag.textContent = item.code || 'CABLE';
    els.dossierSeverity.className = 'status-pill ally';
    els.dossierSeverity.textContent = 'SUBSEA TRUNK';
    els.dossierLed.className = 'led led-accent';
  } else if (kind === 'solar') {
    const kp = Number(item.kp ?? item.solar?.kp ?? liveFeeds.data.solar?.kp ?? 0);
    const scale = item.scale || item.solar?.scale || liveFeeds.data.solar?.scale || 'G0';
    const flareClass = item.flareClass || item.goes?.flareClass || liveFeeds.data.goes?.flareClass || 'A0.0';
    const label = item.solar?.label || item.label || liveFeeds.data.solar?.label || 'GEOMAGNETIC FIELD';
    const bt = item.goes?.latestBt ?? liveFeeds.data.goes?.latestBt;
    const isCrit = kp >= 7 || flareClass.startsWith('X');
    const isWarn = kp >= 5 || flareClass.startsWith('M');
    if (updateRadar) radar.setTargetType(isCrit ? 'CRITICAL' : isWarn ? 'WARNING' : 'SAT');
    els.dossierCode.textContent = `NOAA // ${scale}`;
    els.dossierOp.textContent = `SOLAR ${scale} // FLARE ${flareClass}`;
    els.dossierLoc.textContent = String(label).toUpperCase();
    els.dossierCoords.textContent = formatCoord(item.lat ?? 65.0, item.lon ?? -20.0);
    els.dossierBrief.textContent = `Live NOAA Space Weather Prediction Center geomagnetic telemetry. Planetary Kp ${kp.toFixed(1)} (${scale}), GOES-18 X-ray class ${flareClass}${bt != null ? `, GOES-19 magnetic field Bt ${Number(bt).toFixed(1)} nT` : ''}.`;
    els.dossierSignal.textContent = `Kp ${kp.toFixed(1)}`;
    els.dossierFreq.textContent = flareClass;
    els.dossierStatus.textContent = isCrit ? 'SEVERE' : isWarn ? 'STORM' : 'NOMINAL';
    els.dossierCipher.textContent = 'NOAA-SWPC';
    setSpectrumSubtitle('GOES X-RAY');
    els.radarRngTag.textContent = `${scale} AURORA`;
    els.dossierSeverity.className = `status-pill ${isCrit ? 'crit' : isWarn ? 'warn' : 'sat'}`;
    els.dossierSeverity.textContent = isCrit ? 'SEVERE STORM' : isWarn ? 'SOLAR STORM' : 'SPACE WX';
    els.dossierLed.className = `led ${isCrit ? 'led-crit' : isWarn ? 'led-warn' : 'led-ok'}`;
  }
}

function selectLiveItem(kind, item, syncMap = true) {
  if (!item) return;
  state.selectedNodeId = null;
  state.selectedSatId = null;
  state.selectedLive = { kind, id: item.id, item };

  if (syncMap) mapEngine.selectLive(kind, item, true);
  if (!state.hydrating) sfx.playLock();
  spectrum.boost(0.7);

  applyLiveDossierFields(kind, item, { updateRadar: true });
  updateDossierSourceLink(kind, item);

  renderOpsList();
  renderSatList();
  updateDossierWeather(item.lat, item.lon);
}

function refreshSelectedLiveDossier() {
  if (state.selectedLive) {
    const { kind, id } = state.selectedLive;
    let fresh = null;
    if (kind === 'cable') {
      fresh = SUBSEA_CABLES.find((c) => c.id === id) || state.selectedLive.item;
    } else if (kind === 'solar') {
      const kp = liveFeeds.data.solar?.kp ?? state.selectedLive.item?.kp ?? 0;
      const scale = liveFeeds.data.solar?.scale || state.selectedLive.item?.scale || 'G0';
      const flareClass = liveFeeds.data.goes?.flareClass || state.selectedLive.item?.flareClass || 'A0.0';
      fresh = {
        ...(state.selectedLive.item || {}),
        id: 'noaa-solar',
        kp,
        scale,
        flareClass,
        solar: liveFeeds.data.solar,
        goes: liveFeeds.data.goes,
        lat: state.selectedLive.item?.lat ?? 65.0,
        lon: state.selectedLive.item?.lon ?? -20.0,
      };
    } else {
      fresh = liveFeeds.findLiveItem(kind, id);
    }
    if (fresh) {
      state.selectedLive.item = fresh;
      applyLiveDossierFields(kind, fresh, { updateRadar: false });
      updateDossierSourceLink(kind, fresh);
    }
  } else if (state.selectedSatId) {
    const sat = mapEngine.satellites.find((s) => s.id === state.selectedSatId);
    if (sat) {
      els.dossierCoords.textContent = formatCoord(sat.lat, sat.lon);
      const lockPct = Math.min(
        99,
        Math.max(76, Math.round(sat.lock + Math.sin(performance.now() * 0.002 + sat.phaseOffset) * 3))
      );
      els.dossierSignal.textContent = `${lockPct}% LOCK`;
    }
  }
}

// ----------------------------------------------------------------------------
// DATA FEED SWITCHBOARD & LAYER SYNC
// ----------------------------------------------------------------------------
function syncFeedSwitchboard() {
  const counts = {
    spyOps: state.spyOpsEnabled ? NODES.length : 'OFF',
    liveSats: liveFeeds.enabled.liveSats ? liveFeeds.status.liveSats.count : 'OFF',
    quakes: liveFeeds.enabled.quakes ? liveFeeds.status.quakes.count : 'OFF',
    eonet: liveFeeds.enabled.eonet ? liveFeeds.status.eonet.count : 'OFF',
    aircraft: liveFeeds.enabled.aircraft ? liveFeeds.status.aircraft.count : 'OFF',
    bgp: liveFeeds.enabled.bgp
      ? liveFeeds.status.bgp.state === 'live'
        ? liveFeeds.data.bgpRate >= 1000
          ? `${(liveFeeds.data.bgpRate / 1000).toFixed(1)}k/s`
          : `${liveFeeds.data.bgpRate}/s`
        : '..'
      : 'OFF',
    gdacs: liveFeeds.enabled.gdacs ? liveFeeds.status.gdacs.count : 'OFF',
    meteo: liveFeeds.enabled.meteo ? liveFeeds.status.meteo.count : 'OFF',
    wiki: liveFeeds.enabled.wiki ? liveFeeds.status.wiki.count : 'OFF',
    solar: liveFeeds.enabled.solar
      ? liveFeeds.data.solar
        ? `Kp ${liveFeeds.data.solar.kp.toFixed(1)}`
        : '..'
      : 'OFF',
  };

  $('cntSpyOps').textContent = String(counts.spyOps);
  $('cntLiveSats').textContent = String(counts.liveSats);
  $('cntQuakes').textContent = String(counts.quakes);
  $('cntEonet').textContent = String(counts.eonet);
  $('cntAircraft').textContent = String(counts.aircraft);
  $('cntBgp').textContent = String(counts.bgp);
  $('cntGdacs').textContent = String(counts.gdacs);
  $('cntMeteo').textContent = String(counts.meteo);
  $('cntWiki').textContent = String(counts.wiki);
  $('cntSolar').textContent = String(counts.solar);

  const feedLedMap = [
    ['liveSats', 'ledLiveSats'],
    ['quakes', 'ledQuakes'],
    ['eonet', 'ledEonet'],
    ['aircraft', 'ledAircraft'],
    ['bgp', 'ledBgp'],
    ['gdacs', 'ledGdacs'],
    ['meteo', 'ledMeteo'],
    ['wiki', 'ledWiki'],
    ['solar', 'ledSolar'],
  ];

  let activeCount = state.spyOpsEnabled ? 1 : 0;
  for (const [key, ledId] of feedLedMap) {
    if (liveFeeds.enabled[key]) activeCount++;
    const st = liveFeeds.status[key].state;
    const led = $(ledId);
    led.classList.toggle('is-loading', liveFeeds.enabled[key] && st === 'loading');
    led.classList.toggle('is-error', liveFeeds.enabled[key] && st === 'error');
    const chip = els.feedSwitchboard.querySelector(`.feed-chip[data-feed="${key}"]`);
    chip?.classList.toggle('active', liveFeeds.enabled[key]);
  }
  const spyChip = els.feedSwitchboard.querySelector('.feed-chip[data-feed="spyOps"]');
  spyChip?.classList.toggle('active', state.spyOpsEnabled);
  els.feedTraySummary.textContent = `DATA FEEDS [${activeCount}/10]`;

  // Sync NOAA Solar meter & RIPE BGP meter in left telemetry panel
  if (liveFeeds.data.solar) {
    const s = liveFeeds.data.solar;
    const pct = Math.min(100, Math.max(8, (s.kp / 9) * 100));
    els.meterSolar.style.width = `${pct.toFixed(0)}%`;
    els.meterSolar.className = `meter-fill ${s.kp >= 5 ? 'meter-warn' : 'meter-ok'}`;
    els.valSolar.textContent = `Kp ${s.kp.toFixed(1)} ${s.scale}`;
  }
  if (liveFeeds.enabled.bgp) {
    const rate = liveFeeds.data.bgpRate;
    const pct = Math.min(100, Math.max(6, (rate / 3000) * 100));
    els.meterBgp.style.width = `${pct.toFixed(0)}%`;
    const rateLabel = rate >= 1000 ? `${(rate / 1000).toFixed(1)}k/s` : `${rate}/s`;
    els.valBgp.textContent = liveFeeds.status.bgp.state === 'live' ? rateLabel : 'CONN..';
  } else {
    els.meterBgp.style.width = '0%';
    els.valBgp.textContent = 'MUTED';
  }

  // Update floating top-left telemetry line with real live counts
  const parts = [];
  if (state.spyOpsEnabled) parts.push(`${NODES.length} OPS`);
  if (liveFeeds.enabled.liveSats && liveFeeds.status.liveSats.count) parts.push(`${liveFeeds.status.liveSats.count} SATS`);
  if (liveFeeds.enabled.quakes && liveFeeds.status.quakes.count) parts.push(`${liveFeeds.status.quakes.count} QUAKES`);
  if (liveFeeds.enabled.gdacs && liveFeeds.status.gdacs.count) parts.push(`${liveFeeds.status.gdacs.count} GDACS`);
  if (liveFeeds.enabled.eonet && liveFeeds.status.eonet.count) parts.push(`${liveFeeds.status.eonet.count} EONET`);
  if (liveFeeds.enabled.aircraft && liveFeeds.status.aircraft.count) parts.push(`${liveFeeds.status.aircraft.count} MIL ADS-B`);
  if (liveFeeds.enabled.bgp && liveFeeds.status.bgp.state === 'live') parts.push(`BGP ${liveFeeds.data.bgpRate}/s`);
  if (liveFeeds.enabled.solar && liveFeeds.data.solar) parts.push(`Kp ${liveFeeds.data.solar.kp.toFixed(1)}`);
  els.mapTelemetryLine.textContent = parts.length ? `LIVE BUS: ${parts.join(' • ')}` : 'ALL DATA LAYERS MUTED — WIREFRAME BASE ONLY';
}

function setMapLayer(layer, forced = null, { silent = false } = {}) {
  if (!(layer in mapEngine.layers)) return;
  const next = forced !== null ? Boolean(forced) : !mapEngine.layers[layer];
  mapEngine.setLayer(layer, next);
  document.querySelector(`.layer-pill[data-layer="${layer}"]`)?.classList.toggle('active', next);

  // Bidirectional sync between nodes/arcs/sigint pills and SPY OPS chip
  if (layer === 'nodes' || layer === 'arcs' || layer === 'sigint') {
    const anySpy = Boolean(mapEngine.layers.nodes || mapEngine.layers.arcs || mapEngine.layers.sigint);
    if (anySpy !== state.spyOpsEnabled) {
      state.spyOpsEnabled = anySpy;
      syncFeedSwitchboard();
      updateTelemetryMeters({ pushSpark: false });
    }
  }
  if (!silent) {
    sfx.playClick();
    saveHudState();
  }
}

function toggleDataset(feedKey, forced = null, { silent = false } = {}) {
  if (feedKey === 'spyOps') {
    state.spyOpsEnabled = forced !== null ? Boolean(forced) : !state.spyOpsEnabled;
    mapEngine.setLayer('nodes', state.spyOpsEnabled);
    mapEngine.setLayer('arcs', state.spyOpsEnabled);
    mapEngine.setLayer('sigint', state.spyOpsEnabled);
    ['nodes', 'arcs', 'sigint'].forEach((l) => {
      document.querySelector(`.layer-pill[data-layer="${l}"]`)?.classList.toggle('active', state.spyOpsEnabled);
    });
    if (!silent) sfx.playClick();
    syncFeedSwitchboard();
    updateTelemetryMeters({ pushSpark: false });
    saveHudState();
    syncUrlParams();
    if (!silent) pushLog('SIG', `DATASET [SPY OPS] ${state.spyOpsEnabled ? 'ENABLED' : 'MUTED'}.`);
    return;
  }

  if (feedKey in liveFeeds.enabled) {
    const next = forced !== null ? Boolean(forced) : !liveFeeds.enabled[feedKey];
    liveFeeds.setEnabled(feedKey, next);
    mapEngine.setLayer(feedKey, next);
    if (!silent) sfx.playClick();
    syncFeedSwitchboard();
    renderSatList();
    if (state.opsMode === 'live') renderOpsList();
    updateTelemetryMeters({ pushSpark: false });
    saveHudState();
    syncUrlParams();
    if (!silent) pushLog('SIG', `LIVE FEED [${feedKey.toUpperCase()}] ${next ? 'ENABLED' : 'MUTED'}.`);
  }
}

function applyFeedPreset(preset, { silent = false } = {}) {
  if (preset === 'all') {
    toggleDataset('spyOps', true, { silent: true });
    ALL_LIVE_KEYS.forEach((k) => toggleDataset(k, true, { silent: true }));
    if (!silent) {
      sfx.playClick();
      pushLog('SIG', 'FEED PRESET [ALL]: ALL 10 LIVE & SCENARIO DATASETS ENABLED.');
    }
  } else if (preset === 'live') {
    toggleDataset('spyOps', false, { silent: true });
    ALL_LIVE_KEYS.forEach((k) => toggleDataset(k, true, { silent: true }));
    setOpsMode('live', { silent: true });
    if (!silent) {
      sfx.playClick();
      pushLog('SIG', 'FEED PRESET [LIVE]: REAL PUBLIC OSINT FEEDS ACTIVE (SPY OPS MUTED).');
    }
  } else if (preset === 'none') {
    toggleDataset('spyOps', false, { silent: true });
    ALL_LIVE_KEYS.forEach((k) => toggleDataset(k, false, { silent: true }));
    if (!silent) {
      sfx.playClick();
      pushLog('SIG', 'FEED PRESET [NONE]: ALL DATASETS MUTED — WIREFRAME BASE ONLY.');
    }
  }
  saveHudState();
  syncUrlParams({ feedsPreset: preset });
}

// ----------------------------------------------------------------------------
// HOVER TOOLTIP (XSS-SAFE + OVERLAP CYCLE HINT)
// ----------------------------------------------------------------------------
function renderTooltip(hit, mx, my) {
  if (!hit) {
    els.mapTooltip.classList.add('hidden');
    return;
  }

  let html = '';
  if (hit.kind === 'node') {
    const n = hit.item;
    html = `
      <div class="tt-head"><span>${escapeHtml(n.opName)}</span><span>${escapeHtml(n.code)}</span></div>
      <div class="tt-sub">${escapeHtml(n.city)}, ${escapeHtml(n.country)} • ${escapeHtml(n.status)}</div>
      <div class="tt-meta">${escapeHtml(formatCoord(n.lat, n.lon))} • ${escapeHtml(n.freq)}</div>
    `;
  } else if (hit.kind === 'sat' || hit.kind === 'liveSat') {
    const s = hit.item;
    html = `
      <div class="tt-head"><span>${escapeHtml(s.name)}</span><span>${hit.kind === 'liveSat' ? 'LIVE NORAD' : 'SIM ORBIT'}</span></div>
      <div class="tt-sub">${escapeHtml(s.mission)}</div>
      <div class="tt-meta">${escapeHtml(s.orbit)}${s.velKms ? ` • ${escapeHtml(s.velKms)} km/s` : ''} • ${escapeHtml(formatCoord(s.lat, s.lon))}</div>
    `;
  } else if (hit.kind === 'quake') {
    const q = hit.item;
    html = `
      <div class="tt-head"><span>M ${escapeHtml(q.mag.toFixed(1))} EARTHQUAKE</span><span>USGS LIVE</span></div>
      <div class="tt-sub">${escapeHtml(q.place)}</div>
      <div class="tt-meta">Depth ${escapeHtml(q.depthKm)} km • ${escapeHtml(formatCoord(q.lat, q.lon))}</div>
    `;
  } else if (hit.kind === 'eonet') {
    const e = hit.item;
    html = `
      <div class="tt-head"><span>${escapeHtml(e.categoryTitle)}</span><span>NASA EONET</span></div>
      <div class="tt-sub">${escapeHtml(e.title)}</div>
      <div class="tt-meta">${escapeHtml(formatCoord(e.lat, e.lon))} • ${escapeHtml(e.source)}</div>
    `;
  } else if (hit.kind === 'aircraft') {
    const a = hit.item;
    const hdg = a.trackDeg !== null && a.trackDeg !== undefined ? `${Math.round(a.trackDeg)}°` : '--';
    html = `
      <div class="tt-head"><span>${escapeHtml(a.callsign)} [${escapeHtml(a.type)}]</span><span>ADS-B MIL</span></div>
      <div class="tt-sub">ALT ${escapeHtml(Number(a.altFt || 0).toLocaleString())} ft • ${escapeHtml(a.gsKts)} kts • HDG ${escapeHtml(hdg)}</div>
      <div class="tt-meta">HEX ${escapeHtml(a.hex)} • REG ${escapeHtml(a.reg)} • SQK ${escapeHtml(a.squawk)}</div>
    `;
  } else if (hit.kind === 'bgp') {
    const c = hit.item;
    html = `
      <div class="tt-head"><span>${escapeHtml(c.city)} IXP (${escapeHtml(c.ixp)})</span><span>RIPE BGP</span></div>
      <div class="tt-sub">${escapeHtml(c.code)} • ${escapeHtml(c.msgCount)} live updates</div>
      <div class="tt-meta">${escapeHtml(c.lastAsn || 'AS?')} → ${escapeHtml(c.lastPrefix || 'Listening...')}</div>
    `;
  } else if (hit.kind === 'gdacs') {
    const g = hit.item;
    html = `
      <div class="tt-head"><span>${escapeHtml(g.name)}</span><span>${escapeHtml(String(g.alertLevel || '').toUpperCase())}</span></div>
      <div class="tt-sub">${escapeHtml(g.country)} • ${escapeHtml(g.typeLabel)}</div>
      <div class="tt-meta">${escapeHtml(g.source)} • ${escapeHtml(formatCoord(g.lat, g.lon))}</div>
    `;
  } else if (hit.kind === 'meteo') {
    const m = hit.item;
    html = `
      <div class="tt-head"><span>${escapeHtml(m.name)}</span><span>OPEN-METEO</span></div>
      <div class="tt-sub">${escapeHtml(m.tempC)}°C • ${escapeHtml(m.condition)}</div>
      <div class="tt-meta">Wind ${escapeHtml(m.windKmh)} km/h @ ${escapeHtml(m.windDir)}° • ${escapeHtml(m.pressureHpa)} hPa</div>
    `;
  } else if (hit.kind === 'wiki') {
    const w = hit.item;
    html = `
      <div class="tt-head"><span>WIKIPEDIA [${escapeHtml(w.lang)}]</span><span>LIVE EDITS</span></div>
      <div class="tt-sub">${escapeHtml(w.lastTitle || 'Streaming live edits...')}</div>
      <div class="tt-meta">${escapeHtml(w.recentCount)} edits tracked • ${escapeHtml(w.city)}</div>
    `;
  } else if (hit.kind === 'cable') {
    const c = hit.item;
    html = `
      <div class="tt-head"><span>${escapeHtml(c.name)}</span><span>SUBSEA CABLE</span></div>
      <div class="tt-sub">${escapeHtml(c.region)} • ${escapeHtml(c.capacity)} • RFS ${escapeHtml(c.rfs)}</div>
      <div class="tt-meta">${escapeHtml(c.landing)}</div>
    `;
  } else if (hit.kind === 'solar') {
    const s = hit.item;
    const kpVal = Number.isFinite(Number(s?.kp)) ? Number(s.kp).toFixed(1) : '--';
    const scale = s?.scale || s?.solar?.scale || 'G0';
    const flare = s?.flareClass || s?.goes?.flareClass || 'A0.0';
    const label = s?.label || s?.solar?.label || 'GEOMAGNETIC ACTIVITY';
    html = `
      <div class="tt-head"><span>NOAA SPACE WEATHER</span><span>${escapeHtml(scale)}</span></div>
      <div class="tt-sub">Kp ${escapeHtml(kpVal)} • GOES X-RAY ${escapeHtml(flare)}</div>
      <div class="tt-meta">${escapeHtml(label)}</div>
    `;
  }

  if (hit.overlapCount > 1) {
    const idx = Number.isFinite(hit.overlapIndex) ? hit.overlapIndex + 1 : 1;
    html += `<div class="tt-meta" style="color:var(--accent)">[${idx}/${hit.overlapCount} STACKED — CLICK TO CYCLE]</div>`;
  }

  els.mapTooltip.innerHTML = html;

  const stageRect = $('mapStage').getBoundingClientRect();
  const left = Math.max(10, Math.min(stageRect.width - 230, mx + 14));
  const top = Math.max(10, Math.min(stageRect.height - 96, my - 12));
  els.mapTooltip.style.left = `${left}px`;
  els.mapTooltip.style.top = `${top}px`;
  els.mapTooltip.classList.remove('hidden');
}

// ----------------------------------------------------------------------------
// LIVE INTERCEPT LOG WITH CHARACTER-DECODE ANIMATION
// ----------------------------------------------------------------------------
function sanitizeSev(sev) {
  const clean = String(sev || 'SIG').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  return clean || 'SIG';
}

function pushLog(sev, message, animateDecode = true) {
  const safeSev = sanitizeSev(sev);
  const now = new Date();
  const ts = tzFormatters.utc.format(now) + 'Z';
  const entry = { id: `${Date.now()}-${Math.random()}`, sev: safeSev, ts, text: String(message ?? ''), hex: randomHex(6) };
  state.logs.unshift(entry);
  if (state.logs.length > 48) state.logs.pop();

  if (state.logFilter !== 'ALL' && state.logFilter !== safeSev) return;

  const div = document.createElement('div');
  div.className = `log-entry sev-${safeSev}`;
  div.innerHTML = `
    <div class="log-meta">
      <span class="log-sev">[${escapeHtml(safeSev)}] 0x${escapeHtml(entry.hex)}</span>
      <span>${escapeHtml(ts)}</span>
    </div>
    <div class="log-text"></div>
  `;
  const textEl = div.querySelector('.log-text');
  els.logFeed.prepend(div);

  while (els.logFeed.children.length > 35) {
    els.logFeed.lastElementChild.remove();
  }

  if (!animateDecode) {
    textEl.textContent = entry.text;
    return;
  }

  // Matrix/cipher scramble-to-plaintext reveal
  const cipherChars = '0123456789ABCDEF#$%*@/';
  let frame = 0;
  const totalFrames = 10;
  const msg = entry.text;
  const timer = setInterval(() => {
    frame++;
    const revealed = Math.floor((frame / totalFrames) * msg.length);
    let out = msg.slice(0, revealed);
    const tailLen = Math.min(12, msg.length - revealed);
    for (let i = 0; i < tailLen; i++) {
      out += cipherChars[Math.floor(Math.random() * cipherChars.length)];
    }
    textEl.textContent = out;
    if (frame >= totalFrames) {
      textEl.textContent = msg;
      clearInterval(timer);
    }
  }, 26);
}

function rerenderLogFeed() {
  els.logFeed.innerHTML = '';
  const visible = state.logFilter === 'ALL' ? state.logs : state.logs.filter((l) => l.sev === state.logFilter);
  visible.slice(0, 35).forEach((entry) => {
    const safeSev = sanitizeSev(entry.sev);
    const div = document.createElement('div');
    div.className = `log-entry sev-${safeSev}`;
    div.innerHTML = `
      <div class="log-meta">
        <span class="log-sev">[${escapeHtml(safeSev)}] 0x${escapeHtml(entry.hex)}</span>
        <span>${escapeHtml(entry.ts)}</span>
      </div>
      <div class="log-text"></div>
    `;
    div.querySelector('.log-text').textContent = entry.text;
    els.logFeed.appendChild(div);
  });
}

// ----------------------------------------------------------------------------
// DEFCON & BREACH ALERT SIMULATION
// ----------------------------------------------------------------------------
function setDefcon(level, { silent = false } = {}) {
  state.defcon = Math.max(1, Math.min(5, level));
  els.defconBtn.dataset.level = String(state.defcon);
  els.defconVal.textContent = `DEFCON ${state.defcon}`;
  els.defconPips.querySelectorAll('i').forEach((pip) => {
    const d = Number(pip.dataset.d);
    pip.classList.toggle('lit', d >= state.defcon);
  });

  const critical = state.defcon <= 2;
  if (state.defcon === 1) {
    setAlertState(true, 'DEFCON 1 // MAXIMUM STRATEGIC READINESS — ALL SECTORS ON HIGH ALERT', { silent });
  } else if (!critical && state.alertActive) {
    setAlertState(false, null, { silent });
  }
  if (!silent) {
    pushLog(state.defcon <= 2 ? 'CRIT' : 'SIG', `STRATEGIC READINESS UPDATED TO DEFCON ${state.defcon}.`);
    saveHudState();
    syncUrlParams();
  }
}

function setAlertState(active, customMsg = null, { silent = false } = {}) {
  state.alertActive = Boolean(active);
  mapEngine.alertActive = state.alertActive;
  els.alertVignette.classList.toggle('active', state.alertActive);
  els.btnSimAlert.classList.toggle('active', state.alertActive);
  els.btnSimAlert.textContent = state.alertActive ? 'CLEAR ALERT' : 'ALERT';

  if (state.alertActive) {
    if (!silent) sfx.playAlert();
    spectrum.boost(1.5);
    showBanner('TACTICAL BREACH ALERT // PRIORITY-0', customMsg || 'ANOMALOUS MULTI-VECTOR INTRUSION DETECTED — INITIATING COUNTERMEASURES', 'alert', 100);
    if (!silent) {
      pushLog('CRIT', customMsg || 'RED ALERT: Simultaneous encrypted burst surges across Zurich, Moscow, and Shenzhen!');
    }
  } else {
    hideBanner();
    if (!silent) pushLog('SIG', 'Tactical alert cleared. Resuming standard global monitoring protocol.');
  }
}

function showBanner(tag, msg, mode = 'trace', progressPct = 0) {
  els.mapBanner.classList.remove('hidden', 'mode-trace', 'mode-locked');
  if (mode === 'trace') els.mapBanner.classList.add('mode-trace');
  if (mode === 'locked') els.mapBanner.classList.add('mode-locked');
  els.bannerTag.textContent = tag;
  els.bannerMsg.textContent = msg;
  els.bannerProgress.style.width = `${progressPct}%`;
}

function hideBanner() {
  els.mapBanner.classList.add('hidden');
}

// ----------------------------------------------------------------------------
// MULTI-HOP SIGNAL TRACE SEQUENCE (NODES, LIVE OSINT & ORBITAL TARGETS)
// ----------------------------------------------------------------------------
function cancelTrace() {
  state.traceTimers.forEach((t) => clearTimeout(t));
  state.traceTimers = [];
  mapEngine.clearTrace();
}

function describeLiveTargetForTrace(kind, item) {
  switch (kind) {
    case 'liveSat':
      return { code: `NORAD-${item.noradId}`, title: item.name, sub: `ALT ${item.altKm} KM` };
    case 'quake':
      return { code: `USGS-M${item.mag.toFixed(1)}`, title: `SEISMIC M${item.mag.toFixed(1)}`, sub: item.place };
    case 'eonet':
      return { code: item.source || 'EONET', title: item.title, sub: item.categoryTitle };
    case 'aircraft':
      return { code: item.callsign || item.hex, title: `${item.callsign} [${item.type}]`, sub: `FL${Math.round((item.altFt || 0) / 100)}` };
    case 'bgp':
      return { code: item.code || 'RIPE', title: `${item.city} IXP`, sub: item.ixp };
    case 'gdacs':
      return { code: `GDACS-${item.eventType}`, title: item.name, sub: item.country };
    case 'meteo':
      return { code: 'METEO', title: item.name, sub: item.condition };
    case 'wiki':
      return { code: `WIKI-${item.lang}`, title: `WIKIPEDIA [${item.lang}]`, sub: item.city };
    case 'cable':
      return { code: item.code || 'SUBSEA', title: item.name, sub: item.region };
    case 'solar':
      return { code: item.scale || 'NOAA', title: `SOLAR ${item.scale || 'G0'}`, sub: item.flareClass || 'SWPC' };
    default:
      return { code: 'LIVE', title: item.name || item.title || item.id, sub: 'OSINT' };
  }
}

function runTrace(targetArg = null) {
  cancelTrace();

  const fakeIp = () =>
    `${10 + Math.floor(Math.random() * 210)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 254)}`;

  const forcedNode = targetArg ? NODES.find((n) => n.id === targetArg) : null;
  let waypoints = null;
  let routeIsObjectWaypoints = false;

  if (!forcedNode && (state.selectedLive?.item || state.selectedSatId)) {
    let targetWp = null;
    if (state.selectedLive?.item) {
      const { kind, id } = state.selectedLive;
      const fresh =
        kind === 'cable'
          ? SUBSEA_CABLES.find((c) => c.id === id) || state.selectedLive.item
          : kind === 'solar'
          ? state.selectedLive.item
          : liveFeeds.findLiveItem(kind, id) || state.selectedLive.item;
      if (fresh && Number.isFinite(fresh.lon) && Number.isFinite(fresh.lat)) {
        const meta = describeLiveTargetForTrace(kind, fresh);
        targetWp = {
          id: fresh.id,
          lon: fresh.lon,
          lat: fresh.lat,
          label: meta.code,
          city: meta.title,
          country: meta.sub,
          opName: meta.title,
          code: meta.code,
          isLive: true,
          liveKind: kind,
          liveItem: fresh,
        };
      }
    } else if (state.selectedSatId) {
      const sat = mapEngine.satellites.find((s) => s.id === state.selectedSatId);
      if (sat) {
        const code = sat.name.split(' ')[0];
        targetWp = {
          id: sat.id,
          lon: sat.lon,
          lat: sat.lat,
          label: code,
          city: sat.name,
          country: sat.orbit,
          opName: sat.name,
          code,
          isLive: true,
          simSatId: sat.id,
        };
      }
    }

    if (targetWp) {
      const relayPool = ['reykjavik', 'london', 'vienna', 'dubai', 'singapore', 'tokyo']
        .map((id) => NODES.find((n) => n.id === id))
        .filter(Boolean)
        .sort(() => Math.random() - 0.5)
        .slice(0, 2)
        .map((n) => ({
          id: n.id,
          lon: n.lon,
          lat: n.lat,
          label: n.code,
          city: n.city,
          country: n.country,
          opName: n.opName,
          code: n.code,
        }));

      waypoints = [
        { id: 'langley', lon: -77.1467, lat: 38.9517, label: 'HQ-01', city: 'LANGLEY', country: 'USA', opName: 'AEGIS COMMAND', code: 'HQ-01' },
        ...relayPool,
        targetWp,
      ];
      routeIsObjectWaypoints = true;
    }
  }

  let route = waypoints;
  if (!route) {
    const resolvedNodeId = forcedNode?.id || state.selectedNodeId;
    if (resolvedNodeId && resolvedNodeId !== 'langley') {
      const intermediates = ['reykjavik', 'london', 'vienna', 'dubai', 'singapore', 'tokyo'].filter(
        (id) => id !== resolvedNodeId
      );
      const chosen = intermediates.sort(() => Math.random() - 0.5).slice(0, 3);
      route = ['langley', ...chosen, resolvedNodeId];
    } else {
      route = TRACE_ROUTES[Math.floor(Math.random() * TRACE_ROUTES.length)];
    }
  }

  mapEngine.startTrace(route);
  spectrum.boost(1.4);
  pushLog('SIG', `INITIATING MULTI-HOP SIGNAL TRACE [${route.length - 1} RELAYS]...`);

  route.forEach((step, idx) => {
    const t = setTimeout(() => {
      const wp = routeIsObjectWaypoints ? step : NODES.find((n) => n.id === step);
      if (!wp) return;
      const isLast = idx === route.length - 1;
      const pct = Math.round(((idx + 1) / route.length) * 100);

      mapEngine.setTraceStep(idx, isLast);
      spectrum.boost(1.1);

      if (!isLast) {
        sfx.playTraceHop(idx);
        showBanner(
          `ACTIVE SIGNAL TRACE // HOP ${idx + 1} OF ${route.length}`,
          `BOUNCING THROUGH ${wp.city} [${wp.code}] // IP ${fakeIp()}`,
          'trace',
          pct
        );
        pushLog('SIG', `TRACE HOP ${idx + 1}: Relay ${wp.code} (${wp.city}) bypassed in ${18 + Math.floor(Math.random() * 44)}ms.`);
      } else {
        sfx.playTraceConfirmed();
        if (wp.isLive) {
          if (wp.liveKind && wp.liveItem) {
            const latest =
              wp.liveKind === 'cable'
                ? SUBSEA_CABLES.find((c) => c.id === wp.id) || wp.liveItem
                : wp.liveKind === 'solar'
                ? wp.liveItem
                : liveFeeds.findLiveItem(wp.liveKind, wp.id) || wp.liveItem;
            selectLiveItem(wp.liveKind, latest, true);
          } else if (wp.simSatId) {
            selectSat(wp.simSatId, true);
          } else {
            mapEngine.focusLonLat(wp.lon, wp.lat);
          }
        } else {
          selectNode(wp.id, true);
        }

        showBanner(
          'TARGET ACQUIRED // GEOLOCATION CONFIRMED',
          `${wp.opName} — ${wp.city}${wp.country ? `, ${wp.country}` : ''} (${formatCoord(wp.lat, wp.lon)})`,
          'locked',
          100
        );
        pushLog('CRIT', `TRACE LOCKED: Signal origin confirmed at ${wp.opName} (${wp.code}).`);

        const clearT = setTimeout(() => {
          if (!state.alertActive) hideBanner();
          mapEngine.clearTrace();
        }, 4200);
        state.traceTimers.push(clearT);
      }
    }, idx * 820);

    state.traceTimers.push(t);
  });
}

// ----------------------------------------------------------------------------
// TARGET FOCUS HELPER (CLI + URL ?focus=...)
// ----------------------------------------------------------------------------
function focusTargetByQuery(rawQuery, { silentNotFound = false } = {}) {
  const arg = String(rawQuery || '').trim().toLowerCase();
  if (!arg) return false;

  const node = NODES.find(
    (n) =>
      n.city.toLowerCase().includes(arg) ||
      n.country.toLowerCase().includes(arg) ||
      n.code.toLowerCase() === arg ||
      n.opName.toLowerCase().includes(arg) ||
      n.id.toLowerCase() === arg
  );
  if (node) {
    selectNode(node.id, true);
    pushLog('SIG', `TARGET LOCKED ON ${node.opName} (${node.city}).`);
    return true;
  }

  const liveSat = liveFeeds.data.liveSats.find(
    (s) => s.name.toLowerCase().includes(arg) || String(s.noradId) === arg
  );
  if (liveSat) {
    selectLiveItem('liveSat', liveSat, true);
    pushLog('SAT', `LIVE NORAD LOCK ENGAGED ON ${liveSat.name}.`);
    return true;
  }

  const ac = liveFeeds.data.aircraft.find(
    (a) =>
      a.callsign.toLowerCase().includes(arg) ||
      a.hex.toLowerCase() === arg ||
      a.type.toLowerCase() === arg
  );
  if (ac) {
    selectLiveItem('aircraft', ac, true);
    pushLog('SIG', `ADS-B LOCK ENGAGED ON ${ac.callsign} [${ac.type}].`);
    return true;
  }

  const cable = SUBSEA_CABLES.find(
    (c) =>
      c.name.toLowerCase().includes(arg) ||
      c.code.toLowerCase() === arg ||
      c.landing.toLowerCase().includes(arg) ||
      c.region.toLowerCase().includes(arg)
  );
  if (cable) {
    selectLiveItem('cable', cable, true);
    pushLog('SIG', `SUBSEA TRUNK LOCK ENGAGED ON ${cable.name} (${cable.capacity}).`);
    return true;
  }

  const anomaly = liveFeeds.getLiveAnomalies().find(
    (a) =>
      String(a.title || '').toLowerCase().includes(arg) ||
      String(a.sub || '').toLowerCase().includes(arg) ||
      String(a.code || '').toLowerCase().includes(arg) ||
      String(a.badge || '').toLowerCase().includes(arg)
  );
  if (anomaly?.item) {
    selectLiveItem(anomaly.kind, anomaly.item, true);
    pushLog('SIG', `OSINT ANOMALY LOCK ENGAGED ON ${anomaly.title}.`);
    return true;
  }

  const sat = mapEngine.satellites.find((s) => s.name.toLowerCase().includes(arg));
  if (sat) {
    selectSat(sat.id, true);
    pushLog('SAT', `ORBITAL LOCK ENGAGED ON ${sat.name}.`);
    return true;
  }

  if (!silentNotFound) {
    pushLog('WARN', `No asset, cable, anomaly, spacecraft, or aircraft matching "${arg}".`);
  }
  return false;
}

// ----------------------------------------------------------------------------
// INTERACTIVE COMMAND LINE PARSER + TAB AUTOCOMPLETE
// ----------------------------------------------------------------------------
function getCommandSuggestion(rawValue) {
  const trimmedStart = rawValue.replace(/^\s+/, '');
  if (!trimmedStart) return '';
  const hasTrailingSpace = /\s$/.test(trimmedStart);
  const tokens = trimmedStart.toLowerCase().split(/\s+/);
  const cmd = tokens[0];

  if (tokens.length === 1 && !hasTrailingSpace) {
    const match = CLI_COMMANDS.find((c) => c.startsWith(cmd) && c !== cmd);
    return match || '';
  }

  const argPartial = hasTrailingSpace ? '' : tokens.slice(1).join(' ');
  let candidates = [];

  switch (cmd) {
    case 'mode':
    case 'view':
      candidates = ['2d', '3d', 'globe', 'map'];
      break;
    case 'theme':
    case 'color':
      candidates = VALID_THEMES;
      break;
    case 'ops':
      candidates = ['live', 'sim'];
      break;
    case 'cables':
    case 'cable':
    case 'terminator':
    case 'term':
    case 'live':
      candidates = ['on', 'off'];
      break;
    case 'spectrum':
    case 'spec':
      candidates = ['goes', 'bgp', 'rf'];
      break;
    case 'panels':
    case 'sidebar':
    case 'sidebars':
      candidates = ['left', 'right', 'show', 'hide'];
      break;
    case 'defcon':
      candidates = ['1', '2', '3', '4', '5'];
      break;
    case 'feed':
    case 'feeds':
      candidates = ['ops', 'sats', 'quakes', 'eonet', 'aircraft', 'bgp', 'gdacs', 'meteo', 'wiki', 'solar', 'cables', 'terminator'];
      break;
    case 'trace':
      candidates = NODES.map((n) => n.city.toLowerCase());
      break;
    case 'focus':
    case 'lock':
    case 'goto':
      candidates = [
        ...NODES.map((n) => n.city.toLowerCase()),
        ...liveFeeds.data.liveSats.map((s) => s.name.toLowerCase()),
        ...SUBSEA_CABLES.map((c) => c.name.toLowerCase()),
        ...liveFeeds.data.aircraft.slice(0, 30).map((a) => a.callsign.toLowerCase()),
        ...mapEngine.satellites.map((s) => s.name.toLowerCase()),
      ];
      break;
    default:
      return '';
  }

  const match = candidates.find((c) => c.startsWith(argPartial) && c !== argPartial);
  return match ? `${cmd} ${match}` : '';
}

function updateCmdHint() {
  if (!els.cmdHint) return;
  const suggestion = getCommandSuggestion(els.cmdInput.value);
  els.cmdHint.textContent = suggestion ? `Tab: ${suggestion}` : '';
}

function handleCommand(raw) {
  const input = raw.trim();
  if (!input) return;

  if (state.cmdHistory[state.cmdHistory.length - 1] !== input) {
    state.cmdHistory.push(input);
    if (state.cmdHistory.length > 50) state.cmdHistory.shift();
  }
  state.cmdHistIdx = -1;
  state.cmdDraft = '';

  const parts = input.toLowerCase().split(/\s+/);
  const cmd = parts[0];
  const arg = parts.slice(1).join(' ');

  sfx.playClick();
  pushLog('CMD', `> ${input}`, false);

  switch (cmd) {
    case 'help':
    case '?':
      pushLog(
        'CMD',
        'COMMANDS: trace [city] | focus <city|iss|cable|callsign|anomaly> | ops <live|sim> | cables [on|off] | terminator [on|off] | feed <ops|sats|quakes|eonet|aircraft|bgp|gdacs|meteo|wiki|solar|cables|terminator> | live [on|off] | refresh | spectrum <goes|bgp|rf> | mode 2d|globe | panels [left|right|show|hide] | maponly | resetlayout | theme cyan|amber|emerald|crimson | defcon <1-5> | alert | ping | clear | status',
        false
      );
      break;

    case 'trace': {
      const target = arg
        ? NODES.find((n) => n.city.toLowerCase().includes(arg) || n.code.toLowerCase() === arg || n.id.includes(arg))
        : null;
      runTrace(target?.id || null);
      break;
    }

    case 'focus':
    case 'lock':
    case 'goto': {
      if (!arg) {
        pushLog('WARN', 'Usage: focus <city, satellite, cable, anomaly, or callsign> (e.g. focus iss, focus marea, focus tokyo)');
        break;
      }
      focusTargetByQuery(arg);
      break;
    }

    case 'ops': {
      if (arg === 'live' || arg === 'sim') {
        setOpsMode(arg);
        pushLog('SIG', `OPERATIONS PANEL SWITCHED TO ${arg === 'live' ? 'LIVE OSINT ANOMALIES' : 'SIM SCENARIO OPS'}.`);
      } else {
        pushLog('WARN', 'Usage: ops <live | sim>');
      }
      break;
    }

    case 'cables':
    case 'cable': {
      const forced = arg === 'on' ? true : arg === 'off' ? false : null;
      setMapLayer('cables', forced);
      pushLog('SIG', `SUBSEA FIBER TRUNK CABLES LAYER ${mapEngine.layers.cables ? 'ENABLED' : 'MUTED'}.`);
      break;
    }

    case 'terminator':
    case 'term': {
      const forced = arg === 'on' ? true : arg === 'off' ? false : null;
      setMapLayer('terminator', forced);
      pushLog('SIG', `SOLAR DAY/NIGHT TERMINATOR LAYER ${mapEngine.layers.terminator ? 'ENABLED' : 'MUTED'}.`);
      break;
    }

    case 'live': {
      const turnOn = arg === 'off' ? false : arg === 'on' ? true : !liveFeeds.enabled.quakes;
      ALL_LIVE_KEYS.forEach((k) => toggleDataset(k, turnOn, { silent: true }));
      saveHudState();
      syncUrlParams();
      pushLog('SIG', `ALL 9 LIVE PUBLIC TELEMETRY FEEDS ${turnOn ? 'ENABLED' : 'MUTED'}.`);
      break;
    }

    case 'feed':
    case 'feeds': {
      const mapKey = {
        ops: 'spyOps',
        spy: 'spyOps',
        spyops: 'spyOps',
        sats: 'liveSats',
        iss: 'liveSats',
        livesats: 'liveSats',
        quake: 'quakes',
        quakes: 'quakes',
        eonet: 'eonet',
        nasa: 'eonet',
        air: 'aircraft',
        aircraft: 'aircraft',
        adsb: 'aircraft',
        bgp: 'bgp',
        ripe: 'bgp',
        gdacs: 'gdacs',
        crisis: 'gdacs',
        meteo: 'meteo',
        weather: 'meteo',
        wx: 'meteo',
        wiki: 'wiki',
        solar: 'solar',
        noaa: 'solar',
        cable: 'cables',
        cables: 'cables',
        term: 'terminator',
        terminator: 'terminator',
      }[arg];
      if (mapKey === 'cables' || mapKey === 'terminator') {
        setMapLayer(mapKey);
        pushLog('SIG', `MAP LAYER [${mapKey.toUpperCase()}] ${mapEngine.layers[mapKey] ? 'ENABLED' : 'MUTED'}.`);
      } else if (mapKey) {
        toggleDataset(mapKey);
      } else {
        pushLog('WARN', 'Usage: feed <ops|sats|quakes|eonet|aircraft|bgp|gdacs|meteo|wiki|solar|cables|terminator>');
      }
      break;
    }

    case 'refresh':
      liveFeeds.refreshAll();
      pushLog('SIG', 'FORCING MANUAL SYNCHRONIZATION ACROSS ALL ENABLED LIVE APIS...');
      break;

    case 'spectrum':
    case 'spec':
      if (['goes', 'bgp', 'rf'].includes(arg)) {
        setSpectrumMode(arg);
        pushLog('SIG', `SPECTRUM WIDGET SWITCHED TO ${arg.toUpperCase()} MODE.`);
      } else {
        pushLog('WARN', 'Usage: spectrum <goes | bgp | rf>');
      }
      break;

    case 'mode':
    case 'view': {
      if (arg === '3d' || arg === 'globe') setProjectionMode('3d');
      else if (arg === '2d' || arg === 'map' || arg === 'flat') setProjectionMode('2d');
      else pushLog('WARN', 'Usage: mode 2d | mode globe');
      break;
    }

    case 'maponly':
    case 'focusmap':
      toggleMapOnly();
      break;

    case 'resetlayout':
      panelLayout.resetAll();
      setSidebars({ left: true, right: true });
      break;

    case 'panels':
    case 'sidebar':
    case 'sidebars': {
      if (arg === 'left') setSidebars({ left: !state.leftOpen });
      else if (arg === 'right') setSidebars({ right: !state.rightOpen });
      else if (arg === 'hide' || arg === 'off') setSidebars({ left: false, right: false });
      else if (arg === 'show' || arg === 'on') setSidebars({ left: true, right: true });
      else toggleMapOnly();
      break;
    }

    case 'theme':
    case 'color': {
      if (VALID_THEMES.includes(arg)) {
        setTheme(arg);
      } else {
        pushLog('WARN', 'Themes available: cyan, amber, emerald, crimson');
      }
      break;
    }

    case 'defcon': {
      const lvl = parseInt(arg, 10);
      if (lvl >= 1 && lvl <= 5) setDefcon(lvl);
      else pushLog('WARN', 'Usage: defcon <1-5>');
      break;
    }

    case 'alert':
      setAlertState(!state.alertActive);
      break;

    case 'ping':
      triggerSonarPing();
      break;

    case 'clear':
      state.logs = [];
      els.logFeed.innerHTML = '';
      break;

    case 'status': {
      const tm = liveFeeds.computeThreatMetrics();
      const anomalies = liveFeeds.getLiveAnomalies();
      const liveSatCnt = liveFeeds.data.liveSats.length;
      pushLog(
        'SIG',
        `STATUS: DEFCON ${state.defcon} | PROJ ${mapEngine.mode.toUpperCase()} | FEEDS ${tm.healthyFeeds}/${tm.activeFeeds} LIVE | ${liveSatCnt} NORAD SATS | ${anomalies.length} ANOMALIES | INDEX ${state.threatIndex.toFixed(1)} | CABLES ${mapEngine.layers.cables ? 'ON' : 'OFF'}`
      );
      break;
    }

    default:
      pushLog('WARN', `Unknown command "${cmd}". Type "help" for available tactical commands.`);
  }
}

// ----------------------------------------------------------------------------
// UI MODE & THEME SWITCHERS
// ----------------------------------------------------------------------------
function setProjectionMode(mode, { silent = false } = {}) {
  mapEngine.setMode(mode);
  els.btnMode2D.classList.toggle('active', mode === '2d');
  els.btnMode3D.classList.toggle('active', mode === '3d');
  els.btnAutoRotate.style.display = mode === '3d' ? 'flex' : 'none';
  els.btnAutoRotate.classList.toggle('active', mapEngine.autoRotate);
  els.mapProjectionLabel.textContent =
    mode === '3d'
      ? 'PROJ: ORTHOGRAPHIC 3D HOLOGRAPHIC GLOBE // WGS-84'
      : 'PROJ: EQUIRECTANGULAR WIREFRAME // WGS-84';
  if (!silent) {
    sfx.playClick();
    pushLog('SIG', `PROJECTION MATRIX SWITCHED TO ${mode === '3d' ? '3D HOLOGRAPHIC GLOBE' : '2D TACTICAL WIREFRAME'}.`);
    saveHudState();
    syncUrlParams();
  }
}

function setTheme(theme, { silent = false } = {}) {
  document.documentElement.setAttribute('data-theme', theme);
  invalidateThemePalette();
  mapEngine.invalidateCache?.();
  radar.resize?.();
  sparkline.resize?.();
  document.querySelectorAll('.theme-dot').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
  if (!silent) {
    sfx.playClick();
    pushLog('SIG', `HUD PHOSPHOR PALETTE SET TO ${theme.toUpperCase()}.`);
    saveHudState();
    syncUrlParams();
  }
}

function setSidebars({ left = state.leftOpen, right = state.rightOpen } = {}, { silent = false } = {}) {
  state.leftOpen = Boolean(left);
  state.rightOpen = Boolean(right);

  els.leftCol.classList.toggle('collapsed', !state.leftOpen);
  els.rightCol.classList.toggle('collapsed', !state.rightOpen);
  els.leftColResizer.classList.toggle('is-hidden', !state.leftOpen);
  els.rightColResizer.classList.toggle('is-hidden', !state.rightOpen);

  const mapOnly = !state.leftOpen && !state.rightOpen;
  els.btnToggleLeft.classList.toggle('active', state.leftOpen);
  els.btnToggleLeft.setAttribute('aria-pressed', String(state.leftOpen));
  els.btnToggleRight.classList.toggle('active', state.rightOpen);
  els.btnToggleRight.setAttribute('aria-pressed', String(state.rightOpen));
  els.btnMapOnly.classList.toggle('active', mapOnly);
  els.btnMapOnly.setAttribute('aria-pressed', String(mapOnly));

  els.dockLeftBtn.textContent = state.leftOpen ? '‹' : '›';
  els.dockLeftBtn.classList.toggle('is-collapsed', !state.leftOpen);
  els.dockRightBtn.textContent = state.rightOpen ? '›' : '‹';
  els.dockRightBtn.classList.toggle('is-collapsed', !state.rightOpen);

  if (!silent) {
    sfx.playClick();
    saveHudState();
    const modeDesc = mapOnly
      ? 'MAP-ONLY FULL STAGE'
      : state.leftOpen && state.rightOpen
      ? 'FULL DUAL-SIDEBAR HUD'
      : state.leftOpen
      ? 'LEFT OPS PANEL ONLY'
      : 'RIGHT DOSSIER PANEL ONLY';
    pushLog('SIG', `VIEWPORT LAYOUT: ${modeDesc}.`);
  }
}

function toggleMapOnly() {
  const mapOnly = !state.leftOpen && !state.rightOpen;
  if (mapOnly) {
    setSidebars({ left: true, right: true });
  } else {
    setSidebars({ left: false, right: false });
  }
}

function triggerSonarPing() {
  sfx.playPing();
  radar.triggerPing();
  spectrum.boost(0.8);
  if (state.selectedNodeId) {
    const n = NODES.find((x) => x.id === state.selectedNodeId);
    if (n) {
      mapEngine.triggerPing(n.lon, n.lat, n.type === 'CRITICAL' ? '--crit' : '--accent');
      pushLog('SIG', `ACTIVE SONAR/RF PING TRANSMITTED TO ${n.code} (${n.city}) — ECHO 41ms.`);
    }
  } else if (state.selectedSatId) {
    const s = mapEngine.satellites.find((x) => x.id === state.selectedSatId);
    if (s) {
      mapEngine.triggerPing(s.lon, s.lat, '--ok');
      pushLog('SAT', `LASER RANGING PING CONFIRMED ON ${s.name} — RTT 12.6ms.`);
    }
  } else if (state.selectedLive?.item) {
    const item = state.selectedLive.item;
    mapEngine.triggerPing(item.lon, item.lat, '--accent');
    pushLog('SIG', `ACTIVE TELEMETRY PING ON ${item.name || item.callsign || item.title || item.id} — CONFIRMED.`);
  }
}

function triggerDecryptBurst() {
  sfx.playDecrypt();
  spectrum.boost(1.2);
  state.decryptPct = Math.min(99, state.decryptPct + 4 + Math.random() * 6);
  let code = 'AEGIS';
  if (state.selectedNodeId) {
    code = NODES.find((n) => n.id === state.selectedNodeId)?.code || 'AEGIS';
  } else if (state.selectedSatId) {
    code = mapEngine.satellites.find((s) => s.id === state.selectedSatId)?.name || 'ORBITAL';
  } else if (state.selectedLive?.item) {
    const it = state.selectedLive.item;
    code = it.callsign || it.code || it.name || it.title || it.hex || it.id || 'LIVE';
  }
  pushLog('SIG', `DECRYPT BURST [${code}]: Recovered session block 0x${randomHex(8)} — keyspace narrowed.`);
}

// ----------------------------------------------------------------------------
// EVENT LISTENERS & KEYBOARD SHORTCUTS
// ----------------------------------------------------------------------------
function bindUIEvents() {
  // Operations mode tabs (LIVE vs SIM)
  els.opsModeTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-ops-mode]');
    if (!btn) return;
    setOpsMode(btn.dataset.opsMode);
  });

  // Operations search input & clear
  els.opsSearchInput?.addEventListener('input', () => {
    state.opsQuery = els.opsSearchInput.value;
    els.opsSearchClear?.classList.toggle('hidden', !state.opsQuery);
    renderOpsList();
  });

  els.opsSearchClear?.addEventListener('click', () => {
    els.opsSearchInput.value = '';
    state.opsQuery = '';
    els.opsSearchClear.classList.add('hidden');
    sfx.playClick();
    renderOpsList();
    els.opsSearchInput.focus();
  });

  // Operations / Live Anomalies list click
  els.opsList.addEventListener('click', (e) => {
    const card = e.target.closest('.op-card');
    if (!card) return;
    if (card.dataset.liveKind && card.dataset.liveId) {
      const kind = card.dataset.liveKind;
      const id = card.dataset.liveId;
      let item = null;
      if (kind === 'solar') {
        item = liveFeeds.getLiveAnomalies().find((a) => a.kind === 'solar')?.item || {
          id: 'noaa-solar',
          kp: liveFeeds.data.solar?.kp ?? 0,
          scale: liveFeeds.data.solar?.scale || 'G0',
          flareClass: liveFeeds.data.goes?.flareClass || 'A0.0',
          solar: liveFeeds.data.solar,
          goes: liveFeeds.data.goes,
          lat: 65.0,
          lon: -20.0,
        };
      } else {
        item = liveFeeds.findLiveItem(kind, id) || liveFeeds.getLiveAnomalies().find((a) => a.kind === kind && a.id === id)?.item;
      }
      if (item) selectLiveItem(kind, item, true);
    } else if (card.dataset.id) {
      selectNode(card.dataset.id, true);
    }
  });

  // Node / Anomaly severity filter tabs
  $('nodeFilterRow').addEventListener('click', (e) => {
    const btn = e.target.closest('.micro-tab');
    if (!btn) return;
    state.nodeFilter = btn.dataset.filter;
    $('nodeFilterRow').querySelectorAll('.micro-tab').forEach((b) => b.classList.toggle('active', b === btn));
    sfx.playClick();
    renderOpsList();
  });

  // Satellites list click (supports both live NORAD spacecraft & simulated satellites)
  els.satList.addEventListener('click', (e) => {
    const row = e.target.closest('.sat-row');
    if (!row) return;
    if (row.dataset.liveSat) {
      const sat = liveFeeds.data.liveSats.find((s) => s.id === row.dataset.liveSat);
      if (sat) selectLiveItem('liveSat', sat, true);
    } else if (row.dataset.sat) {
      selectSat(row.dataset.sat, true);
    }
  });

  // Live Data Feeds Switchboard
  els.feedSwitchboard.addEventListener('click', (e) => {
    const chip = e.target.closest('.feed-chip');
    if (!chip) return;
    toggleDataset(chip.dataset.feed);
  });

  els.btnToggleFeedTray.addEventListener('click', () => {
    const collapsed = els.feedSwitchboard.classList.toggle('is-collapsed');
    els.feedTrayChevron.textContent = collapsed ? '▴' : '▾';
    sfx.playClick();
  });

  els.btnFeedsAll.addEventListener('click', () => applyFeedPreset('all'));
  els.btnFeedsLiveOnly.addEventListener('click', () => applyFeedPreset('live'));
  els.btnFeedsClear.addEventListener('click', () => applyFeedPreset('none'));

  els.btnRefreshFeeds.addEventListener('click', () => {
    sfx.playClick();
    liveFeeds.refreshAll();
    pushLog('SIG', 'SYNCHRONIZING LIVE PUBLIC TELEMETRY FEEDS...');
  });

  // Spectrum widget source tabs (GOES | BGP | RF)
  els.spectrumModes.addEventListener('click', (e) => {
    const btn = e.target.closest('.micro-tab');
    if (!btn) return;
    setSpectrumMode(btn.dataset.spec);
  });

  // Log filter tabs
  $('logFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('.micro-tab');
    if (!btn) return;
    state.logFilter = btn.dataset.log;
    $('logFilters').querySelectorAll('.micro-tab').forEach((b) => b.classList.toggle('active', b === btn));
    sfx.playClick();
    rerenderLogFeed();
  });

  // Projection switcher
  els.btnMode2D.addEventListener('click', () => setProjectionMode('2d'));
  els.btnMode3D.addEventListener('click', () => setProjectionMode('3d'));

  // Sliding sidebar & map-only controls
  els.btnToggleLeft.addEventListener('click', () => setSidebars({ left: !state.leftOpen }));
  els.btnToggleRight.addEventListener('click', () => setSidebars({ right: !state.rightOpen }));
  els.btnMapOnly.addEventListener('click', () => toggleMapOnly());
  els.dockLeftBtn.addEventListener('click', () => setSidebars({ left: !state.leftOpen }));
  els.dockRightBtn.addEventListener('click', () => setSidebars({ right: !state.rightOpen }));

  // Re-sync HiDPI canvases once sidebar slide finishes
  const onSlideEnd = (e) => {
    if (e.propertyName === 'width' || e.propertyName === 'flex-basis') {
      mapEngine.resize();
      spectrum.resize();
    }
  };
  els.leftCol.addEventListener('transitionend', onSlideEnd);
  els.rightCol.addEventListener('transitionend', onSlideEnd);

  // Map zoom / reset / autorotate
  $('btnZoomIn').addEventListener('click', () => { mapEngine.setZoom(0.35); sfx.playClick(); });
  $('btnZoomOut').addEventListener('click', () => { mapEngine.setZoom(-0.35); sfx.playClick(); });
  $('btnResetView').addEventListener('click', () => { mapEngine.resetView(); sfx.playClick(); });
  els.btnAutoRotate.addEventListener('click', () => {
    mapEngine.autoRotate = !mapEngine.autoRotate;
    els.btnAutoRotate.classList.toggle('active', mapEngine.autoRotate);
    sfx.playClick();
  });

  // DEFCON cycle
  els.defconBtn.addEventListener('click', () => {
    const next = state.defcon === 1 ? 5 : state.defcon - 1;
    setDefcon(next);
  });

  // Top action buttons
  els.btnTrace.addEventListener('click', () => runTrace());
  els.btnSimAlert.addEventListener('click', () => setAlertState(!state.alertActive));

  // Theme switcher
  document.querySelectorAll('.theme-dot').forEach((dot) => {
    dot.addEventListener('click', () => setTheme(dot.dataset.theme));
  });

  // Audio toggle
  els.btnAudio.addEventListener('click', () => {
    const next = !sfx.enabled;
    sfx.setEnabled(next);
    els.btnAudio.classList.toggle('active', next);
    els.btnAudio.setAttribute('aria-pressed', String(next));
    els.btnAudio.textContent = next ? 'SFX ON' : 'SFX OFF';
  });

  // CRT toggle
  els.btnCrt.addEventListener('click', () => {
    const enabled = document.body.classList.toggle('crt-enabled');
    els.btnCrt.classList.toggle('active', enabled);
    els.btnCrt.setAttribute('aria-pressed', String(enabled));
    sfx.playClick();
    saveHudState();
  });

  // Fullscreen toggle
  els.btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  });

  // Dossier action buttons
  $('btnDossierTrace').addEventListener('click', () => runTrace());
  $('btnDossierDecrypt').addEventListener('click', triggerDecryptBurst);
  $('btnDossierPing').addEventListener('click', triggerSonarPing);

  // Layer toggle pills (1..8, bidirectional sync with SPY OPS)
  $('layerToggles').addEventListener('click', (e) => {
    const pill = e.target.closest('.layer-pill');
    if (!pill) return;
    setMapLayer(pill.dataset.layer);
  });

  // Command form: submit, history (ArrowUp/Down), live ghost hint & Tab completion
  els.cmdForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleCommand(els.cmdInput.value);
    els.cmdInput.value = '';
    updateCmdHint();
  });

  els.cmdInput.addEventListener('input', () => {
    state.cmdHistIdx = -1;
    updateCmdHint();
  });

  els.cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const suggestion = getCommandSuggestion(els.cmdInput.value);
      if (suggestion) {
        e.preventDefault();
        els.cmdInput.value = suggestion;
        updateCmdHint();
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      if (!state.cmdHistory.length) return;
      e.preventDefault();
      if (state.cmdHistIdx === -1) {
        state.cmdDraft = els.cmdInput.value;
        state.cmdHistIdx = state.cmdHistory.length - 1;
      } else if (state.cmdHistIdx > 0) {
        state.cmdHistIdx--;
      }
      els.cmdInput.value = state.cmdHistory[state.cmdHistIdx] || '';
      updateCmdHint();
      return;
    }

    if (e.key === 'ArrowDown') {
      if (state.cmdHistIdx === -1) return;
      e.preventDefault();
      if (state.cmdHistIdx < state.cmdHistory.length - 1) {
        state.cmdHistIdx++;
        els.cmdInput.value = state.cmdHistory[state.cmdHistIdx] || '';
      } else {
        state.cmdHistIdx = -1;
        els.cmdInput.value = state.cmdDraft;
      }
      updateCmdHint();
    }
  });

  // Global keyboard shortcuts (with modifier guard + input/textarea guard)
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      if (e.key === 'Escape') active.blur();
      return;
    }

    if (e.key === '/') {
      e.preventDefault();
      els.cmdInput.focus();
      return;
    }

    const key = e.key.toLowerCase();
    const layerKeys = {
      '1': 'nodes',
      '2': 'arcs',
      '3': 'satellites',
      '4': 'sigint',
      '5': 'grid',
      '6': 'scan',
      '7': 'terminator',
      '8': 'cables',
    };
    if (layerKeys[key]) {
      const pill = document.querySelector(`.layer-pill[data-layer="${layerKeys[key]}"]`);
      pill?.click();
    } else if (key === 't') {
      runTrace();
    } else if (key === 'a') {
      setAlertState(!state.alertActive);
    } else if (key === 'g') {
      setProjectionMode(mapEngine.mode === '2d' ? '3d' : '2d');
    } else if (key === 'r') {
      mapEngine.resetView();
    } else if (key === 'm') {
      els.btnAudio.click();
    } else if (key === 'f') {
      els.btnFullscreen.click();
    } else if (key === '[') {
      setSidebars({ left: !state.leftOpen });
    } else if (key === ']') {
      setSidebars({ right: !state.rightOpen });
    } else if (key === 'h') {
      toggleMapOnly();
    }
  });

  // ResizeObserver for crisp HiDPI canvas sizing
  const ro = new ResizeObserver(() => {
    mapEngine.resize();
    spectrum.resize();
  });
  ro.observe($('mapStage'));
  ro.observe(els.spectrumCanvas.parentElement);
}

// ----------------------------------------------------------------------------
// PERIODIC LIVE TELEMETRY & REAL COMPOSITE THREAT INDEX
// ----------------------------------------------------------------------------
function flareClassToPct(flareClass) {
  const c = String(flareClass || 'A').toUpperCase();
  if (c.startsWith('X')) return 96;
  if (c.startsWith('M')) return 74;
  if (c.startsWith('C')) return 46;
  if (c.startsWith('B')) return 22;
  return 10;
}

function updateTelemetryMeters({ pushSpark = true } = {}) {
  const tm = liveFeeds.computeThreatMetrics();

  let composite = tm.anomalyIndex;
  if (state.alertActive) {
    composite = Math.max(composite + 22, 84);
  } else if (state.defcon <= 2) {
    composite += (3 - state.defcon) * 9;
  }
  // Tiny ±0.4 micro-jitter so sparkline stays alive without fake random walks
  const jitter = (Math.random() - 0.5) * 0.8;
  state.threatIndex = Math.max(12, Math.min(99, composite + jitter));

  if (!state.spyOpsEnabled) {
    // Pure OSINT mode: real system telemetry instead of simulated spy meters
    if (els.labelDecrypt) els.labelDecrypt.textContent = 'LIVE FEEDS';
    if (els.labelSigint) els.labelSigint.textContent = 'GOES X-RAY';
    if (els.labelMesh) els.labelMesh.textContent = 'API HEALTH';

    const feedPct = tm.activeFeeds ? Math.round((tm.healthyFeeds / tm.activeFeeds) * 100) : 0;
    els.meterDecrypt.style.width = `${feedPct}%`;
    els.valDecrypt.textContent = `${tm.healthyFeeds}/${tm.activeFeeds} OK`;

    const flarePct = flareClassToPct(tm.flareClass);
    els.meterSigint.style.width = `${flarePct}%`;
    els.valSigint.textContent = tm.flareClass;

    const healthPct = tm.activeFeeds ? Math.round(((tm.activeFeeds - tm.errorFeeds) / tm.activeFeeds) * 100) : 100;
    els.meterMesh.style.width = `${healthPct}%`;
    els.valMesh.textContent = `${healthPct}%`;
  } else {
    if (els.labelDecrypt) els.labelDecrypt.textContent = 'QUANTUM DECRYPT';
    if (els.labelSigint) els.labelSigint.textContent = 'SIGINT THROUGHPUT';
    if (els.labelMesh) els.labelMesh.textContent = 'MESH INTEGRITY';

    state.decryptPct = state.decryptPct >= 99.2 ? 14 : state.decryptPct + 0.6 + Math.random() * 1.4;
    const sigintGbps = (state.alertActive ? 29 : 16) + Math.random() * 8.5;
    const meshPct = state.alertActive ? 86 + Math.random() * 6 : 95 + Math.random() * 4.5;

    els.meterDecrypt.style.width = `${state.decryptPct.toFixed(0)}%`;
    els.valDecrypt.textContent = `${state.decryptPct.toFixed(0)}%`;

    const sigintPct = Math.min(100, (sigintGbps / 40) * 100);
    els.meterSigint.style.width = `${sigintPct.toFixed(0)}%`;
    els.valSigint.textContent = `${sigintGbps.toFixed(1)} Gb/s`;

    els.meterMesh.style.width = `${meshPct.toFixed(0)}%`;
    els.valMesh.textContent = `${meshPct.toFixed(0)}%`;
  }

  els.meterThreat.style.width = `${state.threatIndex.toFixed(0)}%`;
  els.valThreat.textContent = state.threatIndex.toFixed(1);

  if (pushSpark) {
    sparkline.push(state.threatIndex / 100);
  }
}

// ----------------------------------------------------------------------------
// MAIN ANIMATION LOOP (PAUSES AUTOMATICALLY WHEN TAB IS HIDDEN)
// ----------------------------------------------------------------------------
let lastTime = performance.now();
let fpsFrames = 0;
let fpsLastCheck = lastTime;
let rafId = null;

function startLoop() {
  if (rafId !== null || document.hidden) return;
  lastTime = performance.now();
  fpsFrames = 0;
  fpsLastCheck = lastTime;
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function tick(now) {
  if (document.hidden) {
    rafId = null;
    return;
  }
  rafId = requestAnimationFrame(tick);

  const dt = Math.max(0.001, Math.min(0.05, (now - lastTime) / 1000));
  lastTime = now;

  liveFeeds.stepRealtime(Date.now());
  mapEngine.render(dt);
  radar.render(dt);
  spectrum.render(dt, state.alertActive, liveFeeds.data);

  fpsFrames++;
  if (now - fpsLastCheck >= 600) {
    const fps = Math.round((fpsFrames * 1000) / (now - fpsLastCheck));
    els.fpsReadout.textContent = `${fps} FPS`;
    fpsFrames = 0;
    fpsLastCheck = now;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
  } else {
    startLoop();
  }
});

// ----------------------------------------------------------------------------
// BOOTSTRAP
// ----------------------------------------------------------------------------
function init() {
  bindUIEvents();
  hydrateInitialConfig();
  updateClocks();
  renderOpsList();

  if (state.pendingFocus) {
    if (focusTargetByQuery(state.pendingFocus, { silentNotFound: true })) {
      state.pendingFocus = null;
    } else {
      selectNode('zurich', false);
    }
  } else {
    selectNode('zurich', false);
  }

  renderSatList();
  syncFeedSwitchboard();
  updateTelemetryMeters();
  state.hydrating = false;

  // Seed initial boot status & kick off real live public telemetry feeds
  pushLog('SIG', 'AEGIS GLOBAL SITUATION ROOM ONLINE // CONNECTING LIVE PUBLIC TELEMETRY BUS...', false);
  liveFeeds.start();

  setInterval(() => {
    if (document.hidden) return;
    updateClocks();
    renderSatList();
    refreshSelectedLiveDossier();
  }, 1000);

  setInterval(() => {
    if (document.hidden) return;
    updateTelemetryMeters();
  }, 1800);

  let poolIdx = 0;
  setInterval(() => {
    if (document.hidden || !state.spyOpsEnabled) return;
    const item = INTERCEPT_POOL[poolIdx % INTERCEPT_POOL.length];
    poolIdx++;
    pushLog(item.sev, item.text, true);
  }, 6500);

  startLoop();
}

init();
