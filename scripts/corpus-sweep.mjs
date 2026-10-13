#!/usr/bin/env node
// YHWP 코퍼스 스윕: HWP/HWPX 문서를 한 개씩 열고, 모든 쪽을 SVG로 그리고,
// HWP로 저장한 뒤 다시 열어 쪽 수가 유지되는지 확인한다. 속도와 실패를 함께 기록한다.
//
// 사용법: node scripts/corpus-sweep.mjs <폴더> [--out report.json] [--limit N]
// 실행 환경은 Node(캔버스 없음)이므로 글자 폭 측정은 근사 스텁을 쓴다.
// 레이아웃 정확도가 아니라 크래시·멈춤·저장 손상·속도를 보는 도구다.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = join(here, '..', 'apps', 'studio-host', 'vendor', 'rhwp-core');

if (process.argv[2] === '--worker') {
  await runWorker();
} else {
  await runMain();
}

async function runMain() {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--'));
  if (!root) {
    console.error('usage: node scripts/corpus-sweep.mjs <dir> [--out report.json] [--limit N]');
    process.exit(2);
  }
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : 'corpus-report.json';
  const limitIdx = args.indexOf('--limit');
  let files = walk(root).filter((f) => ['.hwp', '.hwpx'].includes(extname(f).toLowerCase()));
  if (limitIdx >= 0) files = files.slice(0, Number(args[limitIdx + 1]));

  const results = [];
  const batch = 40;
  for (let i = 0; i < files.length; i += batch) {
    const chunk = files.slice(i, i + batch);
    results.push(...(await runChunk(chunk)));
    process.stdout.write(`\r${Math.min(i + batch, files.length)}/${files.length}`);
  }
  process.stdout.write('\n');

  const ok = results.filter((r) => r.status === 'ok');
  const failed = results.filter((r) => r.status !== 'ok');
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const pct = (xs, p) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };
  const openMs = ok.map((r) => r.openMs);
  const firstMs = ok.map((r) => r.firstPageMs);
  const summary = {
    files: results.length,
    ok: ok.length,
    failed: failed.length,
    pages: sum(ok.map((r) => r.pages)),
    openMs: { p50: pct(openMs, 50), p95: pct(openMs, 95), max: pct(openMs, 100) },
    firstPageMs: { p50: pct(firstMs, 50), p95: pct(firstMs, 95), max: pct(firstMs, 100) },
    renderMsPerPage: +(sum(ok.map((r) => r.renderMs)) / Math.max(1, sum(ok.map((r) => r.pages)))).toFixed(2),
    saveMs: { p50: pct(ok.map((r) => r.saveMs), 50), p95: pct(ok.map((r) => r.saveMs), 95) },
    failuresByKind: failed.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {}),
  };
  writeFileSync(out, JSON.stringify({ summary, failed, results: results.map((r) => ({ ...r, file: relative(root, r.file) })) }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length) {
    console.log('\n실패 상위 20건:');
    for (const f of failed.slice(0, 20)) console.log(`- [${f.status}] ${relative(root, f.file)}: ${f.error}`);
  }
}

function runChunk(chunk) {
  return new Promise((resolveChunk) => {
    const results = [];
    const pending = new Set(chunk);
    const child = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let timer;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    };
    child.on('message', (r) => {
      results.push(r);
      pending.delete(r.file);
      arm();
    });
    child.on('exit', async () => {
      clearTimeout(timer);
      // 워커가 죽은 경우: 처리 중이던 첫 파일을 hang/crash로 기록하고 나머지는 새 워커로 재시도
      const rest = chunk.filter((f) => pending.has(f));
      if (rest.length) {
        results.push({ file: rest[0], status: 'hang-or-crash', error: 'worker exited or timed out (60s)' });
        if (rest.length > 1) results.push(...(await runChunk(rest.slice(1))));
      }
      resolveChunk(results);
    });
    arm();
    child.send(chunk);
  });
}

async function runWorker() {
  installCanvasStub();
  const mod = await import(new URL(`file:///${join(wasmDir, 'rhwp.js').replace(/\\/g, '/')}`).href);
  await mod.default({ module_or_path: readFileSync(join(wasmDir, 'rhwp_bg.wasm')) });
  process.on('message', (files) => {
    for (const file of files) process.send(sweepOne(mod, file));
    process.exit(0);
  });
}

function sweepOne(mod, file) {
  const r = { file, status: 'ok' };
  let doc;
  try {
    const bytes = readFileSync(file);
    r.bytes = bytes.length;
    let t = performance.now();
    doc = new mod.HwpDocument(new Uint8Array(bytes));
    r.pages = doc.pageCount();
    r.openMs = +(performance.now() - t).toFixed(2);
    t = performance.now();
    if (r.pages > 0) doc.renderPageSvg(0);
    r.firstPageMs = +(performance.now() - t).toFixed(2);
    t = performance.now();
    for (let p = 1; p < r.pages; p++) doc.renderPageSvg(p);
    r.renderMs = +(r.firstPageMs + performance.now() - t).toFixed(2);
    t = performance.now();
    const saved = doc.exportHwp();
    r.saveMs = +(performance.now() - t).toFixed(2);
    const again = new mod.HwpDocument(saved);
    const pagesAgain = again.pageCount();
    again.free();
    if (pagesAgain !== r.pages) {
      r.status = 'roundtrip-pages-changed';
      r.error = `pages ${r.pages} -> ${pagesAgain} after HWP save`;
    }
  } catch (e) {
    r.status = 'error';
    r.error = String(e?.message ?? e).slice(0, 300);
  } finally {
    try { doc?.free(); } catch { /* 이미 해제됨 */ }
  }
  return r;
}

function installCanvasStub() {
  // 글자 폭: CSS font 문자열의 px 크기 기준 근사치(한글·전각 1em, 그 외 0.55em)
  const ctx = new Proxy({ font: '10px sans-serif' }, {
    get(target, key) {
      if (key === 'measureText') {
        return (text) => {
          const px = Number(/([\d.]+)px/.exec(target.font)?.[1] ?? 10);
          let w = 0;
          for (const ch of text) w += ch.codePointAt(0) > 0x2e80 ? px : px * 0.55;
          return { width: w, actualBoundingBoxAscent: px * 0.8, actualBoundingBoxDescent: px * 0.2 };
        };
      }
      if (key in target) return target[key];
      return () => undefined;
    },
    set(target, key, value) { target[key] = value; return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  globalThis.document ??= { createElement: () => canvas };
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
