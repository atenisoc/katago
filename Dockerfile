# ---------- Build stage: build KataGo (Eigen/CPU) ----------
FROM ubuntu:22.04 AS katago-build

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
  git build-essential cmake curl python3 \
  libzip-dev libeigen3-dev zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

# KataGo v1.16.3 をソースビルド（Eigen/CPU）
WORKDIR /src
RUN git clone --depth=1 --branch v1.16.3 https://github.com/lightvector/KataGo.git
WORKDIR /src/KataGo/cpp
RUN mkdir build && cd build && \
  cmake -DUSE_BACKEND=EIGEN -DCMAKE_BUILD_TYPE=Release .. && \
  cmake --build . -j"$(nproc)"

# ---------- Runtime stage: Node server + KataGo ----------
FROM node:20-slim

# 実行時に必要な共有ライブラリ（libzip4 等）とツール
RUN apt-get update && apt-get install -y \
    ca-certificates curl \
    libzip4 zlib1g libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存解決（キャッシュ効かせるために先に package.*）
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --omit=dev

# アプリ本体
COPY . .

# ディレクトリ準備
RUN mkdir -p /app/engines/bin \
    /app/engines/easy_b6/weights \
    /app/engines/normal_b10/weights \
    /app/engines/hard_b18/weights

# ビルド成果物（katago 実行ファイル）を配置＆動作確認
COPY --from=katago-build /src/KataGo/cpp/build/katago /app/engines/bin/katago
RUN chmod +x /app/engines/bin/katago && /app/engines/bin/katago version

# 軽量ネット (b6) を取得（公式ミラー + 検証 + bin.gz フォールバック）
# - まず .txt.gz を取得して gzip -t で検証
# - 失敗したら .bin.gz を取得して検証
# - どちらを使ったかに応じて /etc/environment と ENV を整合させる
RUN set -eux; \
  EASY_DIR="/app/engines/easy_b6/weights"; \
  NORM_DIR="/app/engines/normal_b10/weights"; \
  HARD_DIR="/app/engines/hard_b18/weights"; \
  F_TXT="kata1-b6c96-s50894592-d7380655.txt.gz"; \
  F_BIN="kata1-b6c96-s50894592-d7380655.bin.gz"; \
  URL_TXT="https://media.katagotraining.org/uploaded/networks/models/kata1/${F_TXT}"; \
  URL_BIN="https://media.katagotraining.org/uploaded/networks/models/kata1/${F_BIN}"; \
  mkdir -p "$EASY_DIR" "$NORM_DIR" "$HARD_DIR"; \
  echo "Downloading ${F_TXT} ..."; \
  if curl -fL --retry 5 -o "${EASY_DIR}/${F_TXT}" "$URL_TXT" && gzip -t "${EASY_DIR}/${F_TXT}"; then \
    ln -sf "${EASY_DIR}/${F_TXT}" "${NORM_DIR}/${F_TXT}"; \
    ln -sf "${EASY_DIR}/${F_TXT}" "${HARD_DIR}/${F_TXT}"; \
    echo "KATAGO_EASY_MODEL=${EASY_DIR}/${F_TXT}"   >> /etc/environment; \
    echo "KATAGO_NORMAL_MODEL=${NORM_DIR}/${F_TXT}" >> /etc/environment; \
    echo "KATAGO_HARD_MODEL=${HARD_DIR}/${F_TXT}"   >> /etc/environment; \
  else \
    echo "txt.gz failed; trying ${F_BIN} ..."; \
    rm -f "${EASY_DIR}/${F_TXT}" || true; \
    curl -fL --retry 5 -o "${EASY_DIR}/${F_BIN}" "$URL_BIN"; \
    gzip -t "${EASY_DIR}/${F_BIN}"; \
    ln -sf "${EASY_DIR}/${F_BIN}" "${NORM_DIR}/${F_BIN}"; \
    ln -sf "${EASY_DIR}/${F_BIN}" "${HARD_DIR}/${F_BIN}"; \
    echo "KATAGO_EASY_MODEL=${EASY_DIR}/${F_BIN}"   >> /etc/environment; \
    echo "KATAGO_NORMAL_MODEL=${NORM_DIR}/${F_BIN}" >> /etc/environment; \
    echo "KATAGO_HARD_MODEL=${HARD_DIR}/${F_BIN}"   >> /etc/environment; \
  fi

# analysis.cfg（最小設定）
RUN printf "analysisPVLen = 10\nmaxVisits = 4\nnumAnalysisThreads = 1\nnumSearchThreads = 1\nreportAnalysisWinratesAs = BLACK\n" \
  | tee /app/engines/easy_b6/analysis.cfg \
        /app/engines/normal_b10/analysis.cfg \
        /app/engines/hard_b18/analysis.cfg >/dev/null

# 既定の環境変数（Render で上書き可）
ENV PORT=5174 \
  KATAGO_EASY_EXE=/app/engines/bin/katago \
  KATAGO_NORMAL_EXE=/app/engines/bin/katago \
  KATAGO_HARD_EXE=/app/engines/bin/katago \
  KATAGO_EASY_MODEL=/app/engines/easy_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz \
  KATAGO_NORMAL_MODEL=/app/engines/normal_b10/weights/kata1-b6c96-s50894592-d7380655.txt.gz \
  KATAGO_HARD_MODEL=/app/engines/hard_b18/weights/kata1-b6c96-s50894592-d7380655.txt.gz

EXPOSE 5174

# （任意）ヘルスチェック：server.js が /healthz を持っている前提
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD curl -fsS http://localhost:5174/healthz || exit 1

CMD ["node", "server.js"]
