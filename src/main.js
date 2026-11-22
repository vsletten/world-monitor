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

// ----------------------------------------------------------------------------
// APPLICATION STATE
// ----------------------------------------------------------------------------
const state = {
  defcon: 3,
  alertActive: false,
  leftOpen: true,
  rightOpen: true,
  spyOpsEnabled: true,
  nodeFilter: 'ALL',
  logFilter: 'ALL',
  selectedNodeId: 'zurich',
  selectedSatId: null,
  selectedLive: null,
  traceTimers: [],
  logs: [],
  decryptPct: 74,
  threatIndex: 38.2,
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
  spectrumTitle: $('spectrumTitle'),
  spectrumLed: $('spectrumLed'),
  spectrumModes: $('spectrumModes'),
  radarRngTag: $('radarRngTag'),
  // Telemetry meters
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
    const utmZone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
    const latBand = 'CDEFGHJKLMNPQRSTUVWX'[Math.min(19, Math.max(0, Math.floor((lat + 80) / 8)))] || 'N';
    els.coordReadout.textContent = `LAT ${lat >= 0 ? '+' : '-'}${Math.abs(lat).toFixed(4)}°${ns}  LON ${lon >= 0 ? '+' : '-'}${Math.abs(lon).toFixed(4)}°${ew}  //  MGRS ${utmZone}${latBand}`;
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
// OPERATIONS LIST & SATELLITES LIST
// ----------------------------------------------------------------------------
function renderOpsList() {
  const filtered = state.nodeFilter === 'ALL' ? NODES : NODES.filter((n) => n.type === state.nodeFilter);
  const critCount = NODES.filter((n) => n.type === 'CRITICAL').length;
  els.opsCountMeta.textContent = `${NODES.length} NODES // ${critCount} CRIT`;

  els.opsList.innerHTML = filtered
    .map(
      (n) => `
      <div class="op-card ${state.selectedNodeId === n.id ? 'selected' : ''}" data-id="${n.id}" data-type="${n.type}">
        <div class="op-card-name">${n.opName}</div>
        <div class="op-card-code">${n.code}</div>
        <div class="op-card-sub">${n.city}, ${n.country}</div>
        <div class="op-card-sig">${n.status}</div>
      </div>`
    )
    .join('');
}

function renderSatList() {
  const useLive = liveFeeds.enabled.liveSats && liveFeeds.data.liveSats.length > 0;
  const list = useLive ? liveFeeds.data.liveSats : mapEngine.satellites;
  els.satLockMeta.textContent = useLive ? `LIVE NORAD // ${list.length}` : `SIM // ${list.length}`;

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
        : Math.min(99, Math.max(76, Math.round(s.lock + Math.sin(performance.now() * 0.002 + s.phaseOffset) * 3)));
      const rightLabel = useLive ? `${s.altKm} KM` : s.orbit;
      const dataAttr = useLive ? `data-live-sat="${s.id}"` : `data-sat="${s.id}"`;
      return `
      <div class="sat-row ${isSelected ? 'selected' : ''}" ${dataAttr}>
        <div class="sat-name">${s.name}</div>
        <div class="sat-orbit">${rightLabel}</div>
        <div class="sat-coords">${latStr} ${lonStr}</div>
        <div class="sat-bar-wrap">
          <div class="sat-bar"><i style="width:${lockPct}%"></i></div>
          <span class="sat-coords">${useLive ? `${s.velKms}k/s` : `${lockPct}%`}</span>
        </div>
      </div>`;
    })
    .join('');
}

// ----------------------------------------------------------------------------
// TARGET DOSSIER SELECTION
// ----------------------------------------------------------------------------
let _rfSubtitle = '14.285 MHz';
function setSpectrumSubtitle(label) {
  _rfSubtitle = label;
  if (spectrum.mode === 'rf') {
    els.spectrumTitle.textContent = `RF // ${label}`;
  }
}

function setSpectrumMode(mode) {
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
  sfx.playClick();
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
  sfx.playLock();
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

  renderOpsList();
  renderSatList();
  updateDossierWeather(sat.lat, sat.lon);
}

