// ============================================================================
// AEGIS // LIVE PUBLIC DATA TELEMETRY ENGINE (14 ZERO-API-KEY LIVE FEEDS)
// ============================================================================

import {
  json2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from 'satellite.js';
import {
  findCountryAtLonLat,
  findCountryByCodeOrName,
  geocodeHeadlineToCountry,
} from './countryIntel.js';

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
  outages: 300000,
  launches: 900000,
  news: 300000,
  airq: 300000,
  buoys: 300000,
};

const LL2_CACHE_KEY = 'aegis-ll2-cache-v1';
const LL2_CACHE_TTL_MS = 900000;
const DART_STATION_RE = /^(214|324|414|424|434|444|464|514|524|534|550)\d{2}$/;

const SAT_WORKER_TICK_MS = 500;
const DIRECT_RIPE_WS = 'wss://ris-live.ripe.net/v1/ws/?client=aegis-command';

function kpToScale(kp) {
  if (kp >= 9) return { scale: 'G5', label: 'EXTREME STORM', severity: 'CRITICAL' };
  if (kp >= 8) return { scale: 'G4', label: 'SEVERE STORM', severity: 'CRITICAL' };
  if (kp >= 7) return { scale: 'G3', label: 'STRONG STORM', severity: 'WARNING' };
  if (kp >= 6) return { scale: 'G2', label: 'MODERATE STORM', severity: 'WARNING' };
  if (kp >= 5) return { scale: 'G1', label: 'MINOR STORM', severity: 'WARNING' };
  if (kp >= 4) return { scale: 'G0+', label: 'ACTIVE FIELD', severity: 'INFO' };
  return { scale: 'G0', label: 'QUIET', severity: 'INFO' };
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

const AIRQ_STATIONS = [
  { id: 'airq-nyc', name: 'NEW YORK', countryCode: 'US', lat: 40.71, lon: -74.01 },
  { id: 'airq-lax', name: 'LOS ANGELES', countryCode: 'US', lat: 34.05, lon: -118.24 },
  { id: 'airq-mex', name: 'MEXICO CITY', countryCode: 'MX', lat: 19.43, lon: -99.13 },
  { id: 'airq-gru', name: 'SÃO PAULO', countryCode: 'BR', lat: -23.55, lon: -46.63 },
  { id: 'airq-scl', name: 'SANTIAGO', countryCode: 'CL', lat: -33.45, lon: -70.67 },
  { id: 'airq-lon', name: 'LONDON', countryCode: 'GB', lat: 51.51, lon: -0.13 },
  { id: 'airq-par', name: 'PARIS', countryCode: 'FR', lat: 48.86, lon: 2.35 },
  { id: 'airq-waw', name: 'WARSAW', countryCode: 'PL', lat: 52.23, lon: 21.01 },
  { id: 'airq-ist', name: 'ISTANBUL', countryCode: 'TR', lat: 41.01, lon: 28.98 },
  { id: 'airq-cai', name: 'CAIRO', countryCode: 'EG', lat: 30.04, lon: 31.24 },
  { id: 'airq-los', name: 'LAGOS', countryCode: 'NG', lat: 6.52, lon: 3.38 },
  { id: 'airq-jnb', name: 'JOHANNESBURG', countryCode: 'ZA', lat: -26.2, lon: 28.05 },
  { id: 'airq-dxb', name: 'DUBAI', countryCode: 'AE', lat: 25.2, lon: 55.27 },
  { id: 'airq-del', name: 'NEW DELHI', countryCode: 'IN', lat: 28.61, lon: 77.21 },
  { id: 'airq-dac', name: 'DHAKA', countryCode: 'BD', lat: 23.81, lon: 90.41 },
  { id: 'airq-pek', name: 'BEIJING', countryCode: 'CN', lat: 39.9, lon: 116.41 },
  { id: 'airq-tyo', name: 'TOKYO', countryCode: 'JP', lat: 35.68, lon: 139.65 },
  { id: 'airq-syd', name: 'SYDNEY', countryCode: 'AU', lat: -33.87, lon: 151.21 },
];

function usAqiToCategory(aqi) {
  if (aqi >= 301) return { category: 'HAZARDOUS', severity: 'CRITICAL' };
  if (aqi >= 201) return { category: 'VERY UNHEALTHY', severity: 'CRITICAL' };
  if (aqi >= 151) return { category: 'UNHEALTHY', severity: 'CRITICAL' };
  if (aqi >= 101) return { category: 'SENSITIVE', severity: 'WARNING' };
  if (aqi >= 51) return { category: 'MODERATE', severity: 'INFO' };
  return { category: 'GOOD', severity: 'INFO' };
}

function hashSeedString(seedStr) {
  let h = 2166136261;
  const s = String(seedStr || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Deterministic golden-angle spiral offset so multiple country-level events
// sharing the same centroid never stack identically (zero Math.random).
export function deterministicOffset(seedStr, index) {
  if (!index || index <= 0) return { dLat: 0, dLon: 0 };
  const radius = 0.45 * Math.ceil(index / 6);
  const baseAngle = (hashSeedString(seedStr) % 360) * (Math.PI / 180);
  const angle = baseAngle + index * 2.39996;
  return {
    dLat: Math.sin(angle) * radius,
    dLon: Math.cos(angle) * radius,
  };
}

function applyCountrySpiralOffset(baseLat, baseLon, seedStr, index) {
  const { dLat, dLon } = deterministicOffset(seedStr, index);
  const lat = Math.max(-85, Math.min(85, baseLat + dLat));
  const cosLat = Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  const lon = Math.max(-180, Math.min(180, baseLon + dLon / cosLat));
  return {
    lat: Number(lat.toFixed(4)),
    lon: Number(lon.toFixed(4)),
  };
}

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
};

function decodeHtmlEntities(text) {
  return String(text || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, ent) => {
    if (ent[0] === '#') {
      const code =
        ent[1] === 'x' || ent[1] === 'X'
          ? parseInt(ent.slice(2), 16)
          : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    const lower = ent.toLowerCase();
    return lower in HTML_ENTITIES ? HTML_ENTITIES[lower] : match;
  });
}

function stripHtmlAndEntities(raw) {
  const decoded = decodeHtmlEntities(String(raw || ''));
  return decodeHtmlEntities(decoded.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractXmlTag(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return '';
  let val = m[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(val);
  if (cdata) val = cdata[1];
  return val.trim();
}

function parseRssItems(xmlText) {
  const items = [];
  if (!xmlText) return items;

  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
      const hasErr = doc.getElementsByTagName('parsererror').length > 0;
      if (!hasErr) {
        const nodes = doc.getElementsByTagName('item');
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          const getText = (tag) => node.getElementsByTagName(tag)[0]?.textContent || '';
          const title = stripHtmlAndEntities(getText('title'));
          if (!title) continue;
          items.push({
            title,
            description: stripHtmlAndEntities(getText('description')),
            link: getText('link').trim(),
            pubDate: getText('pubDate').trim(),
          });
        }
        if (items.length > 0) return items;
      }
    } catch {
      // Fall through to regex parser
    }
  }

  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xmlText)) !== null) {
    const block = m[1];
    const title = stripHtmlAndEntities(extractXmlTag(block, 'title'));
    if (!title) continue;
    items.push({
      title,
      description: stripHtmlAndEntities(extractXmlTag(block, 'description')),
      link: decodeHtmlEntities(extractXmlTag(block, 'link')).trim(),
      pubDate: extractXmlTag(block, 'pubDate').trim(),
    });
  }
  return items;
}

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

