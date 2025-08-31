// server.js
// ========== KataGo UI Runtime Entrypoint ==========

import fs from 'fs';
import https from 'https';
import { mkdirSync } from 'fs';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';


// ================= モデル準備ユーティリティ =================

const MODEL_NAME = 'kata1-b6c96-s50894592-d7380655.txt.gz';
const MODEL_DIRS = [
  '/app/engines/easy_b6/weights',
  '/app/engines/normal_b10/weights',
  '/app/engines/hard_b18/weights',
];

function fileExists(p) {
  try { return fs.statSync(p).size > 0; } catch { return false; }
}

// リダイレクト付きダウンロード
function downloadWithRedirect(url, dest, { headers = {}, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    opts.headers = {
      'User-Agent': 'katago-ui/1.0 (+https://katago-3.onrender.com)',
      ...headers,
    };
    const req = https.get(opts, res => {
      const status = res.statusCode || 0;

      // Redirect?
      if ([301, 302, 303, 307, 308].includes(status)) {
        if (maxRedirects <= 0) return reject(new Error(`Too many redirects from ${url}`));
        const loc = res.headers.location;
        if (!loc) return reject(new Error(`Redirect without Location from ${url}`));
        res.resume(); // drain
        return resolve(
          downloadWithRedirect(new URL(loc, url).toString(), dest, { headers, maxRedirects: maxRedirects - 1 })
        );
      }

      if (status !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${status}`));
      }

      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', reject);
  });
}

async function ensureModel() {
  for (const dir of MODEL_DIRS) mkdirSync(dir, { recursive: true });
  const target = `${MODEL_DIRS[0]}/${MODEL_NAME}`;
  if (fileExists(target)) {
    console.log('[start] model already exists');
    return;
  }

  console.log('[start] downloading model ...');

  const HF_URL = `https://huggingface.co/katago/katago-models/resolve/main/networks/${MODEL_NAME}`;
  const KATAGO_CDN = `https://media.katagotraining.org/networks/${MODEL_NAME}`;

  const candidates = [
    // HuggingFace 認証付き
    { url: HF_URL, headers: process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {} },
    // HuggingFace 匿名
    { url: HF_URL, headers: {} },
    // 公式 KataGo CDN
    { url: KATAGO_CDN, headers: {} },
  ];

  let success = false;
  for (const c of candidates) {
    try {
      console.log(`[start] trying ${c.url}`);
      await downloadWithRedirect(c.url, `${target}.part`, { headers: c.headers });
      fs.renameSync(`${target}.part`, target);
      fs.copyFileSync(target, `${MODEL_DIRS[1]}/${MODEL_NAME}`);
      fs.copyFileSync(target, `${MODEL_DIRS[2]}/${MODEL_NAME}`);
      console.log('[start] model ready:', target);
      success = true;
      break;
    } catch (e) {
      console.error('[start] failed:', c.url, e.message || e);
    }
  }
  if (!success) throw new Error('All model download attempts failed');
}

// ================== リトライ付き起動処理 ==================

async function retry(fn, times = 5, waitMs = 5000) {
  let lastErr;
  for (let i = 1; i <= times; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.error(`[start] attempt ${i}/${times} failed:`, e.message || e);
      if (i < times) await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

// ================== アプリ本体 ==================

async function start() {
  try {
    console.log('[start] ensuring model...');
    await retry(() => ensureModel(), 3, 5000);

    // Express サーバ起動
    const app = express();


app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.type('text/plain').send('KataGo backend is up. Try POST /api/analyze?engine=easy');
});

app.get('/healthz', (req, res) => res.send('ok'));

app.post('/api/analyze', async (req, res) => {
  try {
    const engine = (req.query.engine || 'easy').toString().toLowerCase();
    const exe = process.env[`KATAGO_${engine.toUpperCase()}_EXE`] || '/app/engines/bin/katago';
    const model =
      process.env[`KATAGO_${engine.toUpperCase()}_MODEL`] ||
      `/app/engines/${engine}_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz`;
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
        try { const j = JSON.parse(s); if (j.id==='req1' && j.moveInfos) best = j; } catch {}
      }
    });
    child.stderr.on('data', d => console.error('[katago]', String(d).trim()));
    child.stdin.write(JSON.stringify(q) + '\n'); child.stdin.end();

    child.on('close', code => best ? res.json(best) : res.status(500).json({ error:'no result from katago', exitCode: code }));
  } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
});


import cors from 'cors';
import { spawn } from 'child_process';

// 中略: 既存の import, ensureModel, retry などはそのまま

// ====== Express アプリ起動部 ======
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// 1) ルート（ブラウザで見たときの案内用）
app.get('/', (req, res) => {
  res.type('text/plain').send('KataGo backend is up. Try POST /api/analyze?engine=easy');
});

// 2) ヘルスチェック（既存があればそのままでOK）
app.get('/healthz', (req, res) => res.send('ok'));

// 3) 解析API（最小実装：単発でKataGo analysisを起動）
app.post('/api/analyze', async (req, res) => {
  try {
    const engine = (req.query.engine || 'easy').toString().toLowerCase(); // easy|normal|hard
    const exe =
      process.env[`KATAGO_${engine.toUpperCase()}_EXE`] || '/app/engines/bin/katago';
    const model =
      process.env[`KATAGO_${engine.toUpperCase()}_MODEL`] ||
      `/app/engines/${engine}_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz`;
    const cfg = `/app/engines/${engine}_b6/analysis.cfg`; // Dockerfileで作ったcfg

    // リクエストから最低限の項目を拾う（無ければデフォルト）
    const {
      boardXSize = 19,
      boardYSize = 19,
      rules = 'japanese',
      komi = 6.5,
      moves = [],
      maxVisits = 4,
    } = req.body || {};

    // KataGo analysis を単発起動
    const child = spawn(exe, ['analysis', '-model', model, '-config', cfg], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 解析クエリ（JSON Lines）
    const q = {
      id: 'req1',
      boardXSize,
      boardYSize,
      rules,
      komi,
      moves,      // 例: [["B","D4"],["W","Q16"]]
      maxVisits,  // 訪問回数の上限（低いほど速い）
    };

    let best; // 返却用
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      for (const line of chunk.split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try {
          const j = JSON.parse(s);
          // 最初の応答で十分（moveInfos を取得）
          if (j.id === 'req1' && j.moveInfos) {
            best = j;
          }
        } catch {
          // JSONでない行は無視
        }
      }
    });

    // エラーもログ化
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => console.error('[katago]', d.trim()));

    // クエリ投入して終了
    child.stdin.write(JSON.stringify(q) + '\n');
    child.stdin.end();

    child.on('close', (code) => {
      if (best) return res.json(best);
      return res
        .status(500)
        .json({ error: 'no result from katago', exitCode: code });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});


    // Healthcheck
    app.get('/healthz', (req, res) => res.send('ok'));

    // TODO: ここに /api/analyze など既存ルートを追加
    // 例:
    // app.post('/api/analyze', handler);

    const PORT = process.env.PORT || 5174;
    app.listen(PORT, () => {
      console.log(`[start] server listening on port ${PORT}`);
    });

  } catch (e) {
    console.error('[start] FATAL: model preparation failed:', e);
    process.exit(1);
  }
}

start().catch(e => {
  console.error('[start] UNCAUGHT:', e);
  process.exit(1);
});
