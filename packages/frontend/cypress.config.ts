/**
 * Cypress E2E Configuration
 *
 * Tests critical user flows against the full local stack.
 * Requirements: 38.3
 */

import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    supportFile: 'cypress/support/e2e.ts',
    specPattern: 'cypress/e2e/**/*.cy.ts',
    viewportWidth: 1280,
    viewportHeight: 720,
    video: false,
    screenshotOnRunFailure: true,
    defaultCommandTimeout: 10000,
    env: {
      API_URL: 'http://localhost:4000',
    },
  },
});
