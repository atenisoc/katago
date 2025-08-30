// scripts/setup.js
const { execSync } = require("child_process");
const path = require("path");

function sh(cmd) {
  console.log(cmd);
  execSync(cmd, { stdio: "inherit", shell: "/bin/bash" });
}

// KataGo のバージョン
const VERSION = "1.16.3";
const URL = `https://github.com/lightvector/KataGo/releases/download/v${VERSION}/katago-v${VERSION}-eigen-linux-x64.zip`;

const KATAGO_DIR = path.join("/opt/render/project/src/katago");

sh(`
  set -e
  mkdir -p "${KATAGO_DIR}"
  cd "${KATAGO_DIR}"
  echo "Downloading KataGo v${VERSION} (Eigen, Linux x64)..."
  curl -fL -o katago.zip "${URL}"
  
  # サイズチェック (1MB未満なら失敗扱い)
  if [ $(stat -c%s katago.zip) -lt 1000000 ]; then
    echo "Download failed: file too small"
    exit 1
  fi

  unzip -o katago.zip
  rm -f katago.zip

  # 実行ファイルを katago に統一
  KATAGO_PATH=$(find . -type f -name "katago" | head -n1)
  if [ -z "$KATAGO_PATH" ]; then
    echo "Error: katago binary not found after unzip"
    exit 1
  fi
  mv "$KATAGO_PATH" ./katago
  chmod +x ./katago
`);

console.log("KataGo setup completed.");
