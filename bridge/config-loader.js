import fs from 'fs';
import yaml from 'js-yaml';

export function initConfig({ path = '../config/config.yaml', wss } = {}) {
  const state = { current: {}, path };
  function broadcast(obj) {
    if (!wss) return;
    const data = JSON.stringify(obj);
    for (const c of wss.clients) if (c.readyState === 1) c.send(data);
  }
  function validate(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('Config is empty/invalid');
    if (!cfg.smoothing || !cfg.director) throw new Error('Missing required keys (smoothing/director)');
  }
  function loadOnce() {
    const raw = fs.readFileSync(new URL(path, import.meta.url));
    const cfg = yaml.load(raw.toString('utf8'));
    validate(cfg);
    state.current = cfg;
    broadcast({ type: 'config', config: cfg });
    console.log(`[config] loaded ${path}`);
  }
  loadOnce();
  // watch (best-effort; may not fire on some systems)
  try {
    fs.watch(new URL(path, import.meta.url), { persistent: false }, (evt) => {
      if (evt === 'change') {
        try { loadOnce(); console.log('[config] reloaded & broadcasted'); }
        catch (e) { console.error('[config] reload failed:', e.message); }
      }
    });
  } catch {}
  return state;
}
