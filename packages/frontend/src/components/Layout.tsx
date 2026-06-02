/**
 * Layout — Main app layout with sidebar navigation
 */

import { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';

interface Props {
  children: ReactNode;
}

export function Layout({ children }: Props) {
  const { user, logout } = useAuth();

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-bold text-brand-700">VaultStream</h1>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <NavLink href="/" label="My Files" icon="📁" />
          <NavLink href="/shared" label="Shared with Me" icon="🔗" />
          <NavLink href="/search" label="Search" icon="🔍" />
          <NavLink href="/trash" label="Trash" icon="🗑️" />
        </nav>

        <div className="p-4 border-t border-gray-200">
          <div className="text-sm text-gray-600 truncate">{user?.email}</div>
          <button
            onClick={logout}
            className="mt-2 text-sm text-red-600 hover:text-red-700"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-50 p-6">{children}</main>
    </div>
  );
}

function NavLink({ href, label, icon }: { href: string; label: string; icon: string }) {
  const isActive = window.location.pathname === href;

  return (
    <a
      href={href}
      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
        isActive
          ? 'bg-brand-50 text-brand-700'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </a>
  );
}
