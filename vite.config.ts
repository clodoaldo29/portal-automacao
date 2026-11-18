/// <reference types="vitest/config" />
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page site: the portal at the root and one page per project under /projetos/<id>/.
// To add a project, add its index.html here.
const pages = {
  portal: 'index.html',
  'transfer-flow-3d': 'projetos/transfer-flow-3d/index.html',
  'memory-flow-3d': 'projetos/memory-flow-3d/index.html',
  'memory-flow-inspecao': 'projetos/memory-flow-3d/inspecao/index.html',
  'adata-movimentacao': 'projetos/adata-movimentacao/index.html',
  'adata-embalagem': 'projetos/adata-embalagem/index.html',
  'adata-retrabalho': 'projetos/adata-retrabalho/index.html',
  'adata-substratos': 'projetos/adata-substratos/index.html',
  'adata-microscopia': 'projetos/adata-microscopia/index.html',
};

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900, // three.js r128 alone is ~600 kB minified
    rollupOptions: {
      input: Object.fromEntries(Object.entries(pages).map(([name, file]) => [name, resolve(import.meta.dirname, file)])),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
