import { Engine } from './engine.js';

const canvas = document.getElementById('glA');
const eng = new Engine(canvas);
window.e = eng;

// --- poly slots (up to 6 notes)
const MAX_SLOTS = 6;
const slots = Array.from({ length: MAX_SLOTS }, () => ({ t: -9999.0, p: 0.0, v: 0.0 }));
let slotIdx = 0;
eng.setSlots(slots);

function pushNote(pitch01, vel01) {
  const tNow = (eng?.time ?? performance.now()/1000);
  slots[slotIdx] = { t: tNow, p: pitch01, v: vel01 };
  slotIdx = (slotIdx + 1) % MAX_SLOTS;

  // convenience mono uniforms
  eng.uniforms.u_note       = pitch01;
  eng.uniforms.u_noteTime   = tNow;
  eng.uniforms.u_brightness = 0.45 + 0.45 * vel01;
}

// --- load shader (ensure this path/file exists!)
async function load(u){ return await (await fetch(u, { cache: 'no-store' })).text(); }
const frag = await load('./shaders/burst_poly.frag');
eng.setScene(frag);

// defaults
eng.uniforms.u_bpm        = 120;
eng.uniforms.u_brightness = 0.5;
eng.uniforms.u_audio      = 0.0;
eng.uniforms.u_note       = 0.0;
eng.uniforms.u_noteTime   = -9999.0;

// brightness relax
const BRIGHT_BASE = 0.5;
const BRIGHT_TAU  = 1.0;
function relaxBrightness(dt){
  const a = 1 - Math.exp(-dt / BRIGHT_TAU);
  eng.uniforms.u_brightness += (BRIGHT_BASE - eng.uniforms.u_brightness) * a;
  eng.uniforms.u_brightness = Math.min(0.95, Math.max(0.10, eng.uniforms.u_brightness));
}

// time loop (Engine drives u_time; we just relax brightness)
(function tick(){
  const t  = performance.now()/1000;
  const dt = Math.max(0.001, t - (tick._prev || t)); tick._prev = t;
  relaxBrightness(dt);
  requestAnimationFrame(tick);
})();

// ===== Boot after user gesture: Audio + MIDI =====
let booted = false;
async function bootOnce() {
  if (booted) return;
  booted = true;

  // show an initial burst so you know it’s alive
  pushNote(Math.random(), 0.9);

  // ---- Audio analyser
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch(_){} }

  const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;

  // demo tone (remove in production)
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.frequency.value = 220; gain.gain.value = 0.08;
  osc.connect(gain).connect(analyser).connect(ctx.destination);
  osc.start();

  let lastAudioBurstT = 0;

  // single analyser loop (also drives audio-triggered bursts)
  (function loop(){
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    // RMS proxy
    let sum = 0; for (let i=0;i<data.length;i++) sum += data[i]*data[i];
    const rms = Math.sqrt(sum/Math.max(1,data.length))/255;
    const curved = Math.pow(rms*2.2, 0.75);
    eng.uniforms.u_audio = (eng.uniforms.u_audio ?? 0)*0.85 + curved*0.15;

    // --- burst-on-audio gate ---
    const tNow = eng.time || performance.now()/1000;
    if (eng.uniforms.u_audio > 0.08 && (tNow - lastAudioBurstT) > 0.18) {
      const pitch01 = Math.min(1, Math.max(0, eng.uniforms.u_audio * 1.2));
      const vel01   = Math.min(1, 0.6 + 0.5 * eng.uniforms.u_audio);
      pushNote(pitch01, vel01);
      lastAudioBurstT = tNow;
    }

    requestAnimationFrame(loop);
  })();

  // optional HUD ping
  const s = document.getElementById('wsState');
  if (s) s.textContent = 'audio: on';

  // ---- MIDI → pushNote on NoteOn
  if ('requestMIDIAccess' in navigator) {
    try {
      const midi = await navigator.requestMIDIAccess({ sysex:false });
      for (const input of midi.inputs.values()) {
        input.onmidimessage = ({ data }) => {
          const [st,d1,d2] = data; const cmd = st & 0xf0;
          if (cmd === 0x90 && d2 > 0) pushNote(d1/127, d2/127);
        };
      }
    } catch (e) {
      console.warn('MIDI unavailable:', e);
    }
  }
}

// Start on first interaction (click/tap/keydown)
['pointerdown','keydown','touchstart'].forEach(evt =>
  window.addEventListener(evt, bootOnce, { once: true, passive: true })
);

// manual test (‘b’ = random note) and click burst
document.addEventListener('keydown', (ev) => {
  if (ev.key.toLowerCase() === 'b') {
    pushNote(Math.random(), 0.9);
  }
});
window.addEventListener('pointerdown', () => {
  pushNote(Math.random(), 0.8 + 0.2*Math.random());
});

// draw forever
eng.frame();
