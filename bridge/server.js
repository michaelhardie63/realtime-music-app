import { WebSocketServer } from 'ws';
import osc from 'osc';
import { initConfig } from './config-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const WS_PORT  = Number(process.env.WS_PORT || 9002);
const OSC_PORT = Number(process.env.OSC_PORT || 9001);

// ----- absolute path to ../config/config.yaml (robust regardless of cwd)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const CONFIG_PATH = path.resolve(__dirname, '../config/config.yaml');

// ----- WebSocket
const wss = new WebSocketServer({ port: WS_PORT });
wss.on('listening', () => console.log(`[bridge] WebSocket ws://localhost:${WS_PORT}`));

// utility
function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const client of wss.clients) if (client.readyState === 1) client.send(data);
}

// ----- Load YAML config and auto-broadcast on changes
// initConfig should: load CONFIG_PATH, watch file, and on change do broadcast({type:'config', config})
const cfg = initConfig({ path: CONFIG_PATH, wss });

// send current config to NEW clients immediately on connect (helps with DEBUG.CONFIG === null)
wss.on('connection', (ws) => {
  if (cfg?.current) {
    ws.send(JSON.stringify({ type: 'config', config: cfg.current }));
  }
});

// ---------- OSC input (from Ableton via Max for Live or similar) ----------
const udp = new osc.UDPPort({ localAddress: '127.0.0.1', localPort: OSC_PORT });
udp.on('ready', () => console.log(`[bridge] OSC udp://127.0.0.1:${OSC_PORT}`));
udp.on('message', (msg) => {
  const addr = msg.address || "";
  const args = (msg.args || []).map(a => (typeof a === 'object' && 'value' in a) ? a.value : a);

  if (addr === "/scene")       broadcast({ type: "scene", name: String(args[0] || "") });
  else if (addr === "/clock")  broadcast({ type: "clock", bpm: Number(args[0] || 120), phase: Number(args[1] || 0) });
  else if (addr === "/note")   { const pitch = Number(args[0]||0), vel = Number(args[1]||0); recordEvent({type:'note',pitch,vel}); broadcast({ type:"note", pitch, vel }); }
  else if (addr === "/bend")   { const value = Number(args[0]||0); recordEvent({type:'bend', bend:value}); broadcast({ type:"bend", value }); }
  else if (addr === "/cc")     { const num = Number(args[0]||0), val = Number(args[1]||0); recordEvent({type:'cc', num, val}); broadcast({ type:"cc", num, val }); }
  else                         broadcast({ type: "osc", address: addr, args });
});
udp.open();

// ---------- Optional: virtual MIDI input ----------
let midiOK = false;
try {
  const midi = await import('midi').then(m => m.default || m);
  const input = new midi.Input();
  const portName = "Ableton-To-Visualiser";
  try {
    input.openVirtualPort(portName);
    midiOK = true;
    console.log(`[bridge] Virtual MIDI input "${portName}" created.`);
  } catch {
    console.log("[bridge] MIDI virtual port not available (optional). Skipping.");
  }
  if (midiOK) {
    input.on('message', (deltaTime, bytes) => {
      const [st,d1,d2] = bytes; const cmd = st & 0xf0;
      if (cmd === 0x90 && d2 > 0) { recordEvent({ type:'note', pitch:d1, vel:d2 }); broadcast({ type: "note", pitch: d1, vel: d2 }); }
      else if (cmd === 0xe0) {
        const bend = ((d2 << 7) | d1) - 8192;  // -8192..+8191
        recordEvent({ type:'bend', bend });
        broadcast({ type: "bend", value: bend });
      } else if (cmd === 0xb0) { recordEvent({ type:'cc', num:d1, val:d2 }); broadcast({ type: "cc", num: d1, val: d2 }); }
      else if (cmd === 0xc0) { broadcast({ type: "scene", name: `program-${d1}` }); }
    });
  }
} catch {
  console.log("[bridge] 'midi' module not installed (optional). Using OSC path only.");
}

