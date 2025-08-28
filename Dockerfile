FROM node:20-bullseye

# OS deps（git-lfs とランタイム）
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs libzip4 ocl-icd-libopencl1 libgomp1 ca-certificates \
 && git lfs install \
 && rm -rf /var/lib/apt/lists/*

# 共有ライブラリ検索パスを明示
ENV LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:

# リポジトリを .git ごとクローン（LFS 用）
WORKDIR /app
RUN git clone --depth=1 https://github.com/atenisoc/katago.git .
RUN git lfs pull

# 実行権
RUN chmod +x engines/bin/katago || true

# 事前チェック：libzip / OpenCL の存在と katago の起動確認
RUN ldconfig -p | grep -E 'libzip\.so|OpenCL' || true
RUN /app/engines/bin/katago version || (ldd /app/engines/bin/katago; exit 1)

# Node 依存（ルートと UI 両方）
RUN npm ci || npm i
RUN npm --prefix katago-ui ci || npm --prefix katago-ui i

# 起動
CMD ["node","server.js"]
