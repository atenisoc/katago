// scripts/setup.js
const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const sh = (cmd) => cp.execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' });

// Render(Nodeランタイム)のアプリルートは /opt/render/project/src
const ROOT = process.cwd();

const BIN_DIR = path.join(ROOT, 'katago');
const ENG_DIR = path.join(ROOT, 'engines');
const EASY    = path.join(ENG_DIR, 'easy_b6');
const NORMAL  = path.join(ENG_DIR, 'normal_b10');
const HARD    = path.join(ENG_DIR, 'hard_b18');

// ディレクトリを作成
for (const d of [
  BIN_DIR,
  path.join(EASY, 'weights'),
  path.join(NORMAL, 'weights'),
  path.join(HARD, 'weights'),
]) fs.mkdirSync(d, { recursive: true });

// 1) KataGo バイナリ（Linux Eigen）
const KVER  = 'v1.16.3';
const FILE  = 'katago-v1.16.3-eigen-linux-x64.tar.gz';
const URL   = `https://github.com/lightvector/KataGo/releases/download/${KVER}/${FILE}`;

sh(`
  set -e
  cd "${BIN_DIR}"
  echo "Downloading KataGo ${KVER}..."
  curl -L -o katago.tgz "${URL}"
  tar xzf katago.tgz
  rm -f katago.tgz
  # 実行ファイルを katago に統一
  find . -type f -name "katago" -print -exec mv {} ./katago \\; || true
  chmod +x ./katago
`);

// 2) 軽量 b6 ウェイト（まずは動作確認用）
const B6_URL = 'https://huggingface.co/datasets/katago/weights/resolve/main/b6/kata1-b6c96-s50894592-d7380655.txt.gz';

sh(`
  set -e
  echo "Downloading b6 weights..."
  curl -L -o "${EASY}/weights/kata1-b6c96-s50894592-d7380655.txt.gz" "${B6_URL}"
  # normal/hard も当面は同じでOK（本番は b10/b18 に差し替え）
  cp "${EASY}/weights/kata1-b6c96-s50894592-d7380655.txt.gz" "${NORMAL}/weights/kata1-b6c96-s50894592-d7380655.txt.gz"
  cp "${EASY}/weights/kata1-b6c96-s50894592-d7380655.txt.gz" "${HARD}/weights/kata1-b6c96-s50894592-d7380655.txt.gz"
`);

// 3) analysis.cfg を生成（最小）
function writeCfg(dir){
  const cfg = `analysisPVLen = 10
maxVisits = 4
numAnalysisThreads = 1
numSearchThreads = 1
reportAnalysisWinratesAs = BLACK
`;
  fs.writeFileSync(path.join(dir, 'analysis.cfg'), cfg);
}
writeCfg(EASY); writeCfg(NORMAL); writeCfg(HARD);

console.log('[setup] done (ROOT=' + ROOT + ')');
