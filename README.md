
# Jamstik Visualiser — Config Starter

An integrated starter with:
- **Bridge**: OSC/MIDI → WebSocket JSON
- **Config**: YAML file (hot-reloaded) controlling AI/visual behaviour
- **Web**: WebGL2 visualiser with two scenes & config-aware palette/mapping

## Run
### Bridge
```bash
cd bridge
npm i
npm start
# WS ws://localhost:9002, OSC udp/9001
```
### Web
```bash
cd ../web
python3 -m http.server 8080
# open http://localhost:8080
```

## YAML config
Edit `config/config.yaml` while everything runs. The bridge will broadcast updates and the browser will show **Config: loaded** in the HUD.

Keys:
- `director.default_palettes`: preferred palettes (names mapped in `web/main.js`)
- `director.map.<style>`: ranges for parameters (`warp`, `burst`, `strobeHz`, `bloom`) and optional `palette` list
- `smoothing`: EMA `TAU` and `SLEW` per parameter

## Ableton ↔ Bridge
- **OSC** via Max for Live `udpsend 127.0.0.1 9001`: `/scene neon-grid`, `/clock 128 0.25`, `/note 64 100`, `/bend -4000`, `/cc 64 127`
- **Virtual MIDI** (macOS IAC): route MIDI to **Ableton-To-Visualiser**

## WebMIDI fallback
If the bridge is off, the browser reads Jamstik/MFC1 directly (Chrome/Edge).

## AI hook
Call `window.applyStyle('lead', 0.8)` from DevTools or your classifier loop to apply YAML-driven parameter targets with smoothing.
