# ---------- Build stage: build KataGo (Eigen/CPU) ----------
FROM ubuntu:22.04 AS katago-build

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
  git build-essential cmake curl python3 \
  libzip-dev libeigen3-dev zlib1g-dev \
  && rm -rf /var/lib/apt/lists/*

# ソース取得（v1.16.3）
WORKDIR /src
RUN git clone --depth=1 --branch v1.16.3 https://github.com/lightvector/KataGo.git
WORKDIR /src/KataGo/cpp
RUN mkdir build && cd build && \
  cmake -DUSE_BACKEND=EIGEN -DCMAKE_BUILD_TYPE=Release .. && \
  cmake --build . -j"$(nproc)"

# ---------- Runtime stage: Node server + katago ----------
FROM node:20-slim

# 必要ツール（curl, unzip等）
RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# まず package.json だけコピーして依存解決
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm i --omit=dev

# アプリ本体
COPY . .

# Katago 実行ファイル配置
RUN mkdir -p /app/engines/bin && \
    mkdir -p /app/engines/easy_b6/weights /app/engines/normal_b10/weights /app/engines/hard_b18/weights

# ビルド成果物を持ってくる
COPY --from=katago-build /src/KataGo/cpp/build/katago /app/engines/bin/katago
RUN chmod +x /app/engines/bin/katago && /app/engines/bin/katago version

# 軽量ネット(c=96,b=6)を取得（まずは動作確認用）
RUN curl -L -o /app/engines/easy_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz \
  "https://huggingface.co/datasets/katago/weights/resolve/main/b6/kata1-b6c96-s50894592-d7380655.txt.gz" && \
  cp /app/engines/easy_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz /app/engines/normal_b10/weights/ && \
  cp /app/engines/easy_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz /app/engines/hard_b18/weights/

# analysis.cfg（最小設定）
RUN printf "analysisPVLen = 10\nmaxVisits = 4\nnumAnalysisThreads = 1\nnumSearchThreads = 1\nreportAnalysisWinratesAs = BLACK\n" \
  | tee /app/engines/easy_b6/analysis.cfg \
        /app/engines/normal_b10/analysis.cfg \
        /app/engines/hard_b18/analysis.cfg >/dev/null

ENV PORT=5174 \
  KATAGO_EASY_EXE=/app/engines/bin/katago \
  KATAGO_NORMAL_EXE=/app/engines/bin/katago \
  KATAGO_HARD_EXE=/app/engines/bin/katago \
  KATAGO_EASY_MODEL=/app/engines/easy_b6/weights/kata1-b6c96-s50894592-d7380655.txt.gz \
  KATAGO_NORMAL_MODEL=/app/engines/normal_b10/weights/kata1-b6c96-s50894592-d7380655.txt.gz \
  KATAGO_HARD_MODEL=/app/engines/hard_b18/weights/kata1-b6c96-s50894592-d7380655.txt.gz

EXPOSE 5174
CMD ["node", "server.js"]
