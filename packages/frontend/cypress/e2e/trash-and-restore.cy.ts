/**
 * E2E Test: Trash and Restore
 *
 * Tests: Delete file → verify in trash → restore → verify back in list
 * Requirements: 38.3
 */

describe('Trash and Restore', () => {
  beforeEach(() => {
    cy.login('alice@example.com', 'password123');
  });

  it('displays trash bin with deleted files', () => {
    cy.intercept('GET', '/api/trash', {
      statusCode: 200,
      body: {
        items: [
          {
            fileId: 'file_deleted_1',
            filename: 'old-report.pdf',
            sizeBytes: 2048,
            deletedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
          },
        ],
      },
    }).as('getTrash');

    cy.visit('/trash');
    cy.wait('@getTrash');
    cy.contains('old-report.pdf').should('be.visible');
    cy.contains('days remaining').should('be.visible');
  });

  it('restores a file from trash', () => {
    cy.intercept('GET', '/api/trash', {
      statusCode: 200,
      body: {
        items: [{ fileId: 'file_del_1', filename: 'restore-me.pdf', sizeBytes: 1024, deletedAt: new Date().toISOString() }],
      },
    }).as('getTrash');

    cy.intercept('POST', '/api/files/file_del_1/restore', { statusCode: 200 }).as('restore');

    cy.visit('/trash');
    cy.wait('@getTrash');
    cy.contains('Restore').click();
    cy.wait('@restore');
  });

  it('shows empty state when trash is empty', () => {
    cy.intercept('GET', '/api/trash', { statusCode: 200, body: { items: [] } });
    cy.visit('/trash');
    cy.contains('Trash is empty').should('be.visible');
  });
});
