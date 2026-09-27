#!/usr/bin/env bash
# allama をこのユーザーに入れて常駐させる（Ubuntu / sudo 不要）。何度実行してもよい。
#   Node.js・Ollama は ~/.local に、Claude Code は Node.js の中に入れる。
#   systemd のユーザーサービスとして allama と ollama を動かす。
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="$HOME/.local"
NODE_MAJOR="${NODE_MAJOR:-24}"
export PATH="$PREFIX/node/bin:$PREFIX/ollama/bin:$PREFIX/bin:$PATH"

say() { printf '\n== %s\n' "$*"; }

say "Node.js $NODE_MAJOR"
if ! node --version 2>/dev/null | grep -q "^v$NODE_MAJOR\."; then
  file=$(curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/SHASUMS256.txt" | awk '/linux-x64.tar.xz$/ {print $2}')
  rm -rf "$PREFIX/node" && mkdir -p "$PREFIX/node"
  curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/$file" | tar -xJ -C "$PREFIX/node" --strip-components=1
fi
node --version

say "Claude Code"
npm install -g @anthropic-ai/claude-code >/dev/null
claude --version

say "Ollama（クラウドモデル用なので本体だけ入れる）"
if [ ! -x "$PREFIX/ollama/bin/ollama" ]; then
  mkdir -p "$PREFIX/ollama"
  curl -fsSL https://ollama.com/download/ollama-linux-amd64.tar.zst | tar --zstd -x -C "$PREFIX/ollama" bin/ollama
fi
ollama --version 2>/dev/null | tail -1 || true

say "allama"
cd "$APP_DIR"
npm ci
npm run build
[ -f config.json ] || cp config.example.json config.json
# 秘書が自分でコミットするときの名前（未設定のときだけ）
git config user.name >/dev/null || git config user.name allama
git config user.email >/dev/null || git config user.email allama@localhost

say "systemd（ユーザーサービス）"
mkdir -p "$HOME/.config/systemd/user"
sed "s#%APP_DIR%#$APP_DIR#g" deploy/allama.service >"$HOME/.config/systemd/user/allama.service"
cp deploy/ollama.service "$HOME/.config/systemd/user/ollama.service"
systemctl --user daemon-reload
systemctl --user enable --now ollama.service
systemctl --user enable allama.service
systemctl --user restart allama.service
systemctl --user --no-pager status allama.service | head -5

cat <<'EOF'

入れ終わった。
- ログを見る:       journalctl --user -u allama -f
- Ollama にサインイン（初回だけ）: ollama signin
- ログアウト中も動かすには、一度だけ: sudo loginctl enable-linger "$USER"
EOF
