// ============================================================================
// AEGIS // SECONDARY TACTICAL CANVAS WIDGETS (PROXIMITY RADAR, TELEMETRY SPECTRUM, SPARKLINE)
// ============================================================================

import { getThemePalette, getCachedCssVar } from './utils.js';

const DEG2RAD = Math.PI / 180;
const TWO_PI = Math.PI * 2;
const EARTH_RADIUS_KM = 6371;

function computeGeodesic(lat1Deg, lon1Deg, lat2Deg, lon2Deg) {
  const lat1 = lat1Deg * DEG2RAD;
  const lat2 = lat2Deg * DEG2RAD;
  const dLat = lat2 - lat1;
  const dLon = (lon2Deg - lon1Deg) * DEG2RAD;

  const sinHalfDLat = Math.sin(dLat * 0.5);
  const sinHalfDLon = Math.sin(dLon * 0.5);
  const cosLat1 = Math.cos(lat1);
  const cosLat2 = Math.cos(lat2);

  const a = sinHalfDLat * sinHalfDLat + cosLat1 * cosLat2 * sinHalfDLon * sinHalfDLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  const distKm = EARTH_RADIUS_KM * c;

  const y = Math.sin(dLon) * cosLat2;
  const x = cosLat1 * Math.sin(lat2) - Math.sin(lat1) * cosLat2 * Math.cos(dLon);
  const bearingRad = Math.atan2(y, x);

  return { distKm, bearingRad };
}

