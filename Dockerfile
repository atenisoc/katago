FROM node:20-bullseye

# 1) git-lfs を入れる
RUN apt-get update && apt-get install -y git-lfs && git lfs install

WORKDIR /app

# 2) リポジトリをコピー（LFS ポインタ込み）
COPY . .

# 3) LFS 実体を取得（※ここで engines/bin/katago と weights が落ちてくる）
RUN git lfs pull

# 4) 実行権
RUN chmod +x engines/bin/katago || true

# 5) 依存インストール
WORKDIR /app/katago-ui
RUN npm ci || npm i

CMD ["node","server.js"]
