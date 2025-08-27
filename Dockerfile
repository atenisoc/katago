# ---- Stage 1: build KataGo (Eigen/CPU) ----
FROM ubuntu:22.04 AS katago-build
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
    git cmake g++ libeigen3-dev zlib1g-dev curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 --branch v1.16.3 https://github.com/lightvector/KataGo.git .
RUN cmake -S cpp -B build -DUSE_BACKEND=EIGEN -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build -j $(nproc)

# ---- Stage 2: app runtime ----
FROM node:20-bullseye-slim
WORKDIR /app

# Node依孁E
COPY package*.json ./
RUN npm i --omit=dev

# アプリ本佁E
COPY . .

# 置き場所を用愁E
RUN mkdir -p /app/engines/bin /app/engines/configs /app/engines/weights

# ビルド済みKataGo投�E
COPY --from=katago-build /src/build/katago /app/engines/bin/katago
RUN chmod +x /app/engines/bin/katago

# �E�任意）�E析設定ファイルを同梱してぁE��なら、ここでコピ�E
# COPY engines/analysis.cfg /app/engines/configs/analysis.cfg

ENV PORT=5173
EXPOSE 5173
CMD ["node","server.js"]
