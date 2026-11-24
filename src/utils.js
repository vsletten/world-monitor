// ============================================================================
// AEGIS // SHARED UTILITIES — ESCAPING, THEME CACHE, MGRS, SOLAR, SOURCE URLS
// ============================================================================

const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

// Theme-keyed CSS variable & palette cache to avoid getComputedStyle on hot 60fps paths.
const THEME_FALLBACKS = {
  accent: '#00e5ff',
  accentRgb: '0, 229, 255',
  secondary: '#4fa8ff',
  secondaryRgb: '79, 168, 255',
  ok: '#00ff9c',
  okRgb: '0, 255, 156',
  warn: '#ffb000',
  warnRgb: '255, 176, 0',
  crit: '#ff2a55',
  critRgb: '255, 42, 85',
  covert: '#b46cff',
  covertRgb: '180, 108, 255',
  textMain: '#d8f3ff',
  textDim: '#739cb5',
  textMuted: '#456880',
};

const PALETTE_VAR_SPEC = [
  ['accent', '--accent', THEME_FALLBACKS.accent],
  ['accentRgb', '--accent-rgb', THEME_FALLBACKS.accentRgb],
  ['secondary', '--secondary', THEME_FALLBACKS.secondary],
  ['secondaryRgb', '--secondary-rgb', THEME_FALLBACKS.secondaryRgb],
  ['ok', '--ok', THEME_FALLBACKS.ok],
  ['okRgb', '--ok-rgb', THEME_FALLBACKS.okRgb],
  ['warn', '--warn', THEME_FALLBACKS.warn],
  ['warnRgb', '--warn-rgb', THEME_FALLBACKS.warnRgb],
  ['crit', '--crit', THEME_FALLBACKS.crit],
  ['critRgb', '--crit-rgb', THEME_FALLBACKS.critRgb],
  ['covert', '--covert', THEME_FALLBACKS.covert],
  ['covertRgb', '--covert-rgb', THEME_FALLBACKS.covertRgb],
  ['textMain', '--text-main', THEME_FALLBACKS.textMain],
  ['textDim', '--text-dim', THEME_FALLBACKS.textDim],
  ['textMuted', '--text-muted', THEME_FALLBACKS.textMuted],
];

const themeCache = new Map();
let activeThemeKey = null;

function resolveThemeKey() {
  if (typeof document === 'undefined' || !document.documentElement) return 'cyan';
  return document.documentElement.getAttribute('data-theme') || 'cyan';
}

function getThemeEntry() {
  const theme = resolveThemeKey();
  if (activeThemeKey !== null && activeThemeKey !== theme) {
    themeCache.delete(activeThemeKey);
  }
  activeThemeKey = theme;

  let entry = themeCache.get(theme);
  if (!entry) {
    const hasDom =
      typeof document !== 'undefined' &&
      document.documentElement &&
      typeof getComputedStyle === 'function';
    const style = hasDom ? getComputedStyle(document.documentElement) : null;
    entry = {
      theme,
      style,
      vars: new Map(),
      palette: null,
    };
    themeCache.set(theme, entry);
  }
  return entry;
}

export function invalidateThemePalette() {
  themeCache.clear();
  activeThemeKey = null;
}

export function getCachedCssVar(name, fallback = '#00e5ff') {
  const entry = getThemeEntry();
  if (entry.vars.has(name)) {
    return entry.vars.get(name) || fallback;
  }
  let value = '';
  if (entry.style) {
    value = entry.style.getPropertyValue(name).trim();
  }
  entry.vars.set(name, value);
  return value || fallback;
}

export function getThemePalette() {
  const entry = getThemeEntry();
  if (entry.palette) return entry.palette;

  const palette = { theme: entry.theme };
  for (let i = 0; i < PALETTE_VAR_SPEC.length; i++) {
    const [prop, cssVar, fallback] = PALETTE_VAR_SPEC[i];
    palette[prop] = getCachedCssVar(cssVar, fallback);
  }
  entry.palette = palette;
  return palette;
}

// ============================================================================
// WGS-84 LAT/LON -> UTM -> MGRS CONVERTER
// ============================================================================

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2);
const UTM_K0 = 0.9996;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const MGRS_LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const MGRS_COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const MGRS_ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

export function formatMgrs(lat, lon) {
  const phiDeg = Number(lat);
  const lamDeg = Number(lon);
  if (!Number.isFinite(phiDeg) || !Number.isFinite(lamDeg)) return '';

  if (phiDeg < -80) return 'UPS SOUTH';
  if (phiDeg >= 84) return 'UPS NORTH';

  // Normalize longitude to [-180, 180)
  const normLon = ((((lamDeg + 180) % 360) + 360) % 360) - 180;

  let zone = Math.floor((normLon + 180) / 6) + 1;
  if (zone < 1) zone = 1;
  if (zone > 60) zone = 60;

  // Norway & Svalbard UTM zone exceptions
  if (phiDeg >= 56 && phiDeg < 64 && normLon >= 3 && normLon < 12) {
    zone = 32;
  } else if (phiDeg >= 72 && phiDeg < 84) {
    if (normLon >= 0 && normLon < 9) zone = 31;
    else if (normLon >= 9 && normLon < 21) zone = 33;
    else if (normLon >= 21 && normLon < 33) zone = 35;
    else if (normLon >= 33 && normLon < 42) zone = 37;
  }

  const bandIdx = Math.min(19, Math.max(0, Math.floor((phiDeg + 80) / 8)));
  const band = MGRS_LAT_BANDS[bandIdx];

  const phi = phiDeg * DEG_TO_RAD;
  const lambda = normLon * DEG_TO_RAD;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * DEG_TO_RAD;
  const dLon = lambda - lon0;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = WGS84_EP2 * cosPhi * cosPhi;
  const A = cosPhi * dLon;
  const A2 = A * A;
  const A3 = A2 * A;
  const A4 = A2 * A2;
  const A5 = A4 * A;
  const A6 = A4 * A2;

  const e4 = WGS84_E2 * WGS84_E2;
  const e6 = e4 * WGS84_E2;
  const M =
    WGS84_A *
    ((1 - WGS84_E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * WGS84_E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));

  const easting =
    500000 +
    UTM_K0 *
      N *
      (A +
        ((1 - T + C) * A3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * WGS84_EP2) * A5) / 120);

  let northing =
    UTM_K0 *
    (M +
      N *
        tanPhi *
        (A2 / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * WGS84_EP2) * A6) / 720));

  if (phiDeg < 0) {
    northing += 10000000;
  }

  const colSet = MGRS_COL_SETS[(zone - 1) % 3];
  const colIdx = (((Math.floor(easting / 100000) - 1) % 8) + 8) % 8;
  const colLetter = colSet[colIdx];

  const rowOffset = zone % 2 === 0 ? 5 : 0;
  const rowIdx = (Math.floor(northing / 100000) + rowOffset) % 20;
  const rowLetter = MGRS_ROW_LETTERS[rowIdx];

  const e10m = String(Math.floor((easting % 100000) / 10)).padStart(4, '0');
  const n10m = String(Math.floor((northing % 100000) / 10)).padStart(4, '0');

  return `${zone}${band} ${colLetter}${rowLetter} ${e10m} ${n10m}`;
}

// ============================================================================
// SOLAR DECLINATION / SUBSOLAR POINT & NIGHT TERMINATOR CENTER
// ============================================================================

