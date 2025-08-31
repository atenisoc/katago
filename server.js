// server.js — self-heal 版（Shell不要）
import fs from 'fs';
import https from 'https';
import { mkdirSync } from 'fs';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';

// === モデル設定（b6 .txt.gz）===
const MODEL_NAME = 'kata1-b6c96-s50894592-d7380655.txt.gz';
const MODEL_DIRS = [
  '/app/engines/easy_b6/weights',
  '/app/engines/normal_b10/weights',
  '/app/engines/hard_b18/weights',
];

// --- ユーティリティ ---
function fileExists(p){ try { return fs.statSync(p).size > 0; } catch { return false; } }
// 先頭2バイトで gzip 判定（HTML誤保存などを弾く）
function isGzipMagic(p){
  try{
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(2);
    fs.readSync(fd, buf, 0, 2, 0);
    fs.closeSync(fd);
    return buf[0] === 0x1f && buf[1] === 0x8b;
  }catch{ return false; }
}

function downloadWithRedirect(url,dest,{headers={},maxRedirects=5}={}){
  return new Promise((resolve,reject)=>{
    const opts = new URL(url);
    opts.headers = { 'User-Agent':'katago-ui/1.0', ...headers };
    const req = https.get(opts, res=>{
      const s = res.statusCode || 0;
      if([301,302,303,307,308].includes(s)){
        if(maxRedirects<=0) return reject(new Error('Too many redirects'));
        const loc = res.headers.location; if(!loc) return reject(new Error('Redirect w/o Location'));
        res.resume();
        return resolve(downloadWithRedirect(new URL(loc, url).toString(), dest, { headers, maxRedirects:maxRedirects-1 }));
      }
      if(s!==200){ res.resume(); return reject(new Error(`HTTP ${s}`)); }
      const out = fs.createWriteStream(dest);
      res.pipe(out); out.on('finish', ()=> out.close(resolve));
    });
    req.on('error', reject);
  });
}

// 既存ファイルが壊れていても自動で再取得する ensureModel
async function ensureModel(){
  for(const d of MODEL_DIRS) mkdirSync(d, { recursive:true });
  const easy = `${MODEL_DIRS[0]}/${MODEL_NAME}`;
  const urls = [
    `https://media.katagotraining.org/uploaded/networks/models/kata1/${MODEL_NAME}`,
    `https://media.katagotraining.org/networks/${MODEL_NAME}`,
  ];

  // 既存を検証
  if (fileExists(easy)) {
    if (isGzipMagic(easy)) {
      console.log('[start] model already exists (valid gzip)');
    } else {
      console.warn('[start] model exists but invalid; redownloading...');
      try { fs.unlinkSync(easy); } catch {}
    }
  }

  // 必要ならダウンロード
  if (!fileExists(easy)) {
    let ok = false;
    for (const u of urls) {
      try {
        console.log('[start] trying', u);
        await downloadWithRedirect(u, `${easy}.part`);
        fs.renameSync(`${easy}.part`, easy);
        if (!isGzipMagic(easy)) throw new Error('downloaded file is not gzip');
        ok = true; break;
      } catch (e) {
        console.error('[start] failed:', u, e.message || e);
        try { fs.unlinkSync(easy); } catch {}
        try { fs.unlinkSync(`${easy}.part`); } catch {}
      }
    }
    if (!ok) console.error('[start] WARNING: model could not be downloaded; server will still start');
    else {
      // 他難易度にも配布
      for (const dir of [MODEL_DIRS[1], MODEL_DIRS[2]]) {
        try { fs.copyFileSync(easy, `${dir}/${MODEL_NAME}`); } catch {}
      }
      console.log('[start] model ready:', easy);
    }
  }
}

// 失敗してもサーバは起動（無料枠向け）
async function start(){
  try { await ensureModel(); } catch(e){ console.error('[start] non-fatal:', e.message || e); }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit:'1mb' }));

  app.get('/', (_req,res)=> res.type('text/plain').send('KataGo backend is up. Try POST /api/analyze?engine=easy'));
  app.get('/healthz', (_req,res)=> res.send('ok'));

  // 壊れたときに外部から自己修復を叩ける簡単なエンドポイント（Shell不要）
  app.post('/__repair_model', async (_req,res)=>{
    try{
      const easy = `${MODEL_DIRS[0]}/${MODEL_NAME}`;
      try { fs.unlinkSync(easy); } catch {}
      await ensureModel();
      return res.json({ ok:true });
    }catch(e){ return res.status(500).json({ ok:false, error: String(e?.message||e) }); }
  });

  app.post('/api/analyze', async (req,res)=>{
    try{
      const engine = (req.query.engine || 'easy').toString().toLowerCase(); // easy|normal|hard
      const exe = '/app/engines/bin/katago';
      const model = `/app/engines/${engine}_b6/weights/${MODEL_NAME}`;
      const cfg = `/app/engines/${engine}_b6/analysis.cfg`;

      const { boardXSize=19, boardYSize=19, rules='japanese', komi=6.5, moves=[], maxVisits=4 } = req.body || {};
      const child = spawn(exe, ['analysis','-model',model,'-config',cfg], { stdio:['pipe','pipe','pipe'] });
      const q = { id:'req1', boardXSize, boardYSize, rules, komi, moves, maxVisits };

      let best;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk=>{
        for (const line of chunk.split('\n')) {
          const s = line.trim(); if (!s) continue;
          try { const j = JSON.parse(s); if (j.id==='req1' && j.moveInfos) best = j; } catch {}
        }
      });
      child.stderr.on('data', d=> console.error('[katago]', String(d).trim()));
      child.stdin.write(JSON.stringify(q)+'\n'); child.stdin.end();

      child.on('close', code => best ? res.json(best) : res.status(500).json({ error:'no result from katago', exitCode:code }));
    }catch(e){ res.status(500).json({ error:String(e?.message||e) }); }
  });

  const PORT = Number(process.env.PORT) || 5174;
  app.listen(PORT, ()=> console.log(`[start] server listening on port ${PORT}`));
}
start().catch(e=>{ console.error('[start] UNCAUGHT:', e); process.exit(1); });
