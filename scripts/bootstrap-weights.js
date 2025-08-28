// scripts/bootstrap-weights.js
const fs = require('fs');
const nodePath = require('path');
const https = require('https');

const WDIR = nodePath.join(__dirname, '..', 'engines', 'weights');
fs.mkdirSync(WDIR, { recursive: true });

function download(url, out) {
  return new Promise((resolve) => {
    const file = fs.createWriteStream(out);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        console.warn(`[bootstrap] WARN ${res.statusCode} for ${url}`);
        try { fs.unlinkSync(out); } catch {}
        return resolve(false);
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(true)));
    }).on('error', err => {
      console.warn(`[bootstrap] WARN ${url} -> ${err.message}`);
      try { fs.unlinkSync(out); } catch {}
      resolve(false);
    });
  });
}

async function ensure(name, url) {
  const out = nodePath.join(WDIR, name);
  if (fs.existsSync(out)) {
    console.log(`[bootstrap] ${name} already exists`);
    return true;
  }
  console.log(`[bootstrap] downloading ${url}`);
  const ok = await download(url, out);
  if (!ok) console.warn(`[bootstrap] failed to fetch ${name} (continuing without it)`);
  return ok;
}

(async () => {
  // 軽釁E 6b (kata1 b6) そ�Eまま
  await ensure(
    'kata1-b6c96-s50894592-d7380655.txt.gz',
    'https://media.katagotraining.org/uploaded/networks/kata1/kata1-b6c96-s50894592-d7380655.txt.gz'
  );

  // 通常: 10b (g170e)  E旧小型ネット、EPU でも回せる強ぁEサイズのバランス
  await ensure(
    'g170e-b10c128-s1141046784-d204142634.bin.gz',
    'https://media.katagotraining.org/uploaded/networks/g170e/g170e-b10c128-s1141046784-d204142634.bin.gz'
  );

  // 重い: 15b (g170e)  E忁E��なら使ぁE��EPU では重いので任愁E
  // await ensure(
  //   'g170e-b15c192-s1672170752-d466197061.bin.gz',
  //   'https://media.katagotraining.org/uploaded/networks/g170e/g170e-b15c192-s1672170752-d466197061.bin.gz'
  // );

  console.log('[bootstrap] done');
  // ダウンロード失敗があっても�Eロセスは成功終亁E
  process.exit(0);
})();
