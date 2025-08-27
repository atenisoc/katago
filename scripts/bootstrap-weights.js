// scripts/bootstrap-weights.js
// 起動時に KataGo の重みが無ければダウンロードします。
// 既に存在する場合は何もしません。

const fs = require('fs');
const path = require('path');
const https = require('https');

const plans = [
  {
    name: 'easy_b6',
    file: 'kata1-b6c96-s50894592-d7380655.txt.gz',
    url:  'https://media.katagotraining.org/uploaded/networks/kata1/kata1-b6c96-s50894592-d7380655.txt.gz'
  },
  {
    name: 'normal_b10',
    file: 'kata1-b10c128-s1141046784-d204142634.txt.gz',
    url:  'https://media.katagotraining.org/uploaded/networks/kata1/kata1-b10c128-s1141046784-d204142634.txt.gz'
  },
  {
    name: 'hard_b18',
    file: 'kata1-b18c256-s1929312256-d418716293.txt.gz',
    url:  'https://media.katagotraining.org/uploaded/networks/kata1/kata1-b18c256-s1929312256-d418716293.txt.gz'
  }
];

function download(url, dst) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dst);
    https.get(url, res => {
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

(async () => {
  for (const p of plans) {
    const dir = path.join(__dirname, '..', 'engines', p.name, 'weights');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const dst = path.join(dir, p.file);
    if (fs.existsSync(dst)) {
      console.log(`[bootstrap] ${p.name} weight already exists:`, p.file);
      continue;
    }
    console.log('[bootstrap] downloading', p.url);
    await download(p.url, dst);
    console.log('[bootstrap] downloaded ->', dst);
  }
  console.log('[bootstrap] done');
})().catch(e => {
  console.error('[bootstrap] failed:', e);
  process.exit(1);
});
