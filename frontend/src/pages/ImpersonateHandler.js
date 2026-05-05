import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Landing page for the SuperAdmin "Gestão" button. Receives an impersonation
 * JWT through `/__impersonate__?token=<jwt>&slug=<slug>` and:
 *   1. Persists the impersonation JWT into **sessionStorage** (per-tab),
 *      so the SuperAdmin's `localStorage.token` in the original tab is NEVER
 *      overwritten. The axios interceptor in services/api.js already prefers
 *      sessionStorage over localStorage.
 *   2. Hard-redirects to `/${slug}/painel` so AuthContext re-hydrates inside
 *      the new tab using the per-tab token.
 *
 * Important: this component MUST NOT touch localStorage. Doing so would
 * destroy the SuperAdmin's session in the original tab.
 */
export default function ImpersonateHandler() {
  const [params] = useSearchParams();
  useEffect(() => {
    const token = params.get('token');
    const slug = params.get('slug') || '';
    if (!token) {
      window.location.replace('/admin-login');
      return;
    }
    // Per-tab token. Cleared automatically when the tab is closed.
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('impersonating', '1');
    // Stale user (if any) must be removed so AuthContext re-fetches /auth/me
    // with the new impersonation token.
    sessionStorage.removeItem('user');
    window.location.replace(slug ? `/${slug}/painel` : '/app');
  }, [params]);
  return (
    <div
      data-testid="impersonate-handler-loading"
      className="min-h-screen flex items-center justify-center text-slate-500"
    >
      Abrindo ambiente da empresa…
    </div>
  );
}