/* ──────────────────────────────────────────────────────────────
   (Optional) RULES-BASED "AI" CLASSIFIER so browser gets ai_control
   This lets your visuals respond even with just OSC/MIDI test data.
   ────────────────────────────────────────────────────────────── */
const FEAT_WINDOW_MS = 320;
const FEAT_HOP_MS    = 80;
const events = []; // { t, type:'note'|'bend'|'cc', pitch, vel, bend, num, val }
function nowSec(){ return performance.now()/1000; }
function recordEvent(ev){ ev.t = nowSec(); events.push(ev); }

function computeFeatures(){
  const tNow = nowSec();
  const tMin = tNow - FEAT_WINDOW_MS/1000;
  while (events.length && events[0].t < tMin - 0.5) events.shift();
  const win = events.filter(e => e.t >= tMin);

  const notes = win.filter(e => e.type==='note');
  const bends = win.filter(e => e.type==='bend');
  const ccs   = win.filter(e => e.type==='cc');

  const density = notes.length / (FEAT_WINDOW_MS/1000);
  const velMean = notes.length ? notes.reduce((s,n)=>s+n.vel,0)/notes.length : 0;
  const velVar  = notes.length ? notes.reduce((s,n)=>s+Math.pow(n.vel-velMean,2),0)/notes.length : 0;

  let intervalMean = 0;
  if (notes.length >= 2) {
    const sorted = notes.slice().sort((a,b)=>a.t-b.t);
    const diffs = [];
    for (let i=1;i<sorted.length;i++) diffs.push(Math.abs(sorted[i].pitch - sorted[i-1].pitch));
    intervalMean = diffs.length ? diffs.reduce((s,x)=>s+x,0)/diffs.length : 0;
  }

  const bendRMS = bends.length 
    ? Math.sqrt(bends.reduce((s,b)=>s + (b.bend*b.bend), 0) / bends.length) / 8192.0
    : 0;

  const activeByPitch = {};
  notes.forEach(n => { activeByPitch[n.pitch] = 1; });
  const uniquePitches = Object.keys(activeByPitch).length;

  const sustain = ccs.filter(c => c.num === 64).slice(-1)[0]?.val > 64 ? 1 : 0;

  return { density, velMean, velVar, intervalMean, bendRMS, uniquePitches, sustain };
}

function classify(f){
  let lastStyle = 'pad';
let lastChange = 0;
const MIN_HOLD_MS = 1200;   // don’t switch styles faster than this
const THRESH = {            // gate style changes
  lead:     { dens: 2.0, int: 0.45 },
  arpeggio: { dens: 3.0, int: 0.35 },
  chords:   { dens: 3.0, int: 0.30 },
  pad:      { dens: 0.0, int: 0.00 },
};

function pickStyle(f){
  // intensity measure roughly like before
  const densNorm = Math.min(1, f.density / 10);
  const velNorm  = Math.min(1, f.velMean / 127);
  const intensity = Math.max(0, Math.min(1, 0.6*densNorm + 0.4*velNorm));

  let candidate = 'pad';
  if (f.uniquePitches >= 3 && f.density >= THRESH.chords.dens && intensity >= THRESH.chords.int) candidate = 'chords';
  if (f.intervalMean >= 4 && f.density >= THRESH.lead.dens && intensity >= THRESH.lead.int) candidate = 'lead';
  if (f.intervalMean <= 3 && f.density >= THRESH.arpeggio.dens && intensity >= THRESH.arpeggio.int) candidate = 'arpeggio';
  if (f.sustain) candidate = 'pad';

  // hysteresis: avoid rapid bouncing
  const now = performance.now();
  if (candidate !== lastStyle && (now - lastChange) < MIN_HOLD_MS) {
    candidate = lastStyle; // hold
  }
  if (candidate !== lastStyle) {
    lastStyle = candidate; lastChange = now;
  }
  return { style: candidate, intensity };
}

setInterval(() => {
  const f = computeFeatures();
  const { style, intensity } = pickStyle(f);
  broadcast({ type: 'ai_control', style, intensity, feat:f });
}, FEAT_HOP_MS);

}

