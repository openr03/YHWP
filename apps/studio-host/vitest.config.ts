import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { createYhwpOverrides } from './yhwp-overrides.ts';

const upstreamSrc = resolve(import.meta.dirname, '../../third_party/rhwp/rhwp-studio/src');
const yhwpSrc = resolve(import.meta.dirname, 'src');
const rhwpWasmModule = resolve(import.meta.dirname, 'vendor/rhwp-core/rhwp.js');

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: [
      ...createYhwpOverrides(yhwpSrc),
      { find: '@wasm/rhwp.js', replacement: rhwpWasmModule },
      { find: '@/upstream', replacement: resolve(yhwpSrc, 'upstream') },
      { find: '@upstream', replacement: upstreamSrc },
      { find: '@', replacement: upstreamSrc },
    ],
  },
});
