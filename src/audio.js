// ============================================================================
// AEGIS // PROCEDURAL WEB AUDIO TACTICAL SFX SYNTHESIZER (MUTED BY DEFAULT)
// ============================================================================

class TacticalAudio {
  constructor() {
    this.enabled = false;
    this.ctx = null;
  }

  _ensureCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setEnabled(flag) {
    this.enabled = Boolean(flag);
    if (this.enabled) {
      this._ensureCtx();
      this.playLock();
    }
  }

  _tone(freq, duration = 0.08, type = 'sine', gainVal = 0.06, delay = 0, freqEnd = null) {
    if (!this.enabled) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, now + duration);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(gainVal, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playClick() {
    this._tone(1120, 0.03, 'triangle', 0.035);
  }

  playLock() {
    this._tone(880, 0.06, 'sine', 0.05, 0);
    this._tone(1320, 0.09, 'sine', 0.055, 0.055);
  }

  playPing() {
    this._tone(1480, 0.35, 'sine', 0.06, 0, 1420);
    this._tone(2960, 0.14, 'sine', 0.02, 0.02);
  }

  playTraceHop(step = 0) {
    const base = 540 + step * 115;
    this._tone(base, 0.075, 'square', 0.028, 0);
    this._tone(base * 1.5, 0.06, 'sine', 0.04, 0.045);
  }

  playTraceConfirmed() {
    this._tone(880, 0.08, 'sine', 0.05, 0);
    this._tone(1174, 0.08, 'sine', 0.05, 0.08);
    this._tone(1760, 0.24, 'sine', 0.06, 0.16);
  }

  playAlert() {
    this._tone(440, 0.16, 'sawtooth', 0.04, 0, 620);
    this._tone(440, 0.16, 'sawtooth', 0.04, 0.22, 620);
  }

  playDecrypt() {
    for (let i = 0; i < 6; i++) {
      const f = 600 + Math.random() * 900;
      this._tone(f, 0.035, 'square', 0.02, i * 0.045);
    }
    this._tone(1380, 0.16, 'sine', 0.05, 0.3);
  }
}

export const sfx = new TacticalAudio();
