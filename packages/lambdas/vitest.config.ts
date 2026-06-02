import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'lambdas',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