function selectLiveItem(kind, item, syncMap = true) {
  if (!item) return;
  state.selectedNodeId = null;
  state.selectedSatId = null;
  state.selectedLive = { kind, id: item.id, item };

  if (syncMap) mapEngine.selectLive(kind, item, true);
  sfx.playLock();
  spectrum.boost(0.7);

  if (kind === 'liveSat') {
    radar.setTargetType('SAT');
    els.dossierCode.textContent = `NORAD // #${item.noradId}`;
    els.dossierOp.textContent = item.name;
    els.dossierLoc.textContent = `ALT ${item.altKm} KM • INCL ${item.inclination.toFixed(1)}°`;
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
    radar.setTargetType(item.mag >= 5 ? 'CRITICAL' : 'WARNING');
    const utcStr = tzFormatters.utc.format(new Date(item.time)) + 'Z';
    els.dossierCode.textContent = `USGS // M${item.mag.toFixed(1)}`;
    els.dossierOp.textContent = `SEISMIC M${item.mag.toFixed(1)} EVENT`;
    els.dossierLoc.textContent = item.place.toUpperCase();
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
    radar.setTargetType(item.categoryId === 'volcanoes' ? 'CRITICAL' : 'WARNING');
    els.dossierCode.textContent = `NASA // ${item.source}`;
    els.dossierOp.textContent = item.categoryTitle;
    els.dossierLoc.textContent = item.title.toUpperCase();
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live NASA Earth Observatory Natural Event Tracker (EONET). Active ${item.categoryTitle.toLowerCase()} anomaly reported ${item.date ? item.date.slice(0, 16).replace('T', ' ') + 'Z' : 'recently'}.`;
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
    radar.setTargetType(item.emergency ? 'CRITICAL' : 'ALLIED');
    els.dossierCode.textContent = `ADS-B // ${item.hex}`;
    els.dossierOp.textContent = `${item.callsign} [${item.type}]`;
    els.dossierLoc.textContent = `REG ${item.reg} • SQUAWK ${item.squawk}`;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `Live ADS-B military/tactical transponder signal. Barometric altitude ${item.altFt.toLocaleString()} ft, ground speed ${item.gsKts} kts, heading ${item.trackDeg !== null ? Math.round(item.trackDeg) + '°' : 'N/A'}.`;
    els.dossierSignal.textContent = `${item.altFt.toLocaleString()} FT`;
    els.dossierFreq.textContent = `${item.gsKts} KTS`;
    els.dossierStatus.textContent = item.emergency || `HDG ${item.trackDeg !== null ? Math.round(item.trackDeg) + '°' : '--'}`;
    els.dossierCipher.textContent = '1090-ES';
    setSpectrumSubtitle('1090 MHz');
    els.radarRngTag.textContent = `FL${Math.round(item.altFt / 100)}`;
    els.dossierSeverity.className = `status-pill ${item.emergency ? 'crit' : 'ally'}`;
    els.dossierSeverity.textContent = item.emergency ? 'EMERGENCY' : 'MIL ADS-B';
    els.dossierLed.className = `led ${item.emergency ? 'led-crit' : 'led-accent'}`;
  } else if (kind === 'bgp') {
    radar.setTargetType('COVERT');
    els.dossierCode.textContent = `RIPE // ${item.code}`;
    els.dossierOp.textContent = `${item.city} IXP (${item.ixp})`;
    els.dossierLoc.textContent = item.host.toUpperCase();
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
    radar.setTargetType(isRed ? 'CRITICAL' : isOrange ? 'WARNING' : 'SAT');
    els.dossierCode.textContent = `GDACS // ${item.eventType}`;
    els.dossierOp.textContent = item.name.toUpperCase();
    els.dossierLoc.textContent = `${item.country.toUpperCase()} • ${item.typeLabel}`;
    els.dossierCoords.textContent = formatCoord(item.lat, item.lon);
    els.dossierBrief.textContent = `UN/EU Global Disaster Alert & Coordination System (${item.source}). ${item.severityText || 'Active humanitarian crisis event under international monitoring.'}`;
    els.dossierSignal.textContent = item.alertLevel.toUpperCase();
    els.dossierFreq.textContent = item.source;
    els.dossierStatus.textContent = item.isCurrent ? 'ACTIVE' : 'RECENT';
    els.dossierCipher.textContent = 'UN-GDACS';
    setSpectrumSubtitle(item.typeLabel);
    els.radarRngTag.textContent = item.alertLevel.toUpperCase();
    els.dossierSeverity.className = `status-pill ${isRed ? 'crit' : isOrange ? 'warn' : 'sat'}`;
    els.dossierSeverity.textContent = `${item.alertLevel.toUpperCase()} ALERT`;
    els.dossierLed.className = `led ${isRed ? 'led-crit' : isOrange ? 'led-warn' : 'led-ok'}`;
  } else if (kind === 'meteo') {
    radar.setTargetType('ALLIED');
    els.dossierCode.textContent = `METEO // WMO`;
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
    radar.setTargetType('ALLIED');
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
  }

  renderOpsList();
  renderSatList();
  updateDossierWeather(item.lat, item.lon);
}

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

