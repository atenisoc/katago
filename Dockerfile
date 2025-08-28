FROM node:20-bookworm

# OS deps（git-lfs とランタイム）
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs libzip4 ocl-icd-libopencl1 libgomp1 ca-certificates \
 && git lfs install \
 && rm -rf /var/lib/apt/lists/*

# libssl1.1 を bullseye から取得（bookworm には無い）
RUN echo 'deb http://deb.debian.org/debian bullseye main' > /etc/apt/sources.list.d/bullseye.list \
 && echo 'deb http://security.debian.org/debian-security bullseye-security main' > /etc/apt/sources.list.d/bullseye-security.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends libssl1.1 \
 && rm -rf /var/lib/apt/lists/*

# リポジトリを .git ごとクローン（LFS 用）
WORKDIR /app
RUN git clone --depth=1 https://github.com/atenisoc/katago.git . \
 && git lfs pull

# 実行権
RUN chmod +x engines/bin/katago || true

# 事前チェック：KataGo が起動できるか（失敗時に ldd を出す）
RUN /app/engines/bin/katago version || (ldd /app/engines/bin/katago; exit 1)

# Node 依存（ルートと UI 両方）
RUN npm ci || npm i
RUN npm --prefix katago-ui ci || npm --prefix katago-ui i

# 起動
CMD ["node","server.js"]
