/**
 * CallbackPage — Handles OAuth PKCE callback from Cognito
 */

import { useEffect, useState } from 'react';
import { handleCallback } from '../stores/auth-store';

export function CallbackPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      handleCallback(code)
        .then(() => {
          window.location.href = '/';
        })
        .catch((err) => {
          setError(err.message || 'Authentication failed');
        });
    } else {
      setError('No authorization code received');
    }
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <p className="text-red-600 font-medium">Authentication Error</p>
          <p className="text-gray-600">{error}</p>
          <a href="/login" className="text-brand-600 hover:underline">
            Try again
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
    </div>
  );
}
