import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    alias: {
      obsidian: path.resolve(__dirname, './tests/__mocks__/obsidian.ts'),
    },
  },
});