function toggleDataset(feedKey, forced = null) {
  if (feedKey === 'spyOps') {
    state.spyOpsEnabled = forced !== null ? Boolean(forced) : !state.spyOpsEnabled;
    mapEngine.setLayer('nodes', state.spyOpsEnabled);
    mapEngine.setLayer('arcs', state.spyOpsEnabled);
    mapEngine.setLayer('sigint', state.spyOpsEnabled);
    // Sync bottom layer pills for nodes/arcs/sigint
    ['nodes', 'arcs', 'sigint'].forEach((l) => {
      document.querySelector(`.layer-pill[data-layer="${l}"]`)?.classList.toggle('active', state.spyOpsEnabled);
    });
    sfx.playClick();
    syncFeedSwitchboard();
    pushLog('SIG', `DATASET [SPY OPS] ${state.spyOpsEnabled ? 'ENABLED' : 'MUTED'}.`);
    return;
  }

  if (feedKey in liveFeeds.enabled) {
    const next = forced !== null ? Boolean(forced) : !liveFeeds.enabled[feedKey];
    liveFeeds.setEnabled(feedKey, next);
    mapEngine.setLayer(feedKey, next);
    sfx.playClick();
    syncFeedSwitchboard();
    renderSatList();
    pushLog('SIG', `LIVE FEED [${feedKey.toUpperCase()}] ${next ? 'ENABLED' : 'MUTED'}.`);
  }
}

