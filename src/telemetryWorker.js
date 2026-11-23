// ============================================================================
// AEGIS // TELEMETRY WEB WORKER (SGP4 ORBITAL PROPAGATION + RIPE RIS BGP)
// ============================================================================

import {
  json2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from 'satellite.js';

// ----------------------------------------------------------------------------
// SUBSYSTEM A — SGP4 ORBITAL PROPAGATION
// ----------------------------------------------------------------------------
const SAT_PROP_INTERVAL_MS = 500;
const SAT_TRACK_REBUILD_MS = 45000;

let compiledSats = []; // [{ id, noradId, satrec }]
let satsEnabled = true;
let satTimer = null;
let lastTrackRebuildMs = 0;

function propagateAt(satrec, date) {
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
  return {
    lat,
    lon,
    altKm: Math.round(gd.height),
    velKms,
  };
}

function emitSatPositions(nowMs = Date.now()) {
  if (!satsEnabled || compiledSats.length === 0) return;
  const nowDate = new Date(nowMs);
  const positions = [];
  for (let i = 0; i < compiledSats.length; i++) {
    const sat = compiledSats[i];
    const p = propagateAt(sat.satrec, nowDate);
    if (!p) continue;
    positions.push({
      id: sat.id,
      lat: p.lat,
      lon: p.lon,
      altKm: p.altKm,
      velKms: p.velKms,
    });
  }
  if (positions.length > 0) {
    self.postMessage({ type: 'sats:positions', nowMs, positions });
  }
  if (nowMs - lastTrackRebuildMs >= SAT_TRACK_REBUILD_MS) {
    emitSatTracks(nowMs);
  }
}

function emitSatTracks(nowMs = Date.now()) {
  if (compiledSats.length === 0) return;
  lastTrackRebuildMs = nowMs;
  const tracks = {};
  for (let i = 0; i < compiledSats.length; i++) {
    const sat = compiledSats[i];
    const pts = [];
    // -24 to +66 minutes in 2-minute steps (~1 full LEO orbit)
    for (let m = -24; m <= 66; m += 2) {
      const p = propagateAt(sat.satrec, new Date(nowMs + m * 60000));
      if (p) pts.push([p.lon, p.lat]);
    }
    tracks[sat.id] = pts;
  }
  self.postMessage({ type: 'sats:tracks', tracks });
}

function stopSatTimer() {
  if (satTimer !== null) {
    clearInterval(satTimer);
    satTimer = null;
  }
}

function syncSatTimer() {
  stopSatTimer();
  if (!satsEnabled || compiledSats.length === 0) return;
  const nowMs = Date.now();
  emitSatPositions(nowMs);
  satTimer = setInterval(() => {
    emitSatPositions(Date.now());
  }, SAT_PROP_INTERVAL_MS);
}

function handleSatsInit(records) {
  const next = [];
  if (Array.isArray(records)) {
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec || !rec.id || !rec.omm) continue;
      try {
        const satrec = json2satrec(rec.omm);
        if (satrec) {
          next.push({ id: rec.id, noradId: rec.noradId, satrec });
        }
      } catch {
        // skip malformed OMM
      }
    }
  }
  compiledSats = next;
  lastTrackRebuildMs = 0;
  if (compiledSats.length > 0) {
    const nowMs = Date.now();
    emitSatTracks(nowMs);
    syncSatTimer();
  } else {
    stopSatTimer();
  }
}

function handleSatsEnable(enabled) {
  satsEnabled = Boolean(enabled);
  syncSatTimer();
}

// ----------------------------------------------------------------------------
// SUBSYSTEM B — RIPE RIS LIVE BGP FIREHOSE (O(1) MAP + 500MS BATCHED TICKS)
// ----------------------------------------------------------------------------
const BGP_TICK_MS = 500;
const BGP_WINDOW_SLOTS = 4; // 4 x 500ms = 2.0s rolling rate window
const BGP_MAX_PULSES_PER_TICK = 6;
const BGP_SAMPLE_LOG_COOLDOWN_MS = 7500;
const BGP_BACKOFF_BASE_MS = 2000;
const BGP_BACKOFF_MAX_MS = 30000;

let bgpEnabled = false;
let bgpUrls = [];
let bgpUrlIndex = 0;
let bgpWs = null;
let bgpTickTimer = null;
let bgpReconnectTimer = null;
let bgpReconnectAttempt = 0;
let bgpConnSeq = 0;

// Map<host, { host, msgCount, recentRate, lastPrefix, lastAsn, lastPulseAt, tickCount, slots }>
const collectorMap = new Map();

let tickTotalCount = 0;
let tickWithdrawCount = 0;
let totalSlots = [0, 0, 0, 0];
let withdrawSlots = [0, 0, 0, 0];
let slotCursor = 0;
let filledSlots = 0;

