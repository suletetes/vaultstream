import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'api',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