// CORS-resilient JSON fetcher: tries direct CORS-native URL first (default 10s timeout) when
// available, falling back to local/edge proxy (default 12s timeout, verifying JSON content-type
// so SPA fallback index.html 200 OK never breaks parsing). Proxy-only feeds pass directUrl = null.
export async function fetchJsonWithFallback(
  proxyUrl,
  directUrl,
  proxyInit = {},
  directInit = {},
  { directTimeoutMs = 10000, proxyTimeoutMs = 12000 } = {}
) {
  let directErr = null;
  if (directUrl) {
    try {
      return await fetchJsonWithTimeout(directUrl, directInit, directTimeoutMs, {
        requireJsonContentType: false,
        label: 'direct',
      });
    } catch (err) {
      directErr = err;
    }
  }

  if (proxyUrl) {
    return await fetchJsonWithTimeout(proxyUrl, proxyInit, proxyTimeoutMs, {
      requireJsonContentType: true,
      label: 'proxy',
    });
  }

  throw directErr || new Error('Fetch failed');
}

async function fetchTextWithTimeout(url, init = {}, timeoutMs = 15000, label = 'direct') {
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (/^\s*<!doctype html/i.test(text)) {
      throw new Error(`SPA HTML fallback on ${label} response`);
    }
    return text;
  } finally {
    clearTimeout(timer);
    if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
  }
}

