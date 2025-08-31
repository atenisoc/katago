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
    ca-certificates curl gzip \
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

# 軽量ネット (b6) を公式ミラーから取得（gzip検証つき）
RUN set -e; \
  EASY_DIR="/app/engines/easy_b6/weights"; \
  NORM_DIR="/app/engines/normal_b10/weights"; \
  HARD_DIR="/app/engines/hard_b18/weights"; \
  FNAME="kata1-b6c96-s50894592-d7380655.bin.gz"; \
  URL="https://media.katagotraining.org/networks/${FNAME}"; \
  mkdir -p "$EASY_DIR" "$NORM_DIR" "$HARD_DIR"; \
  echo "Downloading ${FNAME} ..."; \
  curl -fL --retry 5 -o "${EASY_DIR}/${FNAME}" "$URL"; \
  echo "Verifying gzip..."; \
  gzip -t "${EASY_DIR}/${FNAME}"; \
  cp "${EASY_DIR}/${FNAME}" "${NORM_DIR}/${FNAME}"; \
  cp "${EASY_DIR}/${FNAME}" "${HARD_DIR}/${FNAME}"

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
  KATAGO_EASY_MODEL=/app/engines/easy_b6/weights/kata1-b6c96-s50894592-d7380655.bin.gz \
  KATAGO_NORMAL_MODEL=/app/engines/normal_b10/weights/kata1-b6c96-s50894592-d7380655.bin.gz \
  KATAGO_HARD_MODEL=/app/engines/hard_b18/weights/kata1-b6c96-s50894592-d7380655.bin.gz

EXPOSE 5174
CMD ["node", "server.js"]
