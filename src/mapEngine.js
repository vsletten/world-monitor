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
import worldTopo50 from 'world-atlas/countries-50m.json';
import worldTopo110 from 'world-atlas/countries-110m.json';
import {
  getThemePalette,
  getCachedCssVar,
  getSubsolarPoint,
  getNightCircleCenter,
} from './utils.js';
import { SUBSEA_CABLES } from './subseaCables.js';

const HIT_PRIORITY_BIAS = {
  node: 0,
  liveSat: 1,
  sat: 1.5,
  gdacs: 1.5,
  quake: 2,
  eonet: 2,
  aircraft: 2.5,
  bgp: 3,
  wiki: 3.5,
  meteo: 4,
  cable: 5,
};

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

    // Dual-resolution world vector geometry (Natural Earth 50m + 110m)
    this.land50 = feature(worldTopo50, worldTopo50.objects.land);
    this.borders50 = mesh(worldTopo50, worldTopo50.objects.countries, (a, b) => a !== b);
    this.land110 = feature(worldTopo110, worldTopo110.objects.land);
    this.borders110 = mesh(worldTopo110, worldTopo110.objects.countries, (a, b) => a !== b);
    // Backwards-compatible aliases
    this.land = this.land50;
    this.borders = this.borders50;

    this.graticule = geoGraticule().step([15, 15])();
    this.equator = { type: 'LineString', coordinates: [[-180, 0], [-90, 0], [0, 0], [90, 0], [180, 0]] };
    this.primeMeridian = { type: 'LineString', coordinates: [[0, -85], [0, 0], [0, 85]] };

    // Prebuilt GeoJSON LineStrings for subsea fiber trunk cables
    this._cableGeoms = SUBSEA_CABLES.map((cable) => ({
      cable,
      geoLine: { type: 'LineString', coordinates: cable.coordinates },
    }));

    // View & interaction state
    this.mode = '2d'; // '2d' | '3d'
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.target2D = null; // { zoom, panX, panY }
    this.rotation = [-12, -22, 0]; // 3D globe rotation [lambda, phi, gamma]
    this.targetRotation = null;
    this.autoRotate = true;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.layers = {
      nodes: true,
      arcs: true,
      satellites: false, // superseded by liveSats by default, still toggleable!
      sigint: true,
      grid: true,
      scan: true,
      terminator: true,
      cables: true,
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
    this.selectedLive = null; // { kind: 'liveSat'|'quake'|'eonet'|'aircraft'|'bgp'|'gdacs'|'meteo'|'wiki'|'cable', id }
    this.hoveredItem = null;
    this.alertActive = false;

    // Active trace animation state
    this.trace = null; // { waypoints: [{ id, lon, lat, label }], nodeIds: [], activeStep: 0, segProgress: 0, finished: false }

    // Expanding sonar ping rings
    this.pings = []; // { lon, lat, age, maxAge, colorVar }

    // Mouse & overlap hit-cycling state
    this.mouse = { x: -1, y: -1, inside: false };
    this.dragging = false;
    this.dragMoved = false;
    this.dragStart = { x: 0, y: 0, panX: 0, panY: 0, rot: [0, 0, 0] };
    this._overlapCycleIdx = 0;
    this._lastClickMeta = { x: -999, y: -999, ts: 0 };

    // Animation timers & caches
    this.time = 0;
    this.scanX = 0;
    this._hatchTile = null;
    this._hatchTileAccent = '';
    this._hatchPatterns = new WeakMap();
    this._dotTile = null;
    this._dotTileAccent = '';
    this._dotPatterns = new WeakMap();
    this._baseCacheCanvas = null;
    this._baseCacheCtx = null;
    this._baseCacheKey = '';
    this._terminatorCache = null;
    this._auroraCache = null;
    this._labelBoxes = [];
    this._deferredLabels = [];

    this.resize();
    this._bindEvents();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const nextW = Math.max(300, Math.floor(rect.width));
    const nextH = Math.max(220, Math.floor(rect.height));
    if (nextW === this.w && nextH === this.h && dpr === this.dpr) return;
    this.dpr = dpr;
    this.w = nextW;
    this.h = nextH;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.invalidateCache();
    if (this.land50 && this.time > 0) {
      this.render(0);
    }
  }

  invalidateCache() {
    this._baseCacheKey = '';
  }

  _ensureHatchPattern(ctx, accentRgb) {
    if (this._hatchTileAccent !== accentRgb || !this._hatchTile) {
      this._hatchTileAccent = accentRgb;
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
      this._hatchTile = tile;
      this._hatchPatterns = new WeakMap();
    }
    let pattern = this._hatchPatterns.get(ctx);
    if (!pattern) {
      pattern = ctx.createPattern(this._hatchTile, 'repeat');
      this._hatchPatterns.set(ctx, pattern);
    }
    return pattern;
  }

  _ensureDotPattern(ctx, accentRgb) {
    if (this._dotTileAccent !== accentRgb || !this._dotTile) {
      this._dotTileAccent = accentRgb;
      const tile = document.createElement('canvas');
      tile.width = 36;
      tile.height = 36;
      const tctx = tile.getContext('2d');
      tctx.fillStyle = `rgba(${accentRgb}, 0.08)`;
      tctx.fillRect(18, 18, 1, 1);
      this._dotTile = tile;
      this._dotPatterns = new WeakMap();
    }
    let pattern = this._dotPatterns.get(ctx);
    if (!pattern) {
      pattern = ctx.createPattern(this._dotTile, 'repeat');
      this._dotPatterns.set(ctx, pattern);
    }
    return pattern;
  }

  setMode(mode) {
    this.mode = mode === '3d' ? '3d' : '2d';
    this.zoom = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.target2D = null;
    this.targetRotation = null;
    this.invalidateCache();
    if (this.mode === '3d' && this.selectedNodeId) {
      const node = this.nodeById.get(this.selectedNodeId);
      if (node) this.focusLonLat(node.lon, node.lat);
    }
  }

  setLayer(name, enabled) {
    if (name in this.layers) {
      this.layers[name] = Boolean(enabled);
      if (name === 'grid') this.invalidateCache();
    }
  }

  setZoom(delta, pivotX = null, pivotY = null) {
    this.target2D = null;
    const oldZoom = this.zoom;
    const newZoom = Math.max(0.85, Math.min(4.2, oldZoom + delta));
    if (newZoom === oldZoom) return;
    this.zoom = newZoom;

    if (this.mode === '2d') {
      const ratio = newZoom / oldZoom;
      if (pivotX !== null && pivotY !== null) {
        const cx0 = this.w / 2;
        const cy0 = this.h / 2 + this.h * 0.02;
        this.panX = this.panX * ratio + (pivotX - cx0) * (1 - ratio);
        this.panY = this.panY * ratio + (pivotY - cy0) * (1 - ratio);
      } else {
        this.panX *= ratio;
        this.panY *= ratio;
      }

      if (this.zoom <= 1.02 && delta < 0) {
        this.panX *= 0.5;
        this.panY *= 0.5;
      }

      const maxPanX = this.w * 0.55 * this.zoom;
      const maxPanY = this.h * 0.5 * this.zoom;
      this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
      this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));
    }
  }

  resetView() {
    if (this.mode === '2d') {
      this.target2D = { zoom: 1.0, panX: 0, panY: 0 };
    } else {
      this.zoom = 1.0;
      this.panX = 0;
      this.panY = 0;
      this.target2D = null;
      this.targetRotation = [-12, -22, 0];
    }
  }

  focusLonLat(lon, lat, minZoom2D = 1.75) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (this.mode === '3d') {
      this.targetRotation = [-lon, -Math.max(-65, Math.min(65, lat)), 0];
    } else {
      const targetZoom = Math.max(this.zoom, Math.min(4.2, minZoom2D));
      const scaleX = this.w / (2 * Math.PI);
      const scaleY = this.h / (Math.PI * 0.92);
      const targetScale = Math.min(scaleX, scaleY) * 0.96 * targetZoom;
      const baseProj = geoEquirectangular()
        .scale(targetScale)
        .translate([this.w / 2, this.h / 2 + this.h * 0.02]);
      const pt = baseProj([lon, lat]);
      if (pt) {
        const maxPanX = this.w * 0.55 * targetZoom;
        const maxPanY = this.h * 0.5 * targetZoom;
        const targetPanX = Math.max(-maxPanX, Math.min(maxPanX, this.w / 2 - pt[0]));
        const targetPanY = Math.max(-maxPanY, Math.min(maxPanY, this.h / 2 - pt[1]));
        this.target2D = { zoom: targetZoom, panX: targetPanX, panY: targetPanY };
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

  selectSat(id, focus = true) {
    const sat = this.satellites.find((s) => s.id === id);
    if (!sat) return;
    this.selectedSatId = id;
    this.selectedNodeId = null;
    this.selectedLive = null;
    this.triggerPing(sat.lon, sat.lat, '--ok');
    if (focus) this.focusLonLat(sat.lon, sat.lat);
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
        : kind === 'cable'
        ? '--secondary'
        : '--accent';
    this.triggerPing(item.lon, item.lat, colorVar);
    if (focus) this.focusLonLat(item.lon, item.lat);
  }

  triggerPing(lon, lat, colorVar = '--accent') {
    this.pings.push({ lon, lat, age: 0, maxAge: 1.6, colorVar });
  }

  _normalizeTraceWaypoint(wp) {
    if (typeof wp === 'string') {
      const node = this.nodeById.get(wp);
      if (!node) return null;
      return {
        id: node.id,
        lon: node.lon,
        lat: node.lat,
        label: node.code || node.city || node.id,
      };
    }
    if (wp && typeof wp === 'object' && Number.isFinite(wp.lon) && Number.isFinite(wp.lat)) {
      return {
        id: wp.id || `${wp.lon.toFixed(2)},${wp.lat.toFixed(2)}`,
        lon: wp.lon,
        lat: wp.lat,
        label: wp.label || wp.code || wp.callsign || wp.name || wp.id || '',
      };
    }
    return null;
  }

  startTrace(waypoints) {
    const normalized = (Array.isArray(waypoints) ? waypoints : [])
      .map((wp) => this._normalizeTraceWaypoint(wp))
      .filter(Boolean);
    if (!normalized.length) {
      this.trace = null;
      return;
    }
    this.trace = {
      waypoints: normalized,
      nodeIds: normalized.map((w) => w.id),
      activeStep: 0,
      segProgress: 0,
      finished: false,
    };
    const first = normalized[0];
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
    const wps = this.trace.waypoints || [];
    const wp = wps[Math.min(step, wps.length - 1)];
    if (wp) {
      this.triggerPing(wp.lon, wp.lat, finished ? '--ok' : '--crit');
      if (this.mode === '3d') this.focusLonLat(wp.lon, wp.lat);
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
      this.target2D = null;
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

      // Hit test all active layers (with overlap metadata)
      const hits = this._hitTestAll(mx, my, proj);
      let hit = null;
      if (hits.length > 0) {
        const now = Date.now();
        const nearLastClick =
          Math.hypot(mx - this._lastClickMeta.x, my - this._lastClickMeta.y) <= 14 &&
          now - this._lastClickMeta.ts <= 4000;
        const overlapIndex = hits.length > 1 && nearLastClick ? this._overlapCycleIdx % hits.length : 0;
        const chosen = hits[overlapIndex];
        hit = {
          kind: chosen.kind,
          item: chosen.item,
          overlapCount: hits.length,
          overlapIndex,
        };
      }
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
        const hits = this._hitTestAll(mx, my, proj);
        if (hits.length > 0) {
          const now = Date.now();
          const sameSpot =
            Math.hypot(mx - this._lastClickMeta.x, my - this._lastClickMeta.y) <= 14 &&
            now - this._lastClickMeta.ts <= 4000;
          if (sameSpot && hits.length > 1) {
            this._overlapCycleIdx = (this._overlapCycleIdx + 1) % hits.length;
          } else {
            this._overlapCycleIdx = 0;
          }
          this._lastClickMeta = { x: mx, y: my, ts: now };

          const overlapIndex = this._overlapCycleIdx % hits.length;
          const chosen = hits[overlapIndex];
          const hit = {
            kind: chosen.kind,
            item: chosen.item,
            overlapCount: hits.length,
            overlapIndex,
          };
          this.hoveredItem = hit;
          this.onHover?.(hit, mx, my);

          if (hit.kind === 'node') {
            this.selectNode(hit.item.id, false);
            this.onSelectNode?.(hit.item);
          } else if (hit.kind === 'sat') {
            this.selectSat(hit.item.id, false);
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
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const raw = -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018);
        const delta = Math.max(-0.38, Math.min(0.38, raw)) * Math.max(0.8, this.zoom * 0.65);
        this.setZoom(delta, mx, my);
      },
      { passive: false }
    );
  }

  _distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  _hitTestAll(mx, my, proj) {
    const hits = [];

    const testList = (list, kind, radius = 17) => {
      const bias = HIT_PRIORITY_BIAS[kind] ?? 3;
      for (const item of list) {
        if (!this._isVisible3D(item.lon, item.lat)) continue;
        const pt = proj([item.lon, item.lat]);
        if (!pt) continue;
        const dist = Math.hypot(mx - pt[0], my - pt[1]);
        if (dist < radius) {
          hits.push({ kind, item, dist, score: dist + bias });
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

    if (this.layers.cables) {
      const cableBias = HIT_PRIORITY_BIAS.cable;
      const cableRadius = 12;
      for (const { cable } of this._cableGeoms) {
        let minDist = Infinity;

        // Check midpoint anchor
        if (this._isVisible3D(cable.lon, cable.lat)) {
          const mpt = proj([cable.lon, cable.lat]);
          if (mpt) {
            const md = Math.hypot(mx - mpt[0], my - mpt[1]);
            if (md < minDist) minDist = md;
          }
        }

        // Check projected vertices and segments
        const coords = cable.coordinates;
        let prevPt = null;
        for (let i = 0; i < coords.length; i++) {
          const [lon, lat] = coords[i];
          if (!this._isVisible3D(lon, lat)) {
            prevPt = null;
            continue;
          }
          const pt = proj([lon, lat]);
          if (!pt) {
            prevPt = null;
            continue;
          }
          const vd = Math.hypot(mx - pt[0], my - pt[1]);
          if (vd < minDist) minDist = vd;
          if (prevPt && Math.abs(pt[0] - prevPt[0]) <= this.w * 0.4) {
            const sd = this._distToSegment(mx, my, prevPt[0], prevPt[1], pt[0], pt[1]);
            if (sd < minDist) minDist = sd;
          }
          prevPt = pt;
        }

        if (minDist < cableRadius) {
          hits.push({ kind: 'cable', item: cable, dist: minDist, score: minDist + cableBias });
        }
      }
    }

    hits.sort((a, b) => a.score - b.score || a.dist - b.dist);
    return hits;
  }

  _hitTest(mx, my, proj) {
    const hits = this._hitTestAll(mx, my, proj);
    return hits.length ? { kind: hits[0].kind, item: hits[0].item } : null;
  }

  _updateSatellites() {
    for (const s of this.satellites) {
      const phase = this.time * s.speed + s.phaseOffset;
      s.lat = Math.sin(phase) * s.inclination;
      let lon = ((s.lonOffset + (this.time * s.speed * 57.2958) * 1.15) % 360 + 540) % 360 - 180;
      s.lon = lon;
    }
  }

  _tryPlaceLabel(x, y, w, h, force = false) {
    const pad = 2;
    const bx = x - pad;
    const by = y - pad;
    const bw = w + pad * 2;
    const bh = h + pad * 2;
    if (!force) {
      for (let i = 0; i < this._labelBoxes.length; i++) {
        const b = this._labelBoxes[i];
        if (bx < b.x + b.w && bx + bw > b.x && by < b.y + b.h && by + bh > b.y) {
          return false;
        }
      }
    }
    this._labelBoxes.push({ x: bx, y: by, w: bw, h: bh });
    return true;
  }

  _queueLabel(priority, x, y, w, h, force, draw) {
    this._deferredLabels.push({ priority, x, y, w, h, force, draw });
  }

  _flushDeferredLabels(ctx) {
    if (!this._deferredLabels.length) return;
    this._deferredLabels.sort((a, b) => a.priority - b.priority);
    ctx.save();
    for (let i = 0; i < this._deferredLabels.length; i++) {
      const lbl = this._deferredLabels[i];
      if (this._tryPlaceLabel(lbl.x, lbl.y, lbl.w, lbl.h, lbl.force)) {
        lbl.draw(ctx);
      }
    }
    ctx.restore();
  }

  render(rawDt) {
    const dt = Math.max(0, rawDt);
    this.time += dt;
    this.scanX = (this.scanX + dt * 0.085) % 1;
    this._labelBoxes = [];
    this._deferredLabels = [];

    // Update arc packets
    const speedMult = this.alertActive ? 1.85 : 1.0;
    for (const a of this.arcs) {
      a.progress = (a.progress + dt * a.speed * speedMult) % 1;
    }

    // Update trace segment progress
    if (this.trace && !this.trace.finished) {
      this.trace.segProgress = Math.min(1, this.trace.segProgress + dt * 1.35);
    }

    // Smooth 2D glide interpolation (focusLonLat / resetView)
    if (this.mode === '2d' && !this.dragging && this.target2D) {
      const k = Math.min(1, dt * 6.0);
      const dZoom = this.target2D.zoom - this.zoom;
      const dPanX = this.target2D.panX - this.panX;
      const dPanY = this.target2D.panY - this.panY;
      this.zoom += dZoom * k;
      this.panX += dPanX * k;
      this.panY += dPanY * k;
      if (Math.abs(dZoom) < 0.005 && Math.abs(dPanX) < 0.5 && Math.abs(dPanY) < 0.5) {
        this.zoom = this.target2D.zoom;
        this.panX = this.target2D.panX;
        this.panY = this.target2D.panY;
        this.target2D = null;
      }
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

    // Cached theme palette lookup (zero per-frame getComputedStyle)
    const palette = getThemePalette();

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const proj = this._getProjection(false);
    const path = geoPath(proj, ctx);

    // 1-4. Base layers: cached single-blit offscreen pass in 2D, live dual-res pass in 3D
    if (this.mode === '2d') {
      this._render2DBaseLayer(ctx, proj, palette);
    } else {
      this._drawBackdropGrid(ctx, palette);
      this._drawGlobeBackPass(ctx, palette);
      if (this.layers.grid) {
        this._drawGraticule(ctx, path, proj, palette);
      }
      this._drawWorldWireframe(ctx, path, palette, this.dragging);
    }

    // 4.5. Real-Time Solar Terminator (Day/Night hemisphere + twilight + subsolar marker)
    if (this.layers.terminator) {
      this._drawSolarTerminator(ctx, path, proj, palette);
    }

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

    // 6.8. Subsea Fiber Trunk Cables
    if (this.layers.cables) {
      this._drawSubseaCables(ctx, path, proj, palette);
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
      if (this.layers.meteo) this._drawLiveMeteo(ctx, proj);
      if (this.layers.bgp) this._drawLiveBgp(ctx, proj, palette);
      if (this.layers.quakes) this._drawLiveQuakes(ctx, proj, palette);
      if (this.layers.gdacs) this._drawLiveGdacs(ctx, proj, palette);
      if (this.layers.eonet) this._drawLiveEonet(ctx, proj, palette);
      if (this.layers.wiki) this._drawLiveWiki(ctx, proj);
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

    // 12.5. Priority-sorted de-cluttered labels
    this._flushDeferredLabels(ctx);

    // 13. Live Cursor Tactical Crosshair
    if (this.mouse.inside && !this.dragging) {
      this._drawCrosshair(ctx, palette);
    }
  }

  _render2DBaseLayer(ctx, proj, palette) {
    const cacheKey = `${this.w}|${this.h}|${this.dpr}|${this.zoom.toFixed(4)}|${this.panX.toFixed(2)}|${this.panY.toFixed(2)}|${this.layers.grid}|${palette.theme}`;
    if (!this._baseCacheCanvas) {
      this._baseCacheCanvas = document.createElement('canvas');
      this._baseCacheCtx = this._baseCacheCanvas.getContext('2d');
    }

    if (this._baseCacheKey !== cacheKey) {
      const targetW = Math.round(this.w * this.dpr);
      const targetH = Math.round(this.h * this.dpr);
      if (this._baseCacheCanvas.width !== targetW || this._baseCacheCanvas.height !== targetH) {
        this._baseCacheCanvas.width = targetW;
        this._baseCacheCanvas.height = targetH;
      }

      const cctx = this._baseCacheCtx;
      cctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      cctx.clearRect(0, 0, this.w, this.h);

      const cachePath = geoPath(proj, cctx);
      this._drawBackdropGrid(cctx, palette);
      if (this.layers.grid) {
        this._drawGraticule(cctx, cachePath, proj, palette);
      }
      this._drawWorldWireframe(cctx, cachePath, palette, false);
      this._baseCacheKey = cacheKey;
    }

    ctx.drawImage(this._baseCacheCanvas, 0, 0, this.w, this.h);
  }

  _drawBackdropGrid(ctx, { accentRgb }) {
    ctx.save();
    ctx.fillStyle = this._ensureDotPattern(ctx, accentRgb);
    ctx.fillRect(0, 0, this.w, this.h);
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

    // Clip to sphere and render faint translucent BACKSIDE wireframe (110m for 60fps 3D)
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
    pathBack(this.land110);
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

  _drawWorldWireframe(ctx, path, { accent, accentRgb }, useLowRes = false) {
    const land = useLowRes ? this.land110 : this.land50;
    const borders = useLowRes ? this.borders110 : this.borders50;

    ctx.save();

    // 1. Landmass subtle holographic hatch fill
    ctx.beginPath();
    path(land);
    ctx.fillStyle = this._ensureHatchPattern(ctx, accentRgb);
    ctx.fill();

    // 2. Interior country borders (thin wireframe)
    ctx.beginPath();
    path(borders);
    ctx.strokeStyle = `rgba(${accentRgb}, 0.34)`;
    ctx.lineWidth = 0.65;
    ctx.stroke();

    // 3. Outer glowing coastline wireframe
    ctx.beginPath();
    path(land);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.25;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.stroke();

    ctx.restore();
  }

  _getSolarTerminatorCache() {
    const now = Date.now();
    if (this._terminatorCache && now - this._terminatorCache.ts < 10000) {
      return this._terminatorCache;
    }
    const d = new Date(now);
    const sun = getSubsolarPoint(d);
    const nightCenter = getNightCircleCenter(d);
    const nightPoly = geoCircle().center(nightCenter).radius(90).precision(3)();
    const twilightPoly = geoCircle().center(nightCenter).radius(84).precision(3)();
    this._terminatorCache = {
      ts: now,
      sun,
      nightCenter,
      nightPoly,
      twilightPoly,
    };
    return this._terminatorCache;
  }

  _drawSolarTerminator(ctx, path, proj, palette) {
    const { sun, nightPoly, twilightPoly } = this._getSolarTerminatorCache();
    const horizonRgb = palette.secondaryRgb || palette.accentRgb;

    ctx.save();

    // Night hemisphere shadow polygon + crisp horizon curve at radius(90)
    ctx.beginPath();
    path(nightPoly);
    ctx.fillStyle = 'rgba(1, 5, 14, 0.42)';
    ctx.fill();
    ctx.strokeStyle = `rgba(${horizonRgb}, 0.28)`;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // Subtle civil twilight contour at radius(84)
    ctx.beginPath();
    path(twilightPoly);
    ctx.strokeStyle = `rgba(${palette.accentRgb}, 0.14)`;
    ctx.lineWidth = 0.9;
    ctx.setLineDash([4, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Glowing golden subsolar marker when visible
    if (this._isVisible3D(sun.lon, sun.lat)) {
      const spt = proj([sun.lon, sun.lat]);
      if (spt) {
        ctx.save();
        ctx.translate(spt[0], spt[1]);

        const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, 14);
        glow.addColorStop(0, 'rgba(255, 224, 102, 0.45)');
        glow.addColorStop(0.5, 'rgba(255, 224, 102, 0.12)');
        glow.addColorStop(1, 'rgba(255, 224, 102, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 14, 0, Math.PI * 2);
        ctx.fill();

        // 8 golden rays
        ctx.strokeStyle = 'rgba(255, 224, 102, 0.78)';
        ctx.lineWidth = 0.95;
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 4.5, Math.sin(a) * 4.5);
          ctx.lineTo(Math.cos(a) * 8.2, Math.sin(a) * 8.2);
          ctx.stroke();
        }

        // Core sun disc
        ctx.fillStyle = '#ffe066';
        ctx.shadowColor = '#ffe066';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(0, 0, 3.0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
  }

  _drawSubseaCables(ctx, path, proj, palette) {
    const cableRgb = palette.secondaryRgb || '79, 168, 255';
    const cableColor = palette.secondary || palette.accent;

    ctx.save();
    for (let i = 0; i < this._cableGeoms.length; i++) {
      const { cable, geoLine } = this._cableGeoms[i];
      const isSelected = this.selectedLive?.kind === 'cable' && this.selectedLive.id === cable.id;
      const isHovered = this.hoveredItem?.kind === 'cable' && this.hoveredItem.item.id === cable.id;
      const active = isSelected || isHovered;

      ctx.save();
      ctx.beginPath();
      path(geoLine);
      if (active) {
        ctx.strokeStyle = isSelected ? '#ffffff' : palette.accent;
        ctx.lineWidth = isSelected ? 2.1 : 1.8;
        ctx.shadowColor = palette.accent;
        ctx.shadowBlur = 9;
      } else {
        ctx.strokeStyle = `rgba(${cableRgb}, 0.34)`;
        ctx.lineWidth = 1.1;
      }
      ctx.stroke();
      ctx.restore();

      // Tiny 1.6px landing-station endpoint dots
      const coords = cable.coordinates;
      const startCoord = coords[0];
      const endCoord = coords[coords.length - 1];
      ctx.fillStyle = active ? '#ffffff' : `rgba(${cableRgb}, 0.62)`;
      for (const ep of [startCoord, endCoord]) {
        if (!ep || !this._isVisible3D(ep[0], ep[1])) continue;
        const ept = proj(ep);
        if (!ept) continue;
        ctx.beginPath();
        ctx.arc(ept[0], ept[1], active ? 2.2 : 1.6, 0, Math.PI * 2);
        ctx.fill();
      }

      if (active && this._isVisible3D(cable.lon, cable.lat)) {
        const mpt = proj([cable.lon, cable.lat]);
        if (mpt) {
          if (isSelected) {
            this._drawReticle(ctx, mpt[0], mpt[1], cableColor, 15);
          }
          const tag = `${cable.code} ${cable.name}`;
          ctx.font = 'bold 8px "SF Mono", Menlo, monospace';
          const tw = ctx.measureText(tag).width;
          const lx = mpt[0] + 10;
          const ly = mpt[1] - 6;
          this._queueLabel(0, lx - 2, ly - 9, tw + 4, 11, true, (lctx) => {
            lctx.font = 'bold 8px "SF Mono", Menlo, monospace';
            lctx.fillStyle = 'rgba(3, 9, 17, 0.84)';
            lctx.fillRect(lx - 2, ly - 9, tw + 4, 11);
            lctx.fillStyle = isSelected ? '#ffffff' : palette.accent;
            lctx.fillText(tag, lx, ly);
          });
        }
      }
    }
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
    const wps = this.trace.waypoints || [];
    if (wps.length < 2) return;
    const beamColor = this.trace.finished ? ok : crit;

    ctx.save();
    ctx.shadowColor = beamColor;
    ctx.shadowBlur = 12;

    // Origin hop ring
    const origin = wps[0];
    if (origin && this._isVisible3D(origin.lon, origin.lat)) {
      const p0 = proj([origin.lon, origin.lat]);
      if (p0) {
        ctx.strokeStyle = beamColor;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(p0[0], p0[1], 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const maxSeg = Math.min(this.trace.activeStep, wps.length - 1);
    for (let s = 0; s < maxSeg; s++) {
      const a = wps[s];
      const b = wps[s + 1];
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

  _drawSatellites(ctx, proj, path, { ok, okRgb }) {
    ctx.save();

    for (const s of this.satellites) {
      const isSelected = this.selectedSatId === s.id;
      const isHovered = this.hoveredItem?.kind === 'sat' && this.hoveredItem.item.id === s.id;

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
      ctx.restore();

      const tag = s.name.split(' ')[0];
      ctx.font = '8px "SF Mono", Menlo, monospace';
      const tw = ctx.measureText(tag).width;
      const lx = pt[0] + 13;
      const ly = pt[1] + 3;
      const force = isSelected || isHovered;
      this._queueLabel(force ? 0 : 2, lx - 2, ly - 8, tw + 4, 10, force, (lctx) => {
        lctx.font = '8px "SF Mono", Menlo, monospace';
        lctx.fillStyle = force ? '#ffffff' : `rgba(${okRgb}, 0.85)`;
        lctx.fillText(tag, lx, ly);
      });

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
      const color = getCachedCssVar(p.colorVar, palette.accent);
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

      // Callout tag with smart directional anchor + collision culling
      const font = isSelected || isHovered ? 'bold 9.5px "SF Mono", Menlo, monospace' : '8.5px "SF Mono", Menlo, monospace';
      ctx.font = font;
      const label = `${n.code} ${n.city}`;
      const tw = ctx.measureText(label).width;
      const pos = n.labelPos || 'tr';
      const isLeft = pos === 'tl' || pos === 'bl';
      const isBottom = pos === 'bl' || pos === 'br';
      const lx = isLeft ? pt[0] - 10 - tw : pt[0] + 10;
      const ly = isBottom ? pt[1] + 14 : pt[1] - 7;
      const force = isSelected || isHovered || n.type === 'CRITICAL';
      const drawLeader = isSelected || n.type === 'CRITICAL' || isHovered || pos !== 'tr';

      this._queueLabel(force ? 0 : 1, lx - 2, ly - 9, tw + 4, 11, force, (lctx) => {
        if (drawLeader) {
          lctx.strokeStyle = `rgba(${rgb}, 0.65)`;
          lctx.lineWidth = 0.8;
          lctx.beginPath();
          lctx.moveTo(pt[0] + (isLeft ? -4 : 4), pt[1] + (isBottom ? 3 : -2));
          lctx.lineTo(isLeft ? lx + tw + 2 : lx - 2, ly - 3);
          lctx.stroke();
        }
        lctx.font = font;
        lctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
        lctx.fillRect(lx - 2, ly - 9, tw + 4, 11);
        lctx.fillStyle = isSelected || isHovered ? '#ffffff' : color;
        lctx.fillText(label, lx, ly);
      });

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

    if (!this._auroraCache || this._auroraCache.radiusDeg !== radiusDeg) {
      this._auroraCache = {
        radiusDeg,
        ovals: [81, -76].map((poleLat) => {
          const poleLon = poleLat > 0 ? -72 : 108;
          return {
            outer: geoCircle().center([poleLon, poleLat]).radius(radiusDeg)(),
            inner: geoCircle().center([poleLon, poleLat]).radius(Math.max(6, radiusDeg - 5))(),
          };
        }),
      };
    }

    ctx.save();
    for (const { outer, inner } of this._auroraCache.ovals) {
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

      // Magnitude callout for M4.6+ or selected/hovered
      if (q.mag >= 4.6 || isSelected || isHovered) {
        const tag = `M${q.mag.toFixed(1)}`;
        const lx = pt[0] + 5;
        const ly = pt[1] - 9;
        const force = isMajor || isSelected || isHovered;
        this._queueLabel(force ? 0 : 2, lx, ly, 25, 10, force, (lctx) => {
          lctx.font = 'bold 8px "SF Mono", Menlo, monospace';
          lctx.fillStyle = 'rgba(3, 9, 17, 0.78)';
          lctx.fillRect(lx, ly, 25, 10);
          lctx.fillStyle = color;
          lctx.fillText(tag, lx + 2, ly + 8);
        });
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

  _drawLiveAircraft(ctx, proj, { accent, crit, critRgb }) {
    const planes = this.liveFeeds.data.aircraft;
    if (!planes.length) return;

    ctx.save();
    for (const ac of planes) {
      const isSelected = this.selectedLive?.kind === 'aircraft' && this.selectedLive.id === ac.id;
      const isHovered = this.hoveredItem?.kind === 'aircraft' && this.hoveredItem.item.id === ac.id;

      // Altitude color coding for non-emergency flights
      const altColor =
        ac.altFt >= 30000 ? '#9be8ff' : ac.altFt >= 15000 ? '#5ce1ff' : '#4dffb8';
      const altRgb =
        ac.altFt >= 30000 ? '155, 232, 255' : ac.altFt >= 15000 ? '92, 225, 255' : '77, 255, 184';
      const wakeRgb = ac.emergency ? critRgb : altRgb;
      const color = ac.emergency ? crit : isSelected || isHovered ? '#ffffff' : altColor;

      // Crisp fading ADS-B breadcrumb wake polyline connected to current position
      if (Array.isArray(ac.trail) && ac.trail.length > 0) {
        const wakeCoords = ac.trail.slice();
        const last = wakeCoords[wakeCoords.length - 1];
        if (!last || Math.hypot(ac.lon - last[0], ac.lat - last[1]) > 0.001) {
          wakeCoords.push([ac.lon, ac.lat]);
        }
        const total = wakeCoords.length;
        if (total > 1) {
          let prevPt = null;
          const maxAlpha = isSelected || isHovered ? 0.85 : ac.emergency ? 0.72 : 0.48;
          ctx.lineWidth = isSelected || isHovered ? 1.5 : 1.0;
          for (let i = 0; i < total; i++) {
            const [lon, lat] = wakeCoords[i];
            if (!this._isVisible3D(lon, lat)) {
              prevPt = null;
              continue;
            }
            const p = proj([lon, lat]);
            if (!p) {
              prevPt = null;
              continue;
            }
            if (prevPt && Math.abs(p[0] - prevPt[0]) <= this.w * 0.35) {
              const frac = i / (total - 1);
              const alpha = 0.06 + frac * maxAlpha;
              ctx.strokeStyle = `rgba(${wakeRgb}, ${alpha.toFixed(2)})`;
              ctx.beginPath();
              ctx.moveTo(prevPt[0], prevPt[1]);
              ctx.lineTo(p[0], p[1]);
              ctx.stroke();
            }
            prevPt = p;
          }
        }
      }

      if (!this._isVisible3D(ac.lon, ac.lat)) continue;
      const pt = proj([ac.lon, ac.lat]);
      if (!pt) continue;

      const headingRad = ((ac.trackDeg ?? 0) * Math.PI) / 180;

      ctx.save();
      ctx.translate(pt[0], pt[1]);
      ctx.rotate(headingRad);

      // Subtle velocity heading vector line ahead of aircraft
      ctx.strokeStyle = `rgba(${wakeRgb}, ${ac.emergency ? 0.75 : 0.48})`;
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
        const lx = pt[0] + 7;
        const ly = pt[1] - 9;
        this._queueLabel(0, lx, ly, tw + 4, 10, true, (lctx) => {
          lctx.font = 'bold 8px "SF Mono", Menlo, monospace';
          lctx.fillStyle = 'rgba(3, 9, 17, 0.82)';
          lctx.fillRect(lx, ly, tw + 4, 10);
          lctx.fillStyle = ac.emergency ? crit : accent;
          lctx.fillText(tag, lx + 2, ly + 8);
        });
      }

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], ac.emergency ? crit : altColor, 15);
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
      ctx.restore();

      const font = isIss || isSelected ? 'bold 8.5px "SF Mono", Menlo, monospace' : '8px "SF Mono", Menlo, monospace';
      ctx.font = font;
      const shortName = isIss ? 'ISS [LIVE]' : s.name.replace(/\s*\(.*?\)/, '');
      const tw = ctx.measureText(shortName).width;
      const lx = pt[0] + 12;
      const ly = pt[1] - 7;
      const force = isIss || isSelected || isHovered;
      this._queueLabel(force ? 0 : 2, lx, ly, tw + 4, 10, force, (lctx) => {
        lctx.font = font;
        lctx.fillStyle = 'rgba(3, 9, 17, 0.76)';
        lctx.fillRect(lx, ly, tw + 4, 10);
        lctx.fillStyle = isSelected || isHovered ? '#ffffff' : satColor;
        lctx.fillText(shortName, lx + 2, ly + 8);
      });

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

      // Compact temp tag (collision-culled at low zoom unless selected/hovered)
      const label = `${Math.round(st.tempC)}°C`;
      const lx = pt[0] + 5;
      const ly = pt[1] + 2;
      const force = isSelected || isHovered;
      this._queueLabel(force ? 0 : 3, lx, ly, 23, 9.5, force, (lctx) => {
        lctx.font = '7.5px "SF Mono", Menlo, monospace';
        lctx.fillStyle = 'rgba(3, 9, 17, 0.72)';
        lctx.fillRect(lx, ly, 23, 9.5);
        lctx.fillStyle = force ? '#ffffff' : 'rgba(130, 224, 255, 0.88)';
        lctx.fillText(label, lx + 1, ly + 7.5);
      });

      if (isSelected) {
        this._drawReticle(ctx, pt[0], pt[1], color, 15);
      }
    }
    ctx.restore();
  }

  _drawLiveBgp(ctx, proj, { covert, covertRgb, warn, warnRgb, crit, critRgb }) {
    const cols = this.liveFeeds.data.bgpCollectors || [];
    const pulses = this.liveFeeds.data.bgpPulses || [];
    if (!cols.length && !pulses.length) return;
    const now = Date.now();

    ctx.save();

    // 1. Live ephemeral BGP geodesic pulse arcs (announcements = covert violet, withdrawals = amber/crit)
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i];
      const age = now - p.ts;
      if (age < 0 || age >= 4200) continue;
      if (!Number.isFinite(p.lon) || !Number.isFinite(p.lat) || !Number.isFinite(p.toLon) || !Number.isFinite(p.toLat)) {
        continue;
      }

      const frac = age / 4200;
      const fade = 1 - frac;
      const arcColor = p.isWithdraw ? warn : covert;
      const arcRgb = p.isWithdraw ? warnRgb : covertRgb;
      const headGlowColor = p.isWithdraw ? crit : covert;

      if (!p._interp) {
        p._interp = geoInterpolate([p.lon, p.lat], [p.toLon, p.toLat]);
      }

      const segments = this._sampleGeodesicScreenPoints(p._interp, proj, 22);
      ctx.strokeStyle = `rgba(${arcRgb}, ${(fade * (p.isWithdraw ? 0.62 : 0.48)).toFixed(2)})`;
      ctx.lineWidth = p.isWithdraw ? 1.35 : 1.05;
      for (const seg of segments) {
        ctx.beginPath();
        for (let j = 0; j < seg.length; j++) {
          if (j === 0) ctx.moveTo(seg[j][0], seg[j][1]);
          else ctx.lineTo(seg[j][0], seg[j][1]);
        }
        ctx.stroke();
      }

      // Luminous moving BGP packet head + short trailing wake along frac
      const tailLen = 0.16;
      const tailSteps = 6;
      const tailPts = [];
      for (let s = 0; s <= tailSteps; s++) {
        const t = Math.max(0, frac - tailLen * (1 - s / tailSteps));
        const [lon, lat] = p._interp(t);
        if (!this._isVisible3D(lon, lat)) continue;
        const pt = proj([lon, lat]);
        if (pt) tailPts.push(pt);
      }

      if (tailPts.length > 1) {
        ctx.lineWidth = p.isWithdraw ? 2.0 : 1.7;
        for (let s = 1; s < tailPts.length; s++) {
          const p0 = tailPts[s - 1];
          const p1 = tailPts[s];
          if (Math.abs(p1[0] - p0[0]) > this.w * 0.4) continue;
          const a = (s / tailPts.length) * fade * 0.95;
          ctx.strokeStyle = `rgba(${p.isWithdraw ? critRgb : arcRgb}, ${a.toFixed(2)})`;
          ctx.beginPath();
          ctx.moveTo(p0[0], p0[1]);
          ctx.lineTo(p1[0], p1[1]);
          ctx.stroke();
        }
      }

      const [hlon, hlat] = p._interp(frac);
      if (this._isVisible3D(hlon, hlat)) {
        const hpt = proj([hlon, hlat]);
        if (hpt) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, fade * 1.4);
          ctx.fillStyle = p.isWithdraw ? arcColor : '#ffffff';
          ctx.shadowColor = headGlowColor;
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(hpt[0], hpt[1], p.isWithdraw ? 2.3 : 1.9, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // 2. RIPE RIS IXP collector hex markers + local pulse rings
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
      ctx.restore();

      // Tiny event type code beside for Red/Orange/selected/hovered
      if (isRed || isOrange || isSelected || isHovered) {
        const tag = ev.eventType || 'ALT';
        const lx = pt[0] + 7;
        const ly = pt[1] + 2.5;
        const force = isRed || isSelected || isHovered;
        this._queueLabel(force ? 0 : 2, lx - 1, ly - 8, 18, 10, force, (lctx) => {
          lctx.font = 'bold 7.5px "SF Mono", Menlo, monospace';
          lctx.fillStyle = color;
          lctx.fillText(tag, lx, ly);
        });
      }

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
      const isHovered = this.hoveredItem?.kind === 'wiki' && this.hoveredItem.item.id === h.id;
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

      const lx = pt[0] - 4.5;
      const ly = pt[1] - 6;
      const force = isSelected || isHovered;
      this._queueLabel(force ? 0 : 3, lx - 1, ly - 7, 14, 9, force, (lctx) => {
        lctx.font = 'bold 7px "SF Mono", Menlo, monospace';
        lctx.fillStyle = '#e8f9ff';
        lctx.fillText(h.lang, lx, ly);
      });

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
