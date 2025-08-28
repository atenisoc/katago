@'
FROM node:20-bullseye

# OS deps: git-lfs �ƃ����^�C�����C�u����
RUN apt-get update && apt-get install -y --no-install-recommends \
    git git-lfs libzip4 ocl-icd-libopencl1 ca-certificates \
 && git lfs install \
 && rm -rf /var/lib/apt/lists/*

# ���|�W�g���� .git ���ƃN���[���iLFS�̂��߁j
WORKDIR /app
RUN git clone --depth=1 https://github.com/atenisoc/katago.git .

# LFS ���̂��擾�ikatago �� weights�j
RUN git lfs pull

# ���s��
RUN chmod +x engines/bin/katago || true

# UI �̈ˑ����C���X�g�[���iserver.js �̓��|�W�g�������œ������j
RUN npm --prefix katago-ui ci || npm --prefix katago-ui i

# Render ���n�� $PORT �� server.js ���ǂޑz��
CMD ["node","server.js"]
'@ | Set-Content -Encoding UTF8 Dockerfile
