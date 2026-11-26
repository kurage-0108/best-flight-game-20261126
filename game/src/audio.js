// All-synthesised WebAudio: engine hum that follows RPM, wind noise that follows
// airspeed, a stall horn, and one-shot chime, fanfare, warning, touchdown thud
// and crash crunch. Starts on the first user gesture; stays silent when disabled.

import { AUDIO } from './config.js';

export function createAudio({ enabled = true } = {}) {
  let ctx = null;
  let master, engineGain, engineOsc, engineSub, engineFilter, pulse, windGain, windFilter, hornGain, noiseBuffer;
  let flying = false;

  function noiseSource() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    return src;
  }

  function build() {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = AUDIO.masterVolume;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // engine: sawtooth plus a sub-octave square, low-passed, with a firing-pulse tremolo
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 500;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineSub = ctx.createOscillator();
    engineSub.type = 'square';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    pulse = ctx.createOscillator();
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.35;
    const tremolo = ctx.createGain();
    tremolo.gain.value = 0.65;
    pulse.connect(pulseDepth).connect(tremolo.gain);
    engineOsc.connect(engineFilter);
    engineSub.connect(subGain).connect(engineFilter);
    engineFilter.connect(tremolo).connect(engineGain).connect(master);

    // wind: band-passed noise
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    noiseSource().connect(windFilter).connect(windGain).connect(master);

    // stall horn
    const horn = ctx.createOscillator();
    horn.type = 'square';
    horn.frequency.value = 410;
    hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    horn.connect(hornGain).connect(master);

    for (const o of [engineOsc, engineSub, pulse, horn]) o.start();
    ctx.resume();
  }

  /** A tone that rises in and decays: frequency, start delay, length, volume, wave. */
  function tone(freq, delay, length, volume, type = 'sine', endFreq = freq) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(endFreq, t + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + length + 0.05);
  }

  /** A filtered noise burst: filter type and frequency, length, volume. */
  function burst(type, freq, length, volume, delay = 0) {
    const t = ctx.currentTime + delay;
    const src = noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random());
    src.stop(t + length + 0.05);
  }

  const sounds = {
    chime() {
      tone(988, 0, 0.5, 0.22);
      tone(1480, 0.07, 0.7, 0.18);
    },
    fanfare() {
      [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.11, 0.6, 0.18, 'triangle'));
    },
    warn() {
      tone(520, 0, 0.25, 0.2, 'square');
      tone(390, 0.28, 0.35, 0.2, 'square');
    },
    thud(strength = 1) {
      burst('lowpass', 180, 0.35, 0.5 * strength);
      tone(85, 0, 0.3, 0.45 * strength, 'sine', 40);
    },
    crunch() {
      burst('lowpass', 300, 1.6, 0.9);
      burst('bandpass', 1100, 0.9, 0.6, 0.05);
      burst('highpass', 2500, 0.5, 0.35, 0.12);
      tone(70, 0, 1.2, 0.6, 'sawtooth', 28);
    },
  };

  return {
    /** Creates the audio graph; call from a user gesture (browsers require it). */
    start() {
      if (!enabled || ctx) return;
      try {
        build();
      } catch {
        enabled = false;
      }
    },
    /** Whether the engine and wind should be heard (flying) or faded (menus, results). */
    setFlying(v) {
      flying = v;
    },
    setPaused(p) {
      if (!ctx) return;
      if (p) ctx.suspend();
      else ctx.resume();
    },
    play(name, arg) {
      if (ctx && sounds[name]) sounds[name](arg);
    },
    /** Plays the one-shots for aircraft events (touchdown, crash). */
    handleEvents(events) {
      if (!ctx) return;
      for (const e of events) {
        if (e.type === 'touchdown' && e.kind !== 'water') sounds.thud(Math.min(1.5, 0.4 + e.sink / 3));
        if (e.type === 'crash') sounds.crunch();
      }
    },
    /** Follows the aircraft: engine pitch and loudness with RPM, wind with airspeed, horn on stall warning. */
    update(s) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const live = flying && !s.crashed;
      const rpm = s.rpm;
      const hz = AUDIO.engineIdleHz + (AUDIO.engineFullHz - AUDIO.engineIdleHz) * rpm;
      engineOsc.frequency.setTargetAtTime(hz, t, 0.08);
      engineSub.frequency.setTargetAtTime(hz * 0.5, t, 0.08);
      pulse.frequency.setTargetAtTime(hz * 0.25, t, 0.08);
      engineFilter.frequency.setTargetAtTime(380 + rpm * 1300, t, 0.1);
      engineGain.gain.setTargetAtTime(live ? (s.engineOn ? 0.1 + rpm * 0.16 : 0.02 * rpm) : 0, t, 0.15);
      const air = Math.min(1, s.airspeed / AUDIO.windMaxSpeed);
      windFilter.frequency.setTargetAtTime(300 + air * 1600, t, 0.2);
      windGain.gain.setTargetAtTime(live ? air * air * 0.32 : 0, t, 0.2);
      const horn = live && s.stallWarning && !s.onGround;
      hornGain.gain.setTargetAtTime(horn ? 0.05 : 0, t, 0.03);
    },
  };
}
