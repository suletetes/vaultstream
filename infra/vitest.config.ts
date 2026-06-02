import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'infra',
    globals: true,
    include: ['**/*.test.ts'],
    exclude: ['cdk.out/**'],
  },
});
