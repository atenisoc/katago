// server.js
// ========== KataGo UI Runtime Entrypoint ==========

import fs from 'fs';
import https from 'https';
import { mkdirSync } from 'fs';
import express from 'express';

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
