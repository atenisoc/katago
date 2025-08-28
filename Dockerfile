FROM node:20-bullseye

# git と git-lfs を入れる
RUN apt-get update && apt-get install -y git git-lfs && git lfs install

# レポジトリをクローン（Public想定）
WORKDIR /app
RUN git clone --depth=1 https://github.com/atenisoc/katago.git .

# LFS 実ファイルを取得
RUN git lfs pull

# 実行権
RUN chmod +x engines/bin/katago || true

# 依存インストール
WORKDIR /app/katago-ui
RUN npm ci || npm i

CMD ["node","server.js"]
