/**
 * server.js (multi-engine, robust)
 * - Static hosting for index.html
 * - KataGo engines: easy(b6) / normal(b10) / hard(b18)
 * - /api/analyze?engine=easy|normal|hard
 * - /api/eval 旧互換: 強い方で1回だけ評価（hard→normal→easyの順でフォールバック）
 * - aiComment.js があれば /api/comment で利用
 */

const express   = require("express");
const cors      = require("cors");
const path      = require("path");
const fs        = require("fs");
const { spawn } = require("child_process");
const readline  = require("readline");

require("dotenv").config({ path: ".env.local" });

const app  = express();
const PORT = process.env.PORT || 5173;

app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname))); // 同ディレクトリを静的配信

// ========= Engine definitions =========
const base = path.join(__dirname, "engines");
const ENGINES = {
  easy: {
    exe:   process.env.KATAGO_EASY_EXE   || path.join(base, "bin/katago"),
    model: process.env.KATAGO_EASY_MODEL || path.join(base, "easy_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz"),
    cfg:   process.env.KATAGO_EASY_CFG   || path.join(base, "easy_b6/analysis.cfg"),
  },
  normal: {
    exe:   process.env.KATAGO_NORMAL_EXE   || path.join(base, "bin/katago"),
    model: process.env.KATAGO_NORMAL_MODEL || path.join(base, "normal_b10/weights/g170e-b10c128-s1141046784-d204142634.bin.gz"),
    cfg:   process.env.KATAGO_NORMAL_CFG   || path.join(base, "normal_b10/analysis.cfg"),
  },
  hard: {
    exe:   process.env.KATAGO_HARD_EXE   || path.join(base, "bin/katago"),
    model: process.env.KATAGO_HARD_MODEL || path.join(base, "hard_b18/weights/kata1-b18c256-s1929312256-d418716293.txt.gz"),
    cfg:   process.env.KATAGO_HARD_CFG   || path.join(base, "hard_b18/analysis.cfg"),
  },
};

// ========= Utilities =========
const procs = {};           // name -> { proc, rl, waiters }
const engineMeta = {};      // name -> { backend, modelName, version, katago }
const disabled   = {};      // name -> true if missing files

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function sanitizeEngineName(x) {
  const n = String(x || "").toLowerCase();
  return n === "easy" || n === "hard" ? n : "normal";
}
function logEngine(name, e) {
  console.log(`[${name}] exe=${e.exe}`);
  console.log(`        model=${e.model}`);
  console.log(`        cfg=${e.cfg}`);
}

// 起動前チェック（ファイルが無ければ disable）
for (const [name, e] of Object.entries(ENGINES)) {
  let ok = true;
  if (!exists(e.exe))   { console.warn(`[${name}] missing exe: ${e.exe}`); ok = false; }
  if (!exists(e.cfg))   { console.warn(`[${name}] missing cfg: ${e.cfg}`); ok = false; }
  if (!exists(e.model)) { console.warn(`[${name}] missing model: ${e.model}`); ok = false; }
  if (!ok) {
    disabled[name] = true;
    console.warn(`[${name}] DISABLED (missing files)`);
  }
  logEngine(name, e);
}

// ========= Spawn & talk to KataGo =========
function spawnEngine(name) {
  if (disabled[name]) return;

  const { exe, model, cfg } = ENGINES[name];
  const args = ["analysis", "-model", model, "-config", cfg];
  const proc = spawn(exe, args, { stdio: ["pipe", "pipe", "pipe"] });

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
      m = s.match(/Model name:\s*([\w\-\.]+)/i);
      if (m) (engineMeta[name] ||= {}).modelName = m[1];
      m = s.match(/Model version\s*(\d+)/i);
      if (m) (engineMeta[name] ||= {}).version   = parseInt(m[1], 10);
      m = s.match(/KataGo v(\d+\.\d+\.\d+)/i);
      if (m) (engineMeta[name] ||= {}).katago    = m[1];
    } catch { /* ignore */ }
  });

  proc.on("exit", (code, signal) => {
    console.error(`[${name}] exited: code=${code} signal=${signal}`);
    try { rlOut.close(); rlErr.close(); } catch {}
    // 自動再起動（任意）
    setTimeout(() => { if (!disabled[name]) spawnEngine(name); }, 1500);
  });

  console.log(`[spawned] ${name} -> ${exe}`);
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

// 起動（有効なものだけ）
for (const name of Object.keys(ENGINES)) spawnEngine(name);

// ========= Health =========
app.get("/healthz", (_req, res) => res.status(204).end());
app.get("/engines", (_req, res) => {
  const list = Object.keys(ENGINES).map((name) => ({
    name,
    disabled: !!disabled[name],
    meta: engineMeta[name] || null,
    modelPath: ENGINES[name].model,
  }));
  res.json({ ok: true, engines: list });
});

// ========= API: analyze =========
app.post("/api/analyze", async (req, res) => {
  try {
    const preferred = sanitizeEngineName(req.query.engine || "normal");
    const order = [preferred, "hard", "normal", "easy"]; // フォールバック順（重複は後で除去）
    const tried = new Set();
    for (const n of order) {
      if (tried.has(n)) continue;
      tried.add(n);
      if (!disabled[n] && procs[n] && !procs[n].proc.killed) {
        const payload = { ...req.body };
        if (!payload.rules) payload.rules = "japanese";
        if (typeof payload.komi !== "number") payload.komi = 6.5;
        const out = await askKatago(n, payload);
        let bestMove = null;
        if (Array.isArray(out?.moveInfos) && out.moveInfos.length) {
          bestMove = [...out.moveInfos].sort((a,b)=> (b.visits||0)-(a.visits||0))[0]?.move || null;
        }
        return res.json({
          ok: true,
          engine: n,
          model: ENGINES[n].model,
          modelName: engineMeta[n]?.modelName || null,
          bestMove,
          katago: out,
        });
      }
    }
    return res.status(503).json({ ok:false, error:"no_engine_available" });
  } catch (e) {
    console.error("[/api/analyze] error:", e);
    res.status(500).json({ ok:false, error: String(e?.message ?? e) });
  }
});

// ========= API: eval（旧互換 / 強い方で1回だけ） =========
app.post("/api/eval", async (req, res) => {
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
      try { out = await askKatago(n, payload); used = n; break; }
      catch { /* 次へフォールバック */ }
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

// ========= API: comment（任意機能） =========
let aiComment = null;
try { aiComment = require("./aiComment"); }
catch { console.warn("aiComment.js not found or failed to load."); }

app.post("/api/comment", async (req, res) => {
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

// ========= Start & graceful shutdown =========
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

function shutdown() {
  console.log("Shutting down engines...");
  for (const name of Object.keys(procs)) {
    try { procs[name].proc.kill(); } catch {}
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
