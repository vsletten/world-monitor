// ============================================================================
// AEGIS // LIVE PUBLIC DATA TELEMETRY ENGINE (ISS/NORAD, USGS, NASA, ADS-B, NOAA)
// ============================================================================

import {
  json2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from 'satellite.js';

const PREFERRED_SATS = [
  'ISS (ZARYA)',
  'CSS (TIANHE)',
  'HST',
  'NOAA 20 (JPSS-1)',
  'NOAA 21 (JPSS-2)',
  'TERRA',
  'AQUA',
  'SENTINEL-2A',
  'SENTINEL-1A',
  'SUOMI NPP',
];

const POLL_CADENCE_MS = {
  aircraft: 18000,
  quakes: 120000,
  eonet: 300000,
  solar: 90000,
  gdacs: 300000,
  meteo: 300000,
  wiki: 12000,
  issHeartbeat: 30000,
};

const SAT_WORKER_TICK_MS = 500;
const DIRECT_RIPE_WS = 'wss://ris-live.ripe.net/v1/ws/?client=aegis-command';

function kpToScale(kp) {
  if (kp >= 9) return { scale: 'G5', label: 'EXTREME STORM', severity: 'CRITICAL' };
  if (kp >= 8) return { scale: 'G4', label: 'SEVERE STORM', severity: 'CRITICAL' };
  if (kp >= 7) return { scale: 'G3', label: 'STRONG STORM', severity: 'WARNING' };
  if (kp >= 6) return { scale: 'G2', label: 'MODERATE STORM', severity: 'WARNING' };
  if (kp >= 5) return { scale: 'G1', label: 'MINOR STORM', severity: 'WARNING' };
  if (kp >= 4) return { scale: 'G0+', label: 'ACTIVE FIELD', severity: 'ALLIED' };
  return { scale: 'G0', label: 'QUIET', severity: 'ALLIED' };
}

// Real RIPE RIS Route Collector geographic locations (IXP hubs)
export const RIPE_COLLECTORS = {
  'rrc00.ripe.net': { code: 'RRC00', city: 'AMSTERDAM', ixp: 'RIPE NCC', lat: 52.3676, lon: 4.9041 },
  'rrc01.ripe.net': { code: 'RRC01', city: 'LONDON', ixp: 'LINX', lat: 51.5074, lon: -0.1278 },
  'rrc03.ripe.net': { code: 'RRC03', city: 'AMSTERDAM', ixp: 'AMS-IX', lat: 52.35, lon: 4.95 },
  'rrc04.ripe.net': { code: 'RRC04', city: 'GENEVA', ixp: 'CIXP', lat: 46.2044, lon: 6.1432 },
  'rrc05.ripe.net': { code: 'RRC05', city: 'VIENNA', ixp: 'VIX', lat: 48.2082, lon: 16.3738 },
  'rrc06.ripe.net': { code: 'RRC06', city: 'TOKYO', ixp: 'DIX-IE', lat: 35.6762, lon: 139.6503 },
  'rrc07.ripe.net': { code: 'RRC07', city: 'STOCKHOLM', ixp: 'NETNOD', lat: 59.3293, lon: 18.0686 },
  'rrc10.ripe.net': { code: 'RRC10', city: 'MILAN', ixp: 'MIX', lat: 45.4642, lon: 9.19 },
  'rrc11.ripe.net': { code: 'RRC11', city: 'NEW YORK', ixp: 'NYIIX', lat: 40.7128, lon: -74.006 },
  'rrc12.ripe.net': { code: 'RRC12', city: 'FRANKFURT', ixp: 'DE-CIX', lat: 50.1109, lon: 8.6821 },
  'rrc13.ripe.net': { code: 'RRC13', city: 'MOSCOW', ixp: 'MSK-IX', lat: 55.7558, lon: 37.6173 },
  'rrc14.ripe.net': { code: 'RRC14', city: 'PALO ALTO', ixp: 'PAIX', lat: 37.4419, lon: -122.143 },
  'rrc15.ripe.net': { code: 'RRC15', city: 'SÃO PAULO', ixp: 'IX.BR', lat: -23.5505, lon: -46.6333 },
  'rrc16.ripe.net': { code: 'RRC16', city: 'MIAMI', ixp: 'NOTA', lat: 25.7617, lon: -80.1918 },
  'rrc18.ripe.net': { code: 'RRC18', city: 'BARCELONA', ixp: 'CATNIX', lat: 41.3874, lon: 2.1686 },
  'rrc19.ripe.net': { code: 'RRC19', city: 'JOHANNESBURG', ixp: 'JINX', lat: -26.2041, lon: 28.0473 },
  'rrc20.ripe.net': { code: 'RRC20', city: 'ZURICH', ixp: 'SWISSIX', lat: 47.3769, lon: 8.5417 },
  'rrc21.ripe.net': { code: 'RRC21', city: 'PARIS', ixp: 'FRANCE-IX', lat: 48.8566, lon: 2.3522 },
  'rrc22.ripe.net': { code: 'RRC22', city: 'BUCHAREST', ixp: 'INTERLAN', lat: 44.4268, lon: 26.1025 },
  'rrc23.ripe.net': { code: 'RRC23', city: 'SINGAPORE', ixp: 'EQUINIX-SG', lat: 1.3521, lon: 103.8198 },
  'rrc24.ripe.net': { code: 'RRC24', city: 'MONTEVIDEO', ixp: 'LACNIC', lat: -34.9011, lon: -56.1645 },
  'rrc25.ripe.net': { code: 'RRC25', city: 'AMSTERDAM', ixp: 'RIPE-25', lat: 52.38, lon: 4.88 },
  'rrc26.ripe.net': { code: 'RRC26', city: 'DUBAI', ixp: 'UAE-IX', lat: 25.2048, lon: 55.2708 },
};

const METEO_STATIONS = [
  { id: 'met-nyc', name: 'NEW YORK', lat: 40.71, lon: -74.01 },
  { id: 'met-lax', name: 'LOS ANGELES', lat: 34.05, lon: -118.24 },
  { id: 'met-anc', name: 'ANCHORAGE', lat: 61.22, lon: -149.9 },
  { id: 'met-lon', name: 'LONDON', lat: 51.51, lon: -0.13 },
  { id: 'met-rek', name: 'REYKJAVIK', lat: 64.15, lon: -21.94 },
  { id: 'met-msk', name: 'MOSCOW', lat: 55.76, lon: 37.62 },
  { id: 'met-cai', name: 'CAIRO', lat: 30.04, lon: 31.24 },
  { id: 'met-dxb', name: 'DUBAI', lat: 25.2, lon: 55.27 },
  { id: 'met-del', name: 'NEW DELHI', lat: 28.61, lon: 77.21 },
  { id: 'met-sgp', name: 'SINGAPORE', lat: 1.35, lon: 103.82 },
  { id: 'met-tyo', name: 'TOKYO', lat: 35.68, lon: 139.65 },
  { id: 'met-syd', name: 'SYDNEY', lat: -33.87, lon: 151.21 },
  { id: 'met-gru', name: 'SÃO PAULO', lat: -23.55, lon: -46.63 },
  { id: 'met-cpt', name: 'CAPE TOWN', lat: -33.92, lon: 18.42 },
];

const WIKI_HUBS = [
  { id: 'wiki-en', lang: 'EN', proxy: '/live-api/wiki-en', city: 'LONDON / US-EAST', lat: 44.5, lon: -40.0 },
  { id: 'wiki-de', lang: 'DE', proxy: '/live-api/wiki-de', city: 'BERLIN', lat: 52.52, lon: 13.4 },
  { id: 'wiki-ja', lang: 'JA', proxy: '/live-api/wiki-ja', city: 'TOKYO', lat: 35.68, lon: 139.65 },
  { id: 'wiki-fr', lang: 'FR', proxy: '/live-api/wiki-fr', city: 'PARIS', lat: 48.86, lon: 2.35 },
];

export function wmoCodeToText(code) {
  if (code === 0) return 'CLEAR SKY';
  if (code <= 3) return 'PARTLY CLOUDY';
  if (code <= 48) return 'FOG / HAZE';
  if (code <= 57) return 'DRIZZLE';
  if (code <= 67) return 'RAIN';
  if (code <= 77) return 'SNOWFALL';
  if (code <= 82) return 'RAIN SHOWERS';
  if (code <= 86) return 'SNOW SHOWERS';
  if (code >= 95) return 'THUNDERSTORM';
  return 'OVERCAST';
}

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = 10000, { requireJsonContentType = false, label = 'direct' } = {}) {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  const onCallerAbort = () => controller.abort(callerSignal.reason);
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (ct.includes('text/html') || (requireJsonContentType && !ct.includes('json'))) {
      throw new Error(`Non-JSON ${label} response (${ct || 'unknown'})`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }
}

// CORS-resilient JSON fetcher: tries direct CORS-native URL first (10s timeout) when
// available, falling back to local/edge proxy (12s timeout, verifying JSON content-type
// so SPA fallback index.html 200 OK never breaks parsing). Proxy-only feeds pass directUrl = null.
export async function fetchJsonWithFallback(proxyUrl, directUrl, proxyInit = {}, directInit = {}) {
  let directErr = null;
  if (directUrl) {
    try {
      return await fetchJsonWithTimeout(directUrl, directInit, 10000, {
        requireJsonContentType: false,
        label: 'direct',
      });
    } catch (err) {
      directErr = err;
    }
  }

  if (proxyUrl) {
    return await fetchJsonWithTimeout(proxyUrl, proxyInit, 12000, {
      requireJsonContentType: true,
      label: 'proxy',
    });
  }

  throw directErr || new Error('Fetch failed');
}

export class LiveFeedManager {
  constructor({ onUpdate, onLog, onBgpPulse, onWikiPulse } = {}) {
    this.onUpdate = onUpdate;
    this.onLog = onLog;
    this.onBgpPulse = onBgpPulse;
    this.onWikiPulse = onWikiPulse;

    this.enabled = {
      liveSats: true,
      quakes: true,
      eonet: true,
      aircraft: true,
      solar: true,
      bgp: true,
      gdacs: true,
      meteo: true,
      wiki: true,
    };

    this.status = {
      liveSats: { state: 'idle', count: 0, updatedAt: null, error: null },
      quakes: { state: 'idle', count: 0, updatedAt: null, error: null },
      eonet: { state: 'idle', count: 0, updatedAt: null, error: null },
      aircraft: { state: 'idle', count: 0, updatedAt: null, error: null },
      solar: { state: 'idle', count: 0, updatedAt: null, error: null },
      bgp: { state: 'idle', count: 0, updatedAt: null, error: null },
      gdacs: { state: 'idle', count: 0, updatedAt: null, error: null },
      meteo: { state: 'idle', count: 0, updatedAt: null, error: null },
      wiki: { state: 'idle', count: 0, updatedAt: null, error: null },
    };

    this.data = {
      liveSats: [],
      quakes: [],
      eonet: [],
      aircraft: [],
      solar: null,
      goes: null, // { xraySat, magSat, flareClass, latestFlux, xrayLong: [], xrayShort: [], magHp: [], magTotal: [], latestHp, latestTotal, timeTag }
      bgpCollectors: Object.entries(RIPE_COLLECTORS).map(([host, c]) => ({
        id: `bgp-${c.code.toLowerCase()}`,
        host,
        ...c,
        msgCount: 0,
        windowCount: 0,
        recentRate: 0,
        lastPrefix: '',
        lastAsn: '',
        lastPulseAt: 0,
      })),
      bgpRate: 0,
      bgpWithdrawRate: 0,
      bgpHistory: new Array(48).fill(0),
      bgpPulses: [], // up to 24 recent { id, host, code, city, lat, lon, toLat, toLon, prefix, asn, isWithdraw, ts }
      gdacs: [],
      meteo: [],
      wikiHubs: WIKI_HUBS.map((h) => ({
        ...h,
        recentCount: 0,
        lastTitle: '',
        lastUser: '',
        lastPulseAt: 0,
        revid: null,
      })),
      wikiTotal: 0,
    };

    this.timers = {};
    this._satById = new Map();
    this._bgpCollectorByHost = new Map(this.data.bgpCollectors.map((c) => [c.host, c]));
    this._lastTrackRebuild = 0;
    this._lastBgpLogAt = 0;
    this._lastBgpHistoryAt = 0;
    this._lastBgpPulseCollector = null;
    this._bgpPulseSeq = 0;
    this._seenWikiIds = new Set();
    this._pointWeatherCache = new Map();
    this._visibilityRefreshTimers = [];

    // Fallback BGP state (only used if Web Workers are unavailable)
    this._bgpWs = null;
    this._bgpFallbackReconnectTimer = null;
    this._bgpFallbackAttempt = 0;
    this._bgpWindowCount = 0;
    this._bgpWithdrawWindowCount = 0;

    // Off-thread telemetry Web Worker (SGP4 + RIPE RIS BGP)
    this._worker = null;
    this._initWorker();

    this._onVisibilityChange = () => this._handleVisibilityChange();
    this._visibilityBound = false;
  }

  _initWorker() {
    if (typeof Worker === 'undefined') return;
    try {
      const worker = new Worker(new URL('./telemetryWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (ev) => this._handleWorkerMessage(ev.data);
      worker.onerror = () => {
        this._teardownWorker();
        if (this.enabled.bgp && !this._bgpWs) {
          this._connectBgpFallback();
        }
      };
      this._worker = worker;
    } catch {
      this._worker = null;
    }
  }

  _teardownWorker() {
    if (this._worker) {
      try {
        this._worker.terminate();
      } catch {
        // ignore
      }
      this._worker = null;
    }
  }

  _isDocumentHidden() {
    return typeof document !== 'undefined' && Boolean(document.hidden);
  }

  _handleWorkerMessage(msg) {
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'sats:positions') {
      const nowMs = Date.now();
      const positions = Array.isArray(msg.positions) ? msg.positions : [];
      for (let i = 0; i < positions.length; i++) {
        const p = positions[i];
        const sat = this._satById.get(p.id);
        if (!sat) continue;
        sat.prevLat = Number.isFinite(sat.lat) ? sat.lat : p.lat;
        sat.prevLon = Number.isFinite(sat.lon) ? sat.lon : p.lon;
        sat.targetLat = p.lat;
        sat.targetLon = p.lon;
        sat.altKm = Math.round(p.altKm);
        sat.velKms = p.velKms;
        sat.lastPropMs = nowMs;
      }
      return;
    }

    if (msg.type === 'sats:tracks') {
      const tracks = msg.tracks || {};
      for (const [id, pts] of Object.entries(tracks)) {
        const sat = this._satById.get(id);
        if (sat && Array.isArray(pts)) {
          sat.track = pts;
        }
      }
      return;
    }

    if (msg.type === 'bgp:status') {
      if (!this.enabled.bgp) return;
      if (msg.state === 'live') {
        const wasLive = this.status.bgp.state === 'live';
        this.status.bgp = {
          state: 'live',
          count: this.data.bgpRate || 1,
          updatedAt: new Date(),
          error: null,
        };
        if (!wasLive) {
          const via = msg.url?.includes('ris-live.ripe.net') ? 'DIRECT' : 'PROXY';
          this.onLog?.(
            'SIG',
            `RIPE RIS LIVE BGP WEBSOCKET CONNECTED (${via}) — MONITORING GLOBAL IXP ROUTE COLLECTORS.`
          );
        }
        this.onUpdate?.('bgp');
      } else if (msg.state === 'error') {
        this.status.bgp = {
          state: 'error',
          count: 0,
          updatedAt: null,
          error: msg.error || 'WS error',
        };
        this.onUpdate?.('bgp');
      }
      return;
    }

    if (msg.type === 'bgp:tick') {
      if (!this.enabled.bgp) return;
      const now = Date.now();
      this.data.bgpRate = msg.bgpRate || 0;
      this.data.bgpWithdrawRate = msg.withdrawRate || 0;

      if (Array.isArray(msg.collectors)) {
        for (let i = 0; i < msg.collectors.length; i++) {
          const upd = msg.collectors[i];
          const col = this._bgpCollectorByHost.get(upd.host);
          if (!col) continue;
          col.msgCount = upd.msgCount;
          col.recentRate = upd.recentRate;
          if (upd.lastPrefix) col.lastPrefix = upd.lastPrefix;
          if (upd.lastAsn) col.lastAsn = upd.lastAsn;
          if (upd.lastPulseAt) col.lastPulseAt = upd.lastPulseAt;
        }
      }

      if (Array.isArray(msg.pulses) && msg.pulses.length > 0) {
        for (let i = 0; i < msg.pulses.length; i++) {
          const p = msg.pulses[i];
          const col = this._bgpCollectorByHost.get(p.host);
          if (!col) continue;
          this._recordBgpPulse(col, p);
          this.onBgpPulse?.(col, {
            isWithdraw: p.isWithdraw,
            prefix: p.prefix,
            asn: p.asn,
          });
        }
      }

      if (msg.sampleLog && now - this._lastBgpLogAt > 7500) {
        const col = this._bgpCollectorByHost.get(msg.sampleLog.host);
        if (col && msg.sampleLog.prefix) {
          this._lastBgpLogAt = now;
          const action = msg.sampleLog.isWithdraw ? 'WITHDRAWAL' : 'ANNOUNCE';
          this.onLog?.(
            msg.sampleLog.isWithdraw ? 'WARN' : 'SIG',
            `RIPE BGP ${action} [${col.code} ${col.city}]: ${msg.sampleLog.asn} → ${msg.sampleLog.prefix} (${this.data.bgpRate || 12} updates/s).`
          );
        }
      }

      if (now - this._lastBgpHistoryAt >= 2000) {
        this._lastBgpHistoryAt = now;
        this.data.bgpHistory.shift();
        this.data.bgpHistory.push(this.data.bgpRate);
        if (this.status.bgp.state === 'live') {
          this.status.bgp.count = this.data.bgpRate;
          this.status.bgp.updatedAt = new Date();
          this.onUpdate?.('bgp');
        }
      }
    }
  }

  _recordBgpPulse(col, { isWithdraw, prefix, asn, ts }) {
    const rrc00 = this._bgpCollectorByHost.get('rrc00.ripe.net');
    const rrc01 = this._bgpCollectorByHost.get('rrc01.ripe.net');
    let target = null;
    if (this._lastBgpPulseCollector && this._lastBgpPulseCollector.host !== col.host) {
      target = this._lastBgpPulseCollector;
    } else if (col.host !== 'rrc00.ripe.net' && rrc00) {
      target = rrc00;
    } else if (rrc01) {
      target = rrc01;
    }
    this._lastBgpPulseCollector = col;

    const toLat = target ? target.lat : 52.3676;
    const toLon = target ? target.lon : 4.9041;

    this.data.bgpPulses.push({
      id: `bgp-pulse-${++this._bgpPulseSeq}`,
      host: col.host,
      code: col.code,
      city: col.city,
      lat: col.lat,
      lon: col.lon,
      toLat,
      toLon,
      prefix: prefix || '',
      asn: asn || 'AS?',
      isWithdraw: Boolean(isWithdraw),
      ts: ts || Date.now(),
    });
    if (this.data.bgpPulses.length > 24) {
      this.data.bgpPulses.splice(0, this.data.bgpPulses.length - 24);
    }
  }

  _handleVisibilityChange() {
    if (this._isDocumentHidden()) {
      for (const t of this._visibilityRefreshTimers) clearTimeout(t);
      this._visibilityRefreshTimers = [];
      if (this._worker) {
        this._worker.postMessage({ type: 'sats:enable', enabled: false });
      }
      return;
    }

    if (this._worker && this.enabled.liveSats) {
      this._worker.postMessage({ type: 'sats:enable', enabled: true });
    }

    // Softly stagger refresh of stale HTTP feeds on tab return
    const now = Date.now();
    const staleChecks = [
      ['aircraft', POLL_CADENCE_MS.aircraft],
      ['wiki', POLL_CADENCE_MS.wiki],
      ['solar', POLL_CADENCE_MS.solar],
      ['quakes', POLL_CADENCE_MS.quakes],
      ['eonet', POLL_CADENCE_MS.eonet],
      ['gdacs', POLL_CADENCE_MS.gdacs],
      ['meteo', POLL_CADENCE_MS.meteo],
    ];

    let delay = 0;
    for (const [key, maxAge] of staleChecks) {
      if (!this.enabled[key]) continue;
      const updatedAt = this.status[key]?.updatedAt;
      const age = updatedAt ? now - updatedAt.getTime() : Infinity;
      if (age >= maxAge) {
        const timer = setTimeout(() => {
          if (!this._isDocumentHidden() && this.enabled[key]) {
            this.refreshFeed(key);
          }
        }, delay);
        this._visibilityRefreshTimers.push(timer);
        delay += 150;
      }
    }

    if (this.enabled.liveSats) {
      const satUpdatedAt = this.status.liveSats?.updatedAt;
      if (!satUpdatedAt || now - satUpdatedAt.getTime() >= POLL_CADENCE_MS.issHeartbeat) {
        const timer = setTimeout(() => {
          if (!this._isDocumentHidden() && this.enabled.liveSats) {
            this.fetchIssTelemetry();
          }
        }, delay);
        this._visibilityRefreshTimers.push(timer);
      }
    }
  }

  start() {
    this.stopTimers();
    this.refreshAll();

    if (typeof document !== 'undefined' && !this._visibilityBound) {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
      this._visibilityBound = true;
    }

    // Polling cadences respectful of free public APIs (skip ticks while tab is hidden)
    this.timers.aircraft = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.aircraft) this.fetchAircraft();
    }, POLL_CADENCE_MS.aircraft);

    this.timers.quakes = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.quakes) this.fetchQuakes();
    }, POLL_CADENCE_MS.quakes);

    this.timers.eonet = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.eonet) this.fetchEonet();
    }, POLL_CADENCE_MS.eonet);

    this.timers.solar = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.solar) this.fetchSolar();
    }, POLL_CADENCE_MS.solar);

    this.timers.gdacs = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.gdacs) this.fetchGdacs();
    }, POLL_CADENCE_MS.gdacs);

    this.timers.meteo = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.meteo) this.fetchMeteo();
    }, POLL_CADENCE_MS.meteo);

    this.timers.wiki = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.wiki) this.fetchWiki();
    }, POLL_CADENCE_MS.wiki);

    this.timers.issHeartbeat = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.liveSats) this.fetchIssTelemetry();
    }, POLL_CADENCE_MS.issHeartbeat);

    // Fallback rolling BGP rate timer (only active when running without Web Worker)
    this.timers.bgpRate = setInterval(() => {
      if (this._worker) return;
      if (!this.enabled.bgp) {
        this.data.bgpRate = 0;
        this.data.bgpWithdrawRate = 0;
        return;
      }
      this.data.bgpRate = Math.round(this._bgpWindowCount / 2);
      this.data.bgpWithdrawRate = Math.round(this._bgpWithdrawWindowCount / 2);
      this._bgpWindowCount = 0;
      this._bgpWithdrawWindowCount = 0;
      this.data.bgpHistory.shift();
      this.data.bgpHistory.push(this.data.bgpRate);
      for (const c of this.data.bgpCollectors) {
        c.recentRate = c.windowCount / 2;
        c.windowCount = 0;
      }
      if (this.status.bgp.state === 'live') {
        this.status.bgp.count = this.data.bgpRate;
        this.onUpdate?.('bgp');
      }
    }, 2000);
  }

  stopTimers() {
    for (const key of Object.keys(this.timers)) {
      clearInterval(this.timers[key]);
      delete this.timers[key];
    }
    for (const t of this._visibilityRefreshTimers) clearTimeout(t);
    this._visibilityRefreshTimers = [];
  }

  destroy() {
    this.stopTimers();
    if (typeof document !== 'undefined' && this._visibilityBound) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      this._visibilityBound = false;
    }
    this.disconnectBgp();
    this._teardownWorker();
  }

  setEnabled(feedKey, flag) {
    if (!(feedKey in this.enabled)) return;
    this.enabled[feedKey] = Boolean(flag);
    if (feedKey === 'bgp') {
      if (this.enabled.bgp) this.connectBgp();
      else this.disconnectBgp();
    } else if (feedKey === 'liveSats') {
      if (this._worker) {
        this._worker.postMessage({
          type: 'sats:enable',
          enabled: this.enabled.liveSats && !this._isDocumentHidden(),
        });
      }
      if (this.enabled.liveSats && this.status.liveSats.state !== 'live') {
        this.fetchLiveSats();
      }
    } else if (this.enabled[feedKey] && this.status[feedKey].state !== 'live') {
      this.refreshFeed(feedKey);
    }
    this.onUpdate?.(feedKey);
  }

  refreshFeed(feedKey) {
    if (feedKey === 'liveSats') return this.fetchLiveSats();
    if (feedKey === 'quakes') return this.fetchQuakes();
    if (feedKey === 'eonet') return this.fetchEonet();
    if (feedKey === 'aircraft') return this.fetchAircraft();
    if (feedKey === 'solar') return this.fetchSolar();
    if (feedKey === 'bgp') return this.connectBgp();
    if (feedKey === 'gdacs') return this.fetchGdacs();
    if (feedKey === 'meteo') return this.fetchMeteo();
    if (feedKey === 'wiki') return this.fetchWiki();
  }

  refreshAll() {
    if (this.enabled.liveSats) this.fetchLiveSats();
    if (this.enabled.quakes) this.fetchQuakes();
    if (this.enabled.eonet) this.fetchEonet();
    if (this.enabled.aircraft) this.fetchAircraft();
    if (this.enabled.solar) this.fetchSolar();
    if (this.enabled.bgp) this.connectBgp();
    if (this.enabled.gdacs) this.fetchGdacs();
    if (this.enabled.meteo) this.fetchMeteo();
    if (this.enabled.wiki) this.fetchWiki();
  }

  // --------------------------------------------------------------------------
  // 1. REAL ORBITAL SATELLITES (CELESTRAK OMM + WHERETHEISS.AT + SGP4 WORKER)
  // --------------------------------------------------------------------------
  async fetchLiveSats() {
    this.status.liveSats.state = 'loading';
    this.onUpdate?.('liveSats');
    try {
      const [stationsRes, visualRes, issRes] = await Promise.allSettled([
        fetchJsonWithFallback(
          '/live-api/celestrak/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
          'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json'
        ),
        fetchJsonWithFallback(
          '/live-api/celestrak/NORAD/elements/gp.php?GROUP=visual&FORMAT=json',
          'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json'
        ),
        fetchJsonWithFallback(
          '/live-api/iss/v1/satellites/25544',
          'https://api.wheretheiss.at/v1/satellites/25544'
        ),
      ]);

      const ommPool = [];
      if (stationsRes.status === 'fulfilled' && Array.isArray(stationsRes.value)) {
        ommPool.push(...stationsRes.value);
      }
      if (visualRes.status === 'fulfilled' && Array.isArray(visualRes.value)) {
        ommPool.push(...visualRes.value);
      }

      const issDirect = issRes.status === 'fulfilled' ? issRes.value : null;

      // Pick curated iconic real spacecraft (deduplicated by NORAD_CAT_ID)
      const picked = [];
      const workerRecords = [];
      const seen = new Set();
      const nowDate = new Date();
      const nowMs = nowDate.getTime();

      const addOmm = (omm) => {
        if (!omm || seen.has(omm.NORAD_CAT_ID)) return;
        try {
          const satrec = json2satrec(omm);
          const pos = this._propagateAt(satrec, nowDate);
          if (!pos) return;
          seen.add(omm.NORAD_CAT_ID);
          const id = `live-sat-${omm.NORAD_CAT_ID}`;
          const altKm = Math.round(pos.altKm);
          const footprintDeg = Math.max(
            10,
            Math.min(28, Math.round(Math.acos(6371 / (6371 + Math.max(200, altKm))) * (180 / Math.PI) * 0.72))
          );
          picked.push({
            id,
            name: omm.OBJECT_NAME.trim(),
            noradId: omm.NORAD_CAT_ID,
            objectId: omm.OBJECT_ID || '',
            satrec,
            lat: pos.lat,
            lon: pos.lon,
            prevLat: pos.lat,
            prevLon: pos.lon,
            targetLat: pos.lat,
            targetLon: pos.lon,
            lastPropMs: nowMs,
            altKm,
            velKms: pos.velKms,
            inclination: Number(omm.INCLINATION || 51.6),
            footprintDeg,
            orbit: `${altKm > 1200 ? 'MEO' : 'LEO'} // ${altKm} KM`,
            mission: omm.OBJECT_NAME.includes('ISS')
              ? 'CREWED ORBITAL LABORATORY (LIVE NORAD)'
              : omm.OBJECT_NAME.includes('CSS')
              ? 'TIANGONG ORBITAL STATION (LIVE NORAD)'
              : omm.OBJECT_NAME.includes('HST')
              ? 'HUBBLE SPACE TELESCOPE (LIVE NORAD)'
              : 'LIVE EARTH OBSERVATION / TRACKED SPACECRAFT',
            lock: 98,
            isLive: true,
            track: [],
          });
          workerRecords.push({ id, noradId: omm.NORAD_CAT_ID, omm });
        } catch {
          // skip malformed record
        }
      };

      for (const pref of PREFERRED_SATS) {
        const match = ommPool.find((o) => o.OBJECT_NAME?.trim().toUpperCase() === pref);
        if (match) addOmm(match);
        if (picked.length >= 8) break;
      }
      // Fill up to 7 if some preferred names weren't present
      for (const omm of ommPool) {
        if (picked.length >= 7) break;
        if (omm.OBJECT_NAME && !omm.OBJECT_NAME.includes('DEB')) addOmm(omm);
      }

      // If CelesTrak failed but wheretheiss.at succeeded, still display real live ISS!
      if (picked.length === 0 && issDirect && Number.isFinite(issDirect.latitude)) {
        picked.push({
          id: 'live-sat-25544',
          name: 'ISS (ZARYA)',
          noradId: 25544,
          satrec: null,
          lat: issDirect.latitude,
          lon: issDirect.longitude,
          prevLat: issDirect.latitude,
          prevLon: issDirect.longitude,
          targetLat: issDirect.latitude,
          targetLon: issDirect.longitude,
          lastPropMs: nowMs,
          altKm: Math.round(issDirect.altitude || 420),
          velKms: Number(((issDirect.velocity || 27600) / 3600).toFixed(2)),
          inclination: 51.6,
          footprintDeg: 19,
          orbit: `LEO // ${Math.round(issDirect.altitude || 420)} KM`,
          mission: `CREWED ORBITAL LAB • VISIBILITY: ${(issDirect.visibility || 'DAYLIGHT').toUpperCase()}`,
          lock: 99,
          isLive: true,
          track: [],
        });
      } else if (issDirect) {
        const issEntry = picked.find((s) => s.noradId === 25544);
        if (issEntry) {
          issEntry.visibility = (issDirect.visibility || 'daylight').toUpperCase();
        }
      }

      if (picked.length === 0) throw new Error('No orbital elements returned');

      this.data.liveSats = picked;
      this._satById = new Map(picked.map((s) => [s.id, s]));

      if (this._worker && workerRecords.length > 0) {
        this._worker.postMessage({ type: 'sats:init', records: workerRecords });
        this._worker.postMessage({
          type: 'sats:enable',
          enabled: this.enabled.liveSats && !this._isDocumentHidden(),
        });
      } else {
        this.rebuildSatelliteTracks(nowDate);
      }

      this.status.liveSats = { state: 'live', count: picked.length, updatedAt: new Date(), error: null };
      const iss = picked.find((s) => s.noradId === 25544) || picked[0];
      this.onLog?.(
        'SAT',
        `LIVE NORAD ORBITALS SYNCED (${picked.length} SPACECRAFT): ${iss.name} @ ${iss.lat.toFixed(1)}°, ${iss.lon.toFixed(1)}° (${iss.altKm} km, ${iss.velKms} km/s).`
      );
    } catch (err) {
      this.status.liveSats = { state: 'error', count: this.data.liveSats.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `ORBITAL FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('liveSats');
  }

  async fetchIssTelemetry() {
    try {
      const d = await fetchJsonWithFallback(
        '/live-api/iss/v1/satellites/25544',
        'https://api.wheretheiss.at/v1/satellites/25544'
      );
      const iss = this.data.liveSats.find((s) => s.noradId === 25544);
      if (iss && Number.isFinite(d?.latitude)) {
        iss.visibility = (d.visibility || 'daylight').toUpperCase();
        if (!iss.satrec) {
          iss.prevLat = iss.lat;
          iss.prevLon = iss.lon;
          iss.targetLat = d.latitude;
          iss.targetLon = d.longitude;
          iss.lat = d.latitude;
          iss.lon = d.longitude;
          iss.lastPropMs = Date.now();
          iss.altKm = Math.round(d.altitude || 420);
        }
      }
    } catch {
      // silent heartbeat failure
    }
  }

  _propagateAt(satrec, date) {
    const pv = propagate(satrec, date);
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
    const gmst = gstime(date);
    const gd = eciToGeodetic(pv.position, gmst);
    const lat = degreesLat(gd.latitude);
    const lon = degreesLong(gd.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    let velKms = 7.66;
    if (pv.velocity && typeof pv.velocity !== 'boolean') {
      velKms = Number(Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z).toFixed(2));
    }
    return { lat, lon, altKm: gd.height, velKms };
  }

  rebuildSatelliteTracks(now = new Date()) {
    this._lastTrackRebuild = now.getTime();
    for (const sat of this.data.liveSats) {
      if (!sat.satrec) continue;
      const pts = [];
      // -24 minutes to +66 minutes in 2-minute steps (~1 full LEO orbit)
      for (let m = -24; m <= 66; m += 2) {
        const t = new Date(now.getTime() + m * 60000);
        const p = this._propagateAt(sat.satrec, t);
        if (p) pts.push([p.lon, p.lat]);
      }
      sat.track = pts;
    }
  }

  // Called smoothly from the animation loop to interpolate worker satellites & dead-reckon aircraft
  stepRealtime(nowMs = Date.now()) {
    // 1. Live satellites: zero-SGP4 smooth interpolation between 500ms worker ticks (or fallback)
    if (this.enabled.liveSats && this.data.liveSats.length > 0) {
      if (this._worker) {
        for (let i = 0; i < this.data.liveSats.length; i++) {
          const sat = this.data.liveSats[i];
          if (!Number.isFinite(sat.targetLat) || !Number.isFinite(sat.targetLon)) continue;
          const alpha = Math.min(1, Math.max(0, (nowMs - (sat.lastPropMs || nowMs)) / SAT_WORKER_TICK_MS));
          const dLat = sat.targetLat - sat.prevLat;
          const dLon = ((sat.targetLon - sat.prevLon + 540) % 360) - 180;
          sat.lat = sat.prevLat + dLat * alpha;
          sat.lon = ((sat.prevLon + dLon * alpha + 540) % 360) - 180;
        }
      } else {
        const nowDate = new Date(nowMs);
        for (const sat of this.data.liveSats) {
          if (!sat.satrec) continue;
          const p = this._propagateAt(sat.satrec, nowDate);
          if (p) {
            sat.lat = p.lat;
            sat.lon = p.lon;
            sat.altKm = Math.round(p.altKm);
            sat.velKms = p.velKms;
          }
        }
        if (nowMs - this._lastTrackRebuild > 45000) {
          this.rebuildSatelliteTracks(nowDate);
        }
      }
    }

    // 2. Smoothly dead-reckon live ADS-B aircraft between 18s API refreshes
    if (this.enabled.aircraft && this.data.aircraft.length > 0) {
      for (const ac of this.data.aircraft) {
        if (!ac.gsKts || ac.trackDeg === null) continue;
        const elapsedSec = Math.min(25, Math.max(0, (nowMs - ac.fetchedAt) / 1000));
        // 1 knot = 0.000514444 km/s; 1 deg lat ~= 111.32 km
        const distDeg = (ac.gsKts * 0.000514444 * elapsedSec) / 111.32;
        const rad = (ac.trackDeg * Math.PI) / 180;
        const dLat = Math.cos(rad) * distDeg;
        const cosLat = Math.max(0.2, Math.cos((ac.baseLat * Math.PI) / 180));
        const dLon = (Math.sin(rad) * distDeg) / cosLat;
        ac.lat = Math.max(-85, Math.min(85, ac.baseLat + dLat));
        ac.lon = ((ac.baseLon + dLon + 540) % 360) - 180;
      }
    }
  }

  // --------------------------------------------------------------------------
  // 2. USGS LIVE EARTHQUAKES (M2.5+ PAST 24 HOURS)
  // --------------------------------------------------------------------------
  async fetchQuakes() {
    this.status.quakes.state = 'loading';
    this.onUpdate?.('quakes');
    try {
      const geo = await fetchJsonWithFallback(
        '/live-api/usgs/earthquakes/feed/v1.0/summary/2.5_day.geojson',
        'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson'
      );
      const features = Array.isArray(geo?.features) ? geo.features : [];

      const quakes = features
        .filter((f) => f.geometry?.coordinates && Number.isFinite(f.properties?.mag))
        .map((f) => {
          const [lon, lat, depth] = f.geometry.coordinates;
          const mag = Number(f.properties.mag);
          return {
            id: f.id,
            mag,
            place: f.properties.place || 'Unknown Region',
            title: f.properties.title || `M ${mag.toFixed(1)} Earthquake`,
            depthKm: Number((depth || 0).toFixed(1)),
            time: f.properties.time || Date.now(),
            tsunami: Boolean(f.properties.tsunami),
            url: f.properties.url || '',
            lat,
            lon,
            severity: mag >= 5.0 ? 'CRITICAL' : mag >= 4.0 ? 'WARNING' : 'ALLIED',
          };
        })
        .sort((a, b) => b.mag - a.mag)
        .slice(0, 75);

      this.data.quakes = quakes;
      this.status.quakes = { state: 'live', count: quakes.length, updatedAt: new Date(), error: null };

      if (quakes.length > 0) {
        const top = quakes[0];
        this.onLog?.(
          top.mag >= 5.0 ? 'CRIT' : 'WARN',
          `USGS SEISMIC LIVE (${quakes.length} EVENTS M2.5+): Peak M${top.mag.toFixed(1)} — ${top.place} (Depth ${top.depthKm} km).`
        );
      }
    } catch (err) {
      this.status.quakes = { state: 'error', count: this.data.quakes.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `USGS SEISMIC FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('quakes');
  }

  // --------------------------------------------------------------------------
  // 3. NASA EONET LIVE GLOBAL NATURAL EVENTS
  // --------------------------------------------------------------------------
  async fetchEonet() {
    this.status.eonet.state = 'loading';
    this.onUpdate?.('eonet');
    try {
      const json = await fetchJsonWithFallback(
        '/live-api/eonet/api/v3/events?status=open&limit=40',
        'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=40'
      );
      const raw = Array.isArray(json?.events) ? json.events : [];

      const events = [];
      for (const ev of raw) {
        const geom = Array.isArray(ev.geometry) ? ev.geometry[ev.geometry.length - 1] : null;
        if (!geom || geom.type !== 'Point' || !Array.isArray(geom.coordinates)) continue;
        const [lon, lat] = geom.coordinates;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const cat = ev.categories?.[0] || { id: 'other', title: 'Natural Event' };
        events.push({
          id: ev.id,
          title: ev.title,
          categoryId: cat.id,
          categoryTitle: cat.title.toUpperCase(),
          date: geom.date || '',
          lat,
          lon,
          source: ev.sources?.[0]?.id || 'NASA-EONET',
          sourceUrl: ev.sources?.[0]?.url || '',
        });
      }

      this.data.eonet = events;
      this.status.eonet = { state: 'live', count: events.length, updatedAt: new Date(), error: null };
      if (events.length > 0) {
        const first = events[0];
        this.onLog?.('SIG', `NASA EONET LIVE (${events.length} ACTIVE EVENTS): ${first.categoryTitle} — ${first.title}.`);
      }
    } catch (err) {
      this.status.eonet = { state: 'error', count: this.data.eonet.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `NASA EONET FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('eonet');
  }

  // --------------------------------------------------------------------------
  // 4. ADSB.LOL LIVE GLOBAL MILITARY / TACTICAL AIRCRAFT (WITH FLIGHT TRAILS)
  // --------------------------------------------------------------------------
  async fetchAircraft() {
    this.status.aircraft.state = 'loading';
    this.onUpdate?.('aircraft');
    try {
      const json = await fetchJsonWithFallback('/live-api/adsb/v2/mil', null);
      const raw = Array.isArray(json?.ac) ? json.ac : [];
      const fetchedAt = Date.now();

      const prevByHex = new Map();
      for (const prev of this.data.aircraft) {
        if (prev.hex) prevByHex.set(prev.hex, prev);
      }

      const planes = raw
        .filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
        .slice(0, 140)
        .map((a) => {
          const hex = (a.hex || '').toUpperCase();
          const prev = hex ? prevByHex.get(hex) : null;
          const trail = prev && Array.isArray(prev.trail) ? prev.trail.slice(-14) : [];
          const lastPt = trail[trail.length - 1];
          if (!lastPt) {
            trail.push([a.lon, a.lat]);
          } else {
            const dLon = ((a.lon - lastPt[0] + 540) % 360) - 180;
            const dLat = a.lat - lastPt[1];
            if (Math.hypot(dLon, dLat) > 0.02) {
              trail.push([a.lon, a.lat]);
              if (trail.length > 14) trail.shift();
            }
          }

          return {
            id: `ac-${a.hex}`,
            hex,
            callsign: (a.flight || a.r || a.hex || 'UNKN').trim(),
            reg: (a.r || 'N/A').trim(),
            type: (a.t || 'MIL').trim(),
            altFt: typeof a.alt_baro === 'number' ? a.alt_baro : typeof a.alt_geom === 'number' ? a.alt_geom : 0,
            gsKts: typeof a.gs === 'number' ? Math.round(a.gs) : 0,
            trackDeg: typeof a.track === 'number' ? a.track : null,
            squawk: a.squawk || '----',
            emergency: a.emergency && a.emergency !== 'none' ? a.emergency.toUpperCase() : null,
            lat: a.lat,
            lon: a.lon,
            baseLat: a.lat,
            baseLon: a.lon,
            fetchedAt,
            trail,
          };
        });

      const firstLoad = this.status.aircraft.updatedAt === null;
      this.data.aircraft = planes;
      this.status.aircraft = { state: 'live', count: planes.length, updatedAt: new Date(), error: null };

      if (firstLoad && planes.length > 0) {
        const sample = planes.find((p) => p.altFt > 10000) || planes[0];
        this.onLog?.(
          'SIG',
          `ADS-B MIL TRANSPONDER FEED LIVE (${planes.length} AIRCRAFT): Tracking ${sample.callsign} [${sample.type}] FL${Math.round(sample.altFt / 100)} @ ${sample.gsKts} kts.`
        );
      }
    } catch (err) {
      this.status.aircraft = { state: 'error', count: this.data.aircraft.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `ADS-B AIRCRAFT FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('aircraft');
  }

  // --------------------------------------------------------------------------
  // 5. NOAA SPACE WEATHER (KP INDEX + GOES X-RAY FLUX + GOES MAGNETOMETER)
  // --------------------------------------------------------------------------
  _fluxToFlareClass(flux) {
    if (!Number.isFinite(flux) || flux <= 0) return 'A0.0';
    if (flux >= 1e-4) return `X${(flux / 1e-4).toFixed(1)}`;
    if (flux >= 1e-5) return `M${(flux / 1e-5).toFixed(1)}`;
    if (flux >= 1e-6) return `C${(flux / 1e-6).toFixed(1)}`;
    if (flux >= 1e-7) return `B${(flux / 1e-7).toFixed(1)}`;
    return `A${Math.max(1.0, flux / 1e-8).toFixed(1)}`;
  }

  _downsample(arr, targetLen = 48) {
    if (arr.length <= targetLen) return arr;
    const out = [];
    const step = arr.length / targetLen;
    for (let i = 0; i < targetLen; i++) {
      const start = Math.floor(i * step);
      const end = Math.max(start + 1, Math.floor((i + 1) * step));
      // Use peak value per bucket for X-ray/mag telemetry so flares aren't smoothed away
      let best = arr[start];
      for (let j = start + 1; j < end && j < arr.length; j++) {
        if (Math.abs(arr[j]) > Math.abs(best)) best = arr[j];
      }
      out.push(best);
    }
    return out;
  }

  async fetchSolar() {
    this.status.solar.state = 'loading';
    this.onUpdate?.('solar');
    try {
      const [kpRes, xrayRes, magRes] = await Promise.allSettled([
        fetchJsonWithFallback(
          '/live-api/noaa/products/noaa-planetary-k-index.json',
          'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'
        ),
        fetchJsonWithFallback(
          '/live-api/noaa/json/goes/primary/xrays-6-hour.json',
          'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json'
        ),
        fetchJsonWithFallback(
          '/live-api/noaa/json/goes/primary/magnetometers-6-hour.json',
          'https://services.swpc.noaa.gov/json/goes/primary/magnetometers-6-hour.json'
        ),
      ]);

      // 1. Planetary K-Index
      if (kpRes.status === 'fulfilled' && Array.isArray(kpRes.value) && kpRes.value.length > 0) {
        const arr = kpRes.value;
        const latest = arr[arr.length - 1];
        const kp = Number(typeof latest === 'object' && !Array.isArray(latest) ? latest.Kp : latest[1]);
        const aRunning = Number(typeof latest === 'object' && !Array.isArray(latest) ? latest.a_running : latest[2]) || 0;
        const timeTag = (typeof latest === 'object' && !Array.isArray(latest) ? latest.time_tag : latest[0]) || '';
        const scaleInfo = kpToScale(kp);
        this.data.solar = {
          kp: Number.isFinite(kp) ? kp : 0,
          aRunning,
          timeTag,
          ...scaleInfo,
        };
      }

      // 2. GOES Primary X-Ray Flux (0.1-0.8nm long + 0.05-0.4nm short, past 6h)
      let xrayLong = [];
      let xrayShort = [];
      let xraySat = 18;
      let latestFlux = 0;
      let flareClass = 'A0.0';
      let goesTime = '';

      if (xrayRes.status === 'fulfilled' && Array.isArray(xrayRes.value) && xrayRes.value.length > 0) {
        const xArr = xrayRes.value;
        const longRaw = [];
        const shortRaw = [];
        for (const row of xArr) {
          if (typeof row.flux !== 'number' || row.flux <= 0) continue;
          if (row.energy === '0.1-0.8nm') {
            longRaw.push(row.flux);
            xraySat = row.satellite || xraySat;
            goesTime = row.time_tag || goesTime;
          } else if (row.energy === '0.05-0.4nm') {
            shortRaw.push(row.flux);
          }
        }
        if (longRaw.length > 0) {
          latestFlux = longRaw[longRaw.length - 1];
          flareClass = this._fluxToFlareClass(latestFlux);
          xrayLong = this._downsample(longRaw, 42);
          xrayShort = this._downsample(shortRaw, 42);
        }
      }

      // 3. GOES Primary Magnetometer (Hp parallel + Total B field in nT, past 6h)
      let magHp = [];
      let magTotal = [];
      let magSat = 19;
      let latestHp = 0;
      let latestTotal = 0;

      if (magRes.status === 'fulfilled' && Array.isArray(magRes.value) && magRes.value.length > 0) {
        const mArr = magRes.value;
        const hpRaw = [];
        const totRaw = [];
        for (const row of mArr) {
          if (typeof row.Hp === 'number') {
            hpRaw.push(row.Hp);
            totRaw.push(typeof row.total === 'number' ? row.total : Math.abs(row.Hp));
            magSat = row.satellite || magSat;
            if (!goesTime && row.time_tag) goesTime = row.time_tag;
          }
        }
        if (hpRaw.length > 0) {
          latestHp = hpRaw[hpRaw.length - 1];
          latestTotal = totRaw[totRaw.length - 1];
          magHp = this._downsample(hpRaw, 72);
          magTotal = this._downsample(totRaw, 72);
        }
      }

      if (xrayLong.length > 0 || magHp.length > 0) {
        this.data.goes = {
          xraySat,
          magSat,
          flareClass,
          latestFlux,
          xrayLong,
          xrayShort,
          magHp,
          magTotal,
          latestHp,
          latestTotal,
          timeTag: goesTime,
        };
      }

      if (!this.data.solar && !this.data.goes) throw new Error('No NOAA solar telemetry received');

      const firstLoad = this.status.solar.updatedAt === null;
      this.status.solar = { state: 'live', count: 1, updatedAt: new Date(), error: null };
      if (firstLoad) {
        const kpTxt = this.data.solar ? `Kp ${this.data.solar.kp.toFixed(1)} (${this.data.solar.scale})` : '';
        const goesTxt = this.data.goes
          ? `GOES-${this.data.goes.xraySat} X-RAY ${this.data.goes.flareClass} • GOES-${this.data.goes.magSat} Hp ${this.data.goes.latestHp.toFixed(1)} nT`
          : '';
        this.onLog?.(
          this.data.solar?.severity === 'CRITICAL' ? 'CRIT' : 'SAT',
          `NOAA GOES SPACE WEATHER LIVE: ${[kpTxt, goesTxt].filter(Boolean).join(' // ')}.`
        );
      }
    } catch (err) {
      this.status.solar = { state: 'error', count: 0, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `NOAA SOLAR FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('solar');
  }

  // --------------------------------------------------------------------------
  // 6. RIPE RIS LIVE BGP ROUTING FIREHOSE (OFF-THREAD WORKER + DIRECT FALLBACK)
  // --------------------------------------------------------------------------
  _getBgpUrls() {
    const urls = [DIRECT_RIPE_WS];
    if (typeof window !== 'undefined' && window.location?.host) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      urls.push(`${proto}//${window.location.host}/live-ws/ripe/v1/ws/?client=aegis-command`);
    }
    return urls;
  }

  connectBgp() {
    this.disconnectBgp();
    if (!this.enabled.bgp) return;
    this.status.bgp.state = 'loading';
    this.onUpdate?.('bgp');

    if (this._worker) {
      this._worker.postMessage({
        type: 'bgp:connect',
        urls: this._getBgpUrls(),
        hosts: Object.keys(RIPE_COLLECTORS),
      });
      return;
    }

    this._connectBgpFallback();
  }

  _connectBgpFallback(urlIdx = 0) {
    if (!this.enabled.bgp) return;
    const urls = this._getBgpUrls();
    const wsUrl = urls[urlIdx] || DIRECT_RIPE_WS;
    let opened = false;
    let handled = false;

    const fail = () => {
      if (handled) return;
      handled = true;
      if (this._bgpWs) {
        const old = this._bgpWs;
        this._bgpWs = null;
        try { old.close(); } catch {}
      }
      if (!this.enabled.bgp) return;
      if (!opened && urlIdx + 1 < urls.length) {
        this._connectBgpFallback(urlIdx + 1);
        return;
      }
      this.status.bgp = { state: 'error', count: 0, updatedAt: null, error: 'WS error' };
      this.onUpdate?.('bgp');
      const delay = Math.min(30000, 2000 * Math.pow(2, this._bgpFallbackAttempt)) + Math.floor(Math.random() * 1000);
      this._bgpFallbackAttempt = Math.min(this._bgpFallbackAttempt + 1, 8);
      this._bgpFallbackReconnectTimer = setTimeout(() => {
        this._bgpFallbackReconnectTimer = null;
        if (this.enabled.bgp && !this._bgpWs) this._connectBgpFallback(0);
      }, delay);
    };

    try {
      const ws = new WebSocket(wsUrl);
      this._bgpWs = ws;

      ws.onopen = () => {
        if (this._bgpWs !== ws) return;
        opened = true;
        this._bgpFallbackAttempt = 0;
        ws.send(JSON.stringify({ type: 'ris_subscribe', data: { type: 'UPDATE' } }));
        this.status.bgp = { state: 'live', count: this.data.bgpRate || 1, updatedAt: new Date(), error: null };
        this.onLog?.('SIG', 'RIPE RIS LIVE BGP WEBSOCKET CONNECTED — MONITORING GLOBAL IXP ROUTE COLLECTORS.');
        this.onUpdate?.('bgp');
      };

      ws.onmessage = (ev) => {
        if (!this.enabled.bgp) return;
        this._bgpWindowCount++;
        try {
          const parsed = JSON.parse(ev.data);
          const d = parsed?.data;
          if (!d || !d.host) return;
          const col = this._bgpCollectorByHost.get(d.host);
          if (!col) return;

          const isWithdraw = Array.isArray(d.withdrawals) && d.withdrawals.length > 0;
          if (isWithdraw) this._bgpWithdrawWindowCount++;
          const prefix = isWithdraw
            ? d.withdrawals[0]
            : d.announcements?.[0]?.prefixes?.[0] || '';
          const asn = d.peer_asn ? `AS${d.peer_asn}` : d.path?.[0] ? `AS${d.path[0]}` : 'AS?';
          const now = Date.now();

          col.msgCount++;
          col.windowCount++;
          col.lastPulseAt = now;
          if (prefix) col.lastPrefix = prefix;
          col.lastAsn = asn;

          if (prefix) {
            this._recordBgpPulse(col, { isWithdraw, prefix, asn, ts: now });
          }
          this.onBgpPulse?.(col, { isWithdraw, prefix, asn });

          if (now - this._lastBgpLogAt > 7500 && prefix) {
            this._lastBgpLogAt = now;
            const action = isWithdraw ? 'WITHDRAWAL' : 'ANNOUNCE';
            this.onLog?.(
              isWithdraw ? 'WARN' : 'SIG',
              `RIPE BGP ${action} [${col.code} ${col.city}]: ${asn} → ${prefix} (${this.data.bgpRate || 12} updates/s).`
            );
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onerror = () => {
        if (this._bgpWs === ws && !opened) fail();
      };

      ws.onclose = () => {
        if (this._bgpWs === ws) fail();
      };
    } catch (err) {
      this.status.bgp = { state: 'error', count: 0, updatedAt: null, error: err.message };
      this.onUpdate?.('bgp');
    }
  }

  disconnectBgp() {
    if (this._worker) {
      this._worker.postMessage({ type: 'bgp:disconnect' });
    }
    if (this._bgpFallbackReconnectTimer !== null) {
      clearTimeout(this._bgpFallbackReconnectTimer);
      this._bgpFallbackReconnectTimer = null;
    }
    if (this._bgpWs) {
      const old = this._bgpWs;
      this._bgpWs = null;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      try { old.close(); } catch {}
    }
    this.data.bgpRate = 0;
    this.data.bgpWithdrawRate = 0;
  }

  // --------------------------------------------------------------------------
  // 7. UN / EU GDACS GLOBAL DISASTER & CRISIS ALERTS (GEOJSON)
  // --------------------------------------------------------------------------
  async fetchGdacs() {
    this.status.gdacs.state = 'loading';
    this.onUpdate?.('gdacs');
    try {
      const geo = await fetchJsonWithFallback(
        '/live-api/gdacs/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=Green;Orange;Red',
        null
      );
      const features = Array.isArray(geo?.features) ? geo.features : [];

      const typeNames = {
        TC: 'TROPICAL CYCLONE',
        FL: 'FLOOD ALERT',
        EQ: 'MAJOR SEISMIC',
        VO: 'VOLCANIC ACTIVITY',
        DR: 'DROUGHT CRISIS',
        WF: 'WILDFIRE ALERT',
      };
      const rank = { Red: 3, Orange: 2, Green: 1 };

      const events = features
        .filter((f) => f.geometry?.coordinates && f.properties)
        .map((f) => {
          const p = f.properties;
          const [lon, lat] = f.geometry.coordinates;
          return {
            id: `gdacs-${p.eventtype}-${p.eventid}`,
            eventId: p.eventid != null ? String(p.eventid) : '',
            eventType: p.eventtype || 'AL',
            typeLabel: typeNames[p.eventtype] || 'GLOBAL ALERT',
            name: p.name || p.description || 'GDACS Crisis Event',
            alertLevel: p.alertlevel || 'Green',
            country: p.country || 'International Waters',
            severityText: p.severitydata?.severitytext || p.htmldescription || '',
            source: p.source || 'UN-GDACS',
            reportUrl: p.url?.report || '',
            isCurrent: p.iscurrent === 'true' || p.iscurrent === true,
            fromDate: p.fromdate || '',
            lat,
            lon,
          };
        })
        .sort((a, b) => (b.isCurrent - a.isCurrent) || ((rank[b.alertLevel] || 0) - (rank[a.alertLevel] || 0)))
        .slice(0, 40);

      this.data.gdacs = events;
      this.status.gdacs = { state: 'live', count: events.length, updatedAt: new Date(), error: null };

      if (events.length > 0) {
        const top = events[0];
        this.onLog?.(
          top.alertLevel === 'Red' ? 'CRIT' : top.alertLevel === 'Orange' ? 'WARN' : 'SIG',
          `UN GDACS LIVE (${events.length} ALERTS): [${top.alertLevel.toUpperCase()}] ${top.name} — ${top.country}.`
        );
      }
    } catch (err) {
      this.status.gdacs = { state: 'error', count: this.data.gdacs.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `GDACS CRISIS FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('gdacs');
  }

  // --------------------------------------------------------------------------
  // 8. OPEN-METEO LIVE GLOBAL ATMOSPHERIC & WIND TELEMETRY
  // --------------------------------------------------------------------------
  async fetchMeteo() {
    this.status.meteo.state = 'loading';
    this.onUpdate?.('meteo');
    try {
      const lats = METEO_STATIONS.map((s) => s.lat).join(',');
      const lons = METEO_STATIONS.map((s) => s.lon).join(',');
      const qs = `latitude=${lats}&longitude=${lons}&current=temperature_2m,wind_speed_10m,wind_direction_10m,surface_pressure,weather_code`;
      const payload = await fetchJsonWithFallback(
        `/live-api/meteo/v1/forecast?${qs}`,
        `https://api.open-meteo.com/v1/forecast?${qs}`
      );
      const arr = Array.isArray(payload) ? payload : [payload];

      const stations = METEO_STATIONS.map((st, idx) => {
        const cur = arr[idx]?.current || {};
        return {
          ...st,
          tempC: Number((cur.temperature_2m ?? 0).toFixed(1)),
          windKmh: Math.round(cur.wind_speed_10m ?? 0),
          windDir: Math.round(cur.wind_direction_10m ?? 0),
          pressureHpa: Math.round(cur.surface_pressure ?? 1013),
          weatherCode: cur.weather_code ?? 0,
          condition: wmoCodeToText(cur.weather_code ?? 0),
        };
      });

      this.data.meteo = stations;
      this.status.meteo = { state: 'live', count: stations.length, updatedAt: new Date(), error: null };
      const windiest = [...stations].sort((a, b) => b.windKmh - a.windKmh)[0];
      if (windiest) {
        this.onLog?.(
          'SIG',
          `OPEN-METEO ATMOSPHERIC LIVE (${stations.length} HUBS): Peak wind ${windiest.windKmh} km/h @ ${windiest.name} (${windiest.tempC}°C, ${windiest.condition}).`
        );
      }
    } catch (err) {
      this.status.meteo = { state: 'error', count: this.data.meteo.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `OPEN-METEO FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('meteo');
  }

  async fetchPointWeather(lat, lon) {
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const cached = this._pointWeatherCache.get(key);
    if (cached && Date.now() - cached.ts < 300000) return cached.data;
    try {
      const qs = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=temperature_2m,wind_speed_10m,wind_direction_10m,surface_pressure,weather_code`;
      const json = await fetchJsonWithFallback(
        `/live-api/meteo/v1/forecast?${qs}`,
        `https://api.open-meteo.com/v1/forecast?${qs}`
      );
      const cur = json?.current;
      if (!cur) return null;
      const data = {
        tempC: Number((cur.temperature_2m ?? 0).toFixed(1)),
        windKmh: Math.round(cur.wind_speed_10m ?? 0),
        windDir: Math.round(cur.wind_direction_10m ?? 0),
        pressureHpa: Math.round(cur.surface_pressure ?? 1013),
        condition: wmoCodeToText(cur.weather_code ?? 0),
      };
      this._pointWeatherCache.set(key, { ts: Date.now(), data });
      return data;
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // 9. WIKIPEDIA LIVE MULTI-LANGUAGE GLOBAL EDIT PULSE
  // --------------------------------------------------------------------------
  async fetchWiki() {
    if (this.status.wiki.state === 'idle') {
      this.status.wiki.state = 'loading';
      this.onUpdate?.('wiki');
    }
    try {
      // Polite round-robin across language editions (1 request per tick) to respect Wikimedia rate limits
      this._wikiCursor = ((this._wikiCursor ?? -1) + 1) % this.data.wikiHubs.length;
      const hub = this.data.wikiHubs[this._wikiCursor];
      const baseQs = 'action=query&list=recentchanges&rcnamespace=0&rcshow=!bot&rcprop=ids|title|timestamp|user|sizes&rclimit=6&format=json';
      const proxyUrl = `${hub.proxy}/w/api.php?${baseQs}`;
      const directUrl = `https://${hub.lang.toLowerCase()}.wikipedia.org/w/api.php?${baseQs}&origin=*`;

      const json = await fetchJsonWithFallback(
        proxyUrl,
        directUrl,
        { headers: { 'Api-User-Agent': 'AEGIS-Situation-Room/1.0 (local dashboard)' } },
        {} // omit custom header on direct CORS GET to avoid preflight failure
      );
      const changes = json?.query?.recentchanges || [];

      let newEdits = 0;
      let sampleForLog = null;
      const now = Date.now();

      for (const ch of changes) {
        const uid = `${hub.lang}-${ch.rcid}`;
        if (this._seenWikiIds.has(uid)) continue;
        this._seenWikiIds.add(uid);
        if (this._seenWikiIds.size > 400) {
          const firstKey = this._seenWikiIds.values().next().value;
          this._seenWikiIds.delete(firstKey);
        }
        newEdits++;
        hub.recentCount++;
        hub.lastTitle = ch.title;
        hub.lastUser = ch.user;
        hub.lastPulseAt = now;
        hub.revid = ch.revid || null;
        const delta = (ch.newlen || 0) - (ch.oldlen || 0);
        if (!sampleForLog || Math.abs(delta) > Math.abs(sampleForLog.delta)) {
          sampleForLog = { hub, title: ch.title, user: ch.user, delta, revid: ch.revid || null };
        }
      }

      if (newEdits > 0) {
        this.data.wikiTotal += newEdits;
        this.status.wiki = { state: 'live', count: this.data.wikiTotal, updatedAt: new Date(), error: null };
        if (sampleForLog) {
          const sign = sampleForLog.delta >= 0 ? '+' : '';
          this.onWikiPulse?.(sampleForLog.hub, sampleForLog);
          this.onLog?.(
            'SIG',
            `WIKI PULSE [${sampleForLog.hub.lang}]: "${sampleForLog.title}" (${sign}${sampleForLog.delta}B) by ${sampleForLog.user}.`
          );
        }
      } else if (this.status.wiki.state !== 'live') {
        this.status.wiki = { state: 'live', count: this.data.wikiTotal, updatedAt: new Date(), error: null };
      }
    } catch (err) {
      this.status.wiki = { state: 'error', count: this.data.wikiTotal, updatedAt: null, error: err.message };
    }
    this.onUpdate?.('wiki');
  }

  // --------------------------------------------------------------------------
  // 10. OSINT UI HELPERS: DOSSIER RE-BINDING, LIVE ANOMALIES & THREAT METRICS
  // --------------------------------------------------------------------------
  findLiveItem(kind, id) {
    if (!kind || id == null) return null;
    switch (kind) {
      case 'liveSat':
        return this._satById.get(id) || this.data.liveSats.find((s) => s.id === id) || null;
      case 'quake':
        return this.data.quakes.find((q) => q.id === id) || null;
      case 'eonet':
        return this.data.eonet.find((e) => e.id === id) || null;
      case 'aircraft':
        return this.data.aircraft.find((a) => a.id === id) || null;
      case 'bgp':
        return this._bgpCollectorByHost.get(id) || this.data.bgpCollectors.find((c) => c.id === id) || null;
      case 'gdacs':
        return this.data.gdacs.find((g) => g.id === id) || null;
      case 'meteo':
        return this.data.meteo.find((m) => m.id === id) || null;
      case 'wiki':
        return this.data.wikiHubs.find((w) => w.id === id) || null;
      default:
        return null;
    }
  }

  getLiveAnomalies() {
    const items = [];

    // 1. Emergency ADS-B aircraft (CRITICAL, score 100)
    if (this.enabled.aircraft) {
      for (const ac of this.data.aircraft) {
        const isEmgSquawk = ac.squawk === '7700' || ac.squawk === '7600' || ac.squawk === '7500';
        if (!ac.emergency && !isEmgSquawk) continue;
        items.push({
          kind: 'aircraft',
          id: ac.id,
          badge: 'ADS-B',
          code: ac.squawk !== '----' ? `SQK ${ac.squawk}` : ac.hex,
          title: `${ac.callsign} [${ac.type}]`,
          sub: `FL${Math.round((ac.altFt || 0) / 100)} • ${ac.gsKts} KTS • ${ac.reg}`,
          status: ac.emergency || `SQUAWK ${ac.squawk}`,
          type: 'CRITICAL',
          score: 100,
          lat: ac.lat,
          lon: ac.lon,
          item: ac,
        });
      }
    }

    // 2. UN GDACS Crisis Alerts (Red 92, Orange 74, Green 40)
    if (this.enabled.gdacs) {
      for (const g of this.data.gdacs) {
        const level = g.alertLevel || 'Green';
        const type = level === 'Red' ? 'CRITICAL' : level === 'Orange' ? 'WARNING' : 'ALLIED';
        const score = level === 'Red' ? 92 : level === 'Orange' ? 74 : 40;
        items.push({
          kind: 'gdacs',
          id: g.id,
          badge: 'GDACS',
          code: `${g.eventType}-${level.toUpperCase()}`,
          title: g.name,
          sub: `${g.typeLabel} • ${g.country}`,
          status: `${level.toUpperCase()} ALERT`,
          type,
          score,
          lat: g.lat,
          lon: g.lon,
          item: g,
        });
      }
    }

    // 3. USGS Earthquakes (mag >= 5.0 CRIT, >= 4.0 WARN, >= 3.2 ALLIED; score mag * 15)
    if (this.enabled.quakes) {
      for (const q of this.data.quakes) {
        if (q.mag < 3.2 && !q.tsunami) continue;
        const type = q.mag >= 5.0 || q.tsunami ? 'CRITICAL' : q.mag >= 4.0 ? 'WARNING' : 'ALLIED';
        const score = Number((q.mag * 15).toFixed(1));
        items.push({
          kind: 'quake',
          id: q.id,
          badge: 'USGS',
          code: `M${q.mag.toFixed(1)}`,
          title: q.place,
          sub: `DEPTH ${q.depthKm} KM${q.tsunami ? ' • TSUNAMI' : ''}`,
          status: q.tsunami ? 'TSUNAMI' : `M${q.mag.toFixed(1)} SEISMIC`,
          type,
          score,
          lat: q.lat,
          lon: q.lon,
          item: q,
        });
      }
    }

    // 4. NASA EONET Natural Events (volcanoes 82 CRIT, severeStorms 68 WARN, wildfires/other 60 WARN)
    if (this.enabled.eonet) {
      for (const ev of this.data.eonet) {
        const isVolcano = ev.categoryId === 'volcanoes';
        const isStorm = ev.categoryId === 'severeStorms';
        const type = isVolcano ? 'CRITICAL' : 'WARNING';
        const score = isVolcano ? 82 : isStorm ? 68 : 60;
        items.push({
          kind: 'eonet',
          id: ev.id,
          badge: 'EONET',
          code: ev.categoryTitle.slice(0, 12),
          title: ev.title,
          sub: `${ev.categoryTitle} • ${ev.source}`,
          status: 'ACTIVE',
          type,
          score,
          lat: ev.lat,
          lon: ev.lon,
          item: ev,
        });
      }
    }

    // 5. NOAA Space Weather (kp >= 5 or M/X solar flare)
    if (this.enabled.solar && (this.data.solar || this.data.goes)) {
      const kp = this.data.solar?.kp ?? 0;
      const flareClass = this.data.goes?.flareClass || 'A0.0';
      const isX = flareClass.startsWith('X');
      const isM = flareClass.startsWith('M');
      if (kp >= 5 || isX || isM) {
        const isCrit = kp >= 8 || isX;
        const type = isCrit ? 'CRITICAL' : 'WARNING';
        const score = isCrit ? 88 : 72;
        const scale = this.data.solar?.scale || 'G0';
        const solarItem = {
          id: 'noaa-solar',
          kp,
          scale,
          flareClass,
          solar: this.data.solar,
          goes: this.data.goes,
          lat: 65.0,
          lon: -20.0,
        };
        items.push({
          kind: 'solar',
          id: 'noaa-solar',
          badge: 'NOAA',
          code: isX || isM ? flareClass : scale,
          title: `SOLAR STORM ${scale} // FLARE ${flareClass}`,
          sub: `KP ${kp.toFixed(1)} • ${this.data.solar?.label || 'GEOMAGNETIC ACTIVITY'}`,
          status: isCrit ? 'SEVERE' : 'STORM',
          type,
          score,
          lat: solarItem.lat,
          lon: solarItem.lon,
          item: solarItem,
        });
      }
    }

    // 6. High BGP Withdrawal Activity (COVERT)
    if (this.enabled.bgp && this.data.bgpWithdrawRate >= 15) {
      const activeCols = [...this.data.bgpCollectors]
        .filter((c) => c.recentRate > 0)
        .sort((a, b) => b.recentRate - a.recentRate)
        .slice(0, 3);
      for (const col of activeCols) {
        items.push({
          kind: 'bgp',
          id: col.id,
          badge: 'BGP',
          code: col.code,
          title: `${col.city} // ${col.ixp}`,
          sub: `${this.data.bgpWithdrawRate}/s WDR • ${col.lastAsn || 'AS?'} ${col.lastPrefix || ''}`.trim(),
          status: `${Math.round(col.recentRate)}/s`,
          type: 'COVERT',
          score: Math.min(84, 52 + Math.round(this.data.bgpWithdrawRate * 0.4)),
          lat: col.lat,
          lon: col.lon,
          item: col,
        });
      }
    }

    items.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
    return items.slice(0, 60);
  }

  computeThreatMetrics() {
    const keys = Object.keys(this.enabled);
    let activeFeeds = 0;
    let healthyFeeds = 0;
    let errorFeeds = 0;

    for (const k of keys) {
      if (!this.enabled[k]) continue;
      activeFeeds++;
      const st = this.status[k]?.state;
      if (st === 'live') healthyFeeds++;
      else if (st === 'error') errorFeeds++;
    }

    const kp = Number((this.data.solar?.kp ?? 0).toFixed(1));
    const flareClass = this.data.goes?.flareClass || 'A0.0';
    const totalRate = Math.round(this.data.bgpRate || 0);

    // Deterministic anomaly index scaled 12..98 from real live telemetry
    let score = 12;

    // Seismic contribution
    let peakMag = 0;
    let m5Count = 0;
    for (const q of this.data.quakes) {
      if (q.mag > peakMag) peakMag = q.mag;
      if (q.mag >= 5.0) m5Count++;
    }
    if (peakMag >= 7.0) score += 28;
    else if (peakMag >= 6.0) score += 20;
    else if (peakMag >= 5.0) score += 13;
    else if (peakMag >= 4.0) score += 6;
    else if (peakMag >= 3.0) score += 2;
    score += Math.min(10, m5Count * 2);

    // GDACS Red/Orange contribution
    let redCount = 0;
    let orangeCount = 0;
    for (const g of this.data.gdacs) {
      if (g.alertLevel === 'Red') redCount++;
      else if (g.alertLevel === 'Orange') orangeCount++;
    }
    score += Math.min(24, redCount * 10);
    score += Math.min(12, orangeCount * 3);

    // NOAA Kp & X-ray flare contribution
    if (kp >= 7) score += 16;
    else if (kp >= 5) score += 9;
    else if (kp >= 4) score += 4;

    if (flareClass.startsWith('X')) score += 16;
    else if (flareClass.startsWith('M')) score += 9;
    else if (flareClass.startsWith('C')) score += 3;

    // ADS-B emergency squawks contribution
    let emgCount = 0;
    for (const ac of this.data.aircraft) {
      if (ac.emergency || ac.squawk === '7700' || ac.squawk === '7600' || ac.squawk === '7500') {
        emgCount++;
      }
    }
    score += Math.min(20, emgCount * 12);

    // BGP withdrawal rate contribution
    const wdr = this.data.bgpWithdrawRate || 0;
    score += Math.min(14, Math.floor(wdr / 15) * 2);

    const anomalyIndex = Number(Math.max(12, Math.min(98, score)).toFixed(1));

    return {
      anomalyIndex,
      activeFeeds,
      healthyFeeds,
      errorFeeds,
      totalRate,
      flareClass,
      kp,
    };
  }
}
