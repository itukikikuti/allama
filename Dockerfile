# ---- 画面をビルドする ----
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 動かす ----
FROM node:24-bookworm-slim

# 手（Claude Code）が作業に使う道具
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl tzdata procps ripgrep python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force

ENV TZ=Asia/Tokyo \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CONFIG_DIR=/home/node/.claude \
    ATAMA_CONFIG=/app/docker/config.json

# サーバーは Node だけで動く（依存パッケージは画面のビルドにしか使わない）
WORKDIR /app
COPY package.json tsconfig.json ./
COPY server server
COPY shared shared
COPY mind-seed mind-seed
COPY docker docker
COPY --from=build /app/web/dist web/dist

# 手は許可確認を省いて動くので、root ではなく node ユーザーで動かす
RUN mkdir -p /home/node/.atama /home/node/.claude /home/node/work && chown -R node:node /home/node
USER node

EXPOSE 3170
CMD ["node", "--no-warnings", "server/main.ts"]
