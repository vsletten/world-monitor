// ============================================================================
// AEGIS // GLOBAL LIVE TELEMETRY & OSINT MONITOR — MAIN APPLICATION CONTROLLER
// ============================================================================

import { WORLD_PLACES, formatCoord } from './data.js';
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

const HUD_STORAGE_KEY = 'aegis-hud-state-v2';
const ALL_LIVE_KEYS = ['liveSats', 'quakes', 'eonet', 'aircraft', 'bgp', 'gdacs', 'meteo', 'wiki', 'solar'];
const OVERLAY_LAYERS = ['terminator', 'cables', 'aurora', 'bgpArcs', 'trails', 'grid'];
const VALID_THEMES = ['cyan', 'amber', 'emerald', 'crimson'];
const VALID_CHARTS = ['goes', 'bgp', 'quakes'];
const CLI_COMMANDS = [
  'help',
  'focus',
  'feed',
  'feeds',
  'terminator',
  'cables',
  'aurora',
  'bgparcs',
  'trails',
  'grid',
  'chart',
  'spectrum',
  'refresh',
  'mode',
  'panels',
  'maponly',
  'resetlayout',
  'theme',
  'ping',
  'center',
  'clear',
  'status',
];

const bootMs = Date.now();
let _logSeq = 0;

// ----------------------------------------------------------------------------
// APPLICATION STATE
// ----------------------------------------------------------------------------
const state = {
  leftOpen: true,
  rightOpen: true,
  opsQuery: '',
  nodeFilter: 'ALL',
  logFilter: 'ALL',
  selectedLive: null,
  pendingFocus: null,
  autoLockInitial: false,
  logs: [],
  threatIndex: 12.0,
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
  opsSearchInput: $('opsSearchInput'),
  opsSearchClear: $('opsSearchClear'),
  opsList: $('opsList'),
  opsCountMeta: $('opsCountMeta'),
  satList: $('satList'),
  satLockMeta: $('satLockMeta'),
  logFeed: $('logFeed'),
  coordReadout: $('coordReadout'),
  mapTooltip: $('mapTooltip'),
  mapProjectionLabel: $('mapProjectionLabel'),
  mapTelemetryLine: $('mapTelemetryLine'),
  watchBtn: $('watchBtn'),
  watchVal: $('watchVal'),
  watchPips: $('watchPips'),
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
  btnAudio: $('btnAudio'),
  btnCrt: $('btnCrt'),
  btnFullscreen: $('btnFullscreen'),
  cmdForm: $('cmdForm'),
  cmdInput: $('cmdInput'),
  cmdHint: $('cmdHint'),
  fpsReadout: $('fpsReadout'),
  liveBusLed: $('liveBusLed'),
  liveBusText: $('liveBusText'),
  // Dossier elements
  dossierLed: $('dossierLed'),
  dossierCode: $('dossierCode'),
  dossierOp: $('dossierOp'),
  dossierLoc: $('dossierLoc'),
  dossierCoords: $('dossierCoords'),
  dossierSeverity: $('dossierSeverity'),
  dossierProtocol: $('dossierProtocol'),
  dossierBrief: $('dossierBrief'),
  dossierKey1: $('dossierKey1'),
  dossierKey2: $('dossierKey2'),
  dossierKey3: $('dossierKey3'),
  dossierSignal: $('dossierSignal'),
  dossierFreq: $('dossierFreq'),
  dossierStatus: $('dossierStatus'),
  dossierActions: $('dossierActions'),
  btnDossierCenter: $('btnDossierCenter'),
  btnDossierPing: $('btnDossierPing'),
  btnDossierSource: $('btnDossierSource'),
  dossierWeatherVal: $('dossierWeatherVal'),
  radarRngTag: $('radarRngTag'),
  // Telemetry chart
  spectrumTitle: $('spectrumTitle'),
  spectrumLed: $('spectrumLed'),
  spectrumModes: $('spectrumModes'),
  // Live telemetry meters
  sysUptimeMeta: $('sysUptimeMeta'),
  meterHealth: $('meterHealth'),
  valHealth: $('valHealth'),
  meterXray: $('meterXray'),
  valXray: $('valXray'),
  meterSolar: $('meterSolar'),
  valSolar: $('valSolar'),
  meterBgp: $('meterBgp'),
  valBgp: $('valBgp'),
  meterQuakes: $('meterQuakes'),
  valQuakes: $('valQuakes'),
  meterThreat: $('meterThreat'),
  valThreat: $('valThreat'),
  // Feed switchboard
  feedSwitchboard: $('feedSwitchboard'),
  btnRefreshFeeds: $('btnRefreshFeeds'),
  btnToggleFeedTray: $('btnToggleFeedTray'),
  feedTraySummary: $('feedTraySummary'),
  feedTrayChevron: $('feedTrayChevron'),
  btnFeedsAll: $('btnFeedsAll'),
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
    renderOpsList();
    refreshSelectedLiveDossier();
    updateTelemetryMeters({ pushSpark: false });

    if (state.pendingFocus) {
      if (focusTargetByQuery(state.pendingFocus, { silentNotFound: true })) {
        state.pendingFocus = null;
        state.autoLockInitial = false;
      }
      return;
    }

    if (state.autoLockInitial) {
      if (liveFeeds.enabled.liveSats && liveFeeds.data.liveSats.length > 0) {
        const iss =
          liveFeeds.data.liveSats.find((s) => s.noradId === 25544 || /\biss\b/i.test(s.name)) ||
          liveFeeds.data.liveSats[0];
        state.autoLockInitial = false;
        selectLiveItem('liveSat', iss, false, { silentSound: true });
        mapEngine.selectLive('liveSat', iss, false);
      } else if (!liveFeeds.enabled.liveSats || liveFeeds.status.liveSats.state === 'error') {
        const top = liveFeeds.getLiveAnomalies()[0];
        if (top?.item) {
          state.autoLockInitial = false;
          selectLiveItem(top.kind, top.item, false, { silentSound: true });
          mapEngine.selectLive(top.kind, top.item, false);
        }
      }
    }
  },
  onLog: (sev, msg) => pushLog(sev, msg),
  onBgpPulse: (_col, info) => {
    if (info?.isWithdraw) spectrum.boost(0.28);
  },
});

