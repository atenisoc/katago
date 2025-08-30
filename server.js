/**
 * server.js — multi-engine KataGo API + static (Render/Local friendly)
 *
 * - Binds to 0.0.0.0:$PORT (Render OK). Local default 5173
 * - /healthz         : health check (returns 503 until *all* engines are ready)
 * - /api/engines     : list engines and metadata
 * - /api/analyze     : KataGo analysis (engine=easy|normal|hard)
 * - /api/eval        : single eval using strongest available
 * - /api/comment     : optional comment (fallback if missing)
 * - Static hosting   : mounted LAST to avoid route collisions
 */

// -------------------- Imports --------------------
// ---- requires (一意) ----
const express   = require('express');
const cors      = require('cors');
const fs        = require('fs');
const path      = require('path');
const { spawn } = require('child_process');
const readline  = require('readline');

// もし起動時ダウンロードを入れているなら、このブロックも “重複なし” で一度だけ
const https = require('https');
const { pipeline, Writable } = require('stream');
const { promisify } = require('util');
const zlib = require('zlib');
const pipe = promisify(pipeline);


async function downloadWithFallback(destPath, urls) {
  for (const url of urls) {
    try {
      await new Promise((resolve, reject) => {
        const req = https.get(url, { headers: { 'Accept': 'application/octet-stream', 'User-Agent': 'curl/8' } }, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            res.resume();
            return;
          }
          // 一時ファイルへ保存
          const tmp = destPath + '.part';
          const out = createWriteStream(tmp);
          res.pipe(out);
          out.on('finish', async () => {
            // gzip 検証（展開テスト）
            try {
              await streamPipeline(
                require('fs').createReadStream(tmp),
                zlib.createGunzip(), 
                require('stream').Writable({ write(c, e, cb){ cb(); } })
              );
              // OKなら本番ファイルへ
              require('fs').renameSync(tmp, destPath);
              resolve();
            } catch (e) {
              try { unlinkSync(tmp); } catch {}
              reject(new Error(`gzip verify failed: ${e.message}`));
            }
          });
          out.on('error', (e) => { try { unlinkSync(tmp); } catch {} ; reject(e); });
        });
        req.on('error', reject);
      });
      return; // 成功
    } catch (e) {
      console.warn(`[weights] failed ${url}: ${e.message}`);
    }
  }
  throw new Error('All mirrors failed for weights');
}

async function ensureWeights() {
  const base = path.join(__dirname, 'engines');
  const FNAME = 'kata1-b6c96-s50894592-d7380655.txt.gz';
  const targets = [
    path.join(base, 'easy_b6', 'weights', FNAME),
    path.join(base, 'normal_b10', 'weights', FNAME),
    path.join(base, 'hard_b18', 'weights', FNAME),
  ];
  // 必要ディレクトリ
  for (const t of targets) mkdirSync(path.dirname(t), { recursive: true });

  // どれか1つでも無ければ easy に落としてコピー
  const easyPath = targets[0];
  if (!existsSync(easyPath)) {
    const mirrors = [
      // HFはたまに401/認証が要るので複数ミラーを順に試す
      'https://huggingface.co/datasets/katago/weights/resolve/main/b6/kata1-b6c96-s50894592-d7380655.txt.gz?download=1',
      'https://huggingface.co/datasets/katago/weights/resolve/main/b6/kata1-b6c96-s50894592-d7380655.txt.gz',
      // 追加ミラー（必要なら後で差し替え）
      // 'https://your-mirror.example.com/kata1-b6c96-s50894592-d7380655.txt.gz',
    ];
    console.log('[weights] downloading b6 weights...');
    await downloadWithFallback(easyPath, mirrors);
  }
  // コピー（存在しなければ）
  const fs = require('fs');
  for (let i = 1; i < targets.length; i++) {
    if (!existsSync(targets[i])) fs.copyFileSync(easyPath, targets[i]);
  }
  console.log('[weights] ready:', targets.map(p => (existsSync(p) ? 'ok' : 'missing')).join(', '));
}