export async function fetchTextWithFallback(proxyUrl, directUrl, timeoutMs = 15000, proxyInit = {}, directInit = {}) {
  let directErr = null;
  if (directUrl) {
    try {
      return await fetchTextWithTimeout(directUrl, directInit, timeoutMs, 'direct');
    } catch (err) {
      directErr = err;
    }
  }

  if (proxyUrl) {
    return await fetchTextWithTimeout(proxyUrl, proxyInit, timeoutMs, 'proxy');
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
      outages: true,
      launches: true,
      news: true,
      airq: true,
      buoys: true,
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
      outages: { state: 'idle', count: 0, updatedAt: null, error: null },
      launches: { state: 'idle', count: 0, updatedAt: null, error: null },
      news: { state: 'idle', count: 0, updatedAt: null, error: null },
      airq: { state: 'idle', count: 0, updatedAt: null, error: null },
      buoys: { state: 'idle', count: 0, updatedAt: null, error: null },
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
      outages: [],
      launches: [],
      news: [],
      airq: [],
      buoys: [],
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
            'INFO',
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
            msg.sampleLog.isWithdraw ? 'WARN' : 'INFO',
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
      ['outages', POLL_CADENCE_MS.outages],
      ['launches', POLL_CADENCE_MS.launches],
      ['news', POLL_CADENCE_MS.news],
      ['airq', POLL_CADENCE_MS.airq],
      ['buoys', POLL_CADENCE_MS.buoys],
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

    this.timers.outages = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.outages) this.fetchOutages();
    }, POLL_CADENCE_MS.outages);

    this.timers.launches = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.launches) this.fetchLaunches();
    }, POLL_CADENCE_MS.launches);

    this.timers.news = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.news) this.fetchNews();
    }, POLL_CADENCE_MS.news);

    this.timers.airq = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.airq) this.fetchAirQuality();
    }, POLL_CADENCE_MS.airq);

    this.timers.buoys = setInterval(() => {
      if (!this._isDocumentHidden() && this.enabled.buoys) this.fetchBuoys();
    }, POLL_CADENCE_MS.buoys);

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
    if (feedKey === 'outages') return this.fetchOutages();
    if (feedKey === 'launches') return this.fetchLaunches();
    if (feedKey === 'news') return this.fetchNews();
    if (feedKey === 'airq') return this.fetchAirQuality();
    if (feedKey === 'buoys') return this.fetchBuoys();
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
    if (this.enabled.outages) this.fetchOutages();
    if (this.enabled.launches) this.fetchLaunches();
    if (this.enabled.news) this.fetchNews();
    if (this.enabled.airq) this.fetchAirQuality();
    if (this.enabled.buoys) this.fetchBuoys();
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

    // 3. Keep upcoming orbital launch T-minus countdowns ticking in real time
    if (this.data.launches.length > 0) {
      for (let i = 0; i < this.data.launches.length; i++) {
        const l = this.data.launches[i];
        if (Number.isFinite(l.netMs)) {
          l.tMinusSec = Math.round((l.netMs - nowMs) / 1000);
        }
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
            severity: mag >= 5.0 ? 'CRITICAL' : mag >= 4.0 ? 'WARNING' : 'INFO',
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
        this.onLog?.('INFO', `NASA EONET LIVE (${events.length} ACTIVE EVENTS): ${first.categoryTitle} — ${first.title}.`);
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
          'INFO',
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
        this.onLog?.('INFO', 'RIPE RIS LIVE BGP WEBSOCKET CONNECTED — MONITORING GLOBAL IXP ROUTE COLLECTORS.');
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
              isWithdraw ? 'WARN' : 'INFO',
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
          top.alertLevel === 'Red' ? 'CRIT' : top.alertLevel === 'Orange' ? 'WARN' : 'INFO',
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
          'INFO',
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
      const latStr = lat.toFixed(3);
      const lonStr = lon.toFixed(3);
      const wxQs = `latitude=${latStr}&longitude=${lonStr}&current=temperature_2m,wind_speed_10m,wind_direction_10m,surface_pressure,weather_code`;
      const airQs = `latitude=${latStr}&longitude=${lonStr}&current=us_aqi,pm2_5,uv_index`;
      const [wxRes, airRes] = await Promise.allSettled([
        fetchJsonWithFallback(
          `/live-api/meteo/v1/forecast?${wxQs}`,
          `https://api.open-meteo.com/v1/forecast?${wxQs}`
        ),
        fetchJsonWithFallback(
          `/live-api/airq/v1/air-quality?${airQs}`,
          `https://air-quality-api.open-meteo.com/v1/air-quality?${airQs}`
        ),
      ]);
      if (wxRes.status !== 'fulfilled') return null;
      const cur = wxRes.value?.current;
      if (!cur) return null;
      const airCur = airRes.status === 'fulfilled' ? airRes.value?.current : null;
      const data = {
        tempC: Number((cur.temperature_2m ?? 0).toFixed(1)),
        windKmh: Math.round(cur.wind_speed_10m ?? 0),
        windDir: Math.round(cur.wind_direction_10m ?? 0),
        pressureHpa: Math.round(cur.surface_pressure ?? 1013),
        condition: wmoCodeToText(cur.weather_code ?? 0),
        usAqi: Number.isFinite(airCur?.us_aqi) ? Math.round(airCur.us_aqi) : null,
        pm25: Number.isFinite(airCur?.pm2_5) ? Number(airCur.pm2_5.toFixed(1)) : null,
        uvIndex: Number.isFinite(airCur?.uv_index) ? Number(airCur.uv_index.toFixed(1)) : null,
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
            'INFO',
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
  // 10. GLOBAL INTERNET OUTAGES & CENSORSHIP (GEORGIA TECH IODA v2 + OONI)
  // --------------------------------------------------------------------------
  async fetchOutages() {
    this.status.outages.state = 'loading';
    this.onUpdate?.('outages');
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const fromSec = nowSec - 86400;
      const iodaPath = `/v2/outages/alerts?from=${fromSec}&until=${nowSec}&entityType=country&limit=50`;

      const [iodaRes, ooniRes] = await Promise.allSettled([
        fetchJsonWithFallback(
          `/live-api/ioda${iodaPath}`,
          `https://api.ioda.inetintel.cc.gatech.edu${iodaPath}`,
          {},
          {},
          { directTimeoutMs: 16000, proxyTimeoutMs: 17000 }
        ),
        fetchJsonWithFallback(
          '/live-api/ooni/api/v1/incidents/search?only_ongoing=true',
          null,
          {},
          {},
          { proxyTimeoutMs: 12000 }
        ),
      ]);

      const anySuccess = iodaRes.status === 'fulfilled' || ooniRes.status === 'fulfilled';
      if (!anySuccess) {
        const msg = iodaRes.reason?.message || ooniRes.reason?.message || 'Outage feeds unavailable';
        throw new Error(msg);
      }

      const rawItems = [];

      // (a) IODA v2 Country Alerts
      if (iodaRes.status === 'fulfilled') {
        const alerts = Array.isArray(iodaRes.value?.data) ? iodaRes.value.data : [];
        const deduped = new Map();
        const sevRank = { critical: 2, warning: 1 };

        for (const d of alerts) {
          const level = String(d?.level || '').toLowerCase();
          if (level !== 'critical' && level !== 'warning') continue;
          const entity = d.entity || {};
          const rawCode = entity.code || entity.name;
          if (!rawCode) continue;
          const datasource = String(d.datasource || 'ioda');
          const key = `${String(rawCode).toUpperCase()}:${datasource.toLowerCase()}`;
          const prev = deduped.get(key);
          const curTime = Number(d.time) || 0;
          if (
            !prev ||
            (sevRank[level] || 0) > (sevRank[prev.level] || 0) ||
            ((sevRank[level] || 0) === (sevRank[prev.level] || 0) && curTime > prev.time)
          ) {
            deduped.set(key, { raw: d, level, time: curTime, datasource, entity });
          }
        }

        for (const entry of deduped.values()) {
          const { raw: d, level, datasource, entity } = entry;
          const country = findCountryByCodeOrName(entity.code) || findCountryByCodeOrName(entity.name);
          if (!country) continue;
          const countryCode = country.iso2 || String(entity.code || '').toUpperCase();
          const countryName = country.name || entity.name || countryCode;
          const severity = level === 'critical' ? 'CRITICAL' : 'WARNING';
          const value = Number.isFinite(Number(d.value)) ? Number(d.value) : null;
          const historyValue = Number.isFinite(Number(d.historyValue)) ? Number(d.historyValue) : null;
          const dropPct =
            historyValue !== null && value !== null && historyValue > 0 && value < historyValue
              ? Math.round(((historyValue - value) / historyValue) * 100)
              : null;
          const rawTime = Number(d.time);
          const timeMs = Number.isFinite(rawTime) && rawTime > 0
            ? (rawTime > 1e12 ? rawTime : rawTime * 1000)
            : Date.now();
          const dsLabel = datasource.toUpperCase();
          const asns = Array.isArray(entity.attrs?.asns) ? entity.attrs.asns : [];

          rawItems.push({
            id: `ioda-${countryCode.toLowerCase()}-${datasource.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            source: 'IODA',
            severity,
            level,
            countryCode,
            countryName,
            datasource,
            title: `${countryName} ${dsLabel} ${severity === 'CRITICAL' ? 'OUTAGE' : 'DEGRADATION'}`,
            summary:
              dropPct !== null
                ? `${dropPct}% connectivity drop detected on ${dsLabel} (${value} vs baseline ${historyValue}).`
                : `IODA ${level.toUpperCase()} alert on ${dsLabel}${d.condition ? ` (${d.condition})` : ''}.`,
            value,
            historyValue,
            dropPct,
            asns,
            timeMs,
            reportUrl: `https://ioda.inetintel.cc.gatech.edu/country/${encodeURIComponent(countryCode)}`,
            baseLat: country.lat,
            baseLon: country.lon,
          });
        }
      }

      // (b) OONI Explorer Ongoing Incidents
      if (ooniRes.status === 'fulfilled') {
        const incidents = Array.isArray(ooniRes.value?.incidents) ? ooniRes.value.incidents : [];
        const nowMs = Date.now();
        for (const inc of incidents) {
          if (!inc) continue;
          const endMs = inc.end_time ? Date.parse(inc.end_time) : NaN;
          if (inc.end_time && Number.isFinite(endMs) && endMs <= nowMs) continue;
          if (!Array.isArray(inc.CCs) || inc.CCs.length === 0) continue;
          const country = findCountryByCodeOrName(inc.CCs[0]);
          if (!country) continue;
          const countryCode = country.iso2 || String(inc.CCs[0]).toUpperCase();
          const eventType = String(inc.event_type || 'incident').toLowerCase();
          const severity = eventType === 'outage' ? 'CRITICAL' : 'WARNING';
          const parsedStart = inc.start_time ? Date.parse(inc.start_time) : NaN;
          const timeMs = Number.isFinite(parsedStart) ? parsedStart : nowMs;
          const asns = Array.isArray(inc.ASNs) ? inc.ASNs : [];
          const cleanTitle = stripHtmlAndEntities(inc.title || `${country.name} Network Interference`);
          const cleanSummary = stripHtmlAndEntities(
            inc.short_description || inc.title || 'Ongoing OONI network censorship / outage report.'
          );

          rawItems.push({
            id: `ooni-${String(inc.id || `${countryCode}-${timeMs}`)}`,
            source: 'OONI',
            severity,
            level: eventType,
            countryCode,
            countryName: country.name,
            datasource: 'ooni',
            title: cleanTitle,
            summary: cleanSummary,
            value: null,
            historyValue: null,
            dropPct: null,
            asns,
            timeMs,
            reportUrl: inc.id
              ? `https://explorer.ooni.org/findings/${encodeURIComponent(inc.id)}`
              : 'https://explorer.ooni.org/findings',
            baseLat: country.lat,
            baseLon: country.lon,
          });
        }
      }

      rawItems.sort((a, b) => {
        const sevA = a.severity === 'CRITICAL' ? 1 : 0;
        const sevB = b.severity === 'CRITICAL' ? 1 : 0;
        if (sevB !== sevA) return sevB - sevA;
        return b.timeMs - a.timeMs;
      });

      const countryCounts = new Map();
      const items = rawItems.slice(0, 40).map((item) => {
        const idx = countryCounts.get(item.countryCode) || 0;
        countryCounts.set(item.countryCode, idx + 1);
        const { lat, lon } = applyCountrySpiralOffset(
          item.baseLat,
          item.baseLon,
          `outage:${item.countryCode}`,
          idx
        );
        return {
          id: item.id,
          source: item.source,
          severity: item.severity,
          level: item.level,
          countryCode: item.countryCode,
          countryName: item.countryName,
          datasource: item.datasource,
          title: item.title,
          summary: item.summary,
          value: item.value,
          historyValue: item.historyValue,
          dropPct: item.dropPct,
          asns: item.asns,
          timeMs: item.timeMs,
          reportUrl: item.reportUrl,
          lat,
          lon,
        };
      });

      this.data.outages = items;
      this.status.outages = { state: 'live', count: items.length, updatedAt: new Date(), error: null };

      const critCount = items.filter((i) => i.severity === 'CRITICAL').length;
      if (items.length > 0) {
        const top = items[0];
        this.onLog?.(
          critCount > 0 ? 'CRIT' : 'WARN',
          `NET OUTAGES LIVE (${items.length} EVENTS, ${critCount} CRIT): [${top.source}] ${top.title}.`
        );
      } else {
        this.onLog?.('INFO', 'NET OUTAGES LIVE (IODA + OONI): 0 ACTIVE COUNTRY-LEVEL ALERTS.');
      }
    } catch (err) {
      this.status.outages = { state: 'error', count: this.data.outages.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `NET OUTAGES FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('outages');
  }

  // --------------------------------------------------------------------------
  // 11. UPCOMING ORBITAL LAUNCHES (LAUNCH LIBRARY 2 + 15M LOCALSTORAGE CACHE)
  // --------------------------------------------------------------------------
  async fetchLaunches() {
    this.status.launches.state = 'loading';
    this.onUpdate?.('launches');

    let cachedPayload = null;
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(LL2_CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.results) && parsed.results.length > 0) {
            cachedPayload = parsed;
          }
        }
      } catch {
        cachedPayload = null;
      }
    }

    try {
      let results = null;
      let usedCache = false;

      if (cachedPayload && Date.now() - Number(cachedPayload.ts || 0) < LL2_CACHE_TTL_MS) {
        results = cachedPayload.results;
        usedCache = true;
      } else {
        try {
          const json = await fetchJsonWithFallback(
            '/live-api/launches/2.2.0/launch/upcoming/?limit=15&hide_recent_previous=true',
            'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=15&hide_recent_previous=true'
          );
          if (Array.isArray(json?.results)) {
            results = json.results;
            if (results.length > 0 && typeof localStorage !== 'undefined') {
              try {
                localStorage.setItem(LL2_CACHE_KEY, JSON.stringify({ ts: Date.now(), results }));
              } catch {
                // ignore storage quota errors
              }
            }
          }
        } catch (netErr) {
          if (cachedPayload && cachedPayload.results.length > 0) {
            results = cachedPayload.results;
            usedCache = true;
          } else {
            throw netErr;
          }
        }
      }

      const nowMs = Date.now();
      const launches = [];
      for (const r of Array.isArray(results) ? results : []) {
        const lat = Number(r?.pad?.latitude);
        const lon = Number(r?.pad?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const parsedNet = r.net ? Date.parse(r.net) : NaN;
        const netMs = Number.isFinite(parsedNet) ? parsedNet : nowMs;
        const countryCode =
          findCountryByCodeOrName(r.pad?.country_code || r.pad?.location?.country_code)?.iso2 ||
          findCountryAtLonLat(lon, lat)?.iso2 ||
          '';

        launches.push({
          id: `launch-${r.id}`,
          ll2Id: r.id,
          name: r.name || 'Orbital Launch',
          rocket: r.rocket?.configuration?.full_name || r.rocket?.configuration?.name || 'Launch Vehicle',
          missionName: r.mission?.name || r.name || 'Orbital Mission',
          missionDesc: r.mission?.description || '',
          orbit: r.mission?.orbit?.abbrev || r.mission?.orbit?.name || 'LEO',
          status: r.status?.abbrev || 'TBD',
          statusText: r.status?.name || 'Scheduled',
          net: r.net || '',
          netMs,
          tMinusSec: Math.round((netMs - nowMs) / 1000),
          provider: r.launch_service_provider?.name || 'Launch Provider',
          padName: r.pad?.name || 'Launch Complex',
          locationName: r.pad?.location?.name || '',
          countryCode,
          webcastLive: Boolean(r.webcast_live),
          webcastUrl: r.vidURLs?.[0]?.url || r.vid_urls?.[0]?.url || '',
          infoUrl: r.infoURLs?.[0]?.url || r.info_urls?.[0]?.url || '',
          lat,
          lon,
        });
      }

      this.data.launches = launches;
      this.status.launches = { state: 'live', count: launches.length, updatedAt: new Date(), error: null };

      if (launches.length > 0) {
        const next = launches[0];
        this.onLog?.(
          'SAT',
          `ORBITAL LAUNCH MANIFEST LIVE (${launches.length}${usedCache ? ' CACHED' : ''}): Next ${next.name} [${next.status}] @ ${next.padName}.`
        );
      }
    } catch (err) {
      this.status.launches = { state: 'error', count: this.data.launches.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `LAUNCH LIBRARY FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('launches');
  }

  // --------------------------------------------------------------------------
  // 12. GEOCODED GLOBAL NEWS WIRE (BBC WORLD RSS + WIKIMEDIA CURRENT EVENTS)
  // --------------------------------------------------------------------------
  async fetchNews() {
    this.status.news.state = 'loading';
    this.onUpdate?.('news');
    try {
      const now = new Date();
      const yyyy = String(now.getUTCFullYear());
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(now.getUTCDate()).padStart(2, '0');
      const wikiPath = `/api/rest_v1/feed/featured/${yyyy}/${mm}/${dd}`;

      const [bbcRes, wikiRes] = await Promise.allSettled([
        fetchTextWithFallback('/live-api/bbc/news/world/rss.xml', null, 12000),
        fetchJsonWithFallback(
          `/live-api/wiki-en${wikiPath}`,
          `https://en.wikipedia.org${wikiPath}`,
          { headers: { 'Api-User-Agent': 'AEGIS-Situation-Room/1.0 (local dashboard)' } },
          {}
        ),
      ]);

      const anySuccess = bbcRes.status === 'fulfilled' || wikiRes.status === 'fulfilled';
      if (!anySuccess) {
        const msg = bbcRes.reason?.message || wikiRes.reason?.message || 'News feeds unavailable';
        throw new Error(msg);
      }

      const candidates = [];

      // (a) BBC World RSS
      if (bbcRes.status === 'fulfilled') {
        const rssItems = parseRssItems(bbcRes.value);
        for (let i = 0; i < rssItems.length; i++) {
          const it = rssItems[i];
          const parsedDate = it.pubDate ? Date.parse(it.pubDate) : NaN;
          const timeMs = Number.isFinite(parsedDate) ? parsedDate : now.getTime() - i * 60000;
          candidates.push({
            source: 'BBC WORLD',
            title: it.title,
            summary: it.description || it.title,
            url: it.link || 'https://www.bbc.com/news/world',
            publishedAt: it.pubDate || new Date(timeMs).toISOString(),
            timeMs,
          });
        }
      }

      // (b) Wikimedia Current Events (In The News)
      if (wikiRes.status === 'fulfilled') {
        const wikiNews = Array.isArray(wikiRes.value?.news) ? wikiRes.value.news : [];
        for (let i = 0; i < wikiNews.length; i++) {
          const entry = wikiNews[i];
          const cleanStory = stripHtmlAndEntities(entry?.story || '');
          if (!cleanStory) continue;
          const url =
            entry?.links?.[0]?.content_urls?.desktop?.page ||
            entry?.links?.[0]?.content_urls?.mobile?.page ||
            'https://en.wikipedia.org/wiki/Portal:Current_events';
          const timeMs = now.getTime() - i * 1000;
          candidates.push({
            source: 'WIKIMEDIA',
            title: cleanStory,
            summary: cleanStory,
            url,
            publishedAt: new Date(timeMs).toISOString(),
            timeMs,
          });
        }
      }

      candidates.sort((a, b) => b.timeMs - a.timeMs);

      const seenPrefixes = new Set();
      const countryCounts = new Map();
      const stories = [];

      for (const c of candidates) {
        if (stories.length >= 32) break;
        const normPrefix = c.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim()
          .slice(0, 48);
        if (!normPrefix || seenPrefixes.has(normPrefix)) continue;

        const geo = geocodeHeadlineToCountry(c.title, c.summary);
        if (!geo || !geo.country) continue;
        seenPrefixes.add(normPrefix);

        const country = geo.country;
        const cc = country.iso2 || country.id;
        const idx = countryCounts.get(cc) || 0;
        countryCounts.set(cc, idx + 1);
        const { lat, lon } = applyCountrySpiralOffset(geo.lat, geo.lon, `news:${cc}`, idx);

        stories.push({
          id: `news-${c.source === 'BBC WORLD' ? 'bbc' : 'wiki'}-${hashSeedString(c.title).toString(36)}`,
          title: c.title,
          summary: c.summary,
          source: c.source,
          url: c.url,
          publishedAt: c.publishedAt,
          timeMs: c.timeMs,
          countryCode: country.iso2 || '',
          countryName: country.name,
          region: country.region || '',
          lat,
          lon,
        });
      }

      this.data.news = stories;
      this.status.news = { state: 'live', count: stories.length, updatedAt: new Date(), error: null };

      if (stories.length > 0) {
        const top = stories[0];
        this.onLog?.(
          'INFO',
          `OSINT NEWS WIRE LIVE (${stories.length} GEOCODED): [${top.source} • ${top.countryCode || top.countryName}] ${top.title.slice(0, 96)}.`
        );
      }
    } catch (err) {
      this.status.news = { state: 'error', count: this.data.news.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `NEWS WIRE FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('news');
  }

  // --------------------------------------------------------------------------
  // 13. GLOBAL AIR QUALITY & PM2.5 TELEMETRY (OPEN-METEO AIR QUALITY API)
  // --------------------------------------------------------------------------
  async fetchAirQuality() {
    this.status.airq.state = 'loading';
    this.onUpdate?.('airq');
    try {
      const lats = AIRQ_STATIONS.map((s) => s.lat).join(',');
      const lons = AIRQ_STATIONS.map((s) => s.lon).join(',');
      const qs = `latitude=${lats}&longitude=${lons}&current=us_aqi,pm2_5,dust,uv_index`;
      const payload = await fetchJsonWithFallback(
        `/live-api/airq/v1/air-quality?${qs}`,
        `https://air-quality-api.open-meteo.com/v1/air-quality?${qs}`
      );
      const arr = Array.isArray(payload) ? payload : [payload];

      const stations = AIRQ_STATIONS.map((st, idx) => {
        const cur = arr[idx]?.current || {};
        const usAqi = Math.round(cur.us_aqi ?? 0);
        const { category, severity } = usAqiToCategory(usAqi);
        return {
          id: st.id,
          name: st.name,
          countryCode: st.countryCode,
          lat: st.lat,
          lon: st.lon,
          usAqi,
          pm25: Number((cur.pm2_5 ?? 0).toFixed(1)),
          dust: Math.round(cur.dust ?? 0),
          uvIndex: Number((cur.uv_index ?? 0).toFixed(1)),
          category,
          severity,
        };
      });

      this.data.airq = stations;
      this.status.airq = { state: 'live', count: stations.length, updatedAt: new Date(), error: null };

      const peak = [...stations].sort((a, b) => b.usAqi - a.usAqi)[0];
      if (peak) {
        this.onLog?.(
          peak.usAqi >= 151 ? 'WARN' : 'INFO',
          `OPEN-METEO AIR QUALITY LIVE (${stations.length} HUBS): Peak US AQI ${peak.usAqi} (${peak.category}) @ ${peak.name} (PM2.5 ${peak.pm25} µg/m³).`
        );
      }
    } catch (err) {
      this.status.airq = { state: 'error', count: this.data.airq.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `AIR QUALITY FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('airq');
  }

  // --------------------------------------------------------------------------
  // 14. NOAA NDBC OCEAN BUOYS & DART DEEP-OCEAN TSUNAMI SENSORS
  // --------------------------------------------------------------------------
  async fetchBuoys() {
    this.status.buoys.state = 'loading';
    this.onUpdate?.('buoys');
    try {
      const text = await fetchTextWithFallback('/live-api/ndbc/data/latest_obs/latest_obs.txt', null, 15000);
      const lines = text.split(/\r?\n/);

      const parseNum = (tok) => {
        if (!tok || tok === 'MM') return null;
        const n = Number(tok);
        return Number.isFinite(n) ? n : null;
      };

      const dartStations = [];
      const highWaveBuoys = [];
      const fallbackWaveBuoys = [];
      const seenStn = new Set();

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        const cols = line.split(/\s+/);
        if (cols.length < 19) continue;

        const stn = cols[0].toUpperCase();
        if (seenStn.has(stn)) continue;
        const lat = parseNum(cols[1]);
        const lon = parseNum(cols[2]);
        if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

        const yyyy = cols[3];
        const mm = cols[4];
        const dd = cols[5];
        const hh = cols[6];
        const min = cols[7];
        const obsTime = `${yyyy}-${mm}-${dd}T${hh}:${min}:00Z`;

        const windDir = parseNum(cols[8]);
        const windMs = parseNum(cols[9]);
        const waveM = parseNum(cols[11]);
        const periodSec = parseNum(cols[12]);
        const presHpa = parseNum(cols[15]);
        const ptdyHpa = parseNum(cols[16]);
        const airTempC = parseNum(cols[17]);
        const waterTempC = parseNum(cols[18]);

        const isDart = DART_STATION_RE.test(stn);
        const dartAlert = isDart && ptdyHpa !== null && Math.abs(ptdyHpa) >= 3;
        const severity =
          dartAlert || (waveM !== null && waveM >= 6.0)
            ? 'CRITICAL'
            : waveM !== null && waveM >= 4.0
            ? 'WARNING'
            : 'INFO';

        const rec = {
          id: `buoy-${stn.toLowerCase()}`,
          stationId: stn,
          name: isDart ? `DART TSUNAMI ${stn}` : `NDBC BUOY ${stn}`,
          isDart,
          lat,
          lon,
          waveM,
          periodSec,
          windMs,
          windDir,
          presHpa,
          ptdyHpa,
          airTempC,
          waterTempC,
          obsTime,
          severity,
        };

        seenStn.add(stn);
        if (isDart) {
          dartStations.push(rec);
        } else if (waveM !== null && waveM >= 1.5) {
          highWaveBuoys.push(rec);
        } else if (waveM !== null && waveM > 0) {
          fallbackWaveBuoys.push(rec);
        }
      }

      dartStations.sort(
        (a, b) => Math.abs(b.ptdyHpa ?? 0) - Math.abs(a.ptdyHpa ?? 0) || a.stationId.localeCompare(b.stationId)
      );
      highWaveBuoys.sort((a, b) => (b.waveM ?? 0) - (a.waveM ?? 0));
      fallbackWaveBuoys.sort((a, b) => (b.waveM ?? 0) - (a.waveM ?? 0));

      const pickedDart = dartStations.slice(0, 28);
      const remainingSlots = Math.max(0, 65 - pickedDart.length);
      const pickedWaves = highWaveBuoys.slice(0, remainingSlots);
      if (pickedWaves.length < remainingSlots) {
        pickedWaves.push(...fallbackWaveBuoys.slice(0, remainingSlots - pickedWaves.length));
      }

      const buoys = [...pickedDart, ...pickedWaves];
      this.data.buoys = buoys;
      this.status.buoys = { state: 'live', count: buoys.length, updatedAt: new Date(), error: null };

      const peakWave = [...buoys].filter((b) => b.waveM !== null).sort((a, b) => b.waveM - a.waveM)[0];
      if (buoys.length > 0) {
        this.onLog?.(
          peakWave && peakWave.waveM >= 6.0 ? 'WARN' : 'INFO',
          `NOAA NDBC BUOYS LIVE (${buoys.length} STATIONS, ${pickedDart.length} DART):${peakWave ? ` Peak sea ${peakWave.waveM.toFixed(1)}m @ ${peakWave.stationId}.` : ' Telemetry nominal.'}`
        );
      }
    } catch (err) {
      this.status.buoys = { state: 'error', count: this.data.buoys.length, updatedAt: null, error: err.message };
      this.onLog?.('WARN', `NOAA NDBC BUOY FEED ERROR: ${err.message}`);
    }
    this.onUpdate?.('buoys');
  }

  // --------------------------------------------------------------------------
  // 15. OSINT UI HELPERS: DOSSIER RE-BINDING, LIVE ANOMALIES & THREAT METRICS
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
      case 'outage':
        return this.data.outages.find((o) => o.id === id) || null;
      case 'launch':
        return this.data.launches.find((l) => l.id === id) || null;
      case 'news':
        return this.data.news.find((n) => n.id === id) || null;
      case 'airq':
        return this.data.airq.find((a) => a.id === id) || null;
      case 'buoy':
        return this.data.buoys.find((b) => b.id === id) || null;
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
        const type = level === 'Red' ? 'CRITICAL' : level === 'Orange' ? 'WARNING' : 'INFO';
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

    // 3. USGS Earthquakes (mag >= 5.0 CRIT, >= 4.0 WARN, >= 3.2 INFO; score mag * 15)
    if (this.enabled.quakes) {
      for (const q of this.data.quakes) {
        if (q.mag < 3.2 && !q.tsunami) continue;
        const type = q.mag >= 5.0 || q.tsunami ? 'CRITICAL' : q.mag >= 4.0 ? 'WARNING' : 'INFO';
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

    // 6. High BGP Withdrawal Activity (INFO)
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
          type: 'INFO',
          score: Math.min(84, 52 + Math.round(this.data.bgpWithdrawRate * 0.4)),
          lat: col.lat,
          lon: col.lon,
          item: col,
        });
      }
    }

    // 7. Critical Internet Outages (IODA CRITICAL alerts)
    if (this.enabled.outages) {
      for (const o of this.data.outages) {
        if (o.source !== 'IODA' || o.severity !== 'CRITICAL') continue;
        items.push({
          kind: 'outage',
          id: o.id,
          badge: 'IODA',
          code: `${o.countryCode || 'NET'}-${String(o.datasource || 'OUT').toUpperCase().slice(0, 6)}`,
          title: o.title,
          sub: `${o.countryName}${o.dropPct !== null ? ` • -${o.dropPct}% DROP` : ''}`,
          status: 'OUTAGE',
          type: 'CRITICAL',
          score: 86,
          lat: o.lat,
          lon: o.lon,
          item: o,
        });
      }
    }

    // 8. Upcoming / Imminent Orbital Launches (GO or |T-minus| <= 6h)
    if (this.enabled.launches) {
      for (const l of this.data.launches) {
        const statusUpper = String(l.status || '').toUpperCase();
        const withinSixHours = Number.isFinite(l.tMinusSec) && Math.abs(l.tMinusSec) <= 21600;
        if (statusUpper !== 'GO' && !withinSixHours) continue;
        const imminent = Number.isFinite(l.tMinusSec) && Math.abs(l.tMinusSec) <= 7200;
        items.push({
          kind: 'launch',
          id: l.id,
          badge: 'LL2',
          code: statusUpper || 'TBD',
          title: l.name,
          sub: `${l.provider} • ${l.padName}`,
          status: l.webcastLive ? 'WEBCAST LIVE' : l.statusText,
          type: imminent ? 'WARNING' : 'INFO',
          score: imminent ? 70 : 54,
          lat: l.lat,
          lon: l.lon,
          item: l,
        });
      }
    }

    // 9. Elevated Air Quality Hazards (US AQI >= 130)
    if (this.enabled.airq) {
      for (const a of this.data.airq) {
        if (!Number.isFinite(a.usAqi) || a.usAqi < 130) continue;
        const type = a.usAqi >= 200 ? 'CRITICAL' : 'WARNING';
        const score = a.usAqi >= 200 ? 78 : a.usAqi >= 151 ? 66 : 56;
        items.push({
          kind: 'airq',
          id: a.id,
          badge: 'AIRQ',
          code: `AQI ${a.usAqi}`,
          title: `${a.name} AIR QUALITY`,
          sub: `PM2.5 ${a.pm25} µg/m³ • UV ${a.uvIndex}`,
          status: a.category,
          type,
          score,
          lat: a.lat,
          lon: a.lon,
          item: a,
        });
      }
    }

    // 10. Severe Ocean Swell (waveM >= 5.0m) or DART Tsunami Buoy Pressure Tendency (|ptdyHpa| >= 3)
    if (this.enabled.buoys) {
      for (const b of this.data.buoys) {
        const isDartAlert = Boolean(b.isDart && b.ptdyHpa !== null && Math.abs(b.ptdyHpa) >= 3);
        const isHighWave = b.waveM !== null && b.waveM >= 5.0;
        if (!isDartAlert && !isHighWave) continue;
        const type = isDartAlert || (b.waveM !== null && b.waveM >= 6.5) ? 'CRITICAL' : 'WARNING';
        const score = isDartAlert ? 89 : b.waveM >= 6.5 ? 76 : 62;
        items.push({
          kind: 'buoy',
          id: b.id,
          badge: b.isDart ? 'DART' : 'NDBC',
          code: b.stationId,
          title: b.name,
          sub: isDartAlert
            ? `ΔP ${b.ptdyHpa > 0 ? '+' : ''}${b.ptdyHpa} hPa • TSUNAMI BUOY`
            : `WAVE ${b.waveM.toFixed(1)} M${b.periodSec !== null ? ` • ${b.periodSec}s` : ''}`,
          status: isDartAlert ? 'PRESSURE SHIFT' : `SEA ${b.waveM.toFixed(1)}M`,
          type,
          score,
          lat: b.lat,
          lon: b.lon,
          item: b,
        });
      }
    }

    // 11. Top 4 Geocoded Global News Wire Headlines (INFO)
    if (this.enabled.news && this.data.news.length > 0) {
      const topNews = this.data.news.slice(0, 4);
      for (let i = 0; i < topNews.length; i++) {
        const n = topNews[i];
        items.push({
          kind: 'news',
          id: n.id,
          badge: n.source === 'BBC WORLD' ? 'BBC' : 'WIKI',
          code: n.countryCode || 'INTL',
          title: n.title,
          sub: `${n.countryName} • ${n.source}`,
          status: 'BRIEF',
          type: 'INFO',
          score: 44 - i,
          lat: n.lat,
          lon: n.lon,
          item: n,
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
    let peakQuakeMag = 0;
    let m5Count = 0;
    let hasTsunami = false;
    const quakeCount = this.data.quakes.length;
    for (const q of this.data.quakes) {
      if (q.mag > peakQuakeMag) peakQuakeMag = q.mag;
      if (q.mag >= 5.0) m5Count++;
      if (q.tsunami) hasTsunami = true;
    }
    if (peakQuakeMag >= 7.0) score += 28;
    else if (peakQuakeMag >= 6.0) score += 20;
    else if (peakQuakeMag >= 5.0) score += 13;
    else if (peakQuakeMag >= 4.0) score += 6;
    else if (peakQuakeMag >= 3.0) score += 2;
    score += Math.min(10, m5Count * 2);

    // GDACS Red/Orange contribution
    let gdacsRedCount = 0;
    let gdacsOrangeCount = 0;
    for (const g of this.data.gdacs) {
      if (g.alertLevel === 'Red') gdacsRedCount++;
      else if (g.alertLevel === 'Orange') gdacsOrangeCount++;
    }
    score += Math.min(24, gdacsRedCount * 10);
    score += Math.min(12, gdacsOrangeCount * 3);

    // NOAA Kp & X-ray flare contribution
    if (kp >= 7) score += 16;
    else if (kp >= 5) score += 9;
    else if (kp >= 4) score += 4;

    if (flareClass.startsWith('X')) score += 16;
    else if (flareClass.startsWith('M')) score += 9;
    else if (flareClass.startsWith('C')) score += 3;

    // ADS-B emergency squawks contribution
    let emgAircraftCount = 0;
    for (const ac of this.data.aircraft) {
      if (ac.emergency || ac.squawk === '7700' || ac.squawk === '7600' || ac.squawk === '7500') {
        emgAircraftCount++;
      }
    }
    score += Math.min(20, emgAircraftCount * 12);

    // BGP withdrawal rate contribution
    const wdr = this.data.bgpWithdrawRate || 0;
    score += Math.min(14, Math.floor(wdr / 15) * 2);

    // Internet outages (IODA critical alerts) contribution
    let criticalOutageCount = 0;
    for (const o of this.data.outages) {
      if (o.source === 'IODA' && o.severity === 'CRITICAL') criticalOutageCount++;
    }
    score += Math.min(16, criticalOutageCount * 5);

    // Orbital launches (GO / imminent within 6h) contribution
    let imminentLaunchCount = 0;
    for (const l of this.data.launches) {
      if (Number.isFinite(l.tMinusSec) && Math.abs(l.tMinusSec) <= 21600) imminentLaunchCount++;
    }
    score += Math.min(6, imminentLaunchCount * 3);

    // Air Quality (US AQI >= 130) contribution
    let peakUsAqi = 0;
    for (const a of this.data.airq) {
      if (Number.isFinite(a.usAqi) && a.usAqi > peakUsAqi) peakUsAqi = a.usAqi;
    }
    if (peakUsAqi >= 200) score += 8;
    else if (peakUsAqi >= 151) score += 4;
    else if (peakUsAqi >= 130) score += 2;

    // Ocean Buoys & DART Tsunami contribution
    let peakWaveM = 0;
    let dartAlertCount = 0;
    for (const b of this.data.buoys) {
      if (b.waveM !== null && b.waveM > peakWaveM) peakWaveM = b.waveM;
      if (b.isDart && b.ptdyHpa !== null && Math.abs(b.ptdyHpa) >= 3) dartAlertCount++;
    }
    if (dartAlertCount > 0) score += 14;
    if (peakWaveM >= 7.0) score += 8;
    else if (peakWaveM >= 5.0) score += 4;

    const newsCount = this.data.news.length;

    const anomalyIndex = Number(Math.max(12, Math.min(98, score)).toFixed(1));

    let watchLevel = 1;
    let watchLabel = 'NOMINAL';
    if (
      hasTsunami ||
      dartAlertCount >= 1 ||
      peakQuakeMag >= 7.0 ||
      gdacsRedCount >= 2 ||
      kp >= 8 ||
      flareClass.startsWith('X') ||
      emgAircraftCount >= 1
    ) {
      watchLevel = 5;
      watchLabel = 'SEVERE';
    } else if (
      peakQuakeMag >= 6.0 ||
      gdacsRedCount >= 1 ||
      kp >= 6 ||
      flareClass.startsWith('M') ||
      criticalOutageCount >= 3
    ) {
      watchLevel = 4;
      watchLabel = 'HIGH';
    } else if (
      peakQuakeMag >= 5.2 ||
      gdacsOrangeCount >= 2 ||
      kp >= 5 ||
      wdr >= 40 ||
      criticalOutageCount >= 1 ||
      peakUsAqi >= 200 ||
      peakWaveM >= 7.0
    ) {
      watchLevel = 3;
      watchLabel = 'ELEVATED';
    } else if (
      peakQuakeMag >= 4.5 ||
      gdacsOrangeCount >= 1 ||
      kp >= 4 ||
      flareClass.startsWith('C') ||
      peakUsAqi >= 130 ||
      peakWaveM >= 5.0 ||
      imminentLaunchCount >= 1
    ) {
      watchLevel = 2;
      watchLabel = 'GUARDED';
    }

    return {
      anomalyIndex,
      activeFeeds,
      healthyFeeds,
      errorFeeds,
      totalRate,
      flareClass,
      kp,
      peakQuakeMag,
      quakeCount,
      gdacsRedCount,
      gdacsOrangeCount,
      emgAircraftCount,
      hasTsunami,
      criticalOutageCount,
      imminentLaunchCount,
      peakUsAqi,
      peakWaveM,
      dartAlertCount,
      newsCount,
      watchLevel,
      watchLabel,
    };
  }
}
