import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'shared',
    globals: true,
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
