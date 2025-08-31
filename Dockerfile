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

# 実行時に必要なライブラリ
RUN apt-get update && apt-get install -y \
    ca-certificates curl gzip \
    libzip4 zlib1g libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存解決（キャッシュ効かせるため package.* を先にコピー）
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --omit=dev

# アプリ本体
COPY . .

# ディレクトリ準備
RUN mkdir -p /app/engines/bin \
    /app/engines/easy_b6/weights \
    /app/engines/normal_b10/weights \
    /app/engines/hard_b18/weights

# KataGo 実行ファイルを配置＆動作確認
COPY --from=katago-build /src/KataGo/cpp/build/katago /app/engines/bin/katago
RUN chmod +x /app/engines/bin/katago && /app/engines/bin/katago version

# analysis.cfg（最小設定）
RUN printf "analysisPVLen = 10\nmaxVisits = 4\nnumAnalysisThreads = 1\nnumSearchThreads = 1\nreportAnalysisWinratesAs = BLACK\n" \
  | tee /app/engines/easy_b6/analysis.cfg \
        /app/engines/normal_b10/analysis.cfg \
        /app/engines/hard_b18/analysis.cfg >/dev/null

# 環境変数（Renderで上書き可）
ENV PORT=5174 \
  KATAGO_EASY_EXE=/app/engines/bin/katago \
  KATAGO_NORMAL_EXE=/app/engines/bin/katago \
  KATAGO_HARD_EXE=/app/engines/bin/katago \
  KATAGO_EASY_MODEL=/app/engines/easy_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz \
  KATAGO_NORMAL_MODEL=/app/engines/normal_b10/weights/kata1-b6c96-s50894592-d7380655.txt.gz \
  KATAGO_HARD_MODEL=/app/engines/hard_b18/weights/kata1-b6c96-s50894592-d7380655.txt.gz

EXPOSE 5174
CMD ["node", "server.js"]
