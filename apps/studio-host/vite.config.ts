import { defineConfig, normalizePath } from 'vite';
import { createRequire } from 'node:module';
import { basename, dirname, relative, resolve } from 'node:path';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';
import { createHopOverrides } from './hop-overrides';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const desktopConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../desktop/src-tauri/tauri.conf.json'), 'utf-8'),
);
const upstreamSrc = resolve(__dirname, '../../third_party/rhwp/rhwp-studio/src');
const hopSrc = resolve(__dirname, 'src');
const rhwpCore = normalizePath(require.resolve('@rhwp/core/rhwp.js'));
const rhwpCoreDir = dirname(rhwpCore);
const fontAssetsDir = resolve(__dirname, '../../assets/fonts');

function hopFontAssets(): Plugin {
  return {
    name: 'hop-font-assets',
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const fontName = basename(decodePath(req.url?.split('?')[0] ?? ''));
        if (!fontName.endsWith('.woff2')) {
          next();
          return;
        }

        const fontPath = resolve(fontAssetsDir, fontName);
        const relativeFontPath = relative(fontAssetsDir, fontPath);
        if (relativeFontPath.startsWith('..') || relativeFontPath === '' || !existsSync(fontPath)) {
          next();
          return;
        }

        res.setHeader('Content-Type', 'font/woff2');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        createReadStream(fontPath).pipe(res);
      });
    },
    closeBundle() {
      const outDir = resolve(__dirname, 'dist/fonts');
      mkdirSync(outDir, { recursive: true });
      for (const fileName of readdirSync(fontAssetsDir)) {
        const source = resolve(fontAssetsDir, fileName);
        if (!fileName.endsWith('.woff2') || !statSync(source).isFile()) continue;
        copyFileSync(source, resolve(outDir, fileName));
      }
    },
  };
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return '';
  }
}

export default defineConfig({
  base: process.env.HOP_WEB_BASE || './',
  plugins: [hopFontAssets()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __HOP_VERSION__: JSON.stringify(desktopConfig.version),
  },
  resolve: {
    alias: [
      ...createHopOverrides(hopSrc),
      { find: '@wasm/rhwp.js', replacement: rhwpCore },
      { find: '@upstream', replacement: upstreamSrc },
      { find: '@', replacement: upstreamSrc },
    ],
  },
  // ─── Production 빌드 최적화 ────────────────────────────────────
  build: {
    // WASM 청크가 4MB 라 500kB 임계 경고는 의미 없음. 1.5MB 로 올려서
    // 진짜 신경 써야 할 경우(앱 코드가 1MB 넘기는 사고) 만 경고 띄움.
    chunkSizeWarningLimit: 1500,
    // 프로덕션 소스맵은 꺼서 인스톨러 크기 감소 + 코드 노출 방지.
    sourcemap: false,
    // 깔끔한 출력 — minify 는 vite 기본 oxc-minify 사용.
    cssMinify: true,
    // 동적 import 청크 분리 — 다이얼로그 등이 별도 청크로 lazy load.
    rollupOptions: {
      output: {
        // 청크 파일명 — hash 짧게 + 인코딩 가벼움.
        chunkFileNames: 'assets/[name]-[hash:8].js',
        assetFileNames: 'assets/[name]-[hash:8].[ext]',
      },
    },
  },
  // ─── ESBuild — production 에서 console.log / debugger 제거 ─────
  esbuild: {
    drop: process.env.NODE_ENV === 'production'
      ? ['debugger']
      : [],
    pure: process.env.NODE_ENV === 'production'
      ? ['console.debug']
      : [],
  },
  server: {
    host: '127.0.0.1',
    port: 7700,
    fs: {
      allow: [
        __dirname,
        rhwpCoreDir,
        fontAssetsDir,
        resolve(__dirname, '../../third_party/rhwp/rhwp-studio'),
      ],
    },
  },
});
