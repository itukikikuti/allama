import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * 画面に束ねられた node_modules の package 名を書き残す。
 *
 * web/dist の JS には third-party のコードが混ざるので、配る物にはその表示（著作権と
 * ライセンス文）が要る。人が一覧を持つと依存が変わったときにずれるので、ビルドのついでに
 * 実際に束ねられた package を数えておき、desktop/tools/make-notices.mjs がそれを読む。
 */
function collectBundledPackages(): Plugin {
  const found = new Set<string>();
  return {
    name: 'allama:collect-bundled-packages',
    transform(_code, id) {
      const m = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id);
      if (m) found.add(m[1].replace(/\\/g, '/'));
    },
    buildEnd() {
      fs.writeFileSync(path.join(here, '.bundled-packages.json'), `${JSON.stringify([...found].sort(), null, 2)}\n`);
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), collectBundledPackages()],
  build: { outDir: path.join(here, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:3170' },
  },
});
