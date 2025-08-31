// server.js — 最小・完成版
import fs from 'fs';
import https from 'https';
import { mkdirSync } from 'fs';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';

// ===== モデル設定（b6 .txt.gz）=====
const MODEL_NAME = 'kata1-b6c96-s50894592-d7380655.txt.gz';
const MODEL_DIRS = [
  '/app/engines/easy_b6/weights',
  '/app/engines/normal_b10/weights',
  '/app/engines/hard_b18/weights',
];

function fileExists(p){ try { return fs.statSync(p).size > 0; } catch { return false; } }

function downloadWithRedirect(url,dest,{headers={},maxRedirects=5}={}){
  return new Promise((resolve,reject)=>{
    const opts=new URL(url); opts.headers={'User-Agent':'katago-ui/1.0',...headers};
    const req=https.get(opts,res=>{
      const s=res.statusCode||0;
      if([301,302,303,307,308].includes(s)){
        if(maxRedirects<=0) return reject(new Error('Too many redirects'));
        const loc=res.headers.location; if(!loc) return reject(new Error('Redirect w/o Location'));
        res.resume();
        return resolve(downloadWithRedirect(new URL(loc,url).toString(),dest,{headers,maxRedirects:maxRedirects-1}));
      }
      if(s!==200){ res.resume(); return reject(new Error('HTTP '+s)); }
      const out=fs.createWriteStream(dest); res.pipe(out); out.on('finish',()=>out.close(resolve));
    });
    req.on('error',reject);
  });
}

async function ensureModel(){
  for(const d of MODEL_DIRS) mkdirSync(d,{recursive:true});
  const target=`${MODEL_DIRS[0]}/${MODEL_NAME}`;
  if(fileExists(target)){ console.log('[start] model already exists'); return; }
  console.log('[start] downloading model ...');
  const KATAGO_PRIMARY=`https://media.katagotraining.org/uploaded/networks/models/kata1/${MODEL_NAME}`;
  const KATAGO_FALLBACK=`https://media.katagotraining.org/networks/${MODEL_NAME}`;
  for(const url of [KATAGO_PRIMARY,KATAGO_FALLBACK]){
    try{
      console.log('[start] trying',url);
      await downloadWithRedirect(url,`${target}.part`);
      fs.renameSync(`${target}.part`,target);
      fs.copyFileSync(target,`${MODEL_DIRS[1]}/${MODEL_NAME}`);
      fs.copyFileSync(target,`${MODEL_DIRS[2]}/${MODEL_NAME}`);
      console.log('[start] model ready:',target);
      return;
    }catch(e){ console.error('[start] failed:',url,e.message||e); }
  }
  console.error('[start] WARNING: model could not be downloaded; server will still start');
}

async function retry(fn,times=3,waitMs=5000){
  let last;
  for(let i=1;i<=times;i++){
    try{ return await fn(); }
    catch(e){ last=e; console.error(`[start] attempt ${i}/${times} failed:`,e.message||e); if(i<times) await new Promise(r=>setTimeout(r,waitMs)); }
  }
  throw last;
}

async function start(){
  await retry(()=>ensureModel(),3,5000);

  const app=express();
  app.use(cors());
  app.use(express.json({limit:'1mb'}));

  // ルート
  app.get('/',(req,res)=>{ res.type('text/plain').send('KataGo backend is up. Try POST /api/analyze?engine=easy'); });
  app.get('/healthz',(req,res)=>res.send('ok'));

  // 解析API（単発）
  app.post('/api/analyze',async(req,res)=>{
    try{
      const engine=(req.query.engine||'easy').toString().toLowerCase(); // easy|normal|hard
      const exe='/app/engines/bin/katago';
      const model=`/app/engines/${engine}_b6/weights/${MODEL_NAME}`;
      const cfg=`/app/engines/${engine}_b6/analysis.cfg`;

      const {boardXSize=19,boardYSize=19,rules='japanese',komi=6.5,moves=[],maxVisits=4}=req.body||{};
      const child=spawn(exe,['analysis','-model',model,'-config',cfg],{stdio:['pipe','pipe','pipe']});
      const q={id:'req1',boardXSize,boardYSize,rules,komi,moves,maxVisits};

      let best;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{
        for(const line of chunk.split('\n')){
          const s=line.trim(); if(!s) continue;
          try{ const j=JSON.parse(s); if(j.id==='req1' && j.moveInfos) best=j; }catch{}
        }
      });
      child.stderr.on('data',d=>console.error('[katago]',String(d).trim()));
      child.stdin.write(JSON.stringify(q)+'\n'); child.stdin.end();

      child.on('close',code=> best?res.json(best):res.status(500).json({error:'no result from katago',exitCode:code}));
    }catch(e){ res.status(500).json({error:String(e?.message||e)}); }
  });

  const PORT=Number(process.env.PORT)||5174;
  app.listen(PORT,()=>console.log(`[start] server listening on port ${PORT}`));
}

start().catch(e=>{ console.error('[start] UNCAUGHT:',e); process.exit(1); });