function renderTooltip(hit, mx, my) {
  if (!hit) {
    els.mapTooltip.classList.add('hidden');
    return;
  }

  if (hit.kind === 'node') {
    const n = hit.item;
    els.mapTooltip.innerHTML = `
      <div class="tt-head"><span>${n.opName}</span><span>${n.code}</span></div>
      <div class="tt-sub">${n.city}, ${n.country} • ${n.status}</div>
      <div class="tt-meta">${formatCoord(n.lat, n.lon)} • ${n.freq}</div>
    `;
  } else if (hit.kind === 'sat' || hit.kind === 'liveSat') {
    const s = hit.item;
    els.mapTooltip.innerHTML = `
      <div class="tt-head"><span>${s.name}</span><span>${hit.kind === 'liveSat' ? 'LIVE NORAD' : 'SIM ORBIT'}</span></div>
      <div class="tt-sub">${s.mission}</div>
      <div class="tt-meta">${s.orbit}${s.velKms ? ` • ${s.velKms} km/s` : ''} • ${formatCoord(s.lat, s.lon)}</div>
    `;
  } else if (hit.kind === 'quake') {
    const q = hit.item;
    els.mapTooltip.innerHTML = `
      <div class="tt-head"><span>M ${q.mag.toFixed(1)} EARTHQUAKE</span><span>USGS LIVE</span></div>
      <div class="tt-sub">${q.place}</div>
      <div class="tt-meta">Depth ${q.depthKm} km • ${formatCoord(q.lat, q.lon)}</div>
    `;
  } else if (hit.kind === 'eonet') {
    const e = hit.item;
    els.mapTooltip.innerHTML = `
      <div class="tt-head"><span>${e.categoryTitle}</span><span>NASA EONET</span></div>
      <div class="tt-sub">${e.title}</div>
      <div class="tt-meta">${formatCoord(e.lat, e.lon)} • ${e.source}</div>
    `;
  } else if (hit.kind === 'aircraft') {
    const a = hit.item;
    els.mapTooltip.innerHTML = `
      <div class="tt-head"><span>${a.callsign} [${a.type}]</span><span>ADS-B MIL</span></div>
      <div class="tt-sub">ALT ${a.altFt.toLocaleString()} ft • ${a.gsKts} kts • HDG ${a.trackDeg !== null ? Math.round(a.trackDeg) + '°' : '--'}</div>
      <div class="tt-meta">HEX ${a.hex} • REG ${a.reg} • SQK ${a.squawk}</div>
    `;
  } else if (hit.kind === 'bgp') {
    const c = hit.item;
    els.mapTooltip.innerHTML = `
      <div class="tt-head"><span>${c.city} IXP (${c.ixp})</span><span>RIPE BGP</span></div>
      <div class="tt-sub">${c.code} • ${c.msgCount} live updates</div>
      <div class="tt-meta">${c.lastAsn || 'AS?'} → ${c.lastPrefix || 'Listening...'}</div>
    `;
  } else if (hit.kind === 'gdacs') {
    const g = hit.item;
    els.mapTooltip.innerHTML = `
      <div class="tt-head"><span>${g.name}</span><span>${g.alertLevel.toUpperCase()}</span></div>
      <div class="tt-sub">${g.country} • ${g.typeLabel}</div>
      <div class="tt-meta">${g.source} • ${formatCoord(g.lat, g.lon)}</div>
    `;
  } else if (hit.kind === 'meteo') {
    const m = hit.item;
    els.mapTooltip.innerHTML = `
      <div class="tt-head"><span>${m.name}</span><span>OPEN-METEO</span></div>
      <div class="tt-sub">${m.tempC}°C • ${m.condition}</div>
      <div class="tt-meta">Wind ${m.windKmh} km/h @ ${m.windDir}° • ${m.pressureHpa} hPa</div>
    `;
  } else if (hit.kind === 'wiki') {
    const w = hit.item;
    els.mapTooltip.innerHTML = `
      <div class="tt-head"><span>WIKIPEDIA [${w.lang}]</span><span>LIVE EDITS</span></div>
      <div class="tt-sub">${w.lastTitle || 'Streaming live edits...'}</div>
      <div class="tt-meta">${w.recentCount} edits tracked • ${w.city}</div>
    `;
  }

  const stageRect = $('mapStage').getBoundingClientRect();
  const left = Math.min(stageRect.width - 220, mx + 14);
  const top = Math.max(10, my - 12);
  els.mapTooltip.style.left = `${left}px`;
  els.mapTooltip.style.top = `${top}px`;
  els.mapTooltip.classList.remove('hidden');
}

// ----------------------------------------------------------------------------
// LIVE INTERCEPT LOG WITH CHARACTER-DECODE ANIMATION
// ----------------------------------------------------------------------------
function pushLog(sev, message, animateDecode = true) {
  const now = new Date();
  const ts = tzFormatters.utc.format(now) + 'Z';
  const entry = { id: `${Date.now()}-${Math.random()}`, sev, ts, text: message, hex: randomHex(6) };
  state.logs.unshift(entry);
  if (state.logs.length > 48) state.logs.pop();

  if (state.logFilter !== 'ALL' && state.logFilter !== sev) return;

  const div = document.createElement('div');
  div.className = `log-entry sev-${sev}`;
  div.innerHTML = `
    <div class="log-meta">
      <span class="log-sev">[${sev}] 0x${entry.hex}</span>
      <span>${ts}</span>
    </div>
    <div class="log-text"></div>
  `;
  const textEl = div.querySelector('.log-text');
  els.logFeed.prepend(div);

  while (els.logFeed.children.length > 35) {
    els.logFeed.lastElementChild.remove();
  }

  if (!animateDecode) {
    textEl.textContent = message;
    return;
  }

  // Matrix/cipher scramble-to-plaintext reveal
  const cipherChars = '0123456789ABCDEF#$%*@/';
  let frame = 0;
  const totalFrames = 10;
  const timer = setInterval(() => {
    frame++;
    const revealed = Math.floor((frame / totalFrames) * message.length);
    let out = message.slice(0, revealed);
    const tailLen = Math.min(12, message.length - revealed);
    for (let i = 0; i < tailLen; i++) {
      out += cipherChars[Math.floor(Math.random() * cipherChars.length)];
    }
    textEl.textContent = out;
    if (frame >= totalFrames) {
      textEl.textContent = message;
      clearInterval(timer);
    }
  }, 26);
}

