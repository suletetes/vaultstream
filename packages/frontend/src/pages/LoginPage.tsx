/**
 * LoginPage — Landing page with login button
 */

import { useAuth } from '../hooks/useAuth';

export function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-brand-50 to-white">
      <div className="text-center space-y-6 max-w-md px-4">
        <h1 className="text-4xl font-bold text-gray-900">VaultStream</h1>
        <p className="text-lg text-gray-600">
          Secure encrypted file vault with intelligent storage tiering
        </p>
        <button
          onClick={login}
          className="px-6 py-3 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors shadow-sm"
        >
          Sign In
        </button>
      </div>
    </div>
  );
}
