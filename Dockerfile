FROM node:20-bookworm

# OS deps（git-lfs とランタイム）
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs libzip4 ocl-icd-libopencl1 libgomp1 ca-certificates wget \
 && git lfs install \
 && rm -rf /var/lib/apt/lists/*

# libssl1.1（libcrypto.so.1.1）を bullseye セキュリティから取得
RUN wget -O /tmp/libssl1.1.deb \
     http://security.debian.org/debian-security/pool/updates/main/o/openssl1.1/libssl1.1_1.1.1w-0+deb11u2_amd64.deb \
 && apt-get update && apt-get install -y /tmp/libssl1.1.deb \
 && rm -f /tmp/libssl1.1.deb

# リポジトリを .git ごとクローン（LFS 用）
WORKDIR /app
RUN git clone --depth=1 https://github.com/atenisoc/katago.git .
RUN git lfs pull

# 実行権
RUN chmod +x engines/bin/katago || true

# 事前チェック：KataGo が起動できるか（失敗時に ldd を出す）
RUN /app/engines/bin/katago version || (ldd /app/engines/bin/katago; exit 1)

# Node 依存（ルートと UI 両方）
RUN npm ci || npm i
RUN npm --prefix katago-ui ci || npm --prefix katago-ui i

# 起動
CMD ["node","server.js"]