function rerenderLogFeed() {
  els.logFeed.innerHTML = '';
  const visible = state.logFilter === 'ALL' ? state.logs : state.logs.filter((l) => l.sev === state.logFilter);
  visible.slice(0, 35).forEach((entry) => {
    const div = document.createElement('div');
    div.className = `log-entry sev-${entry.sev}`;
    div.innerHTML = `
      <div class="log-meta">
        <span class="log-sev">[${entry.sev}] 0x${entry.hex}</span>
        <span>${entry.ts}</span>
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
function setDefcon(level) {
  state.defcon = Math.max(1, Math.min(5, level));
  els.defconBtn.dataset.level = String(state.defcon);
  els.defconVal.textContent = `DEFCON ${state.defcon}`;
  els.defconPips.querySelectorAll('i').forEach((pip) => {
    const d = Number(pip.dataset.d);
    pip.classList.toggle('lit', d >= state.defcon);
  });

  const critical = state.defcon <= 2;
  if (state.defcon === 1) {
    setAlertState(true, 'DEFCON 1 // MAXIMUM STRATEGIC READINESS — ALL SECTORS ON HIGH ALERT');
  } else if (!critical && state.alertActive) {
    setAlertState(false);
  }
  pushLog(state.defcon <= 2 ? 'CRIT' : 'SIG', `STRATEGIC READINESS UPDATED TO DEFCON ${state.defcon}.`);
}

function setAlertState(active, customMsg = null) {
  state.alertActive = Boolean(active);
  mapEngine.alertActive = state.alertActive;
  els.alertVignette.classList.toggle('active', state.alertActive);
  els.btnSimAlert.classList.toggle('active', state.alertActive);
  els.btnSimAlert.textContent = state.alertActive ? 'CLEAR ALERT' : 'ALERT';

  if (state.alertActive) {
    sfx.playAlert();
    spectrum.boost(1.5);
    showBanner('TACTICAL BREACH ALERT // PRIORITY-0', customMsg || 'ANOMALOUS MULTI-VECTOR INTRUSION DETECTED — INITIATING COUNTERMEASURES', 'alert', 100);
    pushLog('CRIT', customMsg || 'RED ALERT: Simultaneous encrypted burst surges across Zurich, Moscow, and Shenzhen!');
  } else {
    hideBanner();
    pushLog('SIG', 'Tactical alert cleared. Resuming standard global monitoring protocol.');
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
// MULTI-HOP SIGNAL TRACE SEQUENCE (CLASSIC SPY MOVIE TRACE!)
// ----------------------------------------------------------------------------
function cancelTrace() {
  state.traceTimers.forEach((t) => clearTimeout(t));
  state.traceTimers = [];
  mapEngine.clearTrace();
}

function runTrace(targetNodeId = null) {
  cancelTrace();

  let route;
  if (targetNodeId && targetNodeId !== 'langley') {
    // Build a cinematic route from Langley to the target via 3 intermediate relays
    const intermediates = ['reykjavik', 'london', 'vienna', 'dubai', 'singapore', 'tokyo'].filter(
      (id) => id !== targetNodeId
    );
    const chosen = intermediates.sort(() => Math.random() - 0.5).slice(0, 3);
    route = ['langley', ...chosen, targetNodeId];
  } else {
    route = TRACE_ROUTES[Math.floor(Math.random() * TRACE_ROUTES.length)];
  }

  const fakeIp = () =>
    `${10 + Math.floor(Math.random() * 210)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${1 + Math.floor(Math.random() * 254)}`;

  mapEngine.startTrace(route);
  spectrum.boost(1.4);
  pushLog('SIG', `INITIATING MULTI-HOP SIGNAL TRACE [${route.length - 1} RELAYS]...`);

  route.forEach((nodeId, idx) => {
    const t = setTimeout(() => {
      const node = NODES.find((n) => n.id === nodeId);
      const isLast = idx === route.length - 1;
      const pct = Math.round(((idx + 1) / route.length) * 100);

      mapEngine.setTraceStep(idx, isLast);
      spectrum.boost(1.1);

      if (!isLast) {
        sfx.playTraceHop(idx);
        showBanner(
          `ACTIVE SIGNAL TRACE // HOP ${idx + 1} OF ${route.length}`,
          `BOUNCING THROUGH ${node.city} [${node.code}] // IP ${fakeIp()}`,
          'trace',
          pct
        );
        pushLog('SIG', `TRACE HOP ${idx + 1}: Relay ${node.code} (${node.city}) bypassed in ${18 + Math.floor(Math.random() * 44)}ms.`);
      } else {
        sfx.playTraceConfirmed();
        selectNode(node.id, true);
        showBanner(
          'TARGET ACQUIRED // GEOLOCATION CONFIRMED',
          `${node.opName} — ${node.city}, ${node.country} (${formatCoord(node.lat, node.lon)})`,
          'locked',
          100
        );
        pushLog('CRIT', `TRACE LOCKED: Signal origin confirmed at ${node.opName} (${node.city}, ${node.code}).`);

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
// INTERACTIVE COMMAND LINE PARSER
// ----------------------------------------------------------------------------
function handleCommand(raw) {
  const input = raw.trim();
  if (!input) return;
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
        'COMMANDS: trace [city] | focus <city|iss|callsign> | feed <ops|sats|quakes|eonet|aircraft|solar> | live [on|off] | refresh | mode 2d|globe | panels [left|right|show|hide] | maponly | theme cyan|amber|emerald|crimson | defcon <1-5> | alert | ping | clear | status',
        false
      );
      break;

    case 'trace': {
      const target = arg ? NODES.find((n) => n.city.toLowerCase().includes(arg) || n.code.toLowerCase() === arg || n.id.includes(arg)) : null;
      runTrace(target?.id || null);
      break;
    }

    case 'focus':
    case 'lock':
    case 'goto': {
      if (!arg) {
        pushLog('WARN', 'Usage: focus <city, satellite, or callsign> (e.g. focus iss, focus tokyo, focus hst)');
        break;
      }
      const node = NODES.find(
        (n) =>
          n.city.toLowerCase().includes(arg) ||
          n.country.toLowerCase().includes(arg) ||
          n.code.toLowerCase() === arg ||
          n.opName.toLowerCase().includes(arg)
      );
      if (node) {
        selectNode(node.id, true);
        pushLog('SIG', `TARGET LOCKED ON ${node.opName} (${node.city}).`);
        break;
      }
      const liveSat = liveFeeds.data.liveSats.find((s) => s.name.toLowerCase().includes(arg));
      if (liveSat) {
        selectLiveItem('liveSat', liveSat, true);
        pushLog('SAT', `LIVE NORAD LOCK ENGAGED ON ${liveSat.name}.`);
        break;
      }
      const ac = liveFeeds.data.aircraft.find(
        (a) => a.callsign.toLowerCase().includes(arg) || a.hex.toLowerCase() === arg || a.type.toLowerCase() === arg
      );
      if (ac) {
        selectLiveItem('aircraft', ac, true);
        pushLog('SIG', `ADS-B LOCK ENGAGED ON ${ac.callsign} [${ac.type}].`);
        break;
      }
      const sat = mapEngine.satellites.find((s) => s.name.toLowerCase().includes(arg));
      if (sat) {
        selectSat(sat.id, true);
        pushLog('SAT', `ORBITAL LOCK ENGAGED ON ${sat.name}.`);
      } else {
        pushLog('WARN', `No asset, spacecraft, or aircraft matching "${arg}".`);
      }
      break;
    }

    case 'live': {
      const turnOn = arg === 'off' ? false : arg === 'on' ? true : !liveFeeds.enabled.quakes;
      ['liveSats', 'quakes', 'eonet', 'aircraft', 'bgp', 'gdacs', 'meteo', 'wiki', 'solar'].forEach((k) =>
        toggleDataset(k, turnOn)
      );
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
      }[arg];
      if (mapKey) toggleDataset(mapKey);
      else pushLog('WARN', 'Usage: feed <ops|sats|quakes|eonet|aircraft|bgp|gdacs|meteo|wiki|solar>');
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
      if (['cyan', 'amber', 'emerald', 'crimson'].includes(arg)) {
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

    case 'status':
      pushLog(
        'SIG',
        `STATUS: DEFCON ${state.defcon} | PROJ ${mapEngine.mode.toUpperCase()} | ${NODES.length} NODES | ${SATELLITES.length} ORBITAL ASSETS | DECRYPT ${Math.round(state.decryptPct)}%`
      );
      break;

    default:
      pushLog('WARN', `Unknown command "${cmd}". Type "help" for available tactical commands.`);
  }
}

// ----------------------------------------------------------------------------
// UI MODE & THEME SWITCHERS
// ----------------------------------------------------------------------------
function setProjectionMode(mode) {
  mapEngine.setMode(mode);
  els.btnMode2D.classList.toggle('active', mode === '2d');
  els.btnMode3D.classList.toggle('active', mode === '3d');
  els.btnAutoRotate.style.display = mode === '3d' ? 'flex' : 'none';
  els.btnAutoRotate.classList.toggle('active', mapEngine.autoRotate);
  els.mapProjectionLabel.textContent =
    mode === '3d'
      ? 'PROJ: ORTHOGRAPHIC 3D HOLOGRAPHIC GLOBE // WGS-84'
      : 'PROJ: EQUIRECTANGULAR WIREFRAME // WGS-84';
  sfx.playClick();
  pushLog('SIG', `PROJECTION MATRIX SWITCHED TO ${mode === '3d' ? '3D HOLOGRAPHIC GLOBE' : '2D TACTICAL WIREFRAME'}.`);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-dot').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
  sfx.playClick();
  pushLog('SIG', `HUD PHOSPHOR PALETTE SET TO ${theme.toUpperCase()}.`);
}

function setSidebars({ left = state.leftOpen, right = state.rightOpen } = {}) {
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

  sfx.playClick();
  const modeDesc = mapOnly
    ? 'MAP-ONLY FULL STAGE'
    : state.leftOpen && state.rightOpen
    ? 'FULL DUAL-SIDEBAR HUD'
    : state.leftOpen
    ? 'LEFT OPS PANEL ONLY'
    : 'RIGHT DOSSIER PANEL ONLY';
  pushLog('SIG', `VIEWPORT LAYOUT: ${modeDesc}.`);
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
  const code = state.selectedNodeId
    ? NODES.find((n) => n.id === state.selectedNodeId)?.code
    : mapEngine.satellites.find((s) => s.id === state.selectedSatId)?.name;
  pushLog('SIG', `DECRYPT BURST [${code || 'AEGIS'}]: Recovered session block 0x${randomHex(8)} — keyspace narrowed.`);
}

// ----------------------------------------------------------------------------
// EVENT LISTENERS & KEYBOARD SHORTCUTS
// ----------------------------------------------------------------------------
function bindUIEvents() {
  // Operations list click
  els.opsList.addEventListener('click', (e) => {
    const card = e.target.closest('.op-card');
    if (!card) return;
    selectNode(card.dataset.id, true);
  });

  // Node filter tabs
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

  const allLiveKeys = ['liveSats', 'quakes', 'eonet', 'aircraft', 'bgp', 'gdacs', 'meteo', 'wiki', 'solar'];
  els.btnFeedsAll.addEventListener('click', () => {
    toggleDataset('spyOps', true);
    allLiveKeys.forEach((k) => toggleDataset(k, true));
  });
  els.btnFeedsLiveOnly.addEventListener('click', () => {
    toggleDataset('spyOps', false);
    allLiveKeys.forEach((k) => toggleDataset(k, true));
  });
  els.btnFeedsClear.addEventListener('click', () => {
    toggleDataset('spyOps', false);
    allLiveKeys.forEach((k) => toggleDataset(k, false));
  });

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
  els.btnTrace.addEventListener('click', () => runTrace(state.selectedNodeId));
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
  $('btnDossierTrace').addEventListener('click', () => runTrace(state.selectedNodeId));
  $('btnDossierDecrypt').addEventListener('click', triggerDecryptBurst);
  $('btnDossierPing').addEventListener('click', triggerSonarPing);

  // Layer toggle pills
  $('layerToggles').addEventListener('click', (e) => {
    const pill = e.target.closest('.layer-pill');
    if (!pill) return;
    const layer = pill.dataset.layer;
    const active = pill.classList.toggle('active');
    mapEngine.setLayer(layer, active);
    sfx.playClick();
  });

  // Command form
  els.cmdForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleCommand(els.cmdInput.value);
    els.cmdInput.value = '';
  });

  // Keyboard shortcuts (ignored while typing in input)
  window.addEventListener('keydown', (e) => {
    if (document.activeElement === els.cmdInput) {
      if (e.key === 'Escape') els.cmdInput.blur();
      return;
    }
    if (e.key === '/') {
      e.preventDefault();
      els.cmdInput.focus();
      return;
    }
    const key = e.key.toLowerCase();
    const layerKeys = { '1': 'nodes', '2': 'arcs', '3': 'satellites', '4': 'sigint', '5': 'grid', '6': 'scan' };
    if (layerKeys[key]) {
      const pill = document.querySelector(`.layer-pill[data-layer="${layerKeys[key]}"]`);
      pill?.click();
    } else if (key === 't') {
      runTrace(state.selectedNodeId);
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
// PERIODIC LIVE TELEMETRY & INTERCEPT STREAM
// ----------------------------------------------------------------------------
function updateTelemetryMeters() {
  state.decryptPct = state.decryptPct >= 99.2 ? 14 : state.decryptPct + 0.6 + Math.random() * 1.4;
  const sigintGbps = (state.alertActive ? 29 : 16) + Math.random() * 8.5;
  const meshPct = state.alertActive ? 86 + Math.random() * 6 : 95 + Math.random() * 4.5;
  const baseThreat = state.alertActive ? 84 : state.defcon <= 2 ? 68 : 34;
  state.threatIndex = Math.max(12, Math.min(99, baseThreat + (Math.random() - 0.45) * 14));

  els.meterDecrypt.style.width = `${state.decryptPct.toFixed(0)}%`;
  els.valDecrypt.textContent = `${state.decryptPct.toFixed(0)}%`;

  const sigintPct = Math.min(100, (sigintGbps / 40) * 100);
  els.meterSigint.style.width = `${sigintPct.toFixed(0)}%`;
  els.valSigint.textContent = `${sigintGbps.toFixed(1)} Gb/s`;

  els.meterMesh.style.width = `${meshPct.toFixed(0)}%`;
  els.valMesh.textContent = `${meshPct.toFixed(0)}%`;

  els.meterThreat.style.width = `${state.threatIndex.toFixed(0)}%`;
  els.valThreat.textContent = state.threatIndex.toFixed(1);

  sparkline.push(state.threatIndex / 100);
}

// ----------------------------------------------------------------------------
// MAIN ANIMATION LOOP
// ----------------------------------------------------------------------------
let lastTime = performance.now();
let fpsFrames = 0;
let fpsLastCheck = lastTime;

function tick(now) {
  requestAnimationFrame(tick);

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

// ----------------------------------------------------------------------------
// BOOTSTRAP
// ----------------------------------------------------------------------------
function init() {
  bindUIEvents();
  updateClocks();
  setDefcon(3);
  renderOpsList();
  selectNode('zurich', false);
  renderSatList();
  syncFeedSwitchboard();
  updateTelemetryMeters();

  // Seed initial boot status & kick off real live public telemetry feeds
  pushLog('SIG', 'AEGIS GLOBAL SITUATION ROOM ONLINE // CONNECTING LIVE PUBLIC TELEMETRY BUS...', false);
  liveFeeds.start();

  setInterval(updateClocks, 1000);
  setInterval(renderSatList, 1000);
  setInterval(updateTelemetryMeters, 1800);

  let poolIdx = 0;
  setInterval(() => {
    if (!state.spyOpsEnabled) return;
    const item = INTERCEPT_POOL[poolIdx % INTERCEPT_POOL.length];
    poolIdx++;
    pushLog(item.sev, item.text, true);
  }, 6500);

  requestAnimationFrame(tick);
}

init();
