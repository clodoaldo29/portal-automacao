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
  'memory-flow-microscopia': 'projetos/memory-flow-3d/microscopia/index.html',
  'memory-flow-substratos': 'projetos/memory-flow-3d/substratos/index.html',
  'memory-flow-retrabalho': 'projetos/memory-flow-3d/retrabalho/index.html',
  'memory-flow-embalagem': 'projetos/memory-flow-3d/embalagem/index.html',
  'memory-flow-movimentacao': 'projetos/memory-flow-3d/movimentacao/index.html',
  'memory-flow-npi': 'projetos/memory-flow-3d/npi/index.html',
  'adata-movimentacao': 'projetos/adata-movimentacao/index.html',
  'adata-embalagem': 'projetos/adata-embalagem/index.html',
  'adata-retrabalho': 'projetos/adata-retrabalho/index.html',
  'adata-substratos': 'projetos/adata-substratos/index.html',
  'adata-microscopia': 'projetos/adata-microscopia/index.html',
  'adata-npi': 'projetos/adata-npi/index.html',
  'adata-inspecao-pos-corte': 'projetos/adata-inspecao-pos-corte/index.html',
  'smart-solder-a': 'projetos/smart-solder-a/index.html',
  'smart-solder-b': 'projetos/smart-solder-b/index.html',
  'intellifix-ai': 'projetos/intellifix-ai/index.html',
  'smart-pack': 'projetos/smart-pack/index.html',
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