let tickPulses = [];
let tickPulseHosts = new Set();
let pendingSampleLog = null;
let lastSampleLogAt = 0;

function clearBgpReconnectTimer() {
  if (bgpReconnectTimer !== null) {
    clearTimeout(bgpReconnectTimer);
    bgpReconnectTimer = null;
  }
}

function stopBgpTickTimer() {
  if (bgpTickTimer !== null) {
    clearInterval(bgpTickTimer);
    bgpTickTimer = null;
  }
}

function closeActiveBgpSocket() {
  bgpConnSeq++;
  if (bgpWs) {
    const old = bgpWs;
    bgpWs = null;
    old.onopen = null;
    old.onmessage = null;
    old.onerror = null;
    old.onclose = null;
    try {
      old.close();
    } catch {
      // ignore close errors
    }
  }
}

function resetBgpWindowState() {
  tickTotalCount = 0;
  tickWithdrawCount = 0;
  totalSlots = [0, 0, 0, 0];
  withdrawSlots = [0, 0, 0, 0];
  slotCursor = 0;
  filledSlots = 0;
  tickPulses = [];
  tickPulseHosts.clear();
  pendingSampleLog = null;
  for (const col of collectorMap.values()) {
    col.tickCount = 0;
    col.recentRate = 0;
    col.slots = [0, 0, 0, 0];
  }
}

function startBgpTickTimer() {
  stopBgpTickTimer();
  bgpTickTimer = setInterval(() => {
    if (!bgpEnabled) return;

    totalSlots[slotCursor] = tickTotalCount;
    withdrawSlots[slotCursor] = tickWithdrawCount;
    tickTotalCount = 0;
    tickWithdrawCount = 0;

    if (filledSlots < BGP_WINDOW_SLOTS) filledSlots++;
    const windowSec = filledSlots * (BGP_TICK_MS / 1000);

    let totalSum = 0;
    let withdrawSum = 0;
    for (let i = 0; i < filledSlots; i++) {
      totalSum += totalSlots[i];
      withdrawSum += withdrawSlots[i];
    }

    const bgpRate = Math.round(totalSum / windowSec);
    const withdrawRate = Math.round(withdrawSum / windowSec);

    const collectors = [];
    for (const col of collectorMap.values()) {
      col.slots[slotCursor] = col.tickCount;
      col.tickCount = 0;
      let colSum = 0;
      for (let i = 0; i < filledSlots; i++) {
        colSum += col.slots[i];
      }
      col.recentRate = Number((colSum / windowSec).toFixed(1));
      collectors.push({
        host: col.host,
        msgCount: col.msgCount,
        recentRate: col.recentRate,
        lastPrefix: col.lastPrefix,
        lastAsn: col.lastAsn,
        lastPulseAt: col.lastPulseAt,
      });
    }

    slotCursor = (slotCursor + 1) % BGP_WINDOW_SLOTS;

    const pulses = tickPulses;
    const sampleLog = pendingSampleLog;
    tickPulses = [];
    tickPulseHosts.clear();
    pendingSampleLog = null;

    self.postMessage({
      type: 'bgp:tick',
      bgpRate,
      withdrawRate,
      collectors,
      pulses,
      sampleLog,
    });
  }, BGP_TICK_MS);
}

function scheduleBgpReconnect() {
  clearBgpReconnectTimer();
  if (!bgpEnabled || bgpUrls.length === 0) return;

  const baseDelay = Math.min(BGP_BACKOFF_MAX_MS, BGP_BACKOFF_BASE_MS * Math.pow(2, bgpReconnectAttempt));
  const jitter = Math.floor(Math.random() * 1000);
  const delayMs = baseDelay + jitter;
  bgpReconnectAttempt = Math.min(bgpReconnectAttempt + 1, 8);

  bgpReconnectTimer = setTimeout(() => {
    bgpReconnectTimer = null;
    if (!bgpEnabled) return;
    bgpUrlIndex = 0;
    openBgpSocket();
  }, delayMs);
}

