import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Landing page for the SuperAdmin "Gestão" button. The SuperAdmin sets
 * `/__impersonate__?token=<jwt>&slug=<slug>` and this component:
 *   1. Persists the impersonation JWT into localStorage under `token`
 *      (consumed by axios interceptor + AuthContext).
 *   2. Forces AuthContext to re-hydrate the user from the new token.
 *   3. Redirects to the tenant dashboard `/${slug}/painel`.
 *
 * A banner in the impersonated UI can be added later by reading
 * `auth.user.impersonated_by` — the backend token already carries that claim.
 */
export default function ImpersonateHandler() {
  const [params] = useSearchParams();
  const { login: _login, refreshUser } = useAuth();
  useEffect(() => {
    const token = params.get('token');
    const slug = params.get('slug') || '';
    if (!token) {
      window.location.replace('/admin-login');
      return;
    }
    localStorage.setItem('token', token);
    // Best-effort refresh of context; if AuthContext doesn't expose refreshUser,
    // a hard navigation below will re-initialize it on the tenant route.
    if (typeof refreshUser === 'function') { refreshUser(); }
    window.location.replace(slug ? `/${slug}/painel` : '/app');
  }, [params, refreshUser]);
  return (
    <div className="min-h-screen flex items-center justify-center text-slate-500">
      Abrindo ambiente da empresa…
    </div>
  );
}
