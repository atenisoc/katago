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

# Node萓晏ｭ・
COPY package*.json ./
RUN npm i --omit=dev

# 繧｢繝励Μ譛ｬ菴・
COPY . .

# 鄂ｮ縺榊ｴ謇繧堤畑諢・
RUN mkdir -p /app/engines/bin /app/engines/configs /app/engines/weights

# 繝薙Ν繝画ｸ医∩KataGo謚募・
COPY --from=katago-build /src/build/katago /app/engines/bin/katago
RUN chmod +x /app/engines/bin/katago

# ・井ｻｻ諢擾ｼ牙・譫占ｨｭ螳壹ヵ繧｡繧､繝ｫ繧貞酔譴ｱ縺励※縺・ｋ縺ｪ繧峨√％縺薙〒繧ｳ繝斐・
# COPY engines/analysis.cfg /app/engines/configs/analysis.cfg

ENV PORT=5173
EXPOSE 5173
CMD ["node","server.js"]