function wrapDeg180(deg) {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

export function getSubsolarPoint(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const ms = d.getTime();
  const jd = ms / 86400000 + 2440587.5;
  const n = jd - 2451545.0; // Days since J2000.0

  const meanLon = (((280.46 + 0.9856474 * n) % 360) + 360) % 360;
  const meanAnom = (((357.528 + 0.9856003 * n) % 360) + 360) % 360;
  const meanAnomRad = meanAnom * DEG_TO_RAD;

  const eclipticLon =
    meanLon + 1.915 * Math.sin(meanAnomRad) + 0.02 * Math.sin(2 * meanAnomRad);
  const eclipticLonRad = eclipticLon * DEG_TO_RAD;

  const obliquity = (23.439 - 0.0000004 * n) * DEG_TO_RAD;

  const sinDec = Math.sin(obliquity) * Math.sin(eclipticLonRad);
  const lat = Math.asin(Math.max(-1, Math.min(1, sinDec))) * RAD_TO_DEG;

  const ra =
    Math.atan2(
      Math.cos(obliquity) * Math.sin(eclipticLonRad),
      Math.cos(eclipticLonRad)
    ) * RAD_TO_DEG;

  // Equation of Time in degrees (apparent solar time - mean solar time)
  const eotDeg = wrapDeg180(meanLon - ra);

  const utcHours =
    d.getUTCHours() +
    d.getUTCMinutes() / 60 +
    d.getUTCSeconds() / 3600 +
    d.getUTCMilliseconds() / 3600000;

  const lon = wrapDeg180((12 - utcHours) * 15 - eotDeg);
  return { lon, lat };
}

export function getNightCircleCenter(date = new Date()) {
  const { lon, lat } = getSubsolarPoint(date);
  const antiLon = lon >= 0 ? lon - 180 : lon + 180;
  const antiLat = lat === 0 ? 0 : -lat;
  return [antiLon, antiLat];
}

// ============================================================================
// SAFE EXTERNAL SOURCE URL BUILDER
// ============================================================================

function isSafeHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

export function buildExternalSourceUrl(kind, item) {
  if (!item && kind !== 'cable' && kind !== 'solar') return null;
  const data = item || {};
  let result = null;

  switch (kind) {
    case 'quake': {
      if (data.url) {
        if (!isSafeHttpUrl(data.url)) return null;
        result = { label: 'USGS EVENT ↗', url: data.url.trim() };
      } else if (data.id != null && data.id !== '') {
        result = {
          label: 'USGS EVENT ↗',
          url:
            'https://earthquake.usgs.gov/earthquakes/eventpage/' +
            encodeURIComponent(data.id),
        };
      }
      break;
    }
    case 'gdacs': {
      if (data.reportUrl) {
        if (!isSafeHttpUrl(data.reportUrl)) return null;
        result = { label: 'GDACS REPORT ↗', url: data.reportUrl.trim() };
      } else {
        const eventId =
          data.eventId != null && data.eventId !== ''
            ? data.eventId
            : data.id != null && data.id !== ''
              ? String(data.id).split('-').pop()
              : '';
        if (data.eventType && eventId) {
          result = {
            label: 'GDACS REPORT ↗',
            url:
              'https://www.gdacs.org/report.aspx?eventtype=' +
              encodeURIComponent(data.eventType) +
              '&eventid=' +
              encodeURIComponent(eventId),
          };
        }
      }
      break;
    }
    case 'eonet': {
      if (data.sourceUrl) {
        if (!isSafeHttpUrl(data.sourceUrl)) return null;
        result = { label: 'NASA EONET ↗', url: data.sourceUrl.trim() };
      } else if (data.id != null && data.id !== '') {
        result = {
          label: 'NASA EONET ↗',
          url:
            'https://eonet.gsfc.nasa.gov/api/v3/events/' +
            encodeURIComponent(data.id),
        };
      }
      break;
    }
    case 'aircraft': {
      if (data.hex != null && String(data.hex).trim() !== '') {
        result = {
          label: 'ADSB GLOBE ↗',
          url:
            'https://globe.adsb.lol/?icao=' +
            encodeURIComponent(String(data.hex).trim().toLowerCase()),
        };
      }
      break;
    }
    case 'liveSat': {
      const norad = Number(data.noradId);
      if (Number.isFinite(norad) && norad > 0) {
        result = {
          label: norad === 25544 ? 'NASA ISS ↗' : 'CELESTRAK ↗',
          url:
            norad === 25544
              ? 'https://spotthestation.nasa.gov/tracking_map.cfm'
              : 'https://celestrak.org/NORAD/elements/gp.php?CATNR=' +
                encodeURIComponent(data.noradId) +
                '&FORMAT=tle',
        };
      }
      break;
    }
    case 'bgp': {
      const target = data.lastPrefix || data.lastAsn || data.host;
      if (target != null && String(target).trim() !== '') {
        result = {
          label: 'RIPE STAT ↗',
          url: 'https://stat.ripe.net/' + encodeURIComponent(target),
        };
      }
      break;
    }
    case 'wiki': {
      const lang =
        String(data.lang || 'en')
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '') || 'en';
      result = {
        label: 'WIKI DIFF ↗',
        url: data.revid
          ? 'https://' +
            lang +
            '.wikipedia.org/w/index.php?diff=' +
            encodeURIComponent(data.revid)
          : 'https://' + lang + '.wikipedia.org/wiki/Special:RecentChanges',
      };
      break;
    }
    case 'place':
    case 'meteo': {
      const lat = Number(data.lat);
      const lon = Number(data.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        result = {
          label: 'WINDY MAP ↗',
          url:
            'https://www.windy.com/?' +
            lat.toFixed(2) +
            ',' +
            lon.toFixed(2) +
            ',6',
        };
      }
      break;
    }
    case 'cable': {
      result = {
        label: 'SUBSEA MAP ↗',
        url: 'https://www.submarinecablemap.com/',
      };
      break;
    }
    case 'country': {
      if (data.openFactbookUrl) {
        if (!isSafeHttpUrl(data.openFactbookUrl)) return null;
        result = { label: 'OPEN FACTBOOK ↗', url: data.openFactbookUrl.trim() };
      } else {
        const slug = String(data.openFactbookSlug || data.ciaSlug || '').trim();
        if (slug) {
          result = {
            label: 'OPEN FACTBOOK ↗',
            url:
              'https://openfactbook.org/countries/' +
              encodeURIComponent(slug) +
              '/',
          };
        } else if (data.name && String(data.name).trim()) {
          result = {
            label: 'WIKIPEDIA ↗',
            url:
              'https://en.wikipedia.org/wiki/' +
              encodeURIComponent(String(data.name).trim().replace(/\s+/g, '_')),
          };
        }
      }
      break;
    }
    case 'outage': {
      const label =
        data.source === 'OONI' ? 'OONI EXPLORER ↗' : 'IODA OUTAGES ↗';
      if (data.reportUrl) {
        if (!isSafeHttpUrl(data.reportUrl)) return null;
        result = { label, url: data.reportUrl.trim() };
      } else {
        result = {
          label,
          url:
            data.source === 'OONI'
              ? 'https://explorer.ooni.org/chart/mat?probe_cc=' +
                encodeURIComponent(data.countryCode || '')
              : 'https://ioda.inetintel.cc.gatech.edu/country/' +
                encodeURIComponent(data.countryCode || ''),
        };
      }
      break;
    }
    case 'launch': {
      if (data.webcastUrl) {
        if (!isSafeHttpUrl(data.webcastUrl)) return null;
        result = { label: 'WATCH STREAM ↗', url: data.webcastUrl.trim() };
      } else if (data.infoUrl) {
        if (!isSafeHttpUrl(data.infoUrl)) return null;
        result = { label: 'LAUNCH INFO ↗', url: data.infoUrl.trim() };
      } else {
        result = {
          label: 'LAUNCH INFO ↗',
          url: 'https://nextspaceflight.com/launches/',
        };
      }
      break;
    }
    case 'news': {
      if (data.url) {
        if (!isSafeHttpUrl(data.url)) return null;
        result = { label: 'OPEN ARTICLE ↗', url: data.url.trim() };
      } else {
        result = {
          label: 'OPEN ARTICLE ↗',
          url: 'https://www.bbc.com/news/world',
        };
      }
      break;
    }
    case 'airq': {
      const lat = Number(data.lat || 0);
      const lon = Number(data.lon || 0);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        result = {
          label: 'AIR QUALITY ↗',
          url:
            'https://www.iqair.com/earth?nav=&lat=' +
            lat.toFixed(2) +
            '&lng=' +
            lon.toFixed(2) +
            '&zoom=5',
        };
      }
      break;
    }
    case 'buoy': {
      result = {
        label: 'NOAA NDBC ↗',
        url:
          'https://www.ndbc.noaa.gov/station_page.php?station=' +
          encodeURIComponent(data.stationId || data.id || ''),
      };
      break;
    }
    case 'solar': {
      result = {
        label: 'NOAA SWPC ↗',
        url: 'https://www.swpc.noaa.gov/',
      };
      break;
    }
    default:
      return null;
  }

  if (!result || !isSafeHttpUrl(result.url)) return null;
  return result;
}
