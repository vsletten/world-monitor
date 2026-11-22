// ============================================================================
// AEGIS // WIREFRAME WORLD MAP & 3D HOLOGRAPHIC GLOBE ENGINE (CANVAS + D3-GEO)
// ============================================================================

import {
  geoEquirectangular,
  geoOrthographic,
  geoPath,
  geoGraticule,
  geoInterpolate,
  geoCircle,
  geoDistance,
} from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import worldTopo from 'world-atlas/countries-110m.json';

function getCssVar(name, fallback = '#00e5ff') {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export class WorldMapEngine {
  constructor(canvas, { nodes, arcs, satellites, liveFeeds, onSelectNode, onSelectSat, onSelectLive, onHover, onCoords }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = nodes;
    this.nodeById = new Map(nodes.map((n) => [n.id, n]));
    this.arcs = arcs.map((a, idx) => ({
      ...a,
      progress: (idx * 0.17) % 1,
      interpolator: geoInterpolate(
        [this.nodeById.get(a.from).lon, this.nodeById.get(a.from).lat],
        [this.nodeById.get(a.to).lon, this.nodeById.get(a.to).lat]
      ),
    }));
    this.satellites = satellites.map((s) => ({ ...s, lat: 0, lon: 0 }));
    this.liveFeeds = liveFeeds || null;

    this.onSelectNode = onSelectNode;
    this.onSelectSat = onSelectSat;
    this.onSelectLive = onSelectLive;
    this.onHover = onHover;
    this.onCoords = onCoords;

    // World vector geometry (Natural Earth 110m)
    this.land = feature(worldTopo, worldTopo.objects.land);
    this.borders = mesh(worldTopo, worldTopo.objects.countries, (a, b) => a !== b);
    this.graticule = geoGraticule().step([15, 15])();
    this.equator = { type: 'LineString', coordinates: [[-180, 0], [-90, 0], [0, 0], [90, 0], [180, 0]] };
    this.primeMeridian = { type: 'LineString', coordinates: [[0, -85], [0, 0], [0, 85]] };

    // View & interaction state
    this.mode = '2d'; // '2d' | '3d'
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.rotation = [-12, -22, 0]; // 3D globe rotation [lambda, phi, gamma]
    this.targetRotation = null;
    this.autoRotate = true;

    this.layers = {
      nodes: true,
      arcs: true,
      satellites: false, // superseded by liveSats by default, still toggleable!
      sigint: true,
      grid: true,
      scan: true,
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

    this.selectedNodeId = 'zurich';
    this.selectedSatId = null;
    this.selectedLive = null; // { kind: 'liveSat'|'quake'|'eonet'|'aircraft', id }
    this.hoveredItem = null;
    this.alertActive = false;

    // Active trace animation state
    this.trace = null; // { nodeIds: [], activeStep: 0, segProgress: 0, finished: false }

    // Expanding sonar ping rings
    this.pings = []; // { lon, lat, age, maxAge, colorVar }

    // Mouse state
    this.mouse = { x: -1, y: -1, inside: false };
    this.dragging = false;
    this.dragMoved = false;
    this.dragStart = { x: 0, y: 0, panX: 0, panY: 0, rot: [0, 0, 0] };

    // Animation timers
    this.time = 0;
    this.scanX = 0;
    this.hatchPattern = null;
    this.lastThemeAccent = '';

    this.resize();
    this._bindEvents();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = Math.max(300, Math.floor(rect.width));
    const nextH = Math.max(220, Math.floor(rect.height));
    if (nextW === this.w && nextH === this.h) return;
    this.w = nextW;
    this.h = nextH;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.land && this.time > 0) {
      this.render(0);
    }
  }

  _ensureHatchPattern(accentRgb) {
    if (this.hatchPattern && this.lastThemeAccent === accentRgb) return this.hatchPattern;
    this.lastThemeAccent = accentRgb;
    const tile = document.createElement('canvas');
    tile.width = 8;
    tile.height = 8;
    const tctx = tile.getContext('2d');
    tctx.fillStyle = `rgba(${accentRgb}, 0.055)`;
    tctx.fillRect(0, 0, 8, 8);
    tctx.strokeStyle = `rgba(${accentRgb}, 0.13)`;
    tctx.lineWidth = 0.7;
    tctx.beginPath();
    tctx.moveTo(0, 8);
    tctx.lineTo(8, 0);
    tctx.stroke();
    this.hatchPattern = this.ctx.createPattern(tile, 'repeat');
    return this.hatchPattern;
  }

  setMode(mode) {
    this.mode = mode === '3d' ? '3d' : '2d';
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.targetRotation = null;
    if (this.mode === '3d' && this.selectedNodeId) {
      const node = this.nodeById.get(this.selectedNodeId);
      if (node) this.focusLonLat(node.lon, node.lat);
    }
  }

  setLayer(name, enabled) {
    if (name in this.layers) this.layers[name] = Boolean(enabled);
  }

  setZoom(delta) {
    this.zoom = Math.max(0.85, Math.min(4.2, this.zoom + delta));
    if (this.zoom <= 1.02 && this.mode === '2d') {
      this.panX *= 0.5;
      this.panY *= 0.5;
    }
  }

  resetView() {
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.targetRotation = [-12, -22, 0];
  }

  focusLonLat(lon, lat) {
    if (this.mode === '3d') {
      this.targetRotation = [-lon, -Math.max(-65, Math.min(65, lat)), 0];
    } else if (this.zoom > 1.05) {
      const proj = this._getProjection();
      const pt = proj([lon, lat]);
      if (pt) {
        this.panX += this.w / 2 - pt[0];
        this.panY += this.h / 2 - pt[1];
      }
    }
  }

  selectNode(id, focus = true) {
    const node = this.nodeById.get(id);
    if (!node) return;
    this.selectedNodeId = id;
    this.selectedSatId = null;
    this.selectedLive = null;
    this.triggerPing(node.lon, node.lat, this._typeColorVar(node.type));
    if (focus) this.focusLonLat(node.lon, node.lat);
  }

  selectSat(id) {
    const sat = this.satellites.find((s) => s.id === id);
    if (!sat) return;
    this.selectedSatId = id;
    this.selectedNodeId = null;
    this.selectedLive = null;
    this.triggerPing(sat.lon, sat.lat, '--ok');
    this.focusLonLat(sat.lon, sat.lat);
  }

  selectLive(kind, item, focus = true) {
    if (!item) return;
    this.selectedNodeId = null;
    this.selectedSatId = null;
    this.selectedLive = { kind, id: item.id };
    const colorVar =
      kind === 'quake'
        ? '--warn'
        : kind === 'eonet' || kind === 'gdacs'
        ? '--crit'
        : kind === 'liveSat'
        ? '--ok'
        : kind === 'bgp'
        ? '--covert'
        : '--accent';
    this.triggerPing(item.lon, item.lat, colorVar);
    if (focus) this.focusLonLat(item.lon, item.lat);
  }

  triggerPing(lon, lat, colorVar = '--accent') {
    this.pings.push({ lon, lat, age: 0, maxAge: 1.6, colorVar });
  }

  startTrace(nodeIds) {
    this.trace = {
      nodeIds,
      activeStep: 0,
      segProgress: 0,
      finished: false,
    };
    const first = this.nodeById.get(nodeIds[0]);
    if (first) {
      this.triggerPing(first.lon, first.lat, '--accent');
      if (this.mode === '3d') this.focusLonLat(first.lon, first.lat);
    }
  }

  setTraceStep(step, finished = false) {
    if (!this.trace) return;
    this.trace.activeStep = step;
    this.trace.segProgress = 0;
    this.trace.finished = finished;
    const node = this.nodeById.get(this.trace.nodeIds[Math.min(step, this.trace.nodeIds.length - 1)]);
    if (node) {
      this.triggerPing(node.lon, node.lat, finished ? '--ok' : '--crit');
      if (this.mode === '3d') this.focusLonLat(node.lon, node.lat);
    }
  }

  clearTrace() {
    this.trace = null;
  }

  _typeColorVar(type) {
    if (type === 'CRITICAL') return '--crit';
    if (type === 'WARNING') return '--warn';
    if (type === 'COVERT') return '--covert';
    return '--accent';
  }

  _getProjection(unclipped = false) {
    if (this.mode === '3d') {
      const baseRadius = Math.min(this.w, this.h) * 0.43 * this.zoom;
      const proj = geoOrthographic()
        .scale(baseRadius)
        .translate([this.w / 2 + this.panX, this.h / 2 + this.panY])
        .rotate(this.rotation);
      if (unclipped) proj.clipAngle(null);
      else proj.clipAngle(90);
      return proj;
    }

    // 2D Equirectangular fitted to map viewport
    const scaleX = this.w / (2 * Math.PI);
    const scaleY = this.h / (Math.PI * 0.92);
    const baseScale = Math.min(scaleX, scaleY) * 0.96 * this.zoom;
    return geoEquirectangular()
      .scale(baseScale)
      .translate([this.w / 2 + this.panX, this.h / 2 + this.panY + this.h * 0.02]);
  }

  _isVisible3D(lon, lat) {
    if (this.mode !== '3d') return true;
    const center = [-this.rotation[0], -this.rotation[1]];
    return geoDistance([lon, lat], center) <= Math.PI / 2 - 0.01;
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.dragging = true;
      this.dragMoved = false;
      this.canvas.classList.add('dragging');
      this.targetRotation = null;
      this.dragStart = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        panX: this.panX,
        panY: this.panY,
        rot: [...this.rotation],
      };
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.mouse = { x: mx, y: my, inside: true };

      if (this.dragging) {
        const dx = mx - this.dragStart.x;
        const dy = my - this.dragStart.y;
        if (Math.hypot(dx, dy) > 4) this.dragMoved = true;

        if (this.mode === '3d') {
          const sens = 0.28 / Math.max(0.7, this.zoom);
          this.rotation = [
            this.dragStart.rot[0] + dx * sens,
            Math.max(-75, Math.min(75, this.dragStart.rot[1] - dy * sens)),
            0,
          ];
        } else {
          const maxPanX = this.w * 0.55 * this.zoom;
          const maxPanY = this.h * 0.5 * this.zoom;
          this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.dragStart.panX + dx));
          this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.dragStart.panY + dy));
        }
        return;
      }

      // Update cursor coordinates
      const proj = this._getProjection();
      const inv = proj.invert ? proj.invert([mx, my]) : null;
      if (inv && Number.isFinite(inv[0]) && Number.isFinite(inv[1]) && Math.abs(inv[1]) <= 90 && Math.abs(inv[0]) <= 180) {
        this.onCoords?.(inv[1], inv[0]);
      }

      // Hit test nodes & satellites
      const hit = this._hitTest(mx, my, proj);
      this.hoveredItem = hit;
      this.canvas.style.cursor = hit ? 'pointer' : 'crosshair';
      this.onHover?.(hit, mx, my);
    });

    this.canvas.addEventListener('pointerup', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wasDrag = this.dragMoved;
      this.dragging = false;
      this.canvas.classList.remove('dragging');
      try { this.canvas.releasePointerCapture(e.pointerId); } catch {}

      if (!wasDrag) {
        const proj = this._getProjection();
        const hit = this._hitTest(mx, my, proj);
        if (hit) {
          if (hit.kind === 'node') {
            this.selectNode(hit.item.id, false);
            this.onSelectNode?.(hit.item);
          } else if (hit.kind === 'sat') {
            this.selectSat(hit.item.id);
            this.onSelectSat?.(hit.item);
          } else {
            this.selectLive(hit.kind, hit.item, false);
            this.onSelectLive?.(hit.kind, hit.item);
          }
        }
      }
    });

    this.canvas.addEventListener('pointerleave', () => {
      this.mouse.inside = false;
      this.hoveredItem = null;
      this.onHover?.(null, 0, 0);
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.18 : -0.18;
        this.setZoom(delta);
      },
      { passive: false }
    );
  }

  _hitTest(mx, my, proj) {
    let best = null;
    let bestDist = 17;

    const testList = (list, kind, radius = 17) => {
      for (const item of list) {
        if (!this._isVisible3D(item.lon, item.lat)) continue;
        const pt = proj([item.lon, item.lat]);
        if (!pt) continue;
        const d = Math.hypot(mx - pt[0], my - pt[1]);
        if (d < bestDist && d < radius) {
          bestDist = d;
          best = { kind, item };
        }
      }
    };

    if (this.layers.nodes) testList(this.nodes, 'node', 17);
    if (this.layers.satellites) testList(this.satellites, 'sat', 16);

    if (this.liveFeeds) {
      if (this.layers.liveSats) testList(this.liveFeeds.data.liveSats, 'liveSat', 16);
      if (this.layers.quakes) testList(this.liveFeeds.data.quakes, 'quake', 15);
      if (this.layers.gdacs) testList(this.liveFeeds.data.gdacs, 'gdacs', 15);
      if (this.layers.eonet) testList(this.liveFeeds.data.eonet, 'eonet', 14);
      if (this.layers.aircraft) testList(this.liveFeeds.data.aircraft, 'aircraft', 13);
      if (this.layers.bgp) testList(this.liveFeeds.data.bgpCollectors, 'bgp', 13);
      if (this.layers.meteo) testList(this.liveFeeds.data.meteo, 'meteo', 13);
      if (this.layers.wiki) testList(this.liveFeeds.data.wikiHubs, 'wiki', 14);
    }

    return best;
  }

  _updateSatellites() {
    for (const s of this.satellites) {
      const phase = this.time * s.speed + s.phaseOffset;
      s.lat = Math.sin(phase) * s.inclination;
      let lon = ((s.lonOffset + (this.time * s.speed * 57.2958) * 1.15) % 360 + 540) % 360 - 180;
      s.lon = lon;
    }
  }

  render(rawDt) {
    const dt = Math.max(0, rawDt);
    this.time += dt;
    this.scanX = (this.scanX + dt * 0.085) % 1;

    // Update arc packets
    const speedMult = this.alertActive ? 1.85 : 1.0;
    for (const a of this.arcs) {
      a.progress = (a.progress + dt * a.speed * speedMult) % 1;
    }

    // Update trace segment progress
    if (this.trace && !this.trace.finished) {
      this.trace.segProgress = Math.min(1, this.trace.segProgress + dt * 1.35);
    }

    // Update 3D globe rotation
    if (this.mode === '3d' && !this.dragging) {
      if (this.targetRotation) {
        let dLon = this.targetRotation[0] - this.rotation[0];
        // Shortest angular distance
        dLon = ((dLon + 540) % 360) - 180;
        const dLat = this.targetRotation[1] - this.rotation[1];
        this.rotation[0] += dLon * Math.min(1, dt * 4.5);
        this.rotation[1] += dLat * Math.min(1, dt * 4.5);
        if (Math.abs(dLon) < 0.25 && Math.abs(dLat) < 0.25) {
          this.targetRotation = null;
        }
      } else if (this.autoRotate) {
        this.rotation[0] = (this.rotation[0] + dt * 4.2) % 360;
      }
    }

    // Update satellites
    this._updateSatellites();

    // Update sonar ping rings
    for (let i = this.pings.length - 1; i >= 0; i--) {
      this.pings[i].age += dt;
      if (this.pings[i].age >= this.pings[i].maxAge) this.pings.splice(i, 1);
    }

    // Theme palette lookup
    const accent = getCssVar('--accent', '#00e5ff');
    const accentRgb = getCssVar('--accent-rgb', '0, 229, 255');
    const ok = getCssVar('--ok', '#00ff9c');
    const okRgb = getCssVar('--ok-rgb', '0, 255, 156');
    const warn = getCssVar('--warn', '#ffb000');
    const warnRgb = getCssVar('--warn-rgb', '255, 176, 0');
    const crit = getCssVar('--crit', '#ff2a55');
    const critRgb = getCssVar('--crit-rgb', '255, 42, 85');
    const covert = getCssVar('--covert', '#b46cff');
    const covertRgb = getCssVar('--covert-rgb', '180, 108, 255');
    const palette = { accent, accentRgb, ok, okRgb, warn, warnRgb, crit, critRgb, covert, covertRgb };

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const proj = this._getProjection(false);
    const path = geoPath(proj, ctx);

    // 1. Subtle background dot-grid / radar framing
    this._drawBackdropGrid(ctx, palette);

    // 2. Globe outer halo / holographic back-hemisphere pass (3D only)
    if (this.mode === '3d') {
      this._drawGlobeBackPass(ctx, palette);
    }

    // 3. Tactical Graticule (Lat/Lon Wireframe Grid)
    if (this.layers.grid) {
      this._drawGraticule(ctx, path, proj, palette);
    }

    // 4. World Landmasses & Country Borders Wireframe
    this._drawWorldWireframe(ctx, path, palette);

    // 5. Globe front atmospheric rim (3D only)
    if (this.mode === '3d') {
      this._drawGlobeFrontRim(ctx, proj, palette);
    }

    // 6. Sweep Scanline Beam (2D)
    if (this.layers.scan && this.mode === '2d') {
      this._drawScanSweep(ctx, palette);
    }

    // 6.5. Live NOAA Solar / Geomagnetic Aurora Ovals
    if (this.layers.solar && this.liveFeeds?.data.solar) {
      this._drawSolarAurora(ctx, path, palette);
    }

    // 7. SIGINT RF Heat / Interference Zones
    if (this.layers.sigint) {
      this._drawSigintZones(ctx, proj, palette);
    }

    // 8. Great-Circle Trajectory / Data Arcs + Moving Light Packets
    if (this.layers.arcs) {
      this._drawArcs(ctx, proj, palette);
    }

    // 9. Active Multi-Hop Signal Trace Beam
    if (this.trace) {
      this._drawTraceOverlay(ctx, proj, palette);
    }

    // 9.5. Live Public Data Overlays: Meteo, BGP IXPs, USGS Quakes, UN GDACS, NASA EONET, Wiki, ADS-B
    if (this.liveFeeds) {
      if (this.layers.meteo) this._drawLiveMeteo(ctx, proj, palette);
      if (this.layers.bgp) this._drawLiveBgp(ctx, proj, palette);
      if (this.layers.quakes) this._drawLiveQuakes(ctx, proj, palette);
      if (this.layers.gdacs) this._drawLiveGdacs(ctx, proj, palette);
      if (this.layers.eonet) this._drawLiveEonet(ctx, proj, palette);
      if (this.layers.wiki) this._drawLiveWiki(ctx, proj, palette);
      if (this.layers.aircraft) this._drawLiveAircraft(ctx, proj, palette);
    }

    // 10. Orbital Satellites (Simulated & Real Live NORAD/ISS SGP4)
    if (this.layers.satellites) {
      this._drawSatellites(ctx, proj, path, palette);
    }
    if (this.layers.liveSats && this.liveFeeds?.data.liveSats.length) {
      this._drawLiveSatellites(ctx, proj, path, palette);
    }

    // 11. Sonar Ping Ripples
    this._drawPings(ctx, proj, palette);

    // 12. Global Tactical Nodes + Labels + Target Lock Reticle
    if (this.layers.nodes) {
      this._drawNodes(ctx, proj, palette);
    }

    // 13. Live Cursor Tactical Crosshair
    if (this.mouse.inside && !this.dragging) {
      this._drawCrosshair(ctx, palette);
    }
  }

  _drawBackdropGrid(ctx, { accentRgb }) {
    ctx.save();
    ctx.fillStyle = `rgba(${accentRgb}, 0.08)`;
    const step = 36;
    for (let x = 18; x < this.w; x += step) {
      for (let y = 18; y < this.h; y += step) {
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  }

  _drawGlobeBackPass(ctx, { accentRgb }) {
    const projBack = this._getProjection(true);
    const pathBack = geoPath(projBack, ctx);
    const cx = this.w / 2 + this.panX;
    const cy = this.h / 2 + this.panY;
    const r = projBack.scale();

    ctx.save();

    // Outer deep-space glow
    const halo = ctx.createRadialGradient(cx, cy, r * 0.88, cx, cy, r * 1.18);
    halo.addColorStop(0, `rgba(${accentRgb}, 0.14)`);
    halo.addColorStop(0.55, `rgba(${accentRgb}, 0.05)`);
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.18, 0, Math.PI * 2);
    ctx.fill();

    // Subtle dark sphere interior
    const core = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.1, cx, cy, r);
    core.addColorStop(0, `rgba(${accentRgb}, 0.06)`);
    core.addColorStop(1, 'rgba(2, 7, 14, 0.72)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // Clip to sphere and render faint translucent BACKSIDE wireframe (holographic effect!)
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    if (this.layers.grid) {
      ctx.beginPath();
      pathBack(this.graticule);
      ctx.strokeStyle = `rgba(${accentRgb}, 0.065)`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    ctx.beginPath();
    pathBack(this.land);
    ctx.strokeStyle = `rgba(${accentRgb}, 0.14)`;
    ctx.lineWidth = 0.75;
    ctx.stroke();

    ctx.restore();
  }

  _drawGlobeFrontRim(ctx, proj, { accent, accentRgb }) {
    const cx = this.w / 2 + this.panX;
    const cy = this.h / 2 + this.panY;
    const r = proj.scale();

    ctx.save();
    // Main glowing holographic limb
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    ctx.stroke();

    // Outer tactical degree tick ring
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(${accentRgb}, 0.28)`;
    ctx.lineWidth = 1;
    const ringR = r + 10;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.setLineDash([4, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Cardinal degree ticks
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const major = deg % 45 === 0;
      const r0 = ringR;
      const r1 = ringR + (major ? 7 : 3.5);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * r0, cy + Math.sin(rad) * r0);
      ctx.lineTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
      ctx.strokeStyle = major ? `rgba(${accentRgb}, 0.6)` : `rgba(${accentRgb}, 0.25)`;
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawGraticule(ctx, path, proj, { accentRgb }) {
    ctx.save();
    ctx.beginPath();
    path(this.graticule);
    ctx.strokeStyle = `rgba(${accentRgb}, 0.13)`;
    ctx.lineWidth = 0.65;
    ctx.stroke();

    // Brighter Equator & Prime Meridian
    ctx.beginPath();
    path(this.equator);
    path(this.primeMeridian);
    ctx.strokeStyle = `rgba(${accentRgb}, 0.26)`;
    ctx.lineWidth = 0.9;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Degree axis labels in 2D mode
    if (this.mode === '2d') {
      ctx.font = '8.5px "SF Mono", Menlo, monospace';
      ctx.fillStyle = `rgba(${accentRgb}, 0.42)`;
      for (const lat of [-60, -30, 0, 30, 60]) {
        const pt = proj([-178, lat]);
        if (pt && pt[1] > 28 && pt[1] < this.h - 24) {
          const label = lat === 0 ? '0° EQ' : `${Math.abs(lat)}°${lat > 0 ? 'N' : 'S'}`;
          ctx.fillText(label, 12, pt[1] - 3);
        }
      }
      for (const lon of [-120, -60, 0, 60, 120]) {
        const pt = proj([lon, -72]);
        if (pt && pt[0] > 30 && pt[0] < this.w - 30) {
          const label = lon === 0 ? '0° PM' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`;
          ctx.fillText(label, pt[0] + 3, this.h - 32);
        }
      }
    }

    ctx.restore();
  }

  _drawWorldWireframe(ctx, path, { accent, accentRgb }) {
    ctx.save();

    // 1. Landmass subtle holographic hatch fill
    ctx.beginPath();
    path(this.land);
    ctx.fillStyle = this._ensureHatchPattern(accentRgb);
    ctx.fill();

    // 2. Interior country borders (thin wireframe)
    ctx.beginPath();
    path(this.borders);
    ctx.strokeStyle = `rgba(${accentRgb}, 0.34)`;
    ctx.lineWidth = 0.65;
    ctx.stroke();

    // 3. Outer glowing coastline wireframe
    ctx.beginPath();
    path(this.land);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.25;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.stroke();

    ctx.restore();
  }

  _drawScanSweep(ctx, { accentRgb }) {
    const x = this.scanX * this.w;
    const trailW = 90;
    ctx.save();
    const grad = ctx.createLinearGradient(x - trailW, 0, x, 0);
    grad.addColorStop(0, `rgba(${accentRgb}, 0)`);
    grad.addColorStop(0.85, `rgba(${accentRgb}, 0.07)`);
    grad.addColorStop(1, `rgba(${accentRgb}, 0.22)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x - trailW, 0, trailW, this.h);

    ctx.strokeStyle = `rgba(${accentRgb}, 0.45)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.h);
    ctx.stroke();
    ctx.restore();
  }

  _drawSigintZones(ctx, proj, { critRgb, warnRgb, covertRgb }) {
    ctx.save();
    for (const n of this.nodes) {
      if (n.type === 'ALLIED') continue;
      if (!this._isVisible3D(n.lon, n.lat)) continue;
      const pt = proj([n.lon, n.lat]);
      if (!pt) continue;

      const rgb = n.type === 'CRITICAL' ? critRgb : n.type === 'WARNING' ? warnRgb : covertRgb;
      const pulse = 0.72 + 0.28 * Math.sin(this.time * 2.6 + n.lon);
      const r = (n.type === 'CRITICAL' ? 42 : 30) * Math.min(1.5, this.zoom * 0.9) * pulse;

      const grad = ctx.createRadialGradient(pt[0], pt[1], 2, pt[0], pt[1], r);
      grad.addColorStop(0, `rgba(${rgb}, 0.28)`);
      grad.addColorStop(0.55, `rgba(${rgb}, 0.08)`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _sampleGeodesicScreenPoints(interp, proj, steps = 40) {
    const segments = [];
    let current = [];
    let prevPt = null;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const [lon, lat] = interp(t);
      if (!this._isVisible3D(lon, lat)) {
        if (current.length > 1) segments.push(current);
        current = [];
        prevPt = null;
        continue;
      }
      const pt = proj([lon, lat]);
      if (!pt) continue;

      // Break segment on 2D anti-meridian jump
      if (prevPt && Math.abs(pt[0] - prevPt[0]) > this.w * 0.45) {
        if (current.length > 1) segments.push(current);
        current = [pt];
      } else {
        current.push(pt);
      }
      prevPt = pt;
    }
    if (current.length > 1) segments.push(current);
    return segments;
  }

  _drawArcs(ctx, proj, palette) {
    ctx.save();
    for (const a of this.arcs) {
      const color =
        a.type === 'CRITICAL'
          ? palette.crit
          : a.type === 'WARNING'
          ? palette.warn
          : a.type === 'COVERT'
          ? palette.covert
          : palette.accent;
      const rgb =
        a.type === 'CRITICAL'
          ? palette.critRgb
          : a.type === 'WARNING'
          ? palette.warnRgb
          : a.type === 'COVERT'
          ? palette.covertRgb
          : palette.accentRgb;

      const segments = this._sampleGeodesicScreenPoints(a.interpolator, proj, 36);

      // Base dashed geodesic line
      ctx.strokeStyle = `rgba(${rgb}, 0.34)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      for (const seg of segments) {
        ctx.beginPath();
        seg.forEach((p, idx) => (idx === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Animated luminous packet + glowing tail along geodesic
      const headT = a.progress;
      const tailLen = 0.14;
      const tailSteps = 10;
      const tailPts = [];
      for (let i = 0; i <= tailSteps; i++) {
        const t = Math.max(0, headT - tailLen * (1 - i / tailSteps));
        const [lon, lat] = a.interpolator(t);
        if (!this._isVisible3D(lon, lat)) continue;
        const p = proj([lon, lat]);
        if (p) tailPts.push(p);
      }

      if (tailPts.length > 1) {
        for (let i = 1; i < tailPts.length; i++) {
          const p0 = tailPts[i - 1];
          const p1 = tailPts[i];
          if (Math.abs(p1[0] - p0[0]) > this.w * 0.4) continue;
          const alpha = (i / tailPts.length) * 0.9;
          ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(2)})`;
          ctx.lineWidth = 1.9;
          ctx.beginPath();
          ctx.moveTo(p0[0], p0[1]);
          ctx.lineTo(p1[0], p1[1]);
          ctx.stroke();
        }
        const head = tailPts[tailPts.length - 1];
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = color;
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.arc(head[0], head[1], 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  _drawTraceOverlay(ctx, proj, { crit, ok }) {
    const ids = this.trace.nodeIds;
    const beamColor = this.trace.finished ? ok : crit;

    ctx.save();
    ctx.shadowColor = beamColor;
    ctx.shadowBlur = 12;

    const maxSeg = Math.min(this.trace.activeStep, ids.length - 1);
    for (let s = 0; s < maxSeg; s++) {
      const a = this.nodeById.get(ids[s]);
      const b = this.nodeById.get(ids[s + 1]);
      if (!a || !b) continue;
      const interp = geoInterpolate([a.lon, a.lat], [b.lon, b.lat]);
      const isCurrent = s === maxSeg - 1 && !this.trace.finished;
      const limitT = isCurrent ? this.trace.segProgress : 1.0;

      const steps = 28;
      let prev = null;
      ctx.strokeStyle = beamColor;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * limitT;
        const [lon, lat] = interp(t);
        if (!this._isVisible3D(lon, lat)) {
          prev = null;
          continue;
        }
        const p = proj([lon, lat]);
        if (!p) continue;
        if (!prev || Math.abs(p[0] - prev[0]) > this.w * 0.4) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
        prev = p;
      }
      ctx.stroke();

      // Bright hop node ring
      const pb = proj([b.lon, b.lat]);
      if (pb && this._isVisible3D(b.lon, b.lat) && (!isCurrent || limitT > 0.92)) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(pb[0], pb[1], 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawSatellites(ctx, proj, path, { ok, okRgb, accentRgb }) {
    ctx.save();

    for (const s of this.satellites) {
      const isSelected = this.selectedSatId === s.id;

      // 1. Orbital sinusoidal ground track
      ctx.beginPath();
      let prevPt = null;
      const trackSamples = 64;
      for (let i = -24; i <= trackSamples; i++) {
        const tFuture = this.time + i * 1.1;
        const phase = tFuture * s.speed + s.phaseOffset;
        const lat = Math.sin(phase) * s.inclination;
        const lon = ((s.lonOffset + (tFuture * s.speed * 57.2958) * 1.15) % 360 + 540) % 360 - 180;
        if (!this._isVisible3D(lon, lat)) {
          prevPt = null;
          continue;
        }
        const pt = proj([lon, lat]);
        if (!pt) continue;
        if (!prevPt || Math.abs(pt[0] - prevPt[0]) > this.w * 0.35) ctx.moveTo(pt[0], pt[1]);
        else ctx.lineTo(pt[0], pt[1]);
        prevPt = pt;
      }
      ctx.strokeStyle = isSelected ? `rgba(${okRgb}, 0.65)` : `rgba(${okRgb}, 0.18)`;
      ctx.lineWidth = isSelected ? 1.3 : 0.8;
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      // 2. Geodesic sensor swath circle projected onto Earth
      const footprint = geoCircle().center([s.lon, s.lat]).radius(s.footprintDeg)();
      ctx.beginPath();
      path(footprint);
      ctx.fillStyle = isSelected ? `rgba(${okRgb}, 0.12)` : `rgba(${okRgb}, 0.045)`;
      ctx.fill();
      ctx.strokeStyle = isSelected ? `rgba(${okRgb}, 0.72)` : `rgba(${okRgb}, 0.25)`;
      ctx.lineWidth = isSelected ? 1.1 : 0.7;
      ctx.stroke();

      if (!this._isVisible3D(s.lon, s.lat)) continue;
      const pt = proj([s.lon, s.lat]);
      if (!pt) continue;

      // 3. Downlink laser beam to any ground node inside satellite footprint
      const footprintRad = (s.footprintDeg * Math.PI) / 180;
      for (const n of this.nodes) {
        if (geoDistance([s.lon, s.lat], [n.lon, n.lat]) <= footprintRad) {
          if (!this._isVisible3D(n.lon, n.lat)) continue;
          const npt = proj([n.lon, n.lat]);
          if (!npt) continue;
          ctx.strokeStyle = `rgba(${okRgb}, 0.55)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pt[0], pt[1]);
          ctx.lineTo(npt[0], npt[1]);
          ctx.stroke();
        }
      }

      // 4. Satellite glyph (central diamond + solar array wings)
      ctx.save();
      ctx.translate(pt[0], pt[1]);
      ctx.strokeStyle = ok;
      ctx.fillStyle = ok;
      ctx.shadowColor = ok;
      ctx.shadowBlur = 7;
      ctx.lineWidth = 1.2;

      // Solar wings
      ctx.beginPath();
      ctx.moveTo(-9, 0);
      ctx.lineTo(-4, 0);
      ctx.moveTo(4, 0);
      ctx.lineTo(9, 0);
      ctx.stroke();
      ctx.strokeRect(-10, -2.5, 5, 5);
      ctx.strokeRect(5, -2.5, 5, 5);

      // Core bus diamond
      ctx.beginPath();
      ctx.moveTo(0, -3.5);
      ctx.lineTo(3.5, 0);
      ctx.lineTo(0, 3.5);
      ctx.lineTo(-3.5, 0);
      ctx.closePath();
      ctx.fill();

      // Label
      ctx.shadowBlur = 0;
      ctx.font = '8px "SF Mono", Menlo, monospace';
      ctx.fillStyle = isSelected ? '#ffffff' : `rgba(${okRgb}, 0.85)`;
      ctx.fillText(s.name.split(' ')[0], 13, 3);
      ctx.restore();

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], ok, 18);
      }
    }

    ctx.restore();
  }

  _drawPings(ctx, proj, palette) {
    ctx.save();
    for (const p of this.pings) {
      if (!this._isVisible3D(p.lon, p.lat)) continue;
      const pt = proj([p.lon, p.lat]);
      if (!pt) continue;
      const frac = p.age / p.maxAge;
      const radius = 6 + frac * 48;
      const color = getCssVar(p.colorVar, palette.accent);
      ctx.strokeStyle = color;
      ctx.globalAlpha = (1 - frac) * 0.9;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawNodes(ctx, proj, palette) {
    ctx.save();

    for (const n of this.nodes) {
      if (!this._isVisible3D(n.lon, n.lat)) continue;
      const pt = proj([n.lon, n.lat]);
      if (!pt) continue;

      const isSelected = this.selectedNodeId === n.id;
      const isHovered = this.hoveredItem?.kind === 'node' && this.hoveredItem.item.id === n.id;
      const color =
        n.type === 'CRITICAL'
          ? palette.crit
          : n.type === 'WARNING'
          ? palette.warn
          : n.type === 'COVERT'
          ? palette.covert
          : palette.accent;
      const rgb =
        n.type === 'CRITICAL'
          ? palette.critRgb
          : n.type === 'WARNING'
          ? palette.warnRgb
          : n.type === 'COVERT'
          ? palette.covertRgb
          : palette.accentRgb;

      // Scanline proximity boost in 2D mode
      const scanDist = this.mode === '2d' ? Math.abs(pt[0] - this.scanX * this.w) : 999;
      const scanGlow = scanDist < 32 ? 1 - scanDist / 32 : 0;

      // Pulsing outer ring
      const phase = (this.time * (n.type === 'CRITICAL' ? 1.15 : 0.7) + Math.abs(n.lon) * 0.05) % 1;
      const pulseR = 4 + phase * (n.type === 'CRITICAL' ? 17 : 12);
      ctx.strokeStyle = `rgba(${rgb}, ${((1 - phase) * 0.72).toFixed(2)})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], pulseR, 0, Math.PI * 2);
      ctx.stroke();

      // Core tactical marker
      ctx.save();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = isSelected || isHovered || scanGlow > 0.3 ? 14 : 7;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], isSelected ? 4.3 : n.type === 'CRITICAL' ? 3.7 : 3.0, 0, Math.PI * 2);
      ctx.fill();

      // Crisp inner white core
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 1.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Callout tag with smart directional anchor so dense regions never collide
      ctx.font = isSelected || isHovered ? 'bold 9.5px "SF Mono", Menlo, monospace' : '8.5px "SF Mono", Menlo, monospace';
      const label = `${n.code} ${n.city}`;
      const tw = ctx.measureText(label).width;
      const pos = n.labelPos || 'tr';
      const isLeft = pos === 'tl' || pos === 'bl';
      const isBottom = pos === 'bl' || pos === 'br';
      const lx = isLeft ? pt[0] - 10 - tw : pt[0] + 10;
      const ly = isBottom ? pt[1] + 14 : pt[1] - 7;

      // Subtle leader tick for selected/critical/hovered or offset labels
      if (isSelected || n.type === 'CRITICAL' || isHovered || pos !== 'tr') {
        ctx.strokeStyle = `rgba(${rgb}, 0.65)`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(pt[0] + (isLeft ? -4 : 4), pt[1] + (isBottom ? 3 : -2));
        ctx.lineTo(isLeft ? lx + tw + 2 : lx - 2, ly - 3);
        ctx.stroke();
      }

      // Label backdrop for legibility
      ctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
      ctx.fillRect(lx - 2, ly - 9, tw + 4, 11);

      ctx.fillStyle = isSelected || isHovered ? '#ffffff' : color;
      ctx.fillText(label, lx, ly);

      // Animated Target Lock Reticle around selected node
      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], color, 17);
      }
    }

    ctx.restore();
  }

  _drawReticle(ctx, x, y, color, radius) {
    ctx.save();
    ctx.translate(x, y);

    // Rotating segmented outer circle
    ctx.save();
    ctx.rotate(this.time * 0.9);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    for (let i = 0; i < 4; i++) {
      const a0 = i * (Math.PI / 2) + 0.2;
      const a1 = a0 + 0.85;
      ctx.beginPath();
      ctx.arc(0, 0, radius, a0, a1);
      ctx.stroke();
    }
    ctx.restore();

    // 4 Corner Lock Brackets
    const b = radius + 4 + Math.sin(this.time * 5) * 1.2;
    const arm = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.3;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const [sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(sx * b, sy * (b - arm));
      ctx.lineTo(sx * b, sy * b);
      ctx.lineTo(sx * (b - arm), sy * b);
      ctx.stroke();
    }

    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // LIVE PUBLIC DATA OVERLAY RENDERERS (NOAA, USGS, NASA EONET, ADS-B, NORAD)
  // --------------------------------------------------------------------------

  _drawSolarAurora(ctx, path, { okRgb, warnRgb, critRgb }) {
    const solar = this.liveFeeds.data.solar;
    const kp = solar.kp || 1;
    // Aurora oval expands equatorward as Kp increases
    const radiusDeg = Math.min(34, 15 + kp * 2.1);
    const pulse = 0.78 + 0.22 * Math.sin(this.time * 1.8);
    const rgb = kp >= 5 ? critRgb : kp >= 4 ? warnRgb : okRgb;

    ctx.save();
    for (const poleLat of [81, -76]) {
      const poleLon = poleLat > 0 ? -72 : 108; // approximate geomagnetic poles
      const outer = geoCircle().center([poleLon, poleLat]).radius(radiusDeg)();
      const inner = geoCircle().center([poleLon, poleLat]).radius(Math.max(6, radiusDeg - 5))();

      ctx.beginPath();
      path(outer);
      ctx.fillStyle = `rgba(${rgb}, ${(0.055 * pulse).toFixed(3)})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb}, ${(0.34 * pulse).toFixed(3)})`;
      ctx.lineWidth = 1.1;
      ctx.setLineDash([5, 5]);
      ctx.stroke();

      ctx.beginPath();
      path(inner);
      ctx.strokeStyle = `rgba(${rgb}, ${(0.18 * pulse).toFixed(3)})`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawLiveQuakes(ctx, proj, { crit, critRgb, warn, warnRgb }) {
    const quakes = this.liveFeeds.data.quakes;
    if (!quakes.length) return;

    ctx.save();
    for (const q of quakes) {
      if (!this._isVisible3D(q.lon, q.lat)) continue;
      const pt = proj([q.lon, q.lat]);
      if (!pt) continue;

      const isSelected = this.selectedLive?.kind === 'quake' && this.selectedLive.id === q.id;
      const isHovered = this.hoveredItem?.kind === 'quake' && this.hoveredItem.item.id === q.id;
      const isMajor = q.mag >= 5.0;
      const isMod = q.mag >= 4.0;
      const color = isMajor ? crit : isMod ? warn : '#ffe066';
      const rgb = isMajor ? critRgb : isMod ? warnRgb : '255, 224, 102';

      const baseR = Math.max(2.2, (q.mag - 1.8) * 2.1);
      const wavePhase = (this.time * (isMajor ? 0.95 : 0.55) + Math.abs(q.lon) * 0.13) % 1;
      const shockR = Math.max(2, baseR + wavePhase * (isMajor ? 22 : isMod ? 14 : 9));

      // Expanding seismic shockwave ring
      ctx.strokeStyle = `rgba(${rgb}, ${((1 - wavePhase) * (isMajor ? 0.85 : 0.55)).toFixed(2)})`;
      ctx.lineWidth = isMajor ? 1.4 : 0.9;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], shockR, 0, Math.PI * 2);
      ctx.stroke();

      // Secondary inner ring for M4.5+
      if (q.mag >= 4.5) {
        const p2 = (wavePhase + 0.5) % 1;
        ctx.strokeStyle = `rgba(${rgb}, ${((1 - p2) * 0.65).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], Math.max(2, baseR + p2 * 18), 0, Math.PI * 2);
        ctx.stroke();
      }

      // Epicenter core
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], Math.max(1.8, isMajor ? 3.2 : 2.1), 0, Math.PI * 2);
      ctx.fill();

      // Magnitude callout for M4.5+ or selected/hovered
      if (q.mag >= 4.6 || isSelected || isHovered) {
        ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
        const tag = `M${q.mag.toFixed(1)}`;
        ctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
        ctx.fillRect(pt[0] + 5, pt[1] - 9, 25, 10);
        ctx.fillStyle = color;
        ctx.fillText(tag, pt[0] + 7, pt[1] - 1);
      }

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], color, 15);
      }
    }
    ctx.restore();
  }

  _drawLiveEonet(ctx, proj, { crit }) {
    const events = this.liveFeeds.data.eonet;
    if (!events.length) return;

    ctx.save();
    for (const ev of events) {
      if (!this._isVisible3D(ev.lon, ev.lat)) continue;
      const pt = proj([ev.lon, ev.lat]);
      if (!pt) continue;

      const isSelected = this.selectedLive?.kind === 'eonet' && this.selectedLive.id === ev.id;
      const isHovered = this.hoveredItem?.kind === 'eonet' && this.hoveredItem.item.id === ev.id;

      let color = '#ff7b00';
      if (ev.categoryId === 'volcanoes') color = crit;
      else if (ev.categoryId === 'severeStorms') color = '#5ce1ff';
      else if (ev.categoryId === 'seaLakeIce') color = '#b8f0ff';

      ctx.save();
      ctx.translate(pt[0], pt[1]);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = isSelected || isHovered ? 10 : 5;
      ctx.lineWidth = 1.2;

      if (ev.categoryId === 'volcanoes') {
        // Tactical upward warning triangle
        ctx.beginPath();
        ctx.moveTo(0, -5);
        ctx.lineTo(4.6, 3.5);
        ctx.lineTo(-4.6, 3.5);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 42, 85, 0.35)';
        ctx.fill();
      } else if (ev.categoryId === 'severeStorms') {
        // Rotating cyclone ring
        ctx.rotate(this.time * 2.2);
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 1.45);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Wildfire / hazard diamond
        ctx.beginPath();
        ctx.moveTo(0, -4.5);
        ctx.lineTo(4, 0);
        ctx.lineTo(0, 4.5);
        ctx.lineTo(-4, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 0.45;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], color, 15);
      }
    }
    ctx.restore();
  }

  _drawLiveAircraft(ctx, proj, { accent, crit }) {
    const planes = this.liveFeeds.data.aircraft;
    if (!planes.length) return;

    ctx.save();
    for (const ac of planes) {
      if (!this._isVisible3D(ac.lon, ac.lat)) continue;
      const pt = proj([ac.lon, ac.lat]);
      if (!pt) continue;

      const isSelected = this.selectedLive?.kind === 'aircraft' && this.selectedLive.id === ac.id;
      const isHovered = this.hoveredItem?.kind === 'aircraft' && this.hoveredItem.item.id === ac.id;
      const color = ac.emergency ? crit : isSelected || isHovered ? '#ffffff' : '#7df9ff';
      const headingRad = ((ac.trackDeg ?? 0) * Math.PI) / 180;

      ctx.save();
      ctx.translate(pt[0], pt[1]);
      ctx.rotate(headingRad);

      // Subtle velocity heading vector line ahead of aircraft
      ctx.strokeStyle = ac.emergency ? 'rgba(255, 42, 85, 0.7)' : 'rgba(125, 249, 255, 0.45)';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(0, -12);
      ctx.stroke();

      // Tactical delta jet chevron pointing north (0 deg = up)
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = isSelected || isHovered ? 9 : 4;
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(3.6, 3.8);
      ctx.lineTo(0, 1.8);
      ctx.lineTo(-3.6, 3.8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      if (isSelected || isHovered || ac.emergency) {
        ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
        const tag = `${ac.callsign} ${ac.type}`;
        const tw = ctx.measureText(tag).width;
        ctx.fillStyle = 'rgba(3, 9, 17, 0.82)';
        ctx.fillRect(pt[0] + 7, pt[1] - 9, tw + 4, 10);
        ctx.fillStyle = ac.emergency ? crit : accent;
        ctx.fillText(tag, pt[0] + 9, pt[1] - 1);
      }

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], ac.emergency ? crit : accent, 15);
      }
    }
    ctx.restore();
  }

  _drawLiveSatellites(ctx, proj, path, { ok, okRgb, warn }) {
    const sats = this.liveFeeds.data.liveSats;
    if (!sats.length) return;

    ctx.save();
    for (const s of sats) {
      const isIss = s.noradId === 25544;
      const isSelected = this.selectedLive?.kind === 'liveSat' && this.selectedLive.id === s.id;
      const isHovered = this.hoveredItem?.kind === 'liveSat' && this.hoveredItem.item.id === s.id;
      const satColor = isIss ? '#ffe066' : ok;
      const satRgb = isIss ? '255, 224, 102' : okRgb;

      // 1. Real SGP4 propagated orbital ground track
      if (s.track && s.track.length > 1) {
        ctx.beginPath();
        let prevPt = null;
        for (const [lon, lat] of s.track) {
          if (!this._isVisible3D(lon, lat)) {
            prevPt = null;
            continue;
          }
          const pt = proj([lon, lat]);
          if (!pt) continue;
          if (!prevPt || Math.abs(pt[0] - prevPt[0]) > this.w * 0.35) ctx.moveTo(pt[0], pt[1]);
          else ctx.lineTo(pt[0], pt[1]);
          prevPt = pt;
        }
        ctx.strokeStyle = isSelected || isIss ? `rgba(${satRgb}, 0.58)` : `rgba(${satRgb}, 0.22)`;
        ctx.lineWidth = isSelected || isIss ? 1.25 : 0.8;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 2. Geodesic live sensor / visibility swath
      const footprint = geoCircle().center([s.lon, s.lat]).radius(s.footprintDeg || 16)();
      ctx.beginPath();
      path(footprint);
      ctx.fillStyle = isSelected || isIss ? `rgba(${satRgb}, 0.09)` : `rgba(${satRgb}, 0.035)`;
      ctx.fill();
      ctx.strokeStyle = isSelected || isIss ? `rgba(${satRgb}, 0.65)` : `rgba(${satRgb}, 0.24)`;
      ctx.lineWidth = isSelected || isIss ? 1.0 : 0.65;
      ctx.stroke();

      if (!this._isVisible3D(s.lon, s.lat)) continue;
      const pt = proj([s.lon, s.lat]);
      if (!pt) continue;

      // 3. Satellite glyph (ISS gets double solar wings)
      ctx.save();
      ctx.translate(pt[0], pt[1]);
      ctx.strokeStyle = satColor;
      ctx.fillStyle = satColor;
      ctx.shadowColor = satColor;
      ctx.shadowBlur = isIss || isSelected || isHovered ? 10 : 6;
      ctx.lineWidth = 1.25;

      const span = isIss ? 11 : 8;
      ctx.beginPath();
      ctx.moveTo(-span, 0);
      ctx.lineTo(span, 0);
      ctx.stroke();
      ctx.strokeRect(-span - 1, -2.5, 4.5, 5);
      ctx.strokeRect(span - 3.5, -2.5, 4.5, 5);
      ctx.beginPath();
      ctx.arc(0, 0, isIss ? 3.2 : 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.font = isIss || isSelected ? 'bold 8.5px "SF Mono", Menlo, monospace' : '8px "SF Mono", Menlo, monospace';
      const shortName = isIss ? 'ISS [LIVE]' : s.name.replace(/\s*\(.*?\)/, '');
      const tw = ctx.measureText(shortName).width;
      ctx.fillStyle = 'rgba(3, 9, 17, 0.76)';
      ctx.fillRect(12, -7, tw + 4, 10);
      ctx.fillStyle = isSelected ? '#ffffff' : satColor;
      ctx.fillText(shortName, 14, 1);
      ctx.restore();

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], isIss ? warn : ok, 18);
      }
    }
    ctx.restore();
  }

  _drawLiveMeteo(ctx, proj) {
    const stations = this.liveFeeds.data.meteo;
    if (!stations.length) return;

    ctx.save();
    for (const st of stations) {
      if (!this._isVisible3D(st.lon, st.lat)) continue;
      const pt = proj([st.lon, st.lat]);
      if (!pt) continue;

      const isSelected = this.selectedLive?.kind === 'meteo' && this.selectedLive.id === st.id;
      const isHovered = this.hoveredItem?.kind === 'meteo' && this.hoveredItem.item.id === st.id;
      const color = st.windKmh >= 35 ? '#ffb000' : '#64d8ff';

      // Directional wind vector arrow (meteorological wind flows FROM windDir -> arrow points downwind +180deg)
      const rad = (((st.windDir || 0) + 180) * Math.PI) / 180;
      const len = Math.max(8, Math.min(20, 7 + st.windKmh * 0.25));

      ctx.save();
      ctx.translate(pt[0], pt[1]);
      ctx.rotate(rad);
      ctx.strokeStyle = isSelected || isHovered ? '#ffffff' : color;
      ctx.fillStyle = isSelected || isHovered ? '#ffffff' : color;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.lineTo(0, -len);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(0, -len - 2.5);
      ctx.lineTo(2.4, -len + 2);
      ctx.lineTo(-2.4, -len + 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Compact temp tag
      ctx.font = '7.5px "SF Mono", Menlo, monospace';
      const label = `${Math.round(st.tempC)}°C`;
      ctx.fillStyle = 'rgba(3, 9, 17, 0.72)';
      ctx.fillRect(pt[0] + 5, pt[1] + 2, 23, 9.5);
      ctx.fillStyle = isSelected || isHovered ? '#ffffff' : 'rgba(130, 224, 255, 0.88)';
      ctx.fillText(label, pt[0] + 6, pt[1] + 9.5);

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], color, 15);
      }
    }
    ctx.restore();
  }

  _drawLiveBgp(ctx, proj, { covert, covertRgb }) {
    const cols = this.liveFeeds.data.bgpCollectors;
    if (!cols.length) return;
    const now = Date.now();

    ctx.save();
    for (const c of cols) {
      if (!this._isVisible3D(c.lon, c.lat)) continue;
      const pt = proj([c.lon, c.lat]);
      if (!pt) continue;

      const isSelected = this.selectedLive?.kind === 'bgp' && this.selectedLive.id === c.id;
      const isHovered = this.hoveredItem?.kind === 'bgp' && this.hoveredItem.item.id === c.id;
      const pulseAge = now - c.lastPulseAt;
      const isPulsing = c.lastPulseAt > 0 && pulseAge < 1600;

      // Live expanding BGP cyber-pulse ring when real RIPE updates arrive at this IXP!
      if (isPulsing) {
        const frac = pulseAge / 1600;
        const r = Math.max(2, 4 + frac * 18);
        ctx.strokeStyle = `rgba(${covertRgb}, ${((1 - frac) * 0.85).toFixed(2)})`;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Small hexagonal IXP collector glyph
      ctx.save();
      ctx.translate(pt[0], pt[1]);
      ctx.strokeStyle = isPulsing || isSelected || isHovered ? '#e6a8ff' : `rgba(${covertRgb}, 0.58)`;
      ctx.fillStyle = isPulsing ? covert : `rgba(${covertRgb}, 0.22)`;
      ctx.lineWidth = 1;
      const hr = isPulsing ? 3.5 : 2.6;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const hx = Math.cos(a) * hr;
        const hy = Math.sin(a) * hr;
        if (i === 0) ctx.moveTo(hx, hy);
        else ctx.lineTo(hx, hy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], covert, 15);
      }
    }
    ctx.restore();
  }

  _drawLiveGdacs(ctx, proj, { crit, critRgb, warn, warnRgb, ok, okRgb }) {
    const events = this.liveFeeds.data.gdacs;
    if (!events.length) return;

    ctx.save();
    for (const ev of events) {
      if (!this._isVisible3D(ev.lon, ev.lat)) continue;
      const pt = proj([ev.lon, ev.lat]);
      if (!pt) continue;

      const isSelected = this.selectedLive?.kind === 'gdacs' && this.selectedLive.id === ev.id;
      const isHovered = this.hoveredItem?.kind === 'gdacs' && this.hoveredItem.item.id === ev.id;
      const isRed = ev.alertLevel === 'Red';
      const isOrange = ev.alertLevel === 'Orange';
      const color = isRed ? crit : isOrange ? warn : ok;
      const rgb = isRed ? critRgb : isOrange ? warnRgb : okRgb;

      // Pulsing ring for Orange/Red UN alerts
      if (isRed || isOrange) {
        const phase = (this.time * (isRed ? 1.1 : 0.65) + Math.abs(ev.lat) * 0.1) % 1;
        ctx.strokeStyle = `rgba(${rgb}, ${((1 - phase) * 0.75).toFixed(2)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], Math.max(3, 5 + phase * (isRed ? 16 : 11)), 0, Math.PI * 2);
        ctx.stroke();
      }

      // Crisp octagonal crisis shield badge
      ctx.save();
      ctx.translate(pt[0], pt[1]);
      ctx.strokeStyle = color;
      ctx.fillStyle = `rgba(${rgb}, 0.24)`;
      ctx.lineWidth = 1.1;
      const r = isRed ? 5.2 : 4.2;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + Math.PI / 8;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Tiny event type code inside/beside for Red/Orange/selected
      if (isRed || isOrange || isSelected || isHovered) {
        ctx.font = 'bold 7.5px "SF Mono", Menlo, monospace';
        ctx.fillStyle = color;
        ctx.fillText(ev.eventType, 7, 2.5);
      }
      ctx.restore();

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], color, 16);
      }
    }
    ctx.restore();
  }

  _drawLiveWiki(ctx, proj) {
    const hubs = this.liveFeeds.data.wikiHubs;
    if (!hubs.length) return;
    const now = Date.now();

    ctx.save();
    for (const h of hubs) {
      if (!this._isVisible3D(h.lon, h.lat)) continue;
      const pt = proj([h.lon, h.lat]);
      if (!pt) continue;

      const isSelected = this.selectedLive?.kind === 'wiki' && this.selectedLive.id === h.id;
      const age = now - h.lastPulseAt;
      if (h.lastPulseAt > 0 && age < 2600) {
        const frac = age / 2600;
        ctx.strokeStyle = `rgba(220, 248, 255, ${((1 - frac) * 0.72).toFixed(2)})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], Math.max(3, 5 + frac * 22), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(210, 242, 255, 0.75)';
      ctx.lineWidth = 1;
      ctx.strokeRect(pt[0] - 4, pt[1] - 4, 8, 8);
      ctx.font = 'bold 7px "SF Mono", Menlo, monospace';
      ctx.fillStyle = '#e8f9ff';
      ctx.fillText(h.lang, pt[0] - 4.5, pt[1] - 6);

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], '#e8f9ff', 15);
      }
    }
    ctx.restore();
  }

  _drawCrosshair(ctx, { accentRgb }) {
    const { x, y } = this.mouse;
    ctx.save();
    ctx.strokeStyle = `rgba(${accentRgb}, 0.16)`;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, this.h);
    ctx.moveTo(0, y);
    ctx.lineTo(this.w, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Small reticle box at cursor
    ctx.strokeStyle = `rgba(${accentRgb}, 0.55)`;
    ctx.strokeRect(x - 6, y - 6, 12, 12);
    ctx.restore();
  }
}
