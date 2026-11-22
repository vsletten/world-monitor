// ============================================================================
// AEGIS // RESIZABLE & COLLAPSIBLE SIDEBAR PANELS + PERSISTENT LAYOUT MANAGER
// ============================================================================

const STORAGE_KEY = 'aegis-panel-layout-v1';
const MIN_PANEL_HEIGHT = 68;
const MIN_COL_WIDTH = 210;
const MAX_COL_WIDTH = 480;

export class PanelLayoutManager {
  constructor({ opsGrid, leftCol, rightCol, onResize, onClick, onLog }) {
    this.opsGrid = opsGrid;
    this.leftCol = leftCol;
    this.rightCol = rightCol;
    this.onResize = onResize;
    this.onClick = onClick;
    this.onLog = onLog;

    this.state = {
      collapsed: {}, // { [panelId]: boolean }
      weights: {}, // { [panelId]: number }
      leftW: null, // number | null
      rightW: null, // number | null
    };

    this._loadState();
    this._applyAll();
    this._bindCollapse();
    this._bindVerticalSplitters();
    this._bindHorizontalResizers();
  }

  _loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.state.collapsed = parsed.collapsed || {};
        this.state.weights = parsed.weights || {};
        if (typeof parsed.leftW === 'number') this.state.leftW = parsed.leftW;
        if (typeof parsed.rightW === 'number') this.state.rightW = parsed.rightW;
      }
    } catch {
      // ignore corrupted storage
    }
  }

  _saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore storage quota errors
    }
  }

  _getPanels() {
    return Array.from(document.querySelectorAll('.side-col-inner > .hud-panel[data-panel-id]'));
  }

  _applyAll() {
    // Apply custom sidebar widths if saved
    if (this.state.leftW) {
      this.opsGrid.style.setProperty('--left-w', `${this.state.leftW}px`);
    } else {
      this.opsGrid.style.removeProperty('--left-w');
    }
    if (this.state.rightW) {
      this.opsGrid.style.setProperty('--right-w', `${this.state.rightW}px`);
    } else {
      this.opsGrid.style.removeProperty('--right-w');
    }

    // Apply panel collapse states & flex weights
    for (const panel of this._getPanels()) {
      const id = panel.dataset.panelId;
      const defWeight = Number(panel.dataset.defaultWeight) || 33;
      const weight = typeof this.state.weights[id] === 'number' ? this.state.weights[id] : defWeight;
      const isCollapsed = Boolean(this.state.collapsed[id]);

      panel.dataset.weight = String(weight);
      panel.classList.toggle('is-collapsed', isCollapsed);
      if (isCollapsed) {
        panel.style.flex = '0 0 auto';
      } else {
        panel.style.flex = `${weight} 1 0px`;
      }

      const btn = panel.querySelector('.panel-collapse-btn');
      if (btn) {
        btn.textContent = isCollapsed ? '▸' : '▾';
        btn.setAttribute('aria-expanded', String(!isCollapsed));
      }
    }

    this._syncSplitterVisibility();
    this.onResize?.();
  }

  _syncSplitterVisibility() {
    for (const colInner of document.querySelectorAll('.side-col-inner')) {
      const splitters = colInner.querySelectorAll('.panel-splitter');
      for (const sp of splitters) {
        const hasPrev = Boolean(this._findOpenNeighbor(sp, -1));
        const hasNext = Boolean(this._findOpenNeighbor(sp, 1));
        sp.classList.toggle('is-disabled', !(hasPrev && hasNext));
      }
    }
  }

  _findOpenNeighbor(splitter, dir) {
    let el = dir < 0 ? splitter.previousElementSibling : splitter.nextElementSibling;
    while (el) {
      if (el.classList.contains('hud-panel') && !el.classList.contains('is-collapsed')) {
        return el;
      }
      el = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    }
    return null;
  }

  togglePanel(panelId, forced = null) {
    const panel = document.querySelector(`.hud-panel[data-panel-id="${panelId}"]`);
    if (!panel) return;
    const next = forced !== null ? Boolean(forced) : !this.state.collapsed[panelId];
    this.state.collapsed[panelId] = next;
    this._applyAll();
    this._saveState();
    this.onClick?.();
  }

  resetColumnWeights(colInner) {
    for (const panel of colInner.querySelectorAll('.hud-panel[data-panel-id]')) {
      delete this.state.weights[panel.dataset.panelId];
    }
    this._applyAll();
    this._saveState();
    this.onClick?.();
    this.onLog?.('SIG', `RESET ${colInner.dataset.col?.toUpperCase() || ''} SIDEBAR PANEL PROPORTIONS.`);
  }

  resetAll() {
    this.state = { collapsed: {}, weights: {}, leftW: null, rightW: null };
    this._applyAll();
    this._saveState();
    this.onClick?.();
    this.onLog?.('SIG', 'ALL SIDEBAR WIDTHS, PANEL SIZES & COLLAPSE STATES RESET TO DEFAULT.');
  }

  _bindCollapse() {
    for (const panel of this._getPanels()) {
      const id = panel.dataset.panelId;
      const btn = panel.querySelector('.panel-collapse-btn');
      const header = panel.querySelector('.panel-header');

      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePanel(id);
      });

      // Double-clicking a panel header (outside interactive buttons) toggles collapse too
      header?.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        this.togglePanel(id);
      });
    }
  }

  _bindVerticalSplitters() {
    for (const sp of document.querySelectorAll('.panel-splitter')) {
      sp.addEventListener('dblclick', () => {
        const colInner = sp.closest('.side-col-inner');
        if (colInner) this.resetColumnWeights(colInner);
      });

      sp.addEventListener('pointerdown', (e) => {
        const prevPanel = this._findOpenNeighbor(sp, -1);
        const nextPanel = this._findOpenNeighbor(sp, 1);
        if (!prevPanel || !nextPanel) return;

        e.preventDefault();
        sp.setPointerCapture(e.pointerId);
        sp.classList.add('dragging');
        document.body.classList.add('is-resizing-row');

        const startY = e.clientY;
        const startPrevH = prevPanel.getBoundingClientRect().height;
        const startNextH = nextPanel.getBoundingClientRect().height;
        const totalPx = startPrevH + startNextH;
        const prevWeight = Number(prevPanel.dataset.weight) || Number(prevPanel.dataset.defaultWeight) || 33;
        const nextWeight = Number(nextPanel.dataset.weight) || Number(nextPanel.dataset.defaultWeight) || 33;
        const totalWeight = prevWeight + nextWeight;

        const onMove = (ev) => {
          const dy = ev.clientY - startY;
          const minH = Math.min(MIN_PANEL_HEIGHT, totalPx * 0.35);
          const newPrevPx = Math.max(minH, Math.min(totalPx - minH, startPrevH + dy));
          const ratio = newPrevPx / totalPx;
          const w1 = Number((totalWeight * ratio).toFixed(2));
          const w2 = Number((totalWeight - w1).toFixed(2));

          prevPanel.dataset.weight = String(w1);
          nextPanel.dataset.weight = String(w2);
          prevPanel.style.flex = `${w1} 1 0px`;
          nextPanel.style.flex = `${w2} 1 0px`;

          this.state.weights[prevPanel.dataset.panelId] = w1;
          this.state.weights[nextPanel.dataset.panelId] = w2;
          this.onResize?.();
        };

        const onUp = (ev) => {
          sp.classList.remove('dragging');
          document.body.classList.remove('is-resizing-row');
          try { sp.releasePointerCapture(ev.pointerId); } catch {}
          sp.removeEventListener('pointermove', onMove);
          sp.removeEventListener('pointerup', onUp);
          sp.removeEventListener('pointercancel', onUp);
          this._saveState();
          this.onResize?.();
        };

        sp.addEventListener('pointermove', onMove);
        sp.addEventListener('pointerup', onUp);
        sp.addEventListener('pointercancel', onUp);
      });
    }
  }

  _bindHorizontalResizers() {
    for (const rz of document.querySelectorAll('.col-resizer')) {
      const side = rz.dataset.side; // 'left' | 'right'

      rz.addEventListener('dblclick', () => {
        if (side === 'left') this.state.leftW = null;
        else this.state.rightW = null;
        this._applyAll();
        this._saveState();
        this.onClick?.();
        this.onLog?.('SIG', `RESET ${side.toUpperCase()} SIDEBAR WIDTH TO DEFAULT.`);
      });

      rz.addEventListener('pointerdown', (e) => {
        const col = side === 'left' ? this.leftCol : this.rightCol;
        if (!col || col.classList.contains('collapsed')) return;

        e.preventDefault();
        rz.setPointerCapture(e.pointerId);
        rz.classList.add('dragging');
        this.opsGrid.classList.add('is-col-resizing');
        document.body.classList.add('is-resizing-col');

        const startX = e.clientX;
        const startW = col.getBoundingClientRect().width;

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const rawW = side === 'left' ? startW + dx : startW - dx;
          const clamped = Math.round(Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, rawW)));
          const prop = side === 'left' ? '--left-w' : '--right-w';
          this.opsGrid.style.setProperty(prop, `${clamped}px`);
          if (side === 'left') this.state.leftW = clamped;
          else this.state.rightW = clamped;
          this.onResize?.();
        };

        const onUp = (ev) => {
          rz.classList.remove('dragging');
          this.opsGrid.classList.remove('is-col-resizing');
          document.body.classList.remove('is-resizing-col');
          try { rz.releasePointerCapture(ev.pointerId); } catch {}
          rz.removeEventListener('pointermove', onMove);
          rz.removeEventListener('pointerup', onUp);
          rz.removeEventListener('pointercancel', onUp);
          this._saveState();
          this.onResize?.();
        };

        rz.addEventListener('pointermove', onMove);
        rz.addEventListener('pointerup', onUp);
        rz.addEventListener('pointercancel', onUp);
      });
    }
  }
}
