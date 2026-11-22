// ============================================================================
// AEGIS // SECONDARY TACTICAL CANVAS WIDGETS (RADAR, RF SPECTRUM, SPARKLINE)
// ============================================================================

function getCssVar(name, fallback = '#00e5ff') {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export class RadarWidget {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.angle = 0;
    this.blips = this._generateBlips(7);
    this.modeColorVar = '--accent';
    this.pingPulse = 0;
    this._setupHiDPI();
  }

  _setupHiDPI() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = 106;
    const h = 106;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  _generateBlips(count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.18 + Math.random() * 0.72;
      out.push({
        angle: a,
        r,
        intensity: 0.2,
        critical: i === 0,
      });
    }
    return out;
  }

  setTargetType(type) {
    if (type === 'CRITICAL') this.modeColorVar = '--crit';
    else if (type === 'WARNING') this.modeColorVar = '--warn';
    else if (type === 'COVERT') this.modeColorVar = '--covert';
    else if (type === 'SAT') this.modeColorVar = '--ok';
    else this.modeColorVar = '--accent';
    this.blips = this._generateBlips(type === 'CRITICAL' ? 10 : 6);
    this.triggerPing();
  }

  triggerPing() {
    this.pingPulse = 1.0;
  }

  render(dt) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) / 2 - 5;

    const accent = getCssVar('--accent');
    const accentRgb = getCssVar('--accent-rgb', '0, 229, 255');
    const modeColor = getCssVar(this.modeColorVar, accent);

    ctx.clearRect(0, 0, w, h);

    // Subtle concentric range rings
    ctx.strokeStyle = `rgba(${accentRgb}, 0.22)`;
    ctx.lineWidth = 0.8;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (maxR / 3) * i, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshair lines
    ctx.strokeStyle = `rgba(${accentRgb}, 0.16)`;
    ctx.beginPath();
    ctx.moveTo(cx - maxR, cy);
    ctx.lineTo(cx + maxR, cy);
    ctx.moveTo(cx, cy - maxR);
    ctx.lineTo(cx, cy + maxR);
    ctx.stroke();

    // Advance sweep angle
    const prevAngle = this.angle;
    this.angle = (this.angle + dt * 2.15) % (Math.PI * 2);

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
      this.pingPulse = Math.min(1, Math.max(0, this.pingPulse - Math.max(0, dt) * 1.1));
      const pr = Math.max(0.5, (1 - this.pingPulse) * maxR);
      ctx.strokeStyle = modeColor;
      ctx.globalAlpha = this.pingPulse * 0.85;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Blips lit when sweep crosses them
    for (const b of this.blips) {
      let diff = (this.angle - b.angle + Math.PI * 2) % (Math.PI * 2);
      let prevDiff = (prevAngle - b.angle + Math.PI * 2) % (Math.PI * 2);
      if (diff < 0.14 || prevDiff > Math.PI * 1.9) {
        b.intensity = 1.0;
      } else {
        b.intensity = Math.max(0.14, b.intensity - dt * 0.42);
      }

      const bx = cx + Math.cos(b.angle) * b.r * maxR;
      const by = cy + Math.sin(b.angle) * b.r * maxR;

      ctx.save();
      ctx.globalAlpha = b.intensity;
      ctx.fillStyle = b.critical ? modeColor : accent;
      ctx.shadowColor = b.critical ? modeColor : accent;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(bx, by, b.critical ? 2.5 : 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Center dot
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export class SpectrumWidget {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'goes'; // 'goes' | 'bgp' | 'rf'
    this.barCount = 34;
    this.bars = new Float32Array(this.barCount);
    this.peaks = new Float32Array(this.barCount);
    this.bgpSmooth = new Float32Array(24);
    this.time = 0;
    this.intensityBoost = 0;
    this.liveData = null;
    this.resize();
  }

  setMode(mode) {
    if (['goes', 'bgp', 'rf'].includes(mode)) {
      this.mode = mode;
      this.render(0, false, this.liveData);
    }
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(120, Math.floor(rect.width - 8));
    const h = Math.max(64, Math.floor(rect.height - 8));
    if (w === this.w && h === this.h) return;
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
    const dt = Math.max(0, rawDt);
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    if (!w || !h) return;
    if (liveData) this.liveData = liveData;

    this.time += dt;
    this.intensityBoost = Math.max(0, this.intensityBoost - dt * 0.55);

    const palette = {
      accent: getCssVar('--accent'),
      accentRgb: getCssVar('--accent-rgb', '0, 229, 255'),
      ok: getCssVar('--ok', '#00ff9c'),
      okRgb: getCssVar('--ok-rgb', '0, 255, 156'),
      warn: getCssVar('--warn', '#ffb000'),
      warnRgb: getCssVar('--warn-rgb', '255, 176, 0'),
      crit: getCssVar('--crit', '#ff2a55'),
      critRgb: getCssVar('--crit-rgb', '255, 42, 85'),
      covert: getCssVar('--covert', '#b46cff'),
      covertRgb: getCssVar('--covert-rgb', '180, 108, 255'),
    };

    ctx.clearRect(0, 0, w, h);

    if (this.mode === 'goes') {
      this._renderGoes(ctx, w, h, palette);
    } else if (this.mode === 'bgp') {
      this._renderBgp(ctx, w, h, dt, palette);
    } else {
      this._renderRf(ctx, w, h, dt, alertActive, palette);
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
      ctx.arc(lastX, lastY, Math.max(1.2, pulseR), 0, Math.PI * 2);
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
  // MODE 3: PROCEDURAL SIGINT RF SPECTRUM & CARRIER OSCILLOSCOPE
  // --------------------------------------------------------------------------
  _renderRf(ctx, w, h, dt, alertActive, { accent, accentRgb, crit, warn }) {
    const splitY = Math.floor(h * 0.56);

    // Grid lines
    ctx.strokeStyle = `rgba(${accentRgb}, 0.1)`;
    ctx.lineWidth = 1;
    for (let y = 12; y < h; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    // Divider line
    ctx.strokeStyle = `rgba(${accentRgb}, 0.25)`;
    ctx.beginPath();
    ctx.moveTo(0, splitY + 0.5);
    ctx.lineTo(w, splitY + 0.5);
    ctx.stroke();

    // Update and draw FFT Spectrum Bars (Top half)
    const barSlot = w / this.barCount;
    const barW = Math.max(2, barSlot - 2);
    const boost = (alertActive ? 0.42 : 0) + this.intensityBoost * 0.48;

    for (let i = 0; i < this.barCount; i++) {
      const norm = i / this.barCount;
      const carrier1 = Math.exp(-Math.pow((norm - 0.32) * 7.5, 2)) * 0.65;
      const carrier2 = Math.exp(-Math.pow((norm - 0.72) * 9.0, 2)) * 0.55;
      const wave = 0.22 + 0.18 * Math.sin(this.time * 4.5 + i * 0.55) + Math.random() * 0.24;
      const target = Math.min(
        0.98,
        Math.max(
          0.06,
          wave * 0.55 +
            carrier1 * (0.6 + 0.4 * Math.sin(this.time * 7)) +
            carrier2 * (0.55 + 0.45 * Math.cos(this.time * 5.2)) +
            boost * Math.random()
        )
      );

      this.bars[i] += (target - this.bars[i]) * Math.min(1, dt * 16 + 0.2);
      if (this.bars[i] > this.peaks[i]) {
        this.peaks[i] = this.bars[i];
      } else {
        this.peaks[i] = Math.max(this.bars[i], this.peaks[i] - dt * 0.45);
      }

      const bh = this.bars[i] * (splitY - 6);
      const x = i * barSlot + 1;
      const y = splitY - bh;

      if (this.bars[i] > 0.78 || alertActive) {
        ctx.fillStyle = this.bars[i] > 0.82 ? crit : warn;
      } else {
        ctx.fillStyle = `rgba(${accentRgb}, 0.78)`;
      }
      ctx.fillRect(x, y, barW, bh);

      const py = splitY - this.peaks[i] * (splitY - 6) - 2;
      ctx.fillStyle = alertActive ? crit : accent;
      ctx.fillRect(x, Math.max(2, py), barW, 1.5);
    }

    // Bottom half: RF Carrier Oscilloscope Waveform
    const waveMid = splitY + (h - splitY) / 2;
    const waveAmp = (h - splitY) * 0.38;

    ctx.save();
    ctx.strokeStyle = alertActive ? crit : accent;
    ctx.lineWidth = 1.3;
    ctx.shadowColor = alertActive ? crit : accent;
    ctx.shadowBlur = 6;
    ctx.beginPath();

    const samples = 88;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const x = t * w;
      const env = Math.sin(t * Math.PI);
      const sig =
        Math.sin(t * 28 + this.time * 13) * 0.52 +
        Math.sin(t * 62 - this.time * 21) * 0.28 +
        Math.cos(t * 14 + this.time * 6) * 0.2;
      const jitter = alertActive || this.intensityBoost > 0.2 ? (Math.random() - 0.5) * 0.45 : 0;
      const y = waveMid + (sig + jitter) * waveAmp * (0.45 + 0.55 * env) * (1 + boost * 0.45);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export class SparklineWidget {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.values = Array.from({ length: 28 }, () => 0.28 + Math.random() * 0.22);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = 84;
    this.h = 20;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    const accent = getCssVar('--accent');
    const accentRgb = getCssVar('--accent-rgb', '0, 229, 255');
    const crit = getCssVar('--crit', '#ff2a55');

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
    ctx.fillStyle = hot ? 'rgba(255, 42, 85, 0.2)' : `rgba(${accentRgb}, 0.16)`;
    ctx.fill();
  }
}
