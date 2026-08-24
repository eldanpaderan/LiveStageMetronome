// engine.js
// Standalone Web Audio metronome engine. No UI/DOM dependencies, no MIDI.
// Uses the look-ahead scheduling pattern: a lightweight setInterval only
// wakes the scheduler up periodically; every actual click is scheduled
// against AudioContext.currentTime, which is the real, drift-free audio
// clock. setInterval never times the audio itself.

import { getMeter, METERS } from './meters.js';
import { getPattern } from './patterns.js';

const SCHEDULE_AHEAD_TIME = 0.12; // seconds to schedule ahead of "now"
const LOOKAHEAD_MS = 25; // how often the scheduler wakes up
const MIN_BPM = 10;
const MAX_BPM = 500;

function clampBpm(bpm) {
  const n = Number(bpm);
  if (!Number.isFinite(n)) return 120;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(n)));
}

export class MetronomeEngine {
  constructor() {
    this.audioCtx = null;
    this.bpm = 120;
    this.meterId = '4/4';
    this.patternId = 'quarter';
    this.volume = 0.8;

    this.isRunning = false;
    this.isPaused = false;

    this._timerId = null;
    this._nextNoteTime = 0;
    this._pulseIndex = 0; // index of current pulse within the measure
    this._measureCount = 0;

    // queue of {time, pulseIndex, isAccent, isFirstOfPulse} for visual sync
    this._notesInQueue = [];

    // count-in state
    this._countIn = { active: false, beatsLeft: 0, onTick: null, onDone: null };

    this.onBeat = null; // (pulseIndex, totalPulses, isAccent) => void
    this.onMeasure = null; // () => void
    this.onError = null; // (message) => void
  }

  _ensureContext() {
    if (this.audioCtx) return true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio API not supported in this browser.');
      this.audioCtx = new Ctx();
      return true;
    } catch (err) {
      this._fail('Could not start audio: ' + err.message);
      return false;
    }
  }

  _fail(msg) {
    if (this.onError) this.onError(msg);
    else console.error(msg);
  }

  setBpm(bpm) {
    this.bpm = clampBpm(bpm);
    return this.bpm;
  }

  setMeter(meterId) {
    const valid = meterId in METERS;
    if (!valid) this._fail(`Unknown time signature "${meterId}", defaulted to 4/4.`);
    this.meterId = valid ? meterId : '4/4';
    return this.meterId;
  }

  setPattern(patternId) {
    const pattern = getPattern(patternId);
    this.patternId = pattern.id;
    return this.patternId;
  }

  setVolume(vol) {
    const n = Number(vol);
    this.volume = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : this.volume;
    return this.volume;
  }

  async start() {
    if (this.isRunning) return;
    if (!this._ensureContext()) return;

    // Handle browser autoplay restriction: resume suspended context on user gesture.
    if (this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch (err) {
        this._fail('Audio could not be started (autoplay restriction). Tap Start again.');
        return;
      }
    }

    const resuming = this.isPaused;
    this.isRunning = true;
    this.isPaused = false;
    if (!resuming) {
      // Fresh start: begin at beat 1 of the measure.
      this._pulseIndex = 0;
      this._measureCount = 0;
    }
    // Either way, pick the audio clock back up from "now" so we don't
    // dump a backlog of missed clicks.
    this._nextNoteTime = this.audioCtx.currentTime + 0.05;
    this._notesInQueue = [];
    this._timerId = setInterval(() => this._scheduler(), LOOKAHEAD_MS);
  }

  pause() {
    if (!this.isRunning) return;
    this.isPaused = true;
    this.isRunning = false;
    if (this._timerId) clearInterval(this._timerId);
    this._timerId = null;
  }

  async resume() {
    if (this.isRunning) return;
    await this.start();
  }

  stop() {
    this.isRunning = false;
    this.isPaused = false;
    if (this._timerId) clearInterval(this._timerId);
    this._timerId = null;
    this._pulseIndex = 0;
    this._measureCount = 0;
    this._notesInQueue = [];
  }

  // Runs `beats` clicks (e.g. "4 3 2 1") at the current BPM before calling onDone.
  async countIn(beats, onTick, onDone) {
    if (!this._ensureContext()) { onDone && onDone(); return; }
    if (this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch (e) {
        this._fail('Audio could not be started. Tap Start again.');
        onDone && onDone();
        return;
      }
    }
    let remaining = beats;
    const secondsPerBeat = 60 / this.bpm;
    const tick = () => {
      if (remaining <= 0) {
        onDone && onDone();
        return;
      }
      this._playClick(this.audioCtx.currentTime + 0.02, true, 1.0);
      onTick && onTick(remaining);
      remaining -= 1;
      setTimeout(tick, secondsPerBeat * 1000);
    };
    tick();
  }

  _scheduler() {
    const meter = getMeter(this.meterId);
    const pattern = getPattern(this.patternId);
    const totalPulses = meter.pulses.length;

    while (this._nextNoteTime < this.audioCtx.currentTime + SCHEDULE_AHEAD_TIME) {
      const pulseValueEighths = meter.pulses[this._pulseIndex];
      const secondsPerQuarter = 60 / this.bpm;
      const pulseDuration = (pulseValueEighths / 2) * secondsPerQuarter;
      const subDuration = pulseDuration / pattern.subdivisions;

      const isFirstPulseOfMeasure = this._pulseIndex === 0;

      for (let s = 0; s < pattern.subdivisions; s++) {
        const t = this._nextNoteTime + s * subDuration;
        const isAccentClick = isFirstPulseOfMeasure && s === 0;
        const gain = pattern.gains[s] ?? 0.5;
        this._playClick(t, isAccentClick, gain, isFirstPulseOfMeasure);

        this._notesInQueue.push({
          time: t,
          pulseIndex: this._pulseIndex,
          totalPulses,
          isAccent: isAccentClick,
          isSubTick: s > 0,
        });
      }

      this._nextNoteTime += pulseDuration;
      this._pulseIndex = (this._pulseIndex + 1) % totalPulses;
      if (this._pulseIndex === 0) {
        this._measureCount += 1;
      }
    }

    this._drainVisualQueue();
  }

  _drainVisualQueue() {
    const now = this.audioCtx.currentTime;
    while (this._notesInQueue.length && this._notesInQueue[0].time < now + 0.01) {
      const note = this._notesInQueue.shift();
      const delayMs = Math.max(0, (note.time - now) * 1000);
      setTimeout(() => {
        if (!note.isSubTick && this.onBeat) {
          this.onBeat(note.pulseIndex, note.totalPulses, note.isAccent);
        }
        if (note.isAccent && this.onMeasure) this.onMeasure();
      }, delayMs);
    }
  }

  _playClick(time, isAccent, gainMul = 1, isMainPulse = true) {
    if (!this.audioCtx) return;
    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    // Accent = higher pitch, main pulse = mid pitch, subdivision = lower/softer
    let freq = 660;
    if (isAccent) freq = 1500;
    else if (isMainPulse) freq = 1000;
    else freq = 700;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    const peak = this.volume * gainMul * (isAccent ? 1 : 0.85);
    gainNode.gain.setValueAtTime(0.0001, time);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), time + 0.002);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }
}

export { MIN_BPM, MAX_BPM };
