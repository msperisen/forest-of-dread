import { SONG, CHORDS, BASS, JINGLES } from './music.js';
import { clamp, lerp } from './util.js';

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error('bad note ' + name);
  return NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] + 1) * 12;
}
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

// Precompute lead events per section: step -> { m, len } (in sixteenths).
function compileSections() {
  const out = {};
  for (const [name, sec] of Object.entries(SONG.sections)) {
    const len = sec.chords.length * 16;
    const lead = {};
    if (sec.lead) {
      const toks = sec.lead.join(' ').split(/\s+/);
      toks.forEach((tok, i) => {
        if (tok === '-' || tok === '.') return;
        let hold = 1;
        while (toks[i + hold] === '-') hold++;
        lead[i * 2] = { m: midi(tok), len: hold * 2 };
      });
    }
    const chords = sec.chords.map((c) => CHORDS[c]);
    out[name] = { len, lead, chords };
  }
  return out;
}

// A small SID-flavoured synth on top of WebAudio.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = false;
    this.intensity = 1;
    this.sections = compileSections();
    this.stepDur = 60 / SONG.bpm / 4;
  }

  // Must be called from inside a user gesture (tap, click, key press): iOS only lets
  // audio start there. Safe to call repeatedly.
  init() {
    if (this.ctx) {
      // iOS reports 'interrupted' after calls, Siri or switching apps.
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // Play through the iPhone's silent switch, like a game or video (Safari 17+).
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch { /* not supported */ }
    const ctx = (this.ctx = new AC());
    ctx.resume?.().catch(() => {});
    // Older iOS versions only unlock after a sound actually starts in the gesture.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, 22050);
    silent.connect(ctx.destination);
    silent.start(0);

    this.out = ctx.createGain();
    this.out.gain.value = this.muted ? 0 : 0.75;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.out.connect(comp).connect(ctx.destination);

    this.music = ctx.createGain();
    this.music.gain.value = 0.5;
    this.musicLP = ctx.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 14000;
    this.music.connect(this.musicLP).connect(this.out);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.out);

    // Dotted-eighth echo for the "cavernous forest" feel.
    this.echoIn = ctx.createGain();
    const delay = ctx.createDelay(1.5);
    delay.delayTime.value = this.stepDur * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.33;
    const elp = ctx.createBiquadFilter();
    elp.type = 'lowpass';
    elp.frequency.value = 2400;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    this.echoIn.connect(delay).connect(elp).connect(fb).connect(delay);
    elp.connect(wet).connect(this.musicLP);

    // Band-limited pulse waves at classic SID duty cycles.
    this.waves = {};
    for (const [name, duty] of [['pulse12', 0.125], ['pulse25', 0.25], ['pulse50', 0.5]]) {
      const n = 64;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
      this.waves[name] = ctx.createPeriodicWave(real, imag);
    }

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Ambient beds: wind (always) and rain (weather dependent).
    this.wind = this._loopNoise('bandpass', 420, 0.6, 0.035);
    this.rainBed = this._loopNoise('highpass', 2800, 0.5, 0);
  }

  _loopNoise(type, f, q, vol) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(flt).connect(g).connect(this.sfxBus);
    src.start();
    return { g, flt };
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.out.gain.setTargetAtTime(this.muted ? 0 : 0.75, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // ---- voices -------------------------------------------------------------

  note(t, f, dur, o = {}) {
    const ctx = this.ctx;
    const {
      wave = 'pulse25', vol = 0.2, a = 0.005, d = 0.1, s = 0.6, r = 0.08,
      cutoff = 0, q = 1, fenv = 0, vib = 0, detune = 0, bus = this.music,
      echo = 0, slideTo = 0, arp = null,
    } = o;
    const g = ctx.createGain();
    const oscs = [];
    const mk = (cents) => {
      const osc = ctx.createOscillator();
      if (this.waves[wave]) osc.setPeriodicWave(this.waves[wave]);
      else osc.type = { saw: 'sawtooth', tri: 'triangle', sine: 'sine', square: 'square' }[wave] || 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      if (arp) {
        let k = 0;
        for (let tt = t; tt < t + dur; tt += 1 / 50, k++) osc.frequency.setValueAtTime(arp[k % arp.length], tt);
      }
      osc.detune.value = cents;
      oscs.push(osc);
    };
    mk(detune);
    if (detune) mk(-detune);

    if (vib) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.6;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(vib, t + Math.min(0.3, dur));
      lfo.connect(lg);
      for (const osc of oscs) lg.connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + dur + r * 3 + 0.1);
    }

    let target = g;
    if (cutoff) {
      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.Q.value = q;
      flt.frequency.setValueAtTime(cutoff + fenv, t);
      if (fenv) flt.frequency.setTargetAtTime(cutoff, t, Math.max(0.01, d * 0.6));
      flt.connect(g);
      target = flt;
    }
    for (const osc of oscs) osc.connect(target);

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setTargetAtTime(vol * s, t + a, Math.max(0.005, d / 3));
    g.gain.setTargetAtTime(0, t + dur, Math.max(0.005, r / 3));
    g.connect(bus);
    if (echo) {
      const send = ctx.createGain();
      send.gain.value = echo;
      g.connect(send).connect(this.echoIn);
    }
    const end = t + dur + r * 3 + 0.05;
    for (const osc of oscs) {
      osc.start(t);
      osc.stop(end);
    }
  }

  noise(t, o = {}) {
    const ctx = this.ctx;
    const { dur = 0.1, vol = 0.2, type = 'highpass', f = 6000, f1 = 0, q = 1, rate = 1, bus = this.sfxBus } = o;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(bus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  kick(t, vol = 0.35) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g).connect(this.music);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  // ---- music sequencer ------------------------------------------------------

  startMusic(intensity = 1) {
    if (!this.ctx) return;
    this.stopMusic();
    this.intensity = intensity;
    this.musicOn = true;
    this.orderIdx = 0;
    this.secStep = 0;
    this.nextT = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this._tick(), 25);
    this._tick();
  }

  stopMusic() {
    clearInterval(this.timer);
    clearTimeout(this.jingleTimer);
    this.musicOn = false;
  }

  setMood(night) {
    if (!this.ctx) return;
    // Night closes the global filter a little, like turning down the SID cutoff.
    this.musicLP.frequency.setTargetAtTime(lerp(14000, 3800, clamp(night, 0, 1)), this.ctx.currentTime, 1.5);
  }

  setRain(amount) {
    if (!this.ctx) return;
    this.rainBed.g.gain.setTargetAtTime(amount * 0.09, this.ctx.currentTime, 1.0);
  }

  _tick() {
    const ctx = this.ctx;
    while (this.nextT < ctx.currentTime + 0.15) {
      this._step(this.nextT);
      this.nextT += this.stepDur;
      this.secStep++;
      const sec = this.sections[SONG.order[this.orderIdx]];
      if (this.secStep >= sec.len) {
        this.secStep = 0;
        this.orderIdx++;
        if (this.orderIdx >= SONG.order.length) this.orderIdx = SONG.loopTo;
      }
    }
  }

  _step(t) {
    const sec = this.sections[SONG.order[this.orderIdx]];
    const s = this.secStep;
    const b = s & 15;
    const chord = sec.chords[s >> 4];
    const sd = this.stepDur;
    const I = this.intensity;

    // Bass: filtered 25% pulse with a resonant filter "pluck".
    const tok = BASS[b];
    if (tok !== '.') {
      const m = midi(chord[0] + '2') + (tok === 'O' ? 12 : tok === 'F' ? 7 : 0);
      this.note(t, hz(m), sd * 0.85, {
        wave: 'pulse25', vol: 0.24, a: 0.003, d: 0.12, s: 0.5, r: 0.05,
        cutoff: 420, fenv: 1600 + I * 400, q: 7,
      });
    }

    // Chord arpeggio: the trademark C64 "one voice, whole chord" trick.
    const tones = chord.map((n) => hz(midi(n + '4')));
    tones.push(tones[0] * 2);
    if (I > 0 || b % 2 === 0) {
      this.note(t, tones[0], sd * 0.9, {
        wave: 'pulse12', vol: 0.055, a: 0.002, d: 0.06, s: 0.7, r: 0.02, arp: tones, echo: 0.25,
      });
    }

    const ev = sec.lead[s];
    if (ev) {
      this.note(t, hz(ev.m), ev.len * sd * 0.95, {
        wave: 'pulse50', detune: 7, vol: 0.12, a: 0.01, d: 0.25, s: 0.65, r: 0.2,
        vib: 22, cutoff: 2800, q: 1.4, echo: 0.45,
      });
    }

    // Noise percussion
    if (I >= 1) {
      if (b === 0 || b === 8 || (I >= 2 && b === 10)) this.kick(t, 0.3);
      if (b % 2 === 0 || I >= 2) this.noise(t, { dur: 0.035, vol: b % 4 === 2 ? 0.07 : 0.04, type: 'highpass', f: 7500, bus: this.music });
      if (I >= 2 && (b === 4 || b === 12)) this.noise(t, { dur: 0.16, vol: 0.2, type: 'bandpass', f: 1700, q: 0.8, bus: this.music });
    } else if (b === 4 || b === 12) {
      this.noise(t, { dur: 0.05, vol: 0.03, type: 'highpass', f: 8000, bus: this.music });
    }
  }

  jingle(name, done) {
    if (!this.ctx) {
      done?.();
      return;
    }
    this.stopMusic();
    const J = JINGLES[name];
    const t0 = this.ctx.currentTime + 0.05;
    let t = t0;
    for (const [n, len] of J.notes) {
      if (n) {
        this.note(t, hz(midi(n)), len * J.step * 0.95, {
          wave: J.wave, vol: 0.15, a: 0.005, d: 0.2, s: 0.7, r: 0.25, vib: 14, echo: 0.4,
          cutoff: J.wave === 'saw' ? 2200 : 0, q: 2,
        });
        // Octave-down shadow voice for weight
        this.note(t, hz(midi(n) - 12), len * J.step * 0.95, { wave: 'tri', vol: 0.12, a: 0.005, d: 0.2, s: 0.8, r: 0.2 });
      }
      t += len * J.step;
    }
    if (done) this.jingleTimer = setTimeout(done, (t - t0) * 1000 + 250);
  }

  // ---- sound effects --------------------------------------------------------

  sfx(name, opt = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (opt.delay || 0);
    const bus = this.sfxBus;
    switch (name) {
      case 'shoot':
        this.note(t, 760, 0.09, { wave: 'pulse25', vol: 0.16, slideTo: 170, a: 0.001, d: 0.05, s: 0.3, r: 0.03, bus });
        this.noise(t, { dur: 0.07, vol: 0.12, type: 'bandpass', f: 3200, q: 1.5 });
        break;
      case 'hit':
        this.noise(t, { dur: 0.13, vol: 0.3, type: 'bandpass', f: 1300, q: 2 });
        this.note(t, 230, 0.07, { wave: 'saw', vol: 0.12, slideTo: 90, bus });
        break;
      case 'thunk':
        this.noise(t, { dur: 0.06, vol: 0.12, type: 'lowpass', f: 900 });
        this.note(t, 160, 0.05, { wave: 'tri', vol: 0.12, slideTo: 90, bus });
        break;
      case 'kill':
        this.note(t, 440, 0.5, { wave: 'saw', vol: 0.2, slideTo: 45, cutoff: 1600, q: 5, bus });
        this.noise(t, { dur: 0.35, vol: 0.2, type: 'lowpass', f: 1000, f1: 200 });
        break;
      case 'die':
        this.note(t, 620, 1.2, { wave: 'pulse50', vol: 0.2, slideTo: 38, vib: 70, bus });
        this.noise(t, { dur: 0.9, vol: 0.3, type: 'lowpass', f: 700, f1: 120 });
        break;
      case 'thunder':
        this.noise(t, { dur: 0.25, vol: 0.3 * (opt.vol ?? 1), type: 'highpass', f: 1400 });
        this.noise(t + 0.05, { dur: 3.2, vol: 0.65 * (opt.vol ?? 1), type: 'lowpass', f: 420, f1: 90, rate: 0.5 });
        break;
      case 'hop':
        this.note(t, 130, 0.16, { wave: 'tri', vol: 0.28, slideTo: 330, bus });
        break;
      case 'land':
        this.noise(t, { dur: 0.15, vol: 0.18, type: 'lowpass', f: 400 });
        break;
      case 'buzz':
        this.note(t, 170, 0.45, { wave: 'saw', vol: 0.05, vib: 90, cutoff: 1300, bus });
        break;
      case 'fire':
        this.noise(t, { dur: 0.55, vol: 0.32, type: 'bandpass', f: 900, f1: 200, q: 1 });
        this.note(t, 95, 0.4, { wave: 'saw', vol: 0.12, slideTo: 55, bus });
        break;
      case 'boom':
        this.noise(t, { dur: 0.7, vol: 0.4, type: 'lowpass', f: 800, f1: 90 });
        break;
      case 'roar':
        this.note(t, 68, 1.5, { wave: 'saw', vol: 0.26, vib: 130, cutoff: 650, fenv: 400, q: 3, bus, slideTo: 52 });
        this.note(t, 71, 1.5, { wave: 'pulse25', vol: 0.14, cutoff: 500, bus, slideTo: 50 });
        this.noise(t, { dur: 1.2, vol: 0.12, type: 'bandpass', f: 500, q: 2 });
        break;
      case 'rise':
        this.noise(t, { dur: 1.0, vol: 0.22, type: 'lowpass', f: 450 });
        this.note(t, 58, 1.0, { wave: 'tri', vol: 0.15, slideTo: 115, bus });
        break;
      case 'hiss':
        this.noise(t, { dur: 0.5, vol: 0.14, type: 'highpass', f: 4200 });
        break;
      case 'tongue':
        this.note(t, 280, 0.16, { wave: 'tri', vol: 0.2, slideTo: 950, bus });
        break;
      case 'vanish':
        this.note(t, 900, 0.7, { wave: 'pulse12', vol: 0.08, slideTo: 120, vib: 200, bus, echo: 0.6 });
        break;
    }
  }
}