const mapEngine = new WorldMapEngine(els.worldCanvas, {
  liveFeeds,
  onSelectLive: (kind, item) => {
    state.autoLockInitial = false;
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
    const layers = {};
    for (const layer of OVERLAY_LAYERS) {
      layers[layer] = Boolean(mapEngine.layers[layer]);
    }
    const payload = {
      theme: document.documentElement.getAttribute('data-theme') || 'cyan',
      mode: mapEngine.mode,
      crt: document.body.classList.contains('crt-enabled'),
      leftOpen: state.leftOpen,
      rightOpen: state.rightOpen,
      feeds: { ...liveFeeds.enabled },
      layers,
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

    if (extra.feedsPreset) {
      params.set('feeds', extra.feedsPreset);
    } else if (params.has('feeds')) {
      const allLiveOn = ALL_LIVE_KEYS.every((k) => liveFeeds.enabled[k]);
      const allLiveOff = ALL_LIVE_KEYS.every((k) => !liveFeeds.enabled[k]);
      if (allLiveOn) params.set('feeds', 'all');
      else if (allLiveOff) params.set('feeds', 'none');
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
  const paramFeeds = ['all', 'none'].includes(paramFeedsRaw) ? paramFeedsRaw : null;

  const paramChartRaw = (params.get('chart') || '').toLowerCase();
  const paramChart = VALID_CHARTS.includes(paramChartRaw) ? paramChartRaw : null;

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

  // Apply telemetry chart mode
  const specMode = paramChart || (VALID_CHARTS.includes(saved.spectrumMode) ? saved.spectrumMode : 'goes');
  setSpectrumMode(specMode, { silent: true });

  // Apply overlay layer toggles from saved state
  if (saved.layers && typeof saved.layers === 'object') {
    for (const layer of OVERLAY_LAYERS) {
      if (typeof saved.layers[layer] === 'boolean') {
        mapEngine.setLayer(layer, saved.layers[layer]);
        document.querySelector(`.layer-pill[data-layer="${layer}"]`)?.classList.toggle('active', saved.layers[layer]);
      }
    }
  }

  // Apply feeds from saved state
  if (saved.feeds && typeof saved.feeds === 'object') {
    for (const k of ALL_LIVE_KEYS) {
      if (typeof saved.feeds[k] === 'boolean') {
        liveFeeds.setEnabled(k, saved.feeds[k]);
        mapEngine.setLayer(k, saved.feeds[k]);
      }
    }
  }

  // URL ?feeds=all|none overrides saved feed config
  if (paramFeeds === 'all') {
    applyFeedPreset('all', { silent: true });
  } else if (paramFeeds === 'none') {
    applyFeedPreset('none', { silent: true });
  }

  if (paramFocus) {
    state.pendingFocus = paramFocus;
  }
}

// ----------------------------------------------------------------------------
// LIVE WORLD CLOCKS & SESSION UPTIME
// ----------------------------------------------------------------------------
const tzFormatters = {
  utc: new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
  newYork: new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }),
  london: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }),
  moscow: new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hour12: false }),
  tokyo: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }),
};

function updateUptime() {
  const totalSec = Math.max(0, Math.floor((Date.now() - bootMs) / 1000));
  const hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const secs = String(totalSec % 60).padStart(2, '0');
  if (els.sysUptimeMeta) {
    els.sysUptimeMeta.textContent = `UP ${hrs}:${mins}:${secs}`;
  }
}

function updateClocks() {
  const now = new Date();
  $('clockUtc').textContent = `${tzFormatters.utc.format(now)}Z`;
  $('clockNewYork').textContent = tzFormatters.newYork.format(now);
  $('clockLondon').textContent = tzFormatters.london.format(now);
  $('clockMoscow').textContent = tzFormatters.moscow.format(now);
  $('clockTokyo').textContent = tzFormatters.tokyo.format(now);
  updateUptime();
}

// ----------------------------------------------------------------------------
// LIVE GLOBAL EVENTS & ORBITAL ASSETS LISTS
// ----------------------------------------------------------------------------
function renderOpsList() {
  const query = state.opsQuery.trim().toLowerCase();
  const all = liveFeeds.getLiveAnomalies();
  const critCount = all.filter((a) => a.type === 'CRITICAL').length;
  const anyLoading = ALL_LIVE_KEYS.some(
    (k) => liveFeeds.enabled[k] && (liveFeeds.status[k]?.state === 'loading' || liveFeeds.status[k]?.state === 'idle')
  );

  els.opsCountMeta.textContent =
    all.length === 0 && anyLoading ? 'SYNCING...' : `${all.length} LIVE // ${critCount} CRIT`;

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
    const emptyMsg =
      all.length === 0 && !query && state.nodeFilter === 'ALL' && anyLoading
        ? 'SYNCING LIVE OSINT TELEMETRY...'
        : 'NO MATCHING EVENTS — ADJUST FILTER';
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
}

