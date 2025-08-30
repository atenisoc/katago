// downloads kataGo (linux eigen) + sample weights to /app on Render
const fs = require('fs'), cp = require('child_process'), path = require('path');
const sh = (cmd) => cp.execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });

const APP = process.env.RENDER ? '/app' : __dirname; // Renderでは /app
const ROOT = path.resolve(APP, '..'); // /app/scripts -> /app

const BIN_DIR = path.join(ROOT, 'katago');
const ENG_DIR = path.join(ROOT, 'engines');
const EASY = path.join(ENG_DIR, 'easy_b6');
const NORMAL = path.join(ENG_DIR, 'normal_b10');
const HARD = path.join(ENG_DIR, 'hard_b18');

fs.mkdirSync(BIN_DIR, { recursive: true });
fs.mkdirSync(path.join(EASY, 'weights'), { recursive: true });
fs.mkdirSync(path.join(NORMAL, 'weights'), { recursive: true });
fs.mkdirSync(path.join(HARD, 'weights'), { recursive: true });

// 1) katago (linux eigen)
sh(`
  set -e
  cd "${BIN_DIR}"
  KVER="v1.16.3"
  FILE="katago-v1.16.3-eigen-linux-x64.tar.gz"
  URL="https://github.com/lightvector/KataGo/releases/download/${KVER}/${FILE}"
  curl -L -o katago.tgz "$URL"
  tar xzf katago.tgz
  rm -f katago.tgz
  # 対応バイナリ名を katago に揃える
  find . -type f -name "katago" -print -exec mv {} ./katago \\;
  chmod +x ./katago
`);

// 2) sample weights（b6 & b10c128 1本ずつ）
sh(`
  set -e
  cd "${ENG_DIR}"
  # ここでは例として公開ミラーの軽量モデルを仮定（実運用は自前のURLに差し替えを推奨）
  # easy(b6)
  echo "Downloading b6..."
  curl -L -o "${EASY}/weights/kata1-b6c96-s50894592-d7380655.txt.gz" "https://huggingface.co/datasets/katago/weights/resolve/main/b6/kata1-b6c96-s50894592-d7380655.txt.gz"
  # normal/hard も同じファイルで可（動作確認用）。本番はb10/b18に置換してください。
  cp "${EASY}/weights/kata1-b6c96-s50894592-d7380655.txt.gz" "${NORMAL}/weights/kata1-b6c96-s50894592-d7380655.txt.gz"
  cp "${EASY}/weights/kata1-b6c96-s50894592-d7380655.txt.gz" "${HARD}/weights/kata1-b6c96-s50894592-d7380655.txt.gz"
`);

// 3) analysis.cfg を置く（最小構成）
function writeCfg(dir){
  const cfg = `analysisPVLen = 10
maxVisits = 4
numAnalysisThreads = 1
numSearchThreads = 1
reportAnalysisWinratesAs = BLACK
`; fs.writeFileSync(path.join(dir, 'analysis.cfg'), cfg);
}
writeCfg(EASY); writeCfg(NORMAL); writeCfg(HARD);

console.log('[setup] done');