function openBgpSocket() {
  clearBgpReconnectTimer();
  closeActiveBgpSocket();
  if (!bgpEnabled || bgpUrls.length === 0) return;

  const url = bgpUrls[bgpUrlIndex] || bgpUrls[0];
  const seq = bgpConnSeq;
  let opened = false;
  let handledFailure = false;

  const handleFailure = (reason) => {
    if (handledFailure || seq !== bgpConnSeq) return;
    handledFailure = true;

    if (bgpWs) {
      const old = bgpWs;
      bgpWs = null;
      old.onopen = null;
      old.onmessage = null;
      old.onerror = null;
      old.onclose = null;
      try {
        old.close();
      } catch {
        // ignore
      }
    }

    if (!bgpEnabled) return;

    // Immediate fallback to next URL if the socket failed before opening
    if (!opened && bgpUrlIndex + 1 < bgpUrls.length) {
      bgpUrlIndex++;
      openBgpSocket();
      return;
    }

    self.postMessage({
      type: 'bgp:status',
      state: 'error',
      url,
      error: reason || 'WS error',
    });
    scheduleBgpReconnect();
  };

  try {
    const ws = new WebSocket(url);
    bgpWs = ws;

    ws.onopen = () => {
      if (seq !== bgpConnSeq || !bgpEnabled) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        return;
      }
      opened = true;
      bgpReconnectAttempt = 0;
      try {
        ws.send(JSON.stringify({ type: 'ris_subscribe', data: { type: 'UPDATE' } }));
      } catch {
        // ignore
      }
      self.postMessage({ type: 'bgp:status', state: 'live', url });
    };

    ws.onmessage = (ev) => {
      if (!bgpEnabled || seq !== bgpConnSeq) return;
      tickTotalCount++;

      let parsed;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      const d = parsed?.data;
      if (!d || !d.host) return;

      const col = collectorMap.get(d.host);
      if (!col) return;

      const isWithdraw = Array.isArray(d.withdrawals) && d.withdrawals.length > 0;
      if (isWithdraw) tickWithdrawCount++;

      const prefix = isWithdraw
        ? d.withdrawals[0]
        : d.announcements?.[0]?.prefixes?.[0] || '';
      const asn = d.peer_asn ? `AS${d.peer_asn}` : d.path?.[0] ? `AS${d.path[0]}` : 'AS?';
      const ts = Date.now();

      col.msgCount++;
      col.tickCount++;
      col.lastPulseAt = ts;
      if (prefix) col.lastPrefix = prefix;
      col.lastAsn = asn;

      if (prefix) {
        if (tickPulses.length < BGP_MAX_PULSES_PER_TICK && (!tickPulseHosts.has(d.host) || isWithdraw)) {
          tickPulses.push({ host: d.host, isWithdraw, prefix, asn, ts });
          tickPulseHosts.add(d.host);
        } else if (isWithdraw && tickPulses.length >= BGP_MAX_PULSES_PER_TICK) {
          // Prioritize withdrawals over routine announcements in the 500ms batch
          const replaceIdx = tickPulses.findIndex((p) => !p.isWithdraw);
          if (replaceIdx !== -1) {
            tickPulses[replaceIdx] = { host: d.host, isWithdraw, prefix, asn, ts };
          }
        }

        if (!pendingSampleLog && ts - lastSampleLogAt >= BGP_SAMPLE_LOG_COOLDOWN_MS) {
          lastSampleLogAt = ts;
          pendingSampleLog = { host: d.host, isWithdraw, prefix, asn, ts };
        }
      }
    };

    ws.onerror = () => {
      if (!opened) {
        handleFailure('WS connection error');
      }
    };

    ws.onclose = () => {
      handleFailure('WS closed');
    };
  } catch (err) {
    handleFailure(err?.message || 'WS init error');
  }
}

function handleBgpConnect(urls, hosts) {
  clearBgpReconnectTimer();
  closeActiveBgpSocket();

  bgpEnabled = true;
  bgpReconnectAttempt = 0;
  bgpUrlIndex = 0;

  const cleanUrls = [];
  if (Array.isArray(urls)) {
    for (const u of urls) {
      if (typeof u === 'string' && u.length > 0 && !cleanUrls.includes(u)) {
        cleanUrls.push(u);
      }
    }
  }
  if (cleanUrls.length === 0) {
    cleanUrls.push('wss://ris-live.ripe.net/v1/ws/?client=aegis-command');
  }
  bgpUrls = cleanUrls;

  if (Array.isArray(hosts)) {
    for (let i = 0; i < hosts.length; i++) {
      const host = hosts[i];
      if (!host) continue;
      if (!collectorMap.has(host)) {
        collectorMap.set(host, {
          host,
          msgCount: 0,
          recentRate: 0,
          lastPrefix: '',
          lastAsn: '',
          lastPulseAt: 0,
          tickCount: 0,
          slots: [0, 0, 0, 0],
        });
      }
    }
  }

  resetBgpWindowState();
  startBgpTickTimer();
  openBgpSocket();
}

function handleBgpDisconnect() {
  bgpEnabled = false;
  bgpReconnectAttempt = 0;
  clearBgpReconnectTimer();
  stopBgpTickTimer();
  closeActiveBgpSocket();
  resetBgpWindowState();
}

// ----------------------------------------------------------------------------
// WORKER MESSAGE DISPATCH
// ----------------------------------------------------------------------------
self.addEventListener('message', (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'sats:init':
      handleSatsInit(msg.records);
      break;
    case 'sats:enable':
      handleSatsEnable(msg.enabled);
      break;
    case 'bgp:connect':
      handleBgpConnect(msg.urls, msg.hosts);
      break;
    case 'bgp:disconnect':
      handleBgpDisconnect();
      break;
    default:
      break;
  }
});
