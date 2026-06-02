// Cypress E2E support file
// Add custom commands and global configuration here

Cypress.Commands.add('login', (email: string, password: string) => {
  // Stub Cognito auth for E2E tests
  cy.window().then((win) => {
    win.sessionStorage.setItem('test_auth', JSON.stringify({
      accessToken: 'test-access-token',
      idToken: 'test-id-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }));
  });
});

declare global {
  namespace Cypress {
    interface Chainable {
      login(email: string, password: string): Chainable<void>;
    }
  }
}