export class RadarWidget {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.angle = 0;
    this.blips = [];
    this.maxRangeKm = 2500;
    this.centerLat = null;
    this.centerLon = null;
    this.modeColorVar = '--accent';
    this.pingPulse = 0;
    this._dpr = 0;
    this._setupHiDPI();
  }

  _setupHiDPI() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = 106;
    const h = 106;
    this._dpr = dpr;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr === this._dpr) return;
    this._setupHiDPI();
  }

  setTargetType(type) {
    if (type === 'CRITICAL') this.modeColorVar = '--crit';
    else if (type === 'WARNING') this.modeColorVar = '--warn';
    else if (type === 'SAT') this.modeColorVar = '--ok';
    else if (type === 'NETWORK') this.modeColorVar = '--covert';
    else this.modeColorVar = '--accent';
    this.triggerPing();
  }

  setContacts(centerLat, centerLon, liveData, maxRangeKm = 2500) {
    const rangeKm = Number.isFinite(maxRangeKm) && maxRangeKm > 0 ? maxRangeKm : 2500;
    this.maxRangeKm = rangeKm;

    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLon)) {
      this.centerLat = null;
      this.centerLon = null;
      this.blips = [];
      return;
    }

    this.centerLat = centerLat;
    this.centerLon = centerLon;

    if (!liveData || typeof liveData !== 'object') {
      this.blips = [];
      return;
    }

    const prevIntensity = new Map();
    for (let i = 0; i < this.blips.length; i++) {
      const b = this.blips[i];
      if (b.id != null) prevIntensity.set(b.id, b.intensity);
    }

    const contacts = [];
    const consider = (id, lat, lon, severity) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const { distKm, bearingRad } = computeGeodesic(centerLat, centerLon, lat, lon);
      if (distKm < 1 || distKm > rangeKm) return;
      const canvasAngle = ((bearingRad - Math.PI / 2) % TWO_PI + TWO_PI) % TWO_PI;
      const r = Math.max(0.08, Math.min(0.96, distKm / rangeKm));
      contacts.push({
        id,
        angle: canvasAngle,
        r,
        distKm,
        severity,
        intensity: prevIntensity.has(id) ? prevIntensity.get(id) : 0.35,
      });
    };

    if (Array.isArray(liveData.quakes)) {
      for (const q of liveData.quakes) {
        const mag = Number(q?.mag) || 0;
        const severity = mag >= 5.0 || q?.tsunami ? 'crit' : mag >= 4.0 ? 'warn' : 'accent';
        consider(`quake:${q?.id ?? `${q?.lat},${q?.lon}`}`, q?.lat, q?.lon, severity);
      }
    }

    if (Array.isArray(liveData.gdacs)) {
      for (const g of liveData.gdacs) {
        const lvl = String(g?.alertLevel || '').toLowerCase();
        const severity = lvl === 'red' ? 'crit' : lvl === 'orange' ? 'warn' : 'accent';
        consider(`gdacs:${g?.id ?? `${g?.lat},${g?.lon}`}`, g?.lat, g?.lon, severity);
      }
    }

    if (Array.isArray(liveData.eonet)) {
      for (const ev of liveData.eonet) {
        const catId = String(ev?.categoryId || '').toLowerCase();
        const catTitle = String(ev?.categoryTitle || '').toLowerCase();
        let severity = 'accent';
        if (catId === 'volcanoes' || catTitle.includes('volcan')) {
          severity = 'crit';
        } else if (
          catId === 'severestorms' ||
          catId === 'wildfires' ||
          catTitle.includes('storm') ||
          catTitle.includes('wildfire') ||
          catTitle.includes('fire') ||
          catTitle.includes('cyclone')
        ) {
          severity = 'warn';
        }
        consider(`eonet:${ev?.id ?? `${ev?.lat},${ev?.lon}`}`, ev?.lat, ev?.lon, severity);
      }
    }

    if (Array.isArray(liveData.aircraft)) {
      for (const ac of liveData.aircraft) {
        const isEmergency =
          Boolean(ac?.emergency) ||
          ac?.squawk === '7700' ||
          ac?.squawk === '7600' ||
          ac?.squawk === '7500';
        consider(
          `ac:${ac?.id ?? ac?.hex ?? `${ac?.lat},${ac?.lon}`}`,
          ac?.lat,
          ac?.lon,
          isEmergency ? 'crit' : 'accent'
        );
      }
    }

    if (Array.isArray(liveData.bgpCollectors)) {
      for (const col of liveData.bgpCollectors) {
        consider(`bgp:${col?.id ?? col?.host ?? `${col?.lat},${col?.lon}`}`, col?.lat, col?.lon, 'accent');
      }
    }

    if (Array.isArray(liveData.liveSats)) {
      for (const sat of liveData.liveSats) {
        consider(`sat:${sat?.id ?? sat?.noradId ?? `${sat?.lat},${sat?.lon}`}`, sat?.lat, sat?.lon, 'ok');
      }
    }

    if (Array.isArray(liveData.meteo)) {
      for (const st of liveData.meteo) {
        consider(`meteo:${st?.id ?? st?.name ?? `${st?.lat},${st?.lon}`}`, st?.lat, st?.lon, 'accent');
      }
    }

    if (Array.isArray(liveData.outages)) {
      for (const o of liveData.outages) {
        const severity = o?.severity === 'CRITICAL' ? 'crit' : 'warn';
        consider(`outage:${o?.id ?? `${o?.lat},${o?.lon}`}`, o?.lat, o?.lon, severity);
      }
    }

    if (Array.isArray(liveData.launches)) {
      for (const l of liveData.launches) {
        const tMinus = l?.tMinusSec;
        const imminent = tMinus !== null && tMinus !== undefined && Number.isFinite(Number(tMinus)) && Math.abs(Number(tMinus)) < 7200;
        const severity = imminent ? 'warn' : 'ok';
        consider(`launch:${l?.id ?? `${l?.lat},${l?.lon}`}`, l?.lat, l?.lon, severity);
      }
    }

    if (Array.isArray(liveData.news)) {
      for (const n of liveData.news) {
        consider(`news:${n?.id ?? `${n?.lat},${n?.lon}`}`, n?.lat, n?.lon, 'accent');
      }
    }

    if (Array.isArray(liveData.airq)) {
      for (const a of liveData.airq) {
        const usAqi = Number(a?.usAqi) || 0;
        const severity = usAqi >= 151 ? 'crit' : usAqi >= 101 ? 'warn' : 'accent';
        consider(`airq:${a?.id ?? a?.name ?? `${a?.lat},${a?.lon}`}`, a?.lat, a?.lon, severity);
      }
    }

    if (Array.isArray(liveData.buoys)) {
      for (const b of liveData.buoys) {
        const waveM = Number(b?.waveM) || 0;
        const ptdy = Number(b?.ptdyHpa);
        const dartAlert = Boolean(b?.isDart) && Number.isFinite(ptdy) && ptdy !== 0 && Math.abs(ptdy) >= 3;
        const severity = dartAlert || waveM >= 6 ? 'crit' : waveM >= 4 ? 'warn' : 'ok';
        consider(`buoy:${b?.id ?? b?.stationId ?? `${b?.lat},${b?.lon}`}`, b?.lat, b?.lon, severity);
      }
    }

    contacts.sort((a, b) => a.distKm - b.distKm);
    this.blips = contacts.slice(0, 32);
  }

  triggerPing() {
    this.pingPulse = 1.0;
  }

  render(dt) {
    const safeDt = Math.max(0, dt || 0);
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 9;

    const { accent, accentRgb, ok, warn, crit } = getThemePalette();
    const modeColor = getCachedCssVar(this.modeColorVar, accent);

    ctx.clearRect(0, 0, w, h);

    // Concentric geodesic range rings (833km, 1666km, 2500km at default 2500km range)
    ctx.strokeStyle = `rgba(${accentRgb}, 0.22)`;
    ctx.lineWidth = 0.8;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (maxR / 3) * i, 0, TWO_PI);
      ctx.stroke();
    }

    // Crosshair lines & micro-cardinal rim ticks
    ctx.strokeStyle = `rgba(${accentRgb}, 0.16)`;
    ctx.beginPath();
    ctx.moveTo(cx - maxR, cy);
    ctx.lineTo(cx + maxR, cy);
    ctx.moveTo(cx, cy - maxR);
    ctx.lineTo(cx, cy + maxR);
    ctx.stroke();

    // Micro-cardinal labels (N, E, S, W)
    ctx.save();
    ctx.font = 'bold 6.5px "SF Mono", Menlo, monospace';
    ctx.fillStyle = `rgba(${accentRgb}, 0.58)`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, cy - maxR - 4.5);
    ctx.fillText('S', cx, cy + maxR + 5);
    ctx.fillText('E', cx + maxR + 5, cy + 0.5);
    ctx.fillText('W', cx - maxR - 5, cy + 0.5);
    ctx.restore();

    // Advance sweep angle
    const prevAngle = this.angle;
    this.angle = (this.angle + safeDt * 2.15) % TWO_PI;

    // Draw trailing radar wedge (segmented fan for smooth phosphor fade)
    const trailSteps = 18;
    const trailSpan = 0.95;
    for (let i = 0; i < trailSteps; i++) {
      const a0 = this.angle - (i / trailSteps) * trailSpan;
      const a1 = this.angle - ((i + 1) / trailSteps) * trailSpan;
      const alpha = (1 - i / trailSteps) * 0.28;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, a1, a0);
      ctx.closePath();
      ctx.fillStyle = `rgba(${accentRgb}, ${alpha.toFixed(3)})`;
      ctx.fill();
    }

    // Leading sweep needle
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(this.angle) * maxR, cy + Math.sin(this.angle) * maxR);
    ctx.stroke();

    // Expanding ping ring when triggered
    if (this.pingPulse > 0) {
      this.pingPulse = Math.min(1, Math.max(0, this.pingPulse - safeDt * 1.1));
      const pr = Math.max(0.5, (1 - this.pingPulse) * maxR);
      ctx.strokeStyle = modeColor;
      ctx.globalAlpha = this.pingPulse * 0.85;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Real geodesic contact blips lit when sweep crosses their bearing
    for (let i = 0; i < this.blips.length; i++) {
      const b = this.blips[i];
      const diff = (this.angle - b.angle + TWO_PI) % TWO_PI;
      const prevDiff = (prevAngle - b.angle + TWO_PI) % TWO_PI;
      if (diff < 0.14 || (prevDiff > Math.PI && diff < Math.PI)) {
        b.intensity = 1.0;
      } else {
        b.intensity = Math.max(0.16, b.intensity - safeDt * 0.42);
      }

      const bx = cx + Math.cos(b.angle) * b.r * maxR;
      const by = cy + Math.sin(b.angle) * b.r * maxR;
      const blipColor =
        b.severity === 'crit'
          ? crit
          : b.severity === 'warn'
          ? warn
          : b.severity === 'ok'
          ? ok
          : accent;
      const blipRadius =
        b.severity === 'crit' ? 2.5 : b.severity === 'warn' || b.severity === 'ok' ? 2.1 : 1.7;

      ctx.save();
      ctx.globalAlpha = b.intensity;
      ctx.fillStyle = blipColor;
      ctx.shadowColor = blipColor;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(bx, by, blipRadius, 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }

    // Center lock dot
    ctx.fillStyle = modeColor;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, TWO_PI);
    ctx.fill();
  }
}

