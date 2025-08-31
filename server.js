// server.js  —— 最小・完成版（そのまま貼り付け）
import fs from 'fs';
import https from 'https';
import { mkdirSync } from 'fs';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';


// ===== モデルDL設定（b6, .txt.gz を使用）=====
const MODEL_NAME = 'kata1-b6c96-s50894592-d7380655.txt.gz';
const MODEL_DIRS = [
  '/app/engines/easy_b6/weights',
  '/app/engines/normal_b10/weights',
  '/app/engines/hard_b18/weights',
];

// ----- ユーティリティ -----
function fileExists(p) { try { return fs.statSync(p).size > 0; } catch { return false; } }

function downloadWithRedirect(url, dest, { headers = {}, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    opts.headers = { 'User-Agent': 'katago-ui/1.0', ...headers };
    const req = https.get(opts, res => {
      const status = res.statusCode || 0;
      if ([301,302,303,307,308].includes(status)) {
        if (maxRedirects <= 0) return reject(new Error(`Too many redirects from ${url}`));
        const loc = res.headers.location; if (!loc) return reject(new Error(`Redirect without Location from ${url}`));
        res.resume();
        return resolve(downloadWithRedirect(new URL(loc, url).toString(), dest, { headers, maxRedirects: maxRedirects - 1 }));
      }
      if (status !== 200) { res.resume(); return reject(new Error(`HTTP ${status}`)); }
      const out = fs.createWriteStream(dest);
      res.pipe(out); out.on('finish', () => out.close(resolve));
    });
    req.on('error', reject);
  });
}

async function ensureModel() {
  for (const d of MODEL_DIRS) mkdirSync(d, { recursive: true });
  const target = `${MODEL_DIRS[0]}/${MODEL_NAME}`;
  if (fileExists(target)) { console.log('[start] model already exists'); return; }

  console.log('[start] downloading model ...');
  // 公式の正しいパス（/uploaded/.../models/kata1）→ 古いパスの順で試す
  const KATAGO_PRIMARY = `https://media.katagotraining.org/uploaded/networks/models/kata1/${MODEL_NAME}`;
  const KATAGO_FALLBACK = `https://media.katagotraining.org/networks/${MODEL_NAME}`;
  const candidates = [
    { url: KATAGO_PRIMARY, headers: {} },
    { url: KATAGO_FALLBACK, headers: {} },
  ];

  let ok = false;
  for (const c of candidates) {
    try {
      console.log('[start] trying', c.url);
      await downloadWithRedirect(c.url, `${target}.part`, { headers: c.headers });
      fs.renameSync(`${target}.part`, target);
      fs.copyFileSync(target, `${MODEL_DIRS[1]}/${MODEL_NAME}`);
      fs.copyFileSync(target, `${MODEL_DIRS[2]}/${MODEL_NAME}`);
      console.log('[start] model ready:', target);
      ok = true; break;
    } catch (e) {
      console.error('[start] failed:', c.url, e.message || e);
    }
  }
  if (!ok) {
    console.error('[start] WARNING: model could not be downloaded; server will still start');
  }
}

async function retry(fn, times = 3, waitMs = 5000) {
  let last; for (let i = 1; i <= times; i++) {
    try { return await fn(); }
    catch (e) { last = e; console.error(`[start] attempt ${i}/${times} failed:`, e.message || e); if (i<times) await new Promise(r=>setTimeout(r, waitMs)); }
  }
  throw last;
}

// ===== Express アプリ =====
async function start() {
  await retry(() => ensureModel(), 3, 5000);

  const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 1) GET /
app.get('/', (req, res) => {
  res.type('text/plain').send('KataGo backend is up. Try POST /api/analyze?engine=easy');
});

// 2) GET /healthz
app.get('/healthz', (req, res) => res.send('ok'));

// 3) POST /api/analyze（最小版）
app.post('/api/analyze', async (req, res) => {
  try {
    const engine = (req.query.engine || 'easy').toString().toLowerCase(); // easy|normal|hard
    const exe = process.env[`KATAGO_${engine.toUpperCase()}_EXE`] || '/app/engines/bin/katago';
    const model = process.env[`KATAGO_${engine.toUpperCase()}_MODEL`]
      || `/app/engines/${engine}_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz`;
    const cfg = `/app/engines/${engine}_b6/analysis.cfg`;

    const {
      boardXSize = 19, boardYSize = 19, rules = 'japanese',
      komi = 6.5, moves = [], maxVisits = 4,
    } = req.body || {};

    const child = spawn(exe, ['analysis', '-model', model, '-config', cfg], { stdio: ['pipe','pipe','pipe'] });
    const q = { id: 'req1', boardXSize, boardYSize, rules, komi, moves, maxVisits };

    let best;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      for (const line of chunk.split('\n')) {
        const s = line.trim(); if (!s) continue;
        try { const j = JSON.parse(s); if (j.id === 'req1' && j.moveInfos) best = j; } catch {}
      }
    });
    child.stderr.on('data', d => console.error('[katago]', String(d).trim()));
    child.stdin.write(JSON.stringify(q) + '\n'); child.stdin.end();

    child.on('close', code => best ? res.json(best) : res.status(500).json({ error:'no result from katago', exitCode: code }));
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

console.log('[start] routes ready: /, /healthz, POST /api/analyze');

  app.listen(PORT, () => console.log(`[start] server listening on port ${PORT}`));
}

start().catch(e => { console.error('[start] UNCAUGHT:', e); process.exit(1); });
