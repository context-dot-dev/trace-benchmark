import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'server/functions',
    rolldownOptions: {
      input: { dashboard: 'server/index.ts', publish: 'server/vercel-publish.ts' },
      output: { entryFileNames: '[name].js' },
    },
  },
});