let _satListSig = '';
function renderSatList() {
  if (!liveFeeds.enabled.liveSats) {
    els.satLockMeta.textContent = 'MUTED';
    if (_satListSig !== 'MUTED') {
      _satListSig = 'MUTED';
      els.satList.innerHTML = '<div class="ops-empty">ORBITAL FEED MUTED</div>';
    }
    return;
  }

  const list = liveFeeds.data.liveSats;
  if (!list.length) {
    const isErr = liveFeeds.status.liveSats.state === 'error';
    els.satLockMeta.textContent = isErr ? 'FEED ERROR' : 'SYNCING...';
    const emptySig = isErr ? 'ERR' : 'SYNCING';
    if (_satListSig !== emptySig) {
      _satListSig = emptySig;
      els.satList.innerHTML = `<div class="ops-empty">${isErr ? 'CELESTRAK FEED UNAVAILABLE' : 'SYNCING CELESTRAK NORAD GP...'}</div>`;
    }
    return;
  }

  els.satLockMeta.textContent = `LIVE NORAD // ${list.length}`;
  const sig = `L:${list.map((s) => s.id).join(',')}`;

  if (sig !== _satListSig) {
    _satListSig = sig;
    els.satList.innerHTML = list
      .map((s) => {
        const latStr = `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}`;
        const lonStr = `${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}`;
        const isSelected = state.selectedLive?.kind === 'liveSat' && state.selectedLive.id === s.id;
        const altPct = Math.min(100, Math.max(12, Math.round((Number(s.altKm || 0) / 1000) * 100)));
        return `
      <div class="sat-row ${isSelected ? 'selected' : ''}" data-live-sat="${escapeHtml(s.id)}">
        <div class="sat-name">${escapeHtml(s.name)}</div>
        <div class="sat-orbit">${escapeHtml(s.altKm)} KM</div>
        <div class="sat-coords">${escapeHtml(latStr)} ${escapeHtml(lonStr)}</div>
        <div class="sat-bar-wrap">
          <div class="sat-bar"><i style="width:${altPct}%"></i></div>
          <span class="sat-coords">${escapeHtml(s.velKms)} km/s</span>
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
    const isSelected = state.selectedLive?.kind === 'liveSat' && state.selectedLive.id === s.id;
    row.classList.toggle('selected', isSelected);

    const latStr = `${Math.abs(s.lat).toFixed(1)}°${s.lat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(s.lon).toFixed(1)}°${s.lon >= 0 ? 'E' : 'W'}`;
    const altPct = Math.min(100, Math.max(12, Math.round((Number(s.altKm || 0) / 1000) * 100)));

    const orbitEl = row.querySelector('.sat-orbit');
    if (orbitEl) orbitEl.textContent = `${s.altKm} KM`;

    const coordEls = row.querySelectorAll('.sat-coords');
    if (coordEls[0]) coordEls[0].textContent = `${latStr} ${lonStr}`;
    if (coordEls[1]) coordEls[1].textContent = `${s.velKms} km/s`;

    const barEl = row.querySelector('.sat-bar i');
    if (barEl) barEl.style.width = `${altPct}%`;
  }
}

// ----------------------------------------------------------------------------
// TARGET DOSSIER, GEODESIC PROXIMITY RADAR & TELEMETRY CHART MODES
// ----------------------------------------------------------------------------
function setSpectrumMode(mode, { silent = false } = {}) {
  if (!VALID_CHARTS.includes(mode)) return;
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
    els.spectrumTitle.textContent = 'USGS 24H SEISMIC';
    els.spectrumLed.className = 'led led-warn';
  }
  if (!silent) {
    sfx.playClick();
    saveHudState();
  }
}

function setDossierKeys(k1, k2, k3) {
  if (els.dossierKey1) els.dossierKey1.textContent = k1;
  if (els.dossierKey2) els.dossierKey2.textContent = k2;
  if (els.dossierKey3) els.dossierKey3.textContent = k3;
}

function syncProximityRadar(lat, lon) {
  radar.setContacts(lat, lon, liveFeeds.data, 2500);
  els.radarRngTag.textContent = `${radar.blips.length} IN 2500KM`;
}

function updateDossierSourceLink(kind, item) {
  if (!els.btnDossierSource || !els.dossierActions) return;
  const resolvedKind = kind === 'place' ? 'meteo' : kind;
  const src = resolvedKind ? buildExternalSourceUrl(resolvedKind, item) : null;
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

function applyLiveDossierFields(kind, item, { updateRadar = false } = {}) {
  if (!item) return;

  let targetLat = item.lat;
  let targetLon = item.lon;

  if (kind === 'liveSat') {
    if (updateRadar) radar.setTargetType('SAT');
    setDossierKeys('VELOCITY', 'RADIO', 'STATUS');
    els.dossierCode.textContent = `NORAD // #${item.noradId}`;
    els.dossierOp.textContent = item.name;
    els.dossierLoc.textContent = `ALT ${item.altKm} KM • INCL ${Number(item.inclination || 0).toFixed(1)}°`;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `${item.mission}. Real-time SGP4 orbital propagation from live CelesTrak NORAD GP elements.${item.visibility ? ` Illumination: ${item.visibility}.` : ''}`;
    els.dossierSignal.textContent = `${item.velKms} km/s`;
    els.dossierFreq.textContent = item.noradId === 25544 ? '145.800 MHz' : '2.245 GHz';
    els.dossierStatus.textContent = 'LIVE SGP4';
    els.dossierProtocol.textContent = 'NORAD-GP';
    els.dossierSeverity.className = 'status-pill sat';
    els.dossierSeverity.textContent = 'LIVE ORBIT';
    els.dossierLed.className = 'led led-ok';
  } else if (kind === 'quake') {
    if (updateRadar) radar.setTargetType(item.mag >= 5 || item.tsunami ? 'CRITICAL' : 'WARNING');
    setDossierKeys('MAGNITUDE', 'FOCAL DEPTH', 'STATUS');
    const utcStr = tzFormatters.utc.format(new Date(item.time)) + 'Z';
    els.dossierCode.textContent = `USGS // M${item.mag.toFixed(1)}`;
    els.dossierOp.textContent = `SEISMIC M${item.mag.toFixed(1)} EVENT`;
    els.dossierLoc.textContent = String(item.place || 'SEISMIC REGION').toUpperCase();
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live USGS seismic telemetry recorded at ${utcStr}. Focal depth ${item.depthKm} km. Tsunami flag: ${item.tsunami ? 'ACTIVE WARNING' : 'NONE'}.`;
    els.dossierSignal.textContent = `M ${item.mag.toFixed(1)}`;
    els.dossierFreq.textContent = `${item.depthKm} KM`;
    els.dossierStatus.textContent = item.tsunami ? 'TSUNAMI' : 'RECORDED';
    els.dossierProtocol.textContent = 'USGS-GEOJSON';
    const isCrit = item.mag >= 5 || item.tsunami;
    const isWarn = item.mag >= 4;
    els.dossierSeverity.className = `status-pill ${isCrit ? 'crit' : isWarn ? 'warn' : 'info'}`;
    els.dossierSeverity.textContent = isCrit ? 'MAJOR' : 'SEISMIC';
    els.dossierLed.className = `led ${isCrit ? 'led-crit' : isWarn ? 'led-warn' : 'led-accent'}`;
  } else if (kind === 'eonet') {
    const isVolcano = item.categoryId === 'volcanoes';
    if (updateRadar) radar.setTargetType(isVolcano ? 'CRITICAL' : 'WARNING');
    setDossierKeys('STATE', 'SOURCE', 'STATUS');
    els.dossierCode.textContent = `NASA // ${item.source}`;
    els.dossierOp.textContent = item.categoryTitle;
    els.dossierLoc.textContent = String(item.title || '').toUpperCase();
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live NASA Earth Observatory Natural Event Tracker (EONET). Active ${String(item.categoryTitle || 'natural').toLowerCase()} event reported ${item.date ? item.date.slice(0, 16).replace('T', ' ') + 'Z' : 'recently'}.`;
    els.dossierSignal.textContent = 'OPEN';
    els.dossierFreq.textContent = item.source;
    els.dossierStatus.textContent = 'MONITORING';
    els.dossierProtocol.textContent = 'EONET-V3';
    els.dossierSeverity.className = `status-pill ${isVolcano ? 'crit' : 'warn'}`;
    els.dossierSeverity.textContent = 'LIVE HAZARD';
    els.dossierLed.className = `led ${isVolcano ? 'led-crit' : 'led-warn'}`;
  } else if (kind === 'aircraft') {
    const isEmg = Boolean(item.emergency || item.squawk === '7700' || item.squawk === '7600' || item.squawk === '7500');
    if (updateRadar) radar.setTargetType(isEmg ? 'CRITICAL' : 'INFO');
    setDossierKeys('ALTITUDE', 'SPEED', 'HEADING');
    els.dossierCode.textContent = `ADS-B // ${item.hex}`;
    els.dossierOp.textContent = `${item.callsign} [${item.type}]`;
    els.dossierLoc.textContent = `REG ${item.reg} • SQUAWK ${item.squawk}`;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live ADS-B transponder signal. Barometric altitude ${Number(item.altFt || 0).toLocaleString()} ft, ground speed ${item.gsKts} kts, heading ${item.trackDeg !== null && item.trackDeg !== undefined ? Math.round(item.trackDeg) + '°' : 'N/A'}.`;
    els.dossierSignal.textContent = `${Number(item.altFt || 0).toLocaleString()} FT`;
    els.dossierFreq.textContent = `${item.gsKts} KTS`;
    els.dossierStatus.textContent = item.emergency || `${item.trackDeg !== null && item.trackDeg !== undefined ? Math.round(item.trackDeg) + '°' : '--'}`;
    els.dossierProtocol.textContent = '1090-ES';
    els.dossierSeverity.className = `status-pill ${isEmg ? 'crit' : 'info'}`;
    els.dossierSeverity.textContent = isEmg ? 'EMERGENCY' : 'MIL ADS-B';
    els.dossierLed.className = `led ${isEmg ? 'led-crit' : 'led-accent'}`;
  } else if (kind === 'bgp') {
    if (updateRadar) radar.setTargetType('NETWORK');
    setDossierKeys('PACKETS', 'ORIGIN ASN', 'STATUS');
    els.dossierCode.textContent = `RIPE // ${item.code}`;
    els.dossierOp.textContent = `${item.city} IXP (${item.ixp})`;
    els.dossierLoc.textContent = String(item.host || '').toUpperCase();
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live RIPE RIS BGP Route Collector streaming real-time global internet peering updates. Latest prefix: ${item.lastPrefix || 'Awaiting frame'} via ${item.lastAsn || 'AS?'}.`;
    els.dossierSignal.textContent = `${item.msgCount || 0} PKTS`;
    els.dossierFreq.textContent = item.lastAsn || 'BGP-4';
    els.dossierStatus.textContent = liveFeeds.status.bgp.state === 'live' ? `${liveFeeds.data.bgpRate}/s` : 'CONNECTING';
    els.dossierProtocol.textContent = 'BGP-4';
    els.dossierSeverity.className = 'status-pill net';
    els.dossierSeverity.textContent = 'LIVE BGP';
    els.dossierLed.className = 'led led-accent';
  } else if (kind === 'gdacs') {
    const isRed = item.alertLevel === 'Red';
    const isOrange = item.alertLevel === 'Orange';
    if (updateRadar) radar.setTargetType(isRed ? 'CRITICAL' : isOrange ? 'WARNING' : 'SAT');
    setDossierKeys('ALERT LEVEL', 'SOURCE', 'STATUS');
    els.dossierCode.textContent = `GDACS // ${item.eventType}`;
    els.dossierOp.textContent = String(item.name || '').toUpperCase();
    els.dossierLoc.textContent = `${String(item.country || '').toUpperCase()} • ${item.typeLabel}`;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `UN/EU Global Disaster Alert & Coordination System (${item.source}). ${item.severityText || 'Active humanitarian crisis event under international monitoring.'}`;
    els.dossierSignal.textContent = String(item.alertLevel || 'GREEN').toUpperCase();
    els.dossierFreq.textContent = item.source;
    els.dossierStatus.textContent = item.isCurrent ? 'ACTIVE' : 'RECENT';
    els.dossierProtocol.textContent = 'UN-GDACS';
    els.dossierSeverity.className = `status-pill ${isRed ? 'crit' : isOrange ? 'warn' : 'sat'}`;
    els.dossierSeverity.textContent = `${String(item.alertLevel || 'GREEN').toUpperCase()} ALERT`;
    els.dossierLed.className = `led ${isRed ? 'led-crit' : isOrange ? 'led-warn' : 'led-ok'}`;
  } else if (kind === 'meteo') {
    if (updateRadar) radar.setTargetType('INFO');
    setDossierKeys('TEMPERATURE', 'WIND', 'PRESSURE');
    els.dossierCode.textContent = 'METEO // WMO';
    els.dossierOp.textContent = `${item.name} ATMOSPHERIC`;
    els.dossierLoc.textContent = item.condition;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live Open-Meteo surface telemetry: ${item.tempC}°C, wind ${item.windKmh} km/h from ${item.windDir}°, barometric pressure ${item.pressureHpa} hPa.`;
    els.dossierSignal.textContent = `${item.tempC}°C`;
    els.dossierFreq.textContent = `${item.windKmh} km/h`;
    els.dossierStatus.textContent = `${item.pressureHpa} hPa`;
    els.dossierProtocol.textContent = 'OPEN-METEO';
    els.dossierSeverity.className = 'status-pill info';
    els.dossierSeverity.textContent = 'LIVE WX';
    els.dossierLed.className = 'led led-accent';
  } else if (kind === 'wiki') {
    if (updateRadar) radar.setTargetType('INFO');
    setDossierKeys('EDITS', 'PROJECT', 'STATUS');
    els.dossierCode.textContent = `WIKI // ${item.lang}`;
    els.dossierOp.textContent = `WIKIPEDIA [${item.lang}] STREAM`;
    els.dossierLoc.textContent = item.city;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live real-time human knowledge edit stream. Latest article: "${item.lastTitle || 'Syncing...'}" edited by ${item.lastUser || 'contributor'}.`;
    els.dossierSignal.textContent = `${item.recentCount} EDITS`;
    els.dossierFreq.textContent = `${item.lang}.WIKI`;
    els.dossierStatus.textContent = 'STREAMING';
    els.dossierProtocol.textContent = 'MEDIAWIKI';
    els.dossierSeverity.className = 'status-pill info';
    els.dossierSeverity.textContent = 'LIVE PULSE';
    els.dossierLed.className = 'led led-accent';
  } else if (kind === 'cable') {
    if (updateRadar) radar.setTargetType('INFO');
    setDossierKeys('CAPACITY', 'COMMISSIONED', 'STATUS');
    els.dossierCode.textContent = `SUBSEA // ${item.code || 'CBL'}`;
    els.dossierOp.textContent = item.name;
    els.dossierLoc.textContent = `${item.region} • RFS ${item.rfs}`;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Subsea optical fiber trunk (${item.capacity}, Ready For Service ${item.rfs}). Landing points: ${item.landing}.`;
    els.dossierSignal.textContent = item.capacity;
    els.dossierFreq.textContent = `RFS ${item.rfs}`;
    els.dossierStatus.textContent = 'IN SERVICE';
    els.dossierProtocol.textContent = 'SUBSEA-OPTIC';
    els.dossierSeverity.className = 'status-pill info';
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
    targetLat = item.lat ?? 65.0;
    targetLon = item.lon ?? -20.0;
    if (updateRadar) radar.setTargetType(isCrit ? 'CRITICAL' : isWarn ? 'WARNING' : 'SAT');
    setDossierKeys('PLANETARY Kp', 'GOES X-RAY', 'STATUS');
    els.dossierCode.textContent = `NOAA // ${scale}`;
    els.dossierOp.textContent = `SOLAR ${scale} // FLARE ${flareClass}`;
    els.dossierLoc.textContent = String(label).toUpperCase();
    els.dossierCoords.textContent = formatCoord(targetLat, targetLon);
    els.dossierBrief.textContent = `Live NOAA Space Weather Prediction Center geomagnetic telemetry. Planetary Kp ${kp.toFixed(1)} (${scale}), GOES-18 X-ray class ${flareClass}${bt != null ? `, GOES-19 magnetic field Bt ${Number(bt).toFixed(1)} nT` : ''}.`;
    els.dossierSignal.textContent = `Kp ${kp.toFixed(1)}`;
    els.dossierFreq.textContent = flareClass;
    els.dossierStatus.textContent = isCrit ? 'SEVERE' : isWarn ? 'STORM' : 'NOMINAL';
    els.dossierProtocol.textContent = 'NOAA-SWPC';
    els.dossierSeverity.className = `status-pill ${isCrit ? 'crit' : isWarn ? 'warn' : 'sat'}`;
    els.dossierSeverity.textContent = isCrit ? 'SEVERE STORM' : isWarn ? 'SOLAR STORM' : 'SPACE WX';
    els.dossierLed.className = `led ${isCrit ? 'led-crit' : isWarn ? 'led-warn' : 'led-ok'}`;
  } else if (kind === 'place') {
    if (updateRadar) radar.setTargetType('INFO');
    setDossierKeys('ELEVATION', 'REGION', 'STATUS');
    els.dossierCode.textContent = `GEO // ${String(item.id || 'LOC').toUpperCase()}`;
    els.dossierOp.textContent = String(item.name || '').toUpperCase();
    els.dossierLoc.textContent = String(item.region || '').toUpperCase();
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Geographic reference waypoint (${item.region}). Showing live Open-Meteo surface telemetry and geodesic proximity contacts within 2,500 km.`;
    els.dossierSignal.textContent = 'SURFACE';
    els.dossierFreq.textContent = item.region;
    els.dossierStatus.textContent = 'MONITORING';
    els.dossierProtocol.textContent = 'WGS-84';
    els.dossierSeverity.className = 'status-pill info';
    els.dossierSeverity.textContent = 'GEO WAYPOINT';
    els.dossierLed.className = 'led led-accent';
  }

  syncProximityRadar(targetLat, targetLon);
}

function selectLiveItem(kind, item, syncMap = true, { silentSound = false } = {}) {
  if (!item) return;
  state.selectedLive = { kind, id: item.id, item };

  if (syncMap) mapEngine.selectLive(kind, item, true);
  if (!state.hydrating && !silentSound) sfx.playLock();
  spectrum.boost(0.7);

  applyLiveDossierFields(kind, item, { updateRadar: true });
  updateDossierSourceLink(kind, item);

  renderOpsList();
  renderSatList();
  updateDossierWeather(item.lat ?? 65.0, item.lon ?? -20.0);
}

function refreshSelectedLiveDossier() {
  if (!state.selectedLive) return;
  const { kind, id } = state.selectedLive;
  let fresh = null;
  if (kind === 'cable') {
    fresh = SUBSEA_CABLES.find((c) => c.id === id) || state.selectedLive.item;
  } else if (kind === 'place') {
    fresh = WORLD_PLACES.find((p) => p.id === id) || state.selectedLive.item;
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
}

// ----------------------------------------------------------------------------
// DATA FEED SWITCHBOARD & LAYER SYNC
// ----------------------------------------------------------------------------
function syncFeedSwitchboard() {
  const counts = {
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

  let activeCount = 0;
  for (const [key, ledId] of feedLedMap) {
    if (liveFeeds.enabled[key]) activeCount++;
    const st = liveFeeds.status[key].state;
    const led = $(ledId);
    led.classList.toggle('is-loading', liveFeeds.enabled[key] && st === 'loading');
    led.classList.toggle('is-error', liveFeeds.enabled[key] && st === 'error');
    const chip = els.feedSwitchboard.querySelector(`.feed-chip[data-feed="${key}"]`);
    chip?.classList.toggle('active', liveFeeds.enabled[key]);
  }
  els.feedTraySummary.textContent = `DATA FEEDS [${activeCount}/9]`;

  // Update floating top-left telemetry line with real live counts
  const parts = [];
  if (liveFeeds.enabled.liveSats && liveFeeds.status.liveSats.count) parts.push(`${liveFeeds.status.liveSats.count} SATS`);
  if (liveFeeds.enabled.quakes && liveFeeds.status.quakes.count) parts.push(`${liveFeeds.status.quakes.count} QUAKES`);
  if (liveFeeds.enabled.gdacs && liveFeeds.status.gdacs.count) parts.push(`${liveFeeds.status.gdacs.count} GDACS`);
  if (liveFeeds.enabled.eonet && liveFeeds.status.eonet.count) parts.push(`${liveFeeds.status.eonet.count} EONET`);
  if (liveFeeds.enabled.aircraft && liveFeeds.status.aircraft.count) parts.push(`${liveFeeds.status.aircraft.count} MIL ADS-B`);
  if (liveFeeds.enabled.bgp && liveFeeds.status.bgp.state === 'live') parts.push(`BGP ${liveFeeds.data.bgpRate}/s`);
  if (liveFeeds.enabled.solar && liveFeeds.data.solar) parts.push(`Kp ${liveFeeds.data.solar.kp.toFixed(1)}`);

  if (parts.length) {
    els.mapTelemetryLine.textContent = `LIVE BUS: ${parts.join(' • ')}`;
  } else if (activeCount === 0) {
    els.mapTelemetryLine.textContent = 'ALL DATA FEEDS MUTED — WIREFRAME BASE ONLY';
  } else {
    els.mapTelemetryLine.textContent = 'CONNECTING LIVE PUBLIC TELEMETRY FEEDS...';
  }
}

function setMapLayer(layer, forced = null, { silent = false } = {}) {
  if (!(layer in mapEngine.layers)) return;
  const next = forced !== null ? Boolean(forced) : !mapEngine.layers[layer];
  mapEngine.setLayer(layer, next);
  document.querySelector(`.layer-pill[data-layer="${layer}"]`)?.classList.toggle('active', next);
  if (!silent) {
    sfx.playClick();
    saveHudState();
  }
}

function toggleDataset(feedKey, forced = null, { silent = false } = {}) {
  if (!(feedKey in liveFeeds.enabled)) return;
  const next = forced !== null ? Boolean(forced) : !liveFeeds.enabled[feedKey];
  liveFeeds.setEnabled(feedKey, next);
  mapEngine.setLayer(feedKey, next);
  if (!silent) sfx.playClick();
  syncFeedSwitchboard();
  renderSatList();
  renderOpsList();
  updateTelemetryMeters({ pushSpark: false });
  saveHudState();
  syncUrlParams();
  if (!silent) pushLog('INFO', `LIVE FEED [${feedKey.toUpperCase()}] ${next ? 'ENABLED' : 'MUTED'}.`);
}

function applyFeedPreset(preset, { silent = false } = {}) {
  if (preset === 'all') {
    ALL_LIVE_KEYS.forEach((k) => toggleDataset(k, true, { silent: true }));
    if (!silent) {
      sfx.playClick();
      pushLog('INFO', 'FEED PRESET [ALL]: ALL 9 LIVE PUBLIC TELEMETRY FEEDS ENABLED.');
    }
  } else if (preset === 'none') {
    ALL_LIVE_KEYS.forEach((k) => toggleDataset(k, false, { silent: true }));
    if (!silent) {
      sfx.playClick();
      pushLog('INFO', 'FEED PRESET [NONE]: ALL LIVE FEEDS MUTED — WIREFRAME BASE ONLY.');
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
  if (hit.kind === 'liveSat') {
    const s = hit.item;
    html = `
      <div class="tt-head"><span>${escapeHtml(s.name)}</span><span>LIVE NORAD</span></div>
      <div class="tt-sub">${escapeHtml(s.mission)}</div>
      <div class="tt-meta">${escapeHtml(s.altKm)} KM${s.velKms ? ` • ${escapeHtml(s.velKms)} km/s` : ''} • ${escapeHtml(formatCoord(s.lat, s.lon))}</div>
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
// CLEAN TELEMETRY EVENT STREAM
// ----------------------------------------------------------------------------
function sanitizeSev(sev) {
  const clean = String(sev || 'INFO').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!clean || clean === 'SIG') return 'INFO';
  return clean;
}

function pushLog(sev, message) {
  const safeSev = sanitizeSev(sev);
  const now = new Date();
  const ts = tzFormatters.utc.format(now) + 'Z';
  const entry = { id: ++_logSeq, sev: safeSev, ts, text: String(message ?? '') };
  state.logs.unshift(entry);
  if (state.logs.length > 48) state.logs.pop();

  if (state.logFilter !== 'ALL' && state.logFilter !== safeSev) return;

  const div = document.createElement('div');
  div.className = `log-entry sev-${safeSev}`;
  div.innerHTML = `
    <div class="log-meta">
      <span class="log-sev">[${escapeHtml(safeSev)}]</span>
      <span>${escapeHtml(ts)}</span>
    </div>
    <div class="log-text"></div>
  `;
  div.querySelector('.log-text').textContent = entry.text;
  els.logFeed.prepend(div);

  while (els.logFeed.children.length > 35) {
    els.logFeed.lastElementChild.remove();
  }
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
        <span class="log-sev">[${escapeHtml(safeSev)}]</span>
        <span>${escapeHtml(entry.ts)}</span>
      </div>
      <div class="log-text"></div>
    `;
    div.querySelector('.log-text').textContent = entry.text;
    els.logFeed.appendChild(div);
  });
}

// ----------------------------------------------------------------------------
// TARGET FOCUS HELPER (CLI + URL ?focus=...)
// ----------------------------------------------------------------------------
function focusTargetByQuery(rawQuery, { silentNotFound = false } = {}) {
  const arg = String(rawQuery || '').trim().toLowerCase();
  if (!arg) return false;

  const liveSat = liveFeeds.data.liveSats.find(
    (s) => s.name.toLowerCase().includes(arg) || String(s.noradId) === arg
  );
  if (liveSat) {
    state.autoLockInitial = false;
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
    state.autoLockInitial = false;
    selectLiveItem('aircraft', ac, true);
    pushLog('INFO', `ADS-B LOCK ENGAGED ON ${ac.callsign} [${ac.type}].`);
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
    state.autoLockInitial = false;
    selectLiveItem('cable', cable, true);
    pushLog('INFO', `SUBSEA TRUNK LOCK ENGAGED ON ${cable.name} (${cable.capacity}).`);
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
    state.autoLockInitial = false;
    selectLiveItem(anomaly.kind, anomaly.item, true);
    pushLog('INFO', `LIVE EVENT LOCK ENGAGED ON ${anomaly.title}.`);
    return true;
  }

  const bgp = liveFeeds.data.bgpCollectors.find(
    (c) =>
      c.code.toLowerCase() === arg ||
      c.city.toLowerCase().includes(arg) ||
      c.ixp.toLowerCase().includes(arg) ||
      c.host.toLowerCase().includes(arg)
  );
  if (bgp) {
    state.autoLockInitial = false;
    selectLiveItem('bgp', bgp, true);
    pushLog('INFO', `RIPE BGP COLLECTOR LOCK ENGAGED ON ${bgp.code} (${bgp.city} ${bgp.ixp}).`);
    return true;
  }

  const meteo = liveFeeds.data.meteo.find(
    (m) =>
      m.name.toLowerCase().includes(arg) ||
      String(m.condition || '').toLowerCase().includes(arg)
  );
  if (meteo) {
    state.autoLockInitial = false;
    selectLiveItem('meteo', meteo, true);
    pushLog('INFO', `METEO STATION LOCK ENGAGED ON ${meteo.name} (${meteo.tempC}°C).`);
    return true;
  }

  const place = WORLD_PLACES.find(
    (p) =>
      p.name.toLowerCase().includes(arg) ||
      p.id.toLowerCase().includes(arg) ||
      p.region.toLowerCase().includes(arg)
  );
  if (place) {
    state.autoLockInitial = false;
    selectLiveItem('place', place, true);
    pushLog('INFO', `MAP FOCUSED ON ${place.name.toUpperCase()} (${place.region}).`);
    return true;
  }

  if (!silentNotFound) {
    pushLog('WARN', `No satellite, aircraft, cable, event, IXP, station, or place matching "${arg}".`);
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
    case 'terminator':
    case 'term':
    case 'cables':
    case 'cable':
    case 'aurora':
    case 'bgparcs':
    case 'trails':
    case 'grid':
      candidates = ['on', 'off'];
      break;
    case 'chart':
    case 'spectrum':
    case 'spec':
      candidates = VALID_CHARTS;
      break;
    case 'panels':
    case 'sidebar':
    case 'sidebars':
      candidates = ['left', 'right', 'show', 'hide'];
      break;
    case 'feed':
      candidates = ['sats', 'quakes', 'eonet', 'aircraft', 'bgp', 'gdacs', 'meteo', 'wiki', 'solar'];
      break;
    case 'feeds':
      candidates = ['all', 'none'];
      break;
    case 'focus':
    case 'lock':
    case 'goto':
      candidates = [
        ...liveFeeds.data.liveSats.map((s) => s.name.toLowerCase()),
        ...WORLD_PLACES.map((p) => p.name.toLowerCase()),
        ...SUBSEA_CABLES.map((c) => c.name.toLowerCase()),
        ...liveFeeds.data.bgpCollectors.map((c) => c.code.toLowerCase()),
        ...liveFeeds.data.aircraft.slice(0, 30).map((a) => a.callsign.toLowerCase()),
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
  pushLog('CMD', `> ${input}`);

  switch (cmd) {
    case 'help':
    case '?':
      pushLog(
        'CMD',
        'COMMANDS: focus <iss|place|cable|callsign|ixp|event> | feed <sats|quakes|eonet|aircraft|bgp|gdacs|meteo|wiki|solar> | feeds <all|none> | terminator | cables | aurora | bgparcs | trails | grid | chart <goes|bgp|quakes> | refresh | mode <2d|globe> | panels [left|right|show|hide] | maponly | resetlayout | theme <cyan|amber|emerald|crimson> | center | ping | clear | status'
      );
      break;

    case 'focus':
    case 'lock':
    case 'goto': {
      if (!arg) {
        pushLog('WARN', 'Usage: focus <satellite, place, cable, event, IXP, or callsign> (e.g. focus iss, focus hormuz, focus marea)');
        break;
      }
      focusTargetByQuery(arg);
      break;
    }

    case 'terminator':
    case 'term': {
      const forced = arg === 'on' ? true : arg === 'off' ? false : null;
      setMapLayer('terminator', forced);
      pushLog('INFO', `SOLAR DAY/NIGHT TERMINATOR LAYER ${mapEngine.layers.terminator ? 'ENABLED' : 'MUTED'}.`);
      break;
    }

    case 'cables':
    case 'cable': {
      const forced = arg === 'on' ? true : arg === 'off' ? false : null;
      setMapLayer('cables', forced);
      pushLog('INFO', `SUBSEA FIBER TRUNK CABLES LAYER ${mapEngine.layers.cables ? 'ENABLED' : 'MUTED'}.`);
      break;
    }

    case 'aurora': {
      const forced = arg === 'on' ? true : arg === 'off' ? false : null;
      setMapLayer('aurora', forced);
      pushLog('INFO', `NOAA POLAR AURORA OVALS LAYER ${mapEngine.layers.aurora ? 'ENABLED' : 'MUTED'}.`);
      break;
    }

    case 'bgparcs': {
      const forced = arg === 'on' ? true : arg === 'off' ? false : null;
      setMapLayer('bgpArcs', forced);
      pushLog('INFO', `RIPE BGP PEERING ARCS LAYER ${mapEngine.layers.bgpArcs ? 'ENABLED' : 'MUTED'}.`);
      break;
    }

    case 'trails': {
      const forced = arg === 'on' ? true : arg === 'off' ? false : null;
      setMapLayer('trails', forced);
      pushLog('INFO', `ORBITAL & AIRCRAFT TRAILS LAYER ${mapEngine.layers.trails ? 'ENABLED' : 'MUTED'}.`);
      break;
    }

    case 'grid': {
      const forced = arg === 'on' ? true : arg === 'off' ? false : null;
      setMapLayer('grid', forced);
      pushLog('INFO', `LAT/LON GRATICULE GRID LAYER ${mapEngine.layers.grid ? 'ENABLED' : 'MUTED'}.`);
      break;
    }

    case 'feeds': {
      if (arg === 'all' || arg === 'none') {
        applyFeedPreset(arg);
      } else {
        pushLog('WARN', 'Usage: feeds <all | none>');
      }
      break;
    }

    case 'feed': {
      if (arg === 'all' || arg === 'none') {
        applyFeedPreset(arg);
        break;
      }
      const mapKey = {
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
      }[arg];
      if (mapKey) {
        toggleDataset(mapKey);
      } else {
        pushLog('WARN', 'Usage: feed <sats|quakes|eonet|aircraft|bgp|gdacs|meteo|wiki|solar>');
      }
      break;
    }

    case 'refresh':
      liveFeeds.refreshAll();
      pushLog('INFO', 'FORCING MANUAL SYNCHRONIZATION ACROSS ALL ENABLED LIVE APIS...');
      break;

    case 'chart':
    case 'spectrum':
    case 'spec':
      if (VALID_CHARTS.includes(arg)) {
        setSpectrumMode(arg);
        pushLog('INFO', `TELEMETRY CHART SWITCHED TO ${arg.toUpperCase()} MODE.`);
      } else {
        pushLog('WARN', 'Usage: chart <goes | bgp | quakes>');
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

    case 'center':
      centerOnLockedTarget();
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
      const events = liveFeeds.getLiveAnomalies();
      const liveSatCnt = liveFeeds.data.liveSats.length;
      pushLog(
        'INFO',
        `STATUS: WATCH ${tm.watchLabel} (L${tm.watchLevel}) | PROJ ${mapEngine.mode.toUpperCase()} | FEEDS ${tm.healthyFeeds}/${tm.activeFeeds} LIVE | ${liveSatCnt} NORAD SATS | ${events.length} EVENTS | ANOMALY ${tm.anomalyIndex.toFixed(1)} | Kp ${tm.kp.toFixed(1)} | GOES ${tm.flareClass}`
      );
      break;
    }

    default:
      pushLog('WARN', `Unknown command "${cmd}". Type "help" for available commands.`);
  }
}

// ----------------------------------------------------------------------------
// UI MODE, THEME & TARGET ACTIONS
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
    pushLog('INFO', `PROJECTION MATRIX SWITCHED TO ${mode === '3d' ? '3D HOLOGRAPHIC GLOBE' : '2D WIREFRAME MAP'}.`);
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
    pushLog('INFO', `HUD PHOSPHOR PALETTE SET TO ${theme.toUpperCase()}.`);
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
      ? 'LEFT EVENTS PANEL ONLY'
      : 'RIGHT DOSSIER PANEL ONLY';
    pushLog('INFO', `VIEWPORT LAYOUT: ${modeDesc}.`);
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

function centerOnLockedTarget() {
  const item = state.selectedLive?.item;
  if (!item || !Number.isFinite(item.lon) || !Number.isFinite(item.lat)) {
    pushLog('WARN', 'No locked target with coordinates to center on.');
    return;
  }
  sfx.playClick();
  mapEngine.focusLonLat(item.lon, item.lat);
}

function triggerSonarPing() {
  sfx.playPing();
  radar.triggerPing();
  spectrum.boost(0.8);
  if (state.selectedLive?.item) {
    const { kind, item } = state.selectedLive;
    const lat = item.lat ?? 65.0;
    const lon = item.lon ?? -20.0;
    mapEngine.triggerPing(lon, lat, kind === 'liveSat' ? '--ok' : '--accent');
    const label = item.name || item.callsign || item.title || item.code || item.id;
    pushLog(kind === 'liveSat' ? 'SAT' : 'INFO', `LOCATOR PULSE EMITTED ON ${label} (${radar.blips.length} CONTACTS IN 2500KM).`);
  }
}

// ----------------------------------------------------------------------------
// EVENT LISTENERS & KEYBOARD SHORTCUTS
// ----------------------------------------------------------------------------
function bindUIEvents() {
  // Global Watch button: focus top active global event
  els.watchBtn?.addEventListener('click', () => {
    const top = liveFeeds.getLiveAnomalies()[0];
    if (top?.item) {
      state.autoLockInitial = false;
      selectLiveItem(top.kind, top.item, true);
      pushLog('INFO', `GLOBAL WATCH FOCUS: ${top.title} [${top.badge}].`);
    } else {
      sfx.playClick();
      pushLog('INFO', 'GLOBAL WATCH NOMINAL — NO ACTIVE PRIORITY EVENTS TO FOCUS.');
    }
  });

  // Live Events search input & clear
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

  // Live Events list click
  els.opsList.addEventListener('click', (e) => {
    const card = e.target.closest('.op-card');
    if (!card || !card.dataset.liveKind || !card.dataset.liveId) return;
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
      item =
        liveFeeds.findLiveItem(kind, id) ||
        liveFeeds.getLiveAnomalies().find((a) => a.kind === kind && a.id === id)?.item;
    }
    if (item) {
      state.autoLockInitial = false;
      selectLiveItem(kind, item, true);
    }
  });

  // Event severity filter tabs
  $('nodeFilterRow').addEventListener('click', (e) => {
    const btn = e.target.closest('.micro-tab');
    if (!btn) return;
    state.nodeFilter = btn.dataset.filter;
    $('nodeFilterRow').querySelectorAll('.micro-tab').forEach((b) => b.classList.toggle('active', b === btn));
    sfx.playClick();
    renderOpsList();
  });

  // Satellites list click (live NORAD spacecraft only)
  els.satList.addEventListener('click', (e) => {
    const row = e.target.closest('.sat-row');
    if (!row || !row.dataset.liveSat) return;
    const sat = liveFeeds.data.liveSats.find((s) => s.id === row.dataset.liveSat);
    if (sat) {
      state.autoLockInitial = false;
      selectLiveItem('liveSat', sat, true);
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
  els.btnFeedsClear.addEventListener('click', () => applyFeedPreset('none'));

  els.btnRefreshFeeds.addEventListener('click', () => {
    sfx.playClick();
    liveFeeds.refreshAll();
    pushLog('INFO', 'SYNCHRONIZING LIVE PUBLIC TELEMETRY FEEDS...');
  });

  // Telemetry chart source tabs (GOES | BGP | QUAKES)
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
  els.btnDossierCenter?.addEventListener('click', centerOnLockedTarget);
  els.btnDossierPing?.addEventListener('click', triggerSonarPing);

  // Overlay layer toggle pills (1..6)
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
      '1': 'terminator',
      '2': 'cables',
      '3': 'aurora',
      '4': 'bgpArcs',
      '5': 'trails',
      '6': 'grid',
    };
    if (layerKeys[key]) {
      const pill = document.querySelector(`.layer-pill[data-layer="${layerKeys[key]}"]`);
      pill?.click();
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
// PERIODIC LIVE TELEMETRY METERS & GLOBAL WATCH LEVEL (100% DETERMINISTIC)
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
  state.threatIndex = tm.anomalyIndex;

  // Global Watch indicator
  if (els.watchBtn && els.watchVal && els.watchPips) {
    els.watchBtn.dataset.watch = String(tm.watchLevel);
    els.watchVal.textContent = tm.watchLabel;
    els.watchPips.querySelectorAll('i').forEach((pip) => {
      pip.classList.toggle('lit', Number(pip.dataset.w) <= tm.watchLevel);
    });
  }

  // 1. FEED HEALTH
  const healthPct = tm.activeFeeds ? Math.round((tm.healthyFeeds / tm.activeFeeds) * 100) : 0;
  els.meterHealth.style.width = `${healthPct}%`;
  els.meterHealth.className = `meter-fill ${tm.activeFeeds === 0 ? '' : tm.errorFeeds > 0 ? 'meter-warn' : 'meter-ok'}`;
  els.valHealth.textContent = `${tm.healthyFeeds}/${tm.activeFeeds} OK`;

  // 2. GOES X-RAY
  if (!liveFeeds.enabled.solar) {
    els.meterXray.style.width = '0%';
    els.meterXray.className = 'meter-fill';
    els.valXray.textContent = 'MUTED';
  } else if (!liveFeeds.data.goes) {
    els.meterXray.style.width = '8%';
    els.meterXray.className = 'meter-fill';
    els.valXray.textContent = 'SYNC..';
  } else {
    const flarePct = flareClassToPct(tm.flareClass);
    const flareWarn = tm.flareClass.startsWith('X') || tm.flareClass.startsWith('M');
    els.meterXray.style.width = `${flarePct}%`;
    els.meterXray.className = `meter-fill ${flareWarn ? 'meter-warn' : 'meter-ok'}`;
    els.valXray.textContent = tm.flareClass;
  }

  // 3. SOLAR Kp (NOAA)
  if (!liveFeeds.enabled.solar) {
    els.meterSolar.style.width = '0%';
    els.meterSolar.className = 'meter-fill';
    els.valSolar.textContent = 'MUTED';
  } else if (!liveFeeds.data.solar) {
    els.meterSolar.style.width = '8%';
    els.meterSolar.className = 'meter-fill';
    els.valSolar.textContent = 'SYNC..';
  } else {
    const kpPct = Math.min(100, Math.max(8, (tm.kp / 9) * 100));
    els.meterSolar.style.width = `${kpPct.toFixed(0)}%`;
    els.meterSolar.className = `meter-fill ${tm.kp >= 5 ? 'meter-warn' : 'meter-ok'}`;
    els.valSolar.textContent = `Kp ${tm.kp.toFixed(1)} ${liveFeeds.data.solar?.scale || 'G0'}`;
  }

  // 4. RIPE BGP LIVE
  if (!liveFeeds.enabled.bgp) {
    els.meterBgp.style.width = '0%';
    els.valBgp.textContent = 'MUTED';
  } else {
    const rate = liveFeeds.data.bgpRate || 0;
    const isLive = liveFeeds.status.bgp.state === 'live';
    const bgpPct = isLive ? Math.min(100, Math.max(6, (rate / 3000) * 100)) : 8;
    const rateLabel = rate >= 1000 ? `${(rate / 1000).toFixed(1)}k/s` : `${rate}/s`;
    els.meterBgp.style.width = `${bgpPct.toFixed(0)}%`;
    els.valBgp.textContent = isLive ? rateLabel : 'CONN..';
  }

  // 5. SEISMIC 24H
  if (!liveFeeds.enabled.quakes) {
    els.meterQuakes.style.width = '0%';
    els.meterQuakes.className = 'meter-fill';
    els.valQuakes.textContent = 'MUTED';
  } else if (tm.quakeCount > 0) {
    const qPct = Math.min(100, Math.max(8, (tm.peakQuakeMag / 8) * 100));
    els.meterQuakes.style.width = `${qPct.toFixed(0)}%`;
    els.meterQuakes.className = `meter-fill ${tm.peakQuakeMag >= 5 ? 'meter-warn' : 'meter-ok'}`;
    els.valQuakes.textContent = `M${tm.peakQuakeMag.toFixed(1)} (${tm.quakeCount})`;
  } else {
    els.meterQuakes.style.width = '8%';
    els.meterQuakes.className = 'meter-fill';
    els.valQuakes.textContent = 'SYNC..';
  }

  // 6. ANOMALY INDEX
  els.meterThreat.style.width = `${tm.anomalyIndex.toFixed(0)}%`;
  els.meterThreat.className = `meter-fill ${tm.anomalyIndex >= 50 ? 'meter-warn' : ''}`;
  els.valThreat.textContent = tm.anomalyIndex.toFixed(1);

  if (pushSpark) {
    sparkline.push(tm.anomalyIndex / 100);
  }

  // Bottom bar live bus status badge
  if (els.liveBusText) {
    els.liveBusText.textContent = `${tm.healthyFeeds}/${tm.activeFeeds} FEEDS LIVE`;
  }
  if (els.liveBusLed) {
    els.liveBusLed.className = `led ${tm.activeFeeds === 0 || tm.errorFeeds > 0 ? 'led-warn' : 'led-ok'}`;
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
  spectrum.render(dt, false, liveFeeds.data);

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

  let matchedInitialFocus = false;
  if (state.pendingFocus) {
    matchedInitialFocus = focusTargetByQuery(state.pendingFocus, { silentNotFound: true });
    if (matchedInitialFocus) {
      state.pendingFocus = null;
    }
  }

  if (!matchedInitialFocus) {
    const initialCollector = liveFeeds.data.bgpCollectors[0];
    if (initialCollector) {
      selectLiveItem('bgp', initialCollector, false, { silentSound: true });
    }
    state.autoLockInitial = !state.pendingFocus;
  }

  renderSatList();
  syncFeedSwitchboard();
  updateTelemetryMeters();
  state.hydrating = false;

  // Seed initial boot status & kick off real live public telemetry feeds
  pushLog('INFO', 'AEGIS GLOBAL TELEMETRY MONITOR ONLINE // CONNECTING 9 LIVE PUBLIC FEEDS...');
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

  startLoop();
}

init();
