import { defineConfig } from 'bunup';

export default defineConfig([
  {
    name: 'browser',
    entry: ['src/index.ts', 'src/react.ts'],
    dts: true,
    clean: true,
    format: ['esm'],
    target: 'browser',
    external: ['react'],
  },
  {
    name: 'cli',
    entry: ['src/cli.ts'],
    clean: false,
    format: ['esm'],
    target: 'node',
    external: ['@openpkg-ts/sdk', '@openpkg-ts/spec', 'node-html-parser', '@typesafe-ai/sdk'],
  },
]);