// -------------------- App Basics --------------------
if (process.env.NODE_ENV !== "production") {
  try { require("dotenv").config({ path: ".env.local" }); } catch {}
}

const app  = express();
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || "0.0.0.0";

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

console.log("[boot] using file:", __filename);

// Debug: log API hits
app.all("/api/*", (req, _res, next) => { console.log(`[hit] ${req.method} ${req.path}`); next(); });

// -------------------- Engine Config --------------------
const ENGINE_NAMES = ["easy", "normal", "hard"];
const base = path.join(__dirname, "engines");
const ENGINES = {
  easy: {
    exe:   process.env.KATAGO_EASY_EXE   || path.join(base, "bin/katago"),
    model: process.env.KATAGO_EASY_MODEL || path.join(base, "easy_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz"),
    cfg:   process.env.KATAGO_EASY_CFG   || path.join(base, "easy_b6/analysis.cfg"),
  },
  normal: {
    exe:   process.env.KATAGO_NORMAL_EXE   || path.join(base, "bin/katago"),
    // NOTE: default points to b6 network to match common distro; override via env for true b10
    model: process.env.KATAGO_NORMAL_MODEL || path.join(base, "normal_b10/weights/kata1-b6c96-s175395328-d26788732.txt.gz"),
    cfg:   process.env.KATAGO_NORMAL_CFG   || path.join(base, "normal_b10/analysis.cfg"),
  },
  hard: {
    exe:   process.env.KATAGO_HARD_EXE   || path.join(base, "bin/katago"),
    model: process.env.KATAGO_HARD_MODEL || path.join(base, "hard_b18/weights/kata1-b10c128-s1141046784-d204142634.txt.gz"),
    cfg:   process.env.KATAGO_HARD_CFG   || path.join(base, "hard_b18/analysis.cfg"),
  },
};

// -------------------- Utilities --------------------
const procs = {};           // name -> { proc, rl, waiters }
const engineMeta = {};      // name -> { backend, modelName, version, katago }
const disabled   = {};      // name -> true if missing files or spawn failed
const engineReady = { easy:false, normal:false, hard:false }; // becomes true after warmup success

function logReady() {
  console.log(`[ready] easy=${engineReady.easy} normal=${engineReady.normal} hard=${engineReady.hard}`);
}
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function sanitizeEngineName(x) {
  const n = String(x || "").toLowerCase();
  return n === "easy" || n === "hard" ? n : "normal";
}
function resolveExe(p) {
  if (process.platform === "win32") {
    if (exists(p)) return p;
    if (exists(p + ".exe")) return p + ".exe";
    return "katago"; // fall back to PATH
  }
  return p;
}
function logEngine(name, e, resolvedExe) {
  console.log(`[${name}] exe=${resolvedExe || e.exe}`);
  console.log(`        model=${e.model}`);
  console.log(`        cfg=${e.cfg}`);
}

// Pre-flight: ensure config and model exist
for (const [name, e] of Object.entries(ENGINES)) {
  let ok = true;
  if (!exists(e.cfg))   { console.warn(`[${name}] missing cfg: ${e.cfg}`); ok = false; }
  if (!exists(e.model)) { console.warn(`[${name}] missing model: ${e.model}`); ok = false; }
  if (!ok) {
    disabled[name] = true;
    console.warn(`[${name}] DISABLED (missing files)`);
  }
  logEngine(name, e, resolveExe(e.exe));
}

