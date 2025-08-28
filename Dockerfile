FROM node:20-bullseye

# git と git-lfs を入れる
RUN apt-get update && apt-get install -y git git-lfs && git lfs install

# /app にクローン（.git を含むので LFS を使える）
WORKDIR /app
RUN git clone --depth=1 https://github.com/atenisoc/katago.git .

# LFS 実体を取得（katago 本体と weights）
RUN git lfs pull

# KataGo 実行権
RUN chmod +x engines/bin/katago || true

# 依存インストール
WORKDIR /app/katago-ui
RUN npm ci || npm i

# Render の $PORT で待ち受け（server.js が PORT を読む実装になっていること）
CMD ["node","server.js"]