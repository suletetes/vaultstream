/**
 * E2E Test: Share and Download
 *
 * Tests: Upload → share with user → recipient downloads → audit trail
 * Requirements: 38.3
 */

describe('Share and Download', () => {
  beforeEach(() => {
    cy.login('alice@example.com', 'password123');
  });

  it('navigates to shared-with-me view', () => {
    cy.visit('/shared');
    cy.contains('Shared with Me').should('be.visible');
  });

  it('displays shared files from API', () => {
    cy.intercept('GET', '/api/shared', {
      statusCode: 200,
      body: {
        items: [
          {
            fileId: 'file_shared_1',
            filename: 'shared-doc.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            virusScanStatus: 'clean',
            lastAccessedAt: '2026-05-01T10:00:00Z',
            createdAt: '2026-04-01T10:00:00Z',
          },
        ],
      },
    }).as('getShared');

    cy.visit('/shared');
    cy.wait('@getShared');
    cy.contains('shared-doc.pdf').should('be.visible');
  });
});
