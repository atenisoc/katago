﻿FROM node:20-bullseye

# OS deps: git-lfs とランタイムライブラリ
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs libzip4 ocl-icd-libopencl1 ca-certificates \
 && git lfs install \
 && rm -rf /var/lib/apt/lists/*

# リポジトリを .git ごとクローン（LFSのため）
WORKDIR /app
RUN git clone --depth=1 https://github.com/atenisoc/katago.git .

# LFS 実体を取得（katago と weights）
RUN git lfs pull

# 実行権
RUN chmod +x engines/bin/katago || true

# UI の依存インストール
RUN npm --prefix katago-ui ci || npm --prefix katago-ui i

# Render が渡す  を server.js が読む想定（リポジトリ直下で起動）
CMD ["node","server.js"]