// -------------------- Spawn & IPC --------------------
function spawnEngine(name) {
  if (disabled[name]) return;
  const { exe, model, cfg } = ENGINES[name];
  const exePath = resolveExe(exe);
  const args = ["analysis", "-model", model, "-config", cfg];
  const proc = spawn(exePath, args, { stdio: ["pipe", "pipe", "pipe"] });

  const rlOut = readline.createInterface({ input: proc.stdout });
  const rlErr = readline.createInterface({ input: proc.stderr, crlfDelay: Infinity });
  const waiters = new Map();
  procs[name] = { proc, rl: rlOut, waiters };

  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");

  rlOut.on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    const id = msg?.id;
    if (id && waiters.has(id)) {
      const { resolve } = waiters.get(id);
      waiters.delete(id);
      resolve(msg);
    }
  });

  rlErr.on("line", (line) => {
    const s = String(line).trim();
    if (!s) return;
    console.error(`[${name}] ${s}`);
    try {
      let m;
      m = s.match(/backend\s*(.*)thread/i);
      if (m) (engineMeta[name] ||= {}).backend   = m[1].trim();
      m = s.match(/Model name:\s*([\w\-.]+)/i);
      if (m) (engineMeta[name] ||= {}).modelName = m[1];
      m = s.match(/Model version\s*(\d+)/i);
      if (m) (engineMeta[name] ||= {}).version   = parseInt(m[1], 10);
      m = s.match(/KataGo v(\d+\.\d+\.\d+)/i);
      if (m) (engineMeta[name] ||= {}).katago    = m[1];
    } catch {}
  });

  proc.on("error", (err) => {
    console.error(`[${name}] spawn error: ${err.message}`);
    disabled[name] = true;
  });

  proc.on("exit", (code, signal) => {
    console.error(`[${name}] exited: code=${code} signal=${signal}`);
    try { rlOut.close(); rlErr.close(); } catch {}
    engineReady[name] = false; // must re-warm if it respawns
    setTimeout(() => { if (!disabled[name]) spawnEngine(name); }, 1500);
  });

  console.log(`[spawned] ${name} -> ${exePath}`);
}

function askKatago(name, payload, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const eng = procs[name];
    if (!eng || !eng.proc || eng.proc.killed) {
      return reject(new Error(`engine "${name}" is not running`));
    }
    const id = `req_${Math.random().toString(36).slice(2)}`;
    eng.waiters.set(id, { resolve, reject });
    try {
      eng.proc.stdin.write(JSON.stringify({ ...payload, id }) + "\n");
    } catch (e) {
      eng.waiters.delete(id);
      return reject(e);
    }
    setTimeout(() => {
      if (eng.waiters.has(id)) {
        eng.waiters.delete(id);
        reject(new Error(`engine "${name}" timeout`));
      }
    }, timeoutMs);
  });
}

// Start engines now
for (const name of Object.keys(ENGINES)) spawnEngine(name);

// -------------------- Engine Warmup --------------------
async function warmupEngine(name) {
  if (disabled[name]) return;
  const tries = [1000, 2000, 4000, 8000, 12000]; // backoff schedule
  const payload = { boardXSize: 9, boardYSize: 9, rules: "japanese", komi: 6.5, moves: [], maxVisits: 1 };
  for (const waitMs of tries) {
    await new Promise(r => setTimeout(r, waitMs));
    try {
      await askKatago(name, payload, 10000);
      engineReady[name] = true;
      logReady();
      return;
    } catch {}
  }
  console.warn(`[warmup] ${name} not ready after retries`);
}

// Kick off warmups (non-blocking)
for (const e of ENGINE_NAMES) warmupEngine(e);

// -------------------- Health Check --------------------
app.get("/healthz", (_req, res) => {
  const allReady = ENGINE_NAMES.every(e => engineReady[e]);
  if (allReady) res.status(200).send("ok");
  else res.status(503).send("warming");
});

// -------------------- API Routes --------------------
const api = express.Router();

api.get("/engines", (_req, res) => {
  const list = Object.keys(ENGINES).map((name) => ({
    name,
    disabled: !!disabled[name],
    meta: engineMeta[name] || null,
    modelPath: ENGINES[name].model,
    ready: !!engineReady[name],
  }));
  res.type("application/json").json({ ok: true, engines: list });
});

// middleware: if preferred engine not ready yet → 503 with Retry-After
api.use("/analyze", (req, res, next) => {
  const engine = (req.query.engine || "easy").toString();
  if (!engineReady[engine]) {
    res.set("Retry-After", "2");
    return res.status(503).json({ ok:false, error:`engine ${engine} warming` });
  }
  next();
});

