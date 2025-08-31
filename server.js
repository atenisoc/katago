// server.js
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const path = require('path');
const express = require('express');
const cors = require('cors');
require('dotenv').config({ path: process.env.DOTENV_PATH || '.env.local', override: true });

const app = express();
app.use(cors());
app.use(express.json());

// -------- util: sync exec (promise) ----------
function sh(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => out += d.toString());
    p.stderr.on('data', d => err += d.toString());
    p.on('close', code => code === 0 ? resolve({ out, err }) : reject(new Error(err || `exit ${code}`)));
  });
}

// -------- model helpers ----------
function fileOk(file) {
  try {
    const st = fs.statSync(file);
    return st.size > 1024; // 1KB 以下は壊れとみなす
  } catch {
    return false;
  }
}

async function tryDownload(url, dest) {
  // curl でダウンロード → gzip -t で検証
  console.log(`[boot] downloading: ${url}`);
  try {
    await sh('curl', ['-fL', '--retry', '5', '-o', dest, url]);
    await sh('gzip', ['-t', dest]); // 壊れてたら非0で落ちる
    return true;
  } catch (e) {
    console.error(`[boot] download failed: ${url} -> ${e.message}`);
    try { fs.unlinkSync(dest); } catch {}
    return false;
  }
}

async function ensureModel(localPath, urlsCsv) {
  if (fileOk(localPath)) {
    console.log(`[boot] model ok: ${localPath}`);
    return;
  }
  const dir = path.dirname(localPath);
  fs.mkdirSync(dir, { recursive: true });

  const urls = (urlsCsv || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const u of urls) {
    if (await tryDownload(u, localPath)) {
      console.log(`[boot] model saved: ${localPath}`);
      return;
    }
  }
  throw new Error(`failed to obtain model. tried: ${urls.join(' , ')}`);
}

// -------- engines config ----------
const ENGINES = [
  {
    name: 'easy',
    exe: process.env.KATAGO_EASY_EXE || 'katago',
    model: process.env.KATAGO_EASY_MODEL,
    cfg: path.resolve('engines/easy_b6/analysis.cfg')
  },
  {
    name: 'normal',
    exe: process.env.KATAGO_NORMAL_EXE || 'katago',
    model: process.env.KATAGO_NORMAL_MODEL,
    cfg: path.resolve('engines/normal_b10/analysis.cfg')
  },
  {
    name: 'hard',
    exe: process.env.KATAGO_HARD_EXE || 'katago',
    model: process.env.KATAGO_HARD_MODEL,
    cfg: path.resolve('engines/hard_b18/analysis.cfg')
  }
];

const MODEL_URLS = process.env.KATAGO_MODEL_URLS || '';

// 起動時：モデルを用意（足りなければDL）
(async () => {
  try {
    for (const e of ENGINES) {
      if (!e.model) throw new Error('env KATAGO_*_MODEL not set');
      await ensureModel(e.model, MODEL_URLS);
    }
    console.log('[boot] all models ready');
    start();
  } catch (e) {
    console.error('[boot] fatal:', e.message);
    // サーバーは一応立て、/healthz で失敗を返す
    app.get('/healthz', (_req, res) => res.status(500).send(`model-missing: ${e.message}`));
    app.listen(process.env.PORT || 5174, '0.0.0.0', () =>
      console.log(`Server listening on http://0.0.0.0:${process.env.PORT || 5174}`));
  }
})();

function start() {
  console.log('[boot] starting engines…');

  const procs = new Map();
  function spawnEngine(e) {
    console.log(`[spawn] ${e.name} -> ${e.exe}`);
    const p = spawn(e.exe, [
      'analysis',
      '-model', e.model,
      '-config', e.cfg
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    p.stdout.on('data', d => process.stdout.write(`[${e.name}] ${d}`));
    p.stderr.on('data', d => process.stderr.write(`[${e.name}] ${d}`));
    p.on('exit', (code, signal) => {
      console.error(`[${e.name}] exited: code=${code} signal=${signal}`);
      // 少し待って自動再起動（モデルに一時的にアクセス不可でも復旧可）
      setTimeout(() => spawnEngine(e), 1500);
    });
    procs.set(e.name, p);
  }

  ENGINES.forEach(spawnEngine);

  // ---- routes ----
  app.get('/healthz', (_req, res) => res.send('ok'));

  app.get('/api/engines', (_req, res) => {
    res.json({
      ok: true,
      engines: ENGINES.map(e => ({
        name: e.name,
        disabled: false,
        meta: { katago: '1.16.3', backend: 'Eigen', version: 8, modelName: path.basename(e.model) },
        modelPath: e.model,
        ready: fileOk(e.model)
      }))
    });
  });

  // 既存の /api/analyze /api/eval 等はあなたの実装そのままでOK
  // （ここに来る時点でモデル/エンジンは存在・起動済み）
  // ・・・既存のハンドラ（省略）・・・
  // 例）
  app.post('/api/eval', async (req, res) => {
    try {
      // あなたの既存処理…
      res.json({ ok: true, note: 'implement your eval here' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.listen(process.env.PORT || 5174, '0.0.0.0', () =>
    console.log(`Server listening on http://0.0.0.0:${process.env.PORT || 5174}`));
}
