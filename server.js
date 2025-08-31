// server.js
// ====== KataGo UI Runtime Entrypoint ======

import fs from 'fs';
import https from 'https';
import { mkdirSync } from 'fs';
import express from 'express';   // ← あなたの既存サーバのフレームワークに合わせて

// ================= モデル準備ユーティリティ =================

const MODEL_NAME = 'kata1-b6c96-s50894592-d7380655.bin.gz';
const MODEL_DIRS = [
  '/app/engines/easy_b6/weights',
  '/app/engines/normal_b10/weights',
  '/app/engines/hard_b18/weights',
];
const CDN_URL = `https://media.katagotraining.org/networks/${MODEL_NAME}`;

function fileExists(p) {
  try { return fs.statSync(p).size > 0; } catch { return false; }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

async function ensureModel() {
  for (const dir of MODEL_DIRS) mkdirSync(dir, { recursive: true });
  const target = `${MODEL_DIRS[0]}/${MODEL_NAME}`;
  if (!fileExists(target)) {
    console.log('[start] downloading model ...');
    await download(CDN_URL, `${target}.part`);
    fs.renameSync(`${target}.part`, target);
    // 他難易度へコピー
    fs.copyFileSync(target, `${MODEL_DIRS[1]}/${MODEL_NAME}`);
    fs.copyFileSync(target, `${MODEL_DIRS[2]}/${MODEL_NAME}`);
    console.log('[start] model ready:', target);
  } else {
    console.log('[start] model already exists');
  }
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
    await retry(() => ensureModel(), 5, 5000);

    // Express サーバ起動（既存の処理に置き換えてOK）
    const app = express();

    // 簡易 healthz
    app.get('/healthz', (req, res) => res.send('ok'));

    // ここに /api/analyze など既存のルーティングを追加

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
