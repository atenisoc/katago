# Node 20 / Debian bookworm（glibc 2.36系）
FROM node:20-bookworm-slim

# ベースツール
RUN apt-get update && apt-get install -y     ca-certificates curl unzip  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存インストール
COPY package*.json ./
RUN npm ci

# ソースとエンジンをコピー
COPY . .

# KataGo 実行権限
RUN chmod +x /app/engines/bin/katago

# ポート公開（server.js が 5173 を使う想定）
EXPOSE 5173

# 初回起動時に重みが無ければ自動DL、続けてサーバ起動
CMD node scripts/bootstrap-weights.js && node server.js
