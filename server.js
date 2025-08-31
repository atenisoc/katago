// ---- 追加ここから ----
import fs from 'fs';
import https from 'https';
import { mkdirSync } from 'fs';

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
// ---- 追加ここまで ----
