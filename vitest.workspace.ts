import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared',
  'packages/api',
  'packages/lambdas',
  'packages/frontend',
  'infra',
]);