export class SpectrumWidget {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'goes'; // 'goes' | 'bgp' | 'quakes' | 'seas'
    this.bgpSmooth = new Float32Array(24);
    this.time = 0;
    this.intensityBoost = 0;
    this.liveData = null;
    this.resize();
  }

  setMode(mode) {
    if (['goes', 'bgp', 'quakes', 'seas'].includes(mode)) {
      this.mode = mode;
      this.render(0, false, this.liveData);
    }
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(120, Math.floor(rect.width - 8));
    const h = Math.max(64, Math.floor(rect.height - 8));
    if (w === this.w && h === this.h && dpr === this._dpr) return;
    this._dpr = dpr;
    this.w = w;
    this.h = h;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.time > 0) {
      this.render(0, false, this.liveData);
    }
  }

  boost(amount = 1.0) {
    this.intensityBoost = Math.min(1.6, Math.max(this.intensityBoost, amount));
  }

  render(rawDt, alertActive = false, liveData = null) {
    const dt = Math.max(0, rawDt || 0);
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    if (!w || !h) return;
    if (liveData) this.liveData = liveData;

    this.time += dt;
    this.intensityBoost = Math.max(0, this.intensityBoost - dt * 0.55);

    const palette = getThemePalette();

    ctx.clearRect(0, 0, w, h);

    if (this.mode === 'goes') {
      this._renderGoes(ctx, w, h, palette);
    } else if (this.mode === 'bgp') {
      this._renderBgp(ctx, w, h, dt, palette);
    } else if (this.mode === 'seas') {
      this._renderSeas(ctx, w, h, palette);
    } else {
      this._renderQuakes(ctx, w, h, palette);
    }
  }

  // --------------------------------------------------------------------------
  // MODE 1: LIVE NOAA GOES-18 SOLAR X-RAY FLUX + GOES-19 MAGNETOMETER (6H)
  // --------------------------------------------------------------------------
  _renderGoes(ctx, w, h, { accent, accentRgb, ok, okRgb, warn, crit }) {
    const goes = this.liveData?.goes;
    const splitY = Math.floor(h * 0.56);

    // Subtle divider between X-Ray (top) and Magnetometer (bottom)
    ctx.strokeStyle = `rgba(${accentRgb}, 0.28)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, splitY + 0.5);
    ctx.lineTo(w, splitY + 0.5);
    ctx.stroke();

    if (!goes || (!goes.xrayLong.length && !goes.magHp.length)) {
      // Tactical acquiring scanner state before NOAA JSON finishes loading
      const sx = ((this.time * 0.6) % 1) * w;
      ctx.strokeStyle = `rgba(${accentRgb}, 0.4)`;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
      ctx.font = '8.5px "SF Mono", Menlo, monospace';
      ctx.fillStyle = accent;
      ctx.fillText('ACQUIRING NOAA GOES-18/19 TELEMETRY...', 8, splitY - 12);
      return;
    }

    // --- TOP HALF: GOES X-RAY FLUX (LOG SCALE 10^-9 to 10^-3 W/m^2) ---
    const topPad = 13;
    const plotH = Math.max(16, splitY - topPad - 3);
    const minExp = -9; // 1e-9 W/m^2 (A0.1)
    const maxExp = -3; // 1e-3 W/m^2 (X10)
    const fluxToY = (flux) => {
      const exp = Math.max(minExp, Math.min(maxExp, Math.log10(Math.max(1e-10, flux))));
      const norm = (exp - minExp) / (maxExp - minExp);
      return splitY - 2 - norm * plotH;
    };

    // Flare-class horizontal reference lines (B=1e-7, C=1e-6, M=1e-5, X=1e-4)
    const classes = [
      { exp: -7, label: 'B', color: `rgba(${accentRgb}, 0.22)` },
      { exp: -6, label: 'C', color: `rgba(${okRgb}, 0.28)` },
      { exp: -5, label: 'M', color: 'rgba(255, 176, 0, 0.34)' },
      { exp: -4, label: 'X', color: 'rgba(255, 42, 85, 0.42)' },
    ];
    ctx.font = '7.5px "SF Mono", Menlo, monospace';
    for (const cl of classes) {
      const y = fluxToY(Math.pow(10, cl.exp));
      ctx.strokeStyle = cl.color;
      ctx.lineWidth = 0.7;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w - 12, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cl.color.replace(/[\d.]+\)$/, '0.85)');
      ctx.fillText(cl.label, w - 9, y + 2.5);
    }

    // Draw GOES-18 0.1-0.8nm X-Ray flux bars (past 6 hours)
    const longArr = goes.xrayLong;
    if (longArr.length > 0) {
      const plotW = w - 13;
      const slot = plotW / longArr.length;
      const barW = Math.max(2, slot - 1.5);
      const scanIdx = Math.floor((this.time * 9) % longArr.length);

      for (let i = 0; i < longArr.length; i++) {
        const flux = longArr[i];
        const y = fluxToY(flux);
        const bh = Math.max(1.5, splitY - 2 - y);
        const x = i * slot + 1;

        let barColor = `rgba(${accentRgb}, 0.72)`;
        let capColor = accent;
        if (flux >= 1e-4) {
          barColor = 'rgba(255, 42, 85, 0.85)';
          capColor = crit;
        } else if (flux >= 1e-5) {
          barColor = 'rgba(255, 176, 0, 0.85)';
          capColor = warn;
        } else if (flux >= 1e-6) {
          barColor = `rgba(${okRgb}, 0.78)`;
          capColor = ok;
        }

        ctx.fillStyle = i === scanIdx ? '#ffffff' : barColor;
        ctx.fillRect(x, y, barW, bh);
        ctx.fillStyle = capColor;
        ctx.fillRect(x, Math.max(topPad, y - 1.2), barW, 1.4);
      }

      // Overlay GOES short-wave hard X-ray channel (0.05-0.4nm) as crisp line
      if (goes.xrayShort.length > 1) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 224, 102, 0.85)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        goes.xrayShort.forEach((f, idx) => {
          const x = (idx / (goes.xrayShort.length - 1)) * (plotW - 2) + 1;
          const y = fluxToY(f);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();
      }
    }

    // Top-left live X-Ray readout badge
    ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
    ctx.fillRect(2, 1, 186, 10.5);
    ctx.fillStyle = goes.latestFlux >= 1e-5 ? warn : accent;
    ctx.fillText(`GOES-${goes.xraySat} XRAY ${goes.flareClass} (${goes.latestFlux.toExponential(1)} W/m²)`, 4, 9);

    // --- BOTTOM HALF: GOES-19 MAGNETOMETER (Hp & Total B in nT, past 6h) ---
    const magTop = splitY + 12;
    const magBot = h - 4;
    const magH = Math.max(14, magBot - magTop);
    const hpArr = goes.magHp;
    const totArr = goes.magTotal;

    if (hpArr.length > 1) {
      const combined = totArr.length === hpArr.length ? [...hpArr, ...totArr] : hpArr;
      let minV = Math.min(...combined);
      let maxV = Math.max(...combined);
      if (maxV - minV < 8) {
        minV -= 4;
        maxV += 4;
      }
      const valToY = (v) => magBot - ((v - minV) / (maxV - minV)) * magH;

      // Secondary Total B curve (dashed subtle)
      if (totArr.length === hpArr.length) {
        ctx.save();
        ctx.strokeStyle = `rgba(${accentRgb}, 0.42)`;
        ctx.lineWidth = 0.95;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        totArr.forEach((v, idx) => {
          const x = (idx / (totArr.length - 1)) * (w - 6) + 2;
          const y = valToY(v);
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Primary Hp northward field curve (glowing emerald/accent + area fill)
      ctx.save();
      ctx.beginPath();
      let lastX = 2;
      let lastY = magBot;
      hpArr.forEach((v, idx) => {
        const x = (idx / (hpArr.length - 1)) * (w - 6) + 2;
        const y = valToY(v);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        lastX = x;
        lastY = y;
      });
      ctx.strokeStyle = ok;
      ctx.lineWidth = 1.4;
      ctx.shadowColor = ok;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Soft shaded fill beneath Hp
      ctx.lineTo(lastX, magBot);
      ctx.lineTo(2, magBot);
      ctx.closePath();
      ctx.fillStyle = `rgba(${okRgb}, 0.12)`;
      ctx.fill();

      // Pulsing newest-sample beacon at right end of trace
      const pulseR = 2.2 + Math.sin(this.time * 5) * 0.8;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(lastX, lastY, Math.max(1.2, pulseR), 0, TWO_PI);
      ctx.fill();
      ctx.restore();
    }

    // Bottom-half live Magnetometer readout badge
    ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
    ctx.fillRect(2, splitY + 2, 198, 10.5);
    ctx.fillStyle = ok;
    ctx.fillText(`GOES-${goes.magSat} MAG Hp ${goes.latestHp.toFixed(1)}nT • B ${goes.latestTotal.toFixed(1)}nT`, 4, splitY + 10);
  }

  // --------------------------------------------------------------------------
  // MODE 2: LIVE RIPE RIS BGP PER-IXP COLLECTOR SPECTRUM
  // --------------------------------------------------------------------------
  _renderBgp(ctx, w, h, dt, { accent, accentRgb, covert, covertRgb, warn }) {
    const cols = this.liveData?.bgpCollectors || [];
    const hist = this.liveData?.bgpHistory || [];
    const splitY = Math.floor(h * 0.56);

    ctx.strokeStyle = `rgba(${accentRgb}, 0.25)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, splitY + 0.5);
    ctx.lineTo(w, splitY + 0.5);
    ctx.stroke();

    const n = Math.min(cols.length, this.bgpSmooth.length);
    if (n > 0) {
      const maxRate = Math.max(20, ...cols.map((c) => c.recentRate || 0));
      const slot = w / n;
      const barW = Math.max(3, slot - 2);
      const now = Date.now();

      for (let i = 0; i < n; i++) {
        const col = cols[i];
        const pulsing = col.lastPulseAt > 0 && now - col.lastPulseAt < 900 ? 0.22 : 0;
        const target = Math.min(1, Math.max(0.06, Math.sqrt((col.recentRate || 0) / maxRate) + pulsing));
        this.bgpSmooth[i] += (target - this.bgpSmooth[i]) * Math.min(1, dt * 8 + 0.15);
        const bh = this.bgpSmooth[i] * (splitY - 14);
        const x = i * slot + 1;
        const y = splitY - bh - 1;
        ctx.fillStyle = this.bgpSmooth[i] > 0.78 ? warn : `rgba(${covertRgb}, 0.82)`;
        ctx.fillRect(x, y, barW, bh);
        ctx.fillStyle = covert;
        ctx.fillRect(x, Math.max(12, y - 1.5), barW, 1.5);
      }
    }

    ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
    ctx.fillRect(2, 1, 178, 10.5);
    ctx.fillStyle = covert;
    ctx.fillText(`RIPE IXP SPECTRUM (${cols.length} COLLECTORS)`, 4, 9);

    // Bottom half: rolling live BGP updates/sec curve
    if (hist.length > 1) {
      const maxH = Math.max(50, ...hist);
      const top = splitY + 12;
      const bot = h - 4;
      ctx.save();
      ctx.beginPath();
      hist.forEach((v, idx) => {
        const x = (idx / (hist.length - 1)) * (w - 4) + 2;
        const y = bot - (v / maxH) * (bot - top);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.3;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 5;
      ctx.stroke();
      ctx.restore();
    }

    ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
    ctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
    ctx.fillRect(2, splitY + 2, 155, 10.5);
    ctx.fillStyle = accent;
    ctx.fillText(`LIVE BGP RATE: ${this.liveData?.bgpRate || 0} UPDATES/S`, 4, splitY + 10);
  }

  // --------------------------------------------------------------------------
  // MODE 3: LIVE USGS 24H SEISMIC MAGNITUDE TIMELINE & FOCAL DEPTH PROFILE
  // --------------------------------------------------------------------------
  _renderQuakes(ctx, w, h, { accent, accentRgb, ok, okRgb, warn, warnRgb, crit, critRgb }) {
    const quakes = this.liveData?.quakes || [];
    const splitY = Math.floor(h * 0.56);

    // Subtle divider between Magnitude Timeline (top) and Focal Depth Profile (bottom)
    ctx.strokeStyle = `rgba(${accentRgb}, 0.28)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, splitY + 0.5);
    ctx.lineTo(w, splitY + 0.5);
    ctx.stroke();

    if (!quakes.length) {
      const sx = ((this.time * 0.6) % 1) * w;
      ctx.strokeStyle = `rgba(${accentRgb}, 0.4)`;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
      ctx.font = '8.5px "SF Mono", Menlo, monospace';
      ctx.fillStyle = accent;
      ctx.fillText('ACQUIRING USGS 24H SEISMIC TELEMETRY...', 8, splitY - 12);
      return;
    }

    // Sort chronologically oldest -> newest by event timestamp
    const sorted = [...quakes].sort((a, b) => (a.time || 0) - (b.time || 0));
    const recent = sorted.slice(-56);
    const latest = sorted[sorted.length - 1];
    let maxMag = 0;
    for (let i = 0; i < sorted.length; i++) {
      const m = Number(sorted[i].mag) || 0;
      if (m > maxMag) maxMag = m;
    }

    // --- TOP HALF: 24H EARTHQUAKE MAGNITUDE TIMELINE (M2.0 TO M8.0 SCALE) ---
    const topPad = 13;
    const plotH = Math.max(16, splitY - topPad - 3);
    const minMag = 2.0;
    const maxScaleMag = 8.0;
    const magToY = (mag) => {
      const clamped = Math.max(minMag, Math.min(maxScaleMag, mag));
      const norm = (clamped - minMag) / (maxScaleMag - minMag);
      return splitY - 2 - norm * plotH;
    };

    // Dashed horizontal reference lines for M4, M5, M6
    const refLines = [
      { mag: 4, label: 'M4', stroke: `rgba(${accentRgb}, 0.28)`, labelColor: accent },
      { mag: 5, label: 'M5', stroke: `rgba(${warnRgb}, 0.36)`, labelColor: warn },
      { mag: 6, label: 'M6', stroke: `rgba(${critRgb}, 0.44)`, labelColor: crit },
    ];
    ctx.font = '7.5px "SF Mono", Menlo, monospace';
    for (const ref of refLines) {
      const y = magToY(ref.mag);
      ctx.strokeStyle = ref.stroke;
      ctx.lineWidth = 0.7;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w - 16, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ref.labelColor;
      ctx.fillText(ref.label, w - 14, y + 2.5);
    }

    // Vertical magnitude bars for up to 56 most recent earthquakes
    const plotW = w - 17;
    const slot = plotW / recent.length;
    const barW = Math.max(2, Math.min(12, slot - 1.5));
    const scanIdx = Math.floor((this.time * 9) % recent.length);

    for (let i = 0; i < recent.length; i++) {
      const mag = Number(recent[i].mag) || 0;
      const y = magToY(mag);
      const bh = Math.max(1.5, splitY - 2 - y);
      const x = i * slot + (slot - barW) * 0.5;

      let barColor = `rgba(${accentRgb}, 0.74)`;
      let capColor = accent;
      if (mag >= 5.0) {
        barColor = `rgba(${critRgb}, 0.86)`;
        capColor = crit;
      } else if (mag >= 4.0) {
        barColor = `rgba(${warnRgb}, 0.85)`;
        capColor = warn;
      } else if (mag >= 3.5) {
        barColor = `rgba(${okRgb}, 0.78)`;
        capColor = ok;
      }

      ctx.fillStyle = i === scanIdx ? '#ffffff' : barColor;
      ctx.fillRect(x, y, barW, bh);
      ctx.fillStyle = capColor;
      ctx.fillRect(x, Math.max(topPad, y - 1.2), barW, 1.4);
    }

    // Top-left live USGS Seismic readout badge
    const topBadge = `USGS 24H SEISMIC (${quakes.length} EVENTS • MAX M${maxMag.toFixed(1)})`;
    ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
    const topBadgeW = Math.min(w - 4, Math.ceil(ctx.measureText(topBadge).width) + 6);
    ctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
    ctx.fillRect(2, 1, topBadgeW, 10.5);
    ctx.fillStyle = maxMag >= 5.0 ? crit : maxMag >= 4.0 ? warn : accent;
    ctx.fillText(topBadge, 4, 9);

    // --- BOTTOM HALF: FOCAL DEPTH PROFILE (0 TO MAX(100, MAXDEPTH) KM) ---
    const depthTop = splitY + 13;
    const depthBot = h - 4;
    const depthH = Math.max(14, depthBot - depthTop);

    let maxObservedDepth = 0;
    for (let i = 0; i < recent.length; i++) {
      const d = Math.max(0, Number(recent[i].depthKm) || 0);
      if (d > maxObservedDepth) maxObservedDepth = d;
    }
    const maxDepth = Math.max(100, maxObservedDepth);
    const depthToY = (depthKm) => {
      const clamped = Math.max(0, Math.min(maxDepth, Number(depthKm) || 0));
      // Surface (0 km) near depthTop; deeper hypocenters extend downward toward depthBot
      return depthTop + (clamped / maxDepth) * depthH;
    };

    const latestMag = Number(latest?.mag) || 0;
    const latestDepth = Number(latest?.depthKm ?? 0);
    const traceColor = latestMag >= 5.0 ? crit : latestMag >= 4.0 ? warn : ok;
    const traceRgb = latestMag >= 5.0 ? critRgb : latestMag >= 4.0 ? warnRgb : okRgb;

    ctx.save();
    let lastX = 2;
    let lastY = depthToY(latestDepth);
    if (recent.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < recent.length; i++) {
        const x = (i / (recent.length - 1)) * (w - 6) + 2;
        const y = depthToY(recent[i].depthKm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        lastX = x;
        lastY = y;
      }
      ctx.strokeStyle = traceColor;
      ctx.lineWidth = 1.35;
      ctx.shadowColor = traceColor;
      ctx.shadowBlur = 6;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Soft shaded depth profile fill
      ctx.lineTo(lastX, depthBot);
      ctx.lineTo(2, depthBot);
      ctx.closePath();
      ctx.fillStyle = `rgba(${traceRgb}, 0.13)`;
      ctx.fill();
    } else {
      lastX = w - 6;
    }

    // Pulsing newest-event beacon on the right
    const pulseR = 2.2 + Math.sin(this.time * 5) * 0.8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(lastX, lastY, Math.max(1.2, pulseR), 0, TWO_PI);
    ctx.fill();
    ctx.restore();

    // Bottom-left Focal Depth readout badge
    const botBadge = `FOCAL DEPTH • LATEST M${latestMag.toFixed(1)} (${latestDepth} KM)`;
    ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
    const botBadgeW = Math.min(w - 4, Math.ceil(ctx.measureText(botBadge).width) + 6);
    ctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
    ctx.fillRect(2, splitY + 2, botBadgeW, 10.5);
    ctx.fillStyle = traceColor;
    ctx.fillText(botBadge, 4, splitY + 10);
  }

  // --------------------------------------------------------------------------
  // MODE 4: LIVE NOAA NDBC OCEAN WAVE HEIGHT + OPEN-METEO GLOBAL AIR QUALITY
  // --------------------------------------------------------------------------
  _renderSeas(ctx, w, h, { accent, accentRgb, ok, okRgb, warn, warnRgb, crit, critRgb }) {
    const rawBuoys = Array.isArray(this.liveData?.buoys) ? this.liveData.buoys : [];
    const rawAirq = Array.isArray(this.liveData?.airq) ? this.liveData.airq : [];
    const splitY = Math.floor(h * 0.56);

    // Subtle divider between Ocean Wave Height (top) and Global Air Quality (bottom)
    ctx.strokeStyle = `rgba(${accentRgb}, 0.28)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, splitY + 0.5);
    ctx.lineTo(w, splitY + 0.5);
    ctx.stroke();

    const buoys = rawBuoys
      .filter((b) => {
        const waveM = Number(b?.waveM);
        return Number.isFinite(waveM) && waveM > 0;
      })
      .sort((a, b) => Number(b.waveM) - Number(a.waveM))
      .slice(0, 32);

    const airq = rawAirq.filter((a) => Number.isFinite(Number(a?.usAqi)));

    if (!buoys.length && !airq.length) {
      const sx = ((this.time * 0.6) % 1) * w;
      ctx.strokeStyle = `rgba(${accentRgb}, 0.4)`;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
      ctx.stroke();
      ctx.font = '8.5px "SF Mono", Menlo, monospace';
      ctx.fillStyle = accent;
      ctx.fillText('ACQUIRING NOAA NDBC OCEAN & AIR TELEMETRY...', 8, splitY - 12);
      return;
    }

    // --- TOP HALF: NOAA NDBC OCEAN SIGNIFICANT WAVE HEIGHT (M) ---
    if (!buoys.length) {
      const sx = ((this.time * 0.6) % 1) * w;
      ctx.strokeStyle = `rgba(${accentRgb}, 0.35)`;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, splitY);
      ctx.stroke();
      ctx.font = '8.5px "SF Mono", Menlo, monospace';
      ctx.fillStyle = accent;
      ctx.fillText('ACQUIRING NOAA NDBC OCEAN & AIR TELEMETRY...', 8, splitY - 12);
    } else {
      const topPad = 13;
      const plotH = Math.max(16, splitY - topPad - 3);
      const maxWave = Number(buoys[0].waveM) || 0;
      const maxWaveScale = Math.max(8, maxWave);
      const waveToY = (waveM) => {
        const clamped = Math.max(0, Math.min(maxWaveScale, waveM));
        return splitY - 2 - (clamped / maxWaveScale) * plotH;
      };

      const refLines = [
        { val: 4, label: '4m', stroke: `rgba(${warnRgb}, 0.36)`, labelColor: warn },
        { val: 6, label: '6m', stroke: `rgba(${critRgb}, 0.46)`, labelColor: crit },
      ];
      ctx.font = '7.5px "SF Mono", Menlo, monospace';
      for (const ref of refLines) {
        const y = waveToY(ref.val);
        ctx.strokeStyle = ref.stroke;
        ctx.lineWidth = 0.7;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w - 16, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ref.labelColor;
        ctx.fillText(ref.label, w - 14, y + 2.5);
      }

      const plotW = w - 17;
      const slot = plotW / buoys.length;
      const barW = Math.max(2, Math.min(12, slot - 1.5));
      const scanIdx = Math.floor((this.time * 9) % buoys.length);

      for (let i = 0; i < buoys.length; i++) {
        const waveM = Number(buoys[i].waveM) || 0;
        const y = waveToY(waveM);
        const bh = Math.max(1.5, splitY - 2 - y);
        const x = i * slot + (slot - barW) * 0.5;

        let barColor = `rgba(${okRgb}, 0.72)`;
        let capColor = ok;
        if (waveM >= 6) {
          barColor = `rgba(${critRgb}, 0.86)`;
          capColor = crit;
        } else if (waveM >= 4) {
          barColor = `rgba(${warnRgb}, 0.85)`;
          capColor = warn;
        } else if (waveM >= 2) {
          barColor = `rgba(${accentRgb}, 0.76)`;
          capColor = accent;
        }

        ctx.fillStyle = i === scanIdx ? '#ffffff' : barColor;
        ctx.fillRect(x, y, barW, bh);
        ctx.fillStyle = capColor;
        ctx.fillRect(x, Math.max(topPad, y - 1.2), barW, 1.4);
      }

      const topBadge = `NDBC OCEAN BUOYS (${buoys.length} LIVE • MAX ${maxWave.toFixed(1)}M)`;
      ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
      const topBadgeW = Math.min(w - 4, Math.ceil(ctx.measureText(topBadge).width) + 6);
      ctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
      ctx.fillRect(2, 1, topBadgeW, 10.5);
      ctx.fillStyle = maxWave >= 6 ? crit : maxWave >= 4 ? warn : accent;
      ctx.fillText(topBadge, 4, 9);
    }

    // --- BOTTOM HALF: OPEN-METEO GLOBAL URBAN AIR QUALITY (US AQI) ---
    if (airq.length > 0) {
      const airTop = splitY + 13;
      const airBot = h - 4;
      const airH = Math.max(14, airBot - airTop);

      let maxAqi = 0;
      let worstStationName = 'N/A';
      for (let i = 0; i < airq.length; i++) {
        const aqi = Math.max(0, Number(airq[i].usAqi) || 0);
        if (aqi >= maxAqi) {
          maxAqi = aqi;
          worstStationName = String(airq[i].name || airq[i].city || airq[i].id || 'UNKNOWN').toUpperCase();
        }
      }
      const maxAqiScale = Math.max(200, maxAqi);
      const aqiToY = (aqi) => {
        const clamped = Math.max(0, Math.min(maxAqiScale, aqi));
        return airBot - (clamped / maxAqiScale) * airH;
      };

      // Dashed threshold cues at AQI 100 (warn) and 150 (crit)
      const aqiThresholds = [
        { val: 100, label: '100', stroke: `rgba(${warnRgb}, 0.34)`, labelColor: warn },
        { val: 150, label: '150', stroke: `rgba(${critRgb}, 0.42)`, labelColor: crit },
      ];
      ctx.font = '7px "SF Mono", Menlo, monospace';
      for (const th of aqiThresholds) {
        const y = aqiToY(th.val);
        ctx.strokeStyle = th.stroke;
        ctx.lineWidth = 0.7;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w - 18, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = th.labelColor;
        ctx.fillText(th.label, w - 16, y + 2.5);
      }

      const traceColor = maxAqi >= 151 ? crit : maxAqi >= 101 ? warn : ok;
      const traceRgb = maxAqi >= 151 ? critRgb : maxAqi >= 101 ? warnRgb : okRgb;
      const plotW = Math.max(24, w - 22);
      const slot = plotW / airq.length;
      const barW = Math.max(1.5, Math.min(8, slot - 1.5));

      for (let i = 0; i < airq.length; i++) {
        const aqi = Math.max(0, Number(airq[i].usAqi) || 0);
        const y = aqiToY(aqi);
        const bh = Math.max(1, airBot - y);
        const x = 2 + i * slot + (slot - barW) * 0.5;
        ctx.fillStyle =
          aqi >= 151
            ? `rgba(${critRgb}, 0.36)`
            : aqi >= 101
            ? `rgba(${warnRgb}, 0.34)`
            : `rgba(${accentRgb}, 0.28)`;
        ctx.fillRect(x, y, barW, bh);
      }

      ctx.save();
      let lastX = 2 + slot * 0.5;
      let lastY = aqiToY(Number(airq[airq.length - 1].usAqi) || 0);
      if (airq.length > 1) {
        ctx.beginPath();
        for (let i = 0; i < airq.length; i++) {
          const x = 2 + (i / (airq.length - 1)) * (plotW - 2);
          const y = aqiToY(Number(airq[i].usAqi) || 0);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          lastX = x;
          lastY = y;
        }
        ctx.strokeStyle = traceColor;
        ctx.lineWidth = 1.35;
        ctx.shadowColor = traceColor;
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.lineTo(lastX, airBot);
        ctx.lineTo(2, airBot);
        ctx.closePath();
        ctx.fillStyle = `rgba(${traceRgb}, 0.12)`;
        ctx.fill();
      }

      const pulseR = 2.1 + Math.sin(this.time * 5) * 0.7;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(lastX, lastY, Math.max(1.2, pulseR), 0, TWO_PI);
      ctx.fill();
      ctx.restore();

      const botBadge = `GLOBAL AIR QUALITY • PEAK AQI ${Math.round(maxAqi)} (${worstStationName})`;
      ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
      const botBadgeW = Math.min(w - 4, Math.ceil(ctx.measureText(botBadge).width) + 6);
      ctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
      ctx.fillRect(2, splitY + 2, botBadgeW, 10.5);
      ctx.fillStyle = traceColor;
      ctx.fillText(botBadge, 4, splitY + 10);
    } else {
      ctx.font = '8px "SF Mono", Menlo, monospace';
      ctx.fillStyle = `rgba(${accentRgb}, 0.7)`;
      ctx.fillText('AWAITING GLOBAL AIR QUALITY STATIONS...', 8, splitY + 22);
    }
  }
}

export class SparklineWidget {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.values = new Array(28).fill(0.12);
    this._dpr = 0;
    this._setupHiDPI();
  }

  _setupHiDPI() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._dpr = dpr;
    this.w = 84;
    this.h = 20;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr === this._dpr) return;
    this._setupHiDPI();
    this.draw();
  }

  push(val) {
    this.values.shift();
    this.values.push(Math.max(0.08, Math.min(0.98, val)));
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const { accent, accentRgb, crit, critRgb } = getThemePalette();

    ctx.clearRect(0, 0, w, h);

    const last = this.values[this.values.length - 1];
    const hot = last > 0.72;

    ctx.beginPath();
    this.values.forEach((v, i) => {
      const x = (i / (this.values.length - 1)) * w;
      const y = h - 2 - v * (h - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = hot ? crit : accent;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // Fill area beneath line
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = hot ? `rgba(${critRgb}, 0.2)` : `rgba(${accentRgb}, 0.16)`;
    ctx.fill();
  }
}
