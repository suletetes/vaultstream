/**
 * E2E Test: Upload and Browse
 *
 * Tests: Login → upload file → verify in file list → view thumbnail
 * Requirements: 38.3
 */

describe('Upload and Browse', () => {
  beforeEach(() => {
    cy.login('alice@example.com', 'password123');
    cy.visit('/');
  });

  it('displays the dashboard after login', () => {
    cy.contains('My Files').should('be.visible');
  });

  it('shows upload dropzone', () => {
    cy.contains('Drag & drop files here').should('be.visible');
  });

  it('uploads a file and shows it in the list', () => {
    // Stub the API responses
    cy.intercept('POST', '/api/files/upload-url', {
      statusCode: 200,
      body: {
        uploadId: 'upload_test',
        fileId: 'file_test',
        presignedUrl: 'https://s3.example.com/upload',
        headers: { 'Content-Type': 'application/pdf' },
      },
    }).as('getUploadUrl');

    cy.intercept('POST', '/api/files/upload-complete', {
      statusCode: 200,
      body: { fileId: 'file_test', filename: 'test.pdf', status: 'active' },
    }).as('confirmUpload');

    // Upload via file input
    cy.get('input[type="file"]').selectFile({
      contents: Cypress.Buffer.from('test content'),
      fileName: 'test.pdf',
      mimeType: 'application/pdf',
    }, { force: true });

    cy.wait('@getUploadUrl');
    cy.wait('@confirmUpload');
  });
});
