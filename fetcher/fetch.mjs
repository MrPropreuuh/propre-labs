// Background fetcher — runs continuously on the Pi (independent of any visitor).
// Every FETCH_INTERVAL_SECONDS it pulls the Marvel Rivals API and atomically
// writes /data/player.json, which nginx serves at /data/player.json.
import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const API_KEY      = process.env.API_KEY;
const PLAYER       = process.env.PLAYER || 'MrPropreter';
const API_BASE     = 'https://marvelrivalsapi.com/api/v1';
const INTERVAL     = (Number(process.env.FETCH_INTERVAL_SECONDS) || 300) * 1000;
const OUT          = process.env.OUT_FILE || '/data/player.json';
const SEASON_LABEL = process.env.SEASON_LABEL || 'Current Season';

if (!API_KEY) {
  console.error('FATAL: API_KEY env var is required.');
  process.exit(1);
}

const headers = { 'x-api-key': API_KEY };

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function requestUpdate() {
  // Ask the API to re-crawl this player so its data stays current (takes 0-30m).
  try {
    const r = await getJson(`${API_BASE}/player/${PLAYER}/update`);
    console.log(`[${new Date().toISOString()}] update requested: ${r?.message ?? 'ok'}`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] update request failed: ${e.message}`);
  }
}

async function tick() {
  await requestUpdate();
  try {
    // current = active season, allTime = season=0 aggregate.
    const [current, allTime] = await Promise.all([
      getJson(`${API_BASE}/player/${PLAYER}`),
      getJson(`${API_BASE}/player/${PLAYER}?season=0`),
    ]);

    const seasonNum = current?.match_history?.[0]?.season ?? null;
    const payload = JSON.stringify({
      updatedAt: Date.now(),
      seasonLabel: SEASON_LABEL,
      seasonNum,
      current,
      allTime,
    });
    await mkdir(dirname(OUT), { recursive: true });
    const tmp = `${OUT}.tmp`;
    await writeFile(tmp, payload);
    await rename(tmp, OUT); // atomic swap so nginx never serves a half-written file
    console.log(`[${new Date().toISOString()}] wrote ${OUT} (${payload.length} bytes)`);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] fetch failed: ${e.message}`);
  }
}

console.log(`fetcher started · player=${PLAYER} · interval=${INTERVAL / 1000}s · out=${OUT}`);
await tick();
setInterval(tick, INTERVAL);
