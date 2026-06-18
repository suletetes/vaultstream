/**
 * LoginPage — Landing page with login button
 */

import { useAuth } from '../hooks/useAuth';

export function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="flex min-h-screen">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand-950 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-900/90 to-brand-950" />
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-400 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-brand-300 rounded-full blur-3xl" />
        </div>
        <div className="relative z-10 flex flex-col justify-center px-16">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-brand-500 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white">VaultStream</h1>
          </div>
          <h2 className="text-4xl font-bold text-white leading-tight mb-4">
            Your files,<br />encrypted &amp; secure.
          </h2>
          <p className="text-lg text-brand-200 leading-relaxed max-w-md">
            Enterprise-grade encrypted file vault with intelligent storage tiering,
            granular sharing, and complete audit trails.
          </p>
          <div className="mt-12 grid grid-cols-3 gap-6">
            <div>
              <p className="text-3xl font-bold text-white">256-bit</p>
              <p className="text-sm text-brand-300 mt-1">AES encryption</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-white">99.99%</p>
              <p className="text-sm text-brand-300 mt-1">Uptime SLA</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-white">SOC 2</p>
              <p className="text-sm text-brand-300 mt-1">Compliant</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right login panel */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden flex items-center gap-3 justify-center mb-4">
            <div className="w-9 h-9 bg-brand-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">VaultStream</h1>
          </div>

          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="mt-2 text-gray-500">Sign in to access your secure vault</p>
          </div>

          <button
            onClick={login}
            className="btn-primary w-full py-3 text-base"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            Sign In with SSO
          </button>

          <p className="text-center text-xs text-gray-400">
            Protected by AWS Cognito with PKCE authentication
          </p>
        </div>
      </div>
    </div>
  );
}
