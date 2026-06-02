import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'frontend',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