// --- Pitch-class histogram over the window ---
function pitchClassHistogram(winNotes) {
  const pc = new Array(12).fill(0);
  for (const n of winNotes) {
    const p = n.pitch % 12;
    pc[p] += (n.vel || 0) / 127; // weight by velocity
  }
  return pc;
}

// Simple major/minor profiles (Krumhansl-ish, normalized)
const MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
function rotate(arr, k){ return arr.map((_,i)=>arr[(i-k+12)%12]); }
function dot(a,b){ let s=0; for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
function norm(a){ return Math.sqrt(dot(a,a)); }

// Heuristic: energy & valence & key/mode
function analyzeTonal(winNotes, density, velMean, bendRMS){
  const pc = pitchClassHistogram(winNotes);
  const pcN = norm(pc) || 1;
  const pcU = pc.map(x=>x/pcN);

  let bestMajor = {score:-1, root:0};
  let bestMinor = {score:-1, root:0};
  for (let k=0;k<12;k++){
    const maj = rotate(MAJOR, k); const min = rotate(MINOR, k);
    const sMaj = dot(pcU, maj)/norm(maj);
    const sMin = dot(pcU, min)/norm(min);
    if (sMaj > bestMajor.score) bestMajor = {score:sMaj, root:k};
    if (sMin > bestMinor.score) bestMinor = {score:sMin, root:k};
  }

  const isMinor = bestMinor.score > bestMajor.score ? 1 : 0;
  const keyRoot = isMinor ? bestMinor.root : bestMajor.root;
  const tonalConf = Math.max(bestMajor.score, bestMinor.score); // 0..~1

  // Energy: mix density, mean velocity, pitch movement, bend
  const energy = Math.max(0, Math.min(1,
    0.55 * Math.min(1, density/10) +
    0.35 * Math.min(1, velMean/127) +
    0.10 * Math.min(1, bendRMS)
  ));

  // Valence ~ “happy/sad”: major->positive, minor->negative, influence by average register
  const avgPitch = winNotes.length ? (winNotes.reduce((s,n)=>s+n.pitch,0)/winNotes.length) : 60;
  const reg = Math.max(0, Math.min(1, (avgPitch-48)/36)); // 48..84 -> 0..1
  let valence = (isMinor ? -1 : +1) * (0.4 + 0.4*tonalConf) + 0.2*(reg-0.5)*2.0;
  valence = Math.max(-1, Math.min(1, valence));

  return { energy, valence, keyRoot, isMinor, tonalConf };
}

// Section detector: chorus when energy rises and unique pitches increase
let section = 0; // 0=verse,1=pre,2=chorus,3=bridge
let lastEnergy = 0, holdMs = 0;
function updateSection(energy, uniquePitches, dtMs){
  holdMs += dtMs;
  const up = (energy - lastEnergy) > 0.12 && uniquePitches >= 4;
  if (up && holdMs > 1400) { section = Math.min(3, section+1); holdMs = 0; }
  if (!up && energy < 0.15 && holdMs > 4000) { section = Math.max(0, section-1); holdMs = 0; }
  lastEnergy = energy;
  return section;
}

// Replace your AI broadcast loop:
let lastTick = performance.now();
setInterval(() => {
  const tNow = performance.now();
  const dt   = tNow - lastTick; lastTick = tNow;

  const f = computeFeatures(); // your existing window stats
  const notes = events.filter(e=>e.type==='note' && e.t >= (performance.now()/1000 - 0.32));
  const tonal = analyzeTonal(notes, f.density, f.velMean, f.bendRMS);
  const sec   = updateSection(tonal.energy, f.uniquePitches, dt);

  // still keep your style message if you like
  // const { style, intensity } = pickStyle(f);
  // broadcast({ type: 'ai_control', style, intensity, feat: f });

  // NEW: director packet
  broadcast({
    type: 'director',
    energy:  tonal.energy,     // 0..1
    valence: tonal.valence,    // -1..+1
    key:     tonal.keyRoot,    // 0..11 (C..B)
    isMinor: tonal.isMinor,    // 0/1
    section: sec,              // 0..3
    conf:    tonal.tonalConf,  // 0..1
  });
}, FEAT_HOP_MS);