api.post("/analyze", async (req, res) => {
  try {
    const preferred = sanitizeEngineName(req.query.engine || "normal");
    const order = [preferred, "hard", "normal", "easy"]; // fallback chain
    const tried = new Set();
    for (const n of order) {
      if (tried.has(n)) continue; tried.add(n);
      if (!disabled[n] && procs[n] && !procs[n].proc.killed) {
        const payload = { ...req.body };
        if (!payload.rules) payload.rules = "japanese";
        if (typeof payload.komi !== "number") payload.komi = 6.5;
        const out = await askKatago(n, payload);
        let bestMove = null;
        if (Array.isArray(out?.moveInfos) && out.moveInfos.length) {
          bestMove = [...out.moveInfos].sort((a,b)=> (b.visits||0)-(a.visits||0))[0]?.move || null;
        }
        return res.json({ ok:true, engine:n, model:ENGINES[n].model, modelName:engineMeta[n]?.modelName || null, bestMove, katago: out });
      }
    }
    return res.status(503).json({ ok:false, error:"no_engine_available" });
  } catch (e) {
    console.error("[/api/analyze] error:", e);
    res.status(500).json({ ok:false, error: String(e?.message ?? e) });
  }
});

api.post("/eval", async (req, res) => {
  try {
    const chain = ["hard", "normal", "easy"].filter(n => !disabled[n] && procs[n] && !procs[n].proc.killed);
    if (!chain.length) return res.status(503).json({ ok:false, error:"no_engine_available" });

    const payload = { ...req.body };
    if (!payload.rules) payload.rules = "japanese";
    if (typeof payload.komi !== "number") payload.komi = 6.5;
    if (typeof payload.maxVisits !== "number") payload.maxVisits = 128;
    payload.includeOwnership = false;

    let out = null, used = null;
    for (const n of chain) {
      try { out = await askKatago(n, payload); used = n; break; } catch {}
    }
    if (!out) return res.status(500).json({ ok:false, error:"all_engines_failed" });

    const root = out?.rootInfo || {};
    const top  = (out?.moveInfos || [])[0] || {};
    return res.json({
      ok: true,
      engine: used,
      model: ENGINES[used].model,
      modelName: engineMeta[used]?.modelName || null,
      winrateBlack: (typeof root.winrate === "number") ? root.winrate : null,
      scoreLead:   (typeof root.scoreLead === "number") ? root.scoreLead : null,
      pv: Array.isArray(top.pv) ? top.pv : [],
      katago: out,
    });
  } catch (e) {
    console.error("[/api/eval] error:", e);
    res.status(500).json({ ok:false, error: String(e?.message ?? e) });
  }
});

let aiComment = null;
try { aiComment = require("./aiComment"); }
catch { console.warn("aiComment.js not found or failed to load."); }

api.post("/comment", async (req, res) => {
  try {
    if (!aiComment?.generateComment) {
      return res.json({ text: "（コメント機能は現在オフラインです）" });
    }
    const { skeleton, banPhrases, lengthHint } = req.body || {};
    const text = await aiComment.generateComment({ skeleton, banPhrases, lengthHint });
    res.json({ text });
  } catch (e) {
    console.error("[/api/comment] error:", e);
    res.status(500).json({ error: "openai_failed", detail: String(e?.message ?? e) });
  }
});

// Mount /api first
app.use("/api", api);

// -------------------- Start & Static --------------------
const server = app.listen(PORT, HOST, () => {
  const addr = server.address();
  let shown = `port ${PORT}`;
  if (addr && typeof addr === "object" && "address" in addr && "port" in addr) {
    shown = `http://${addr.address}:${addr.port}`;
  } else if (typeof addr === "string") shown = addr;
  console.log(`Server listening on ${shown}`);
});

server.on("error", (err) => {
  console.error("[server] listen error:", err.message);
});

// Static LAST (once)
app.use(express.static(path.join(__dirname), { redirect: false }));

function shutdown() {
  console.log("Shutting down engines...");
  for (const name of Object.keys(procs)) {
    try { procs[name].proc.kill(); } catch {}
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
