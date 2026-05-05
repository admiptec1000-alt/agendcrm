import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Toaster } from './components/ui/sonner';

// Pages
import AdminLoginPage from './pages/AdminLoginPage';
import RegisterPage from './pages/RegisterPage';
import LandingPage from './pages/Public/LandingPage';
import SuperAdminDashboard from './pages/SuperAdmin/Dashboard';
import CompanyDashboard from './pages/Company/Dashboard';
import PublicBooking from './pages/Public/BookingPage';
import IndoorDisplay from './pages/Public/IndoorDisplay';
import CompanyLoginPage from './pages/Public/CompanyLoginPage';
import ImpersonateHandler from './pages/ImpersonateHandler';
import './index.css';

const PrivateRoute = ({ children, requireSuperAdmin = false }) => {
  const { isAuthenticated, isSuperAdmin, loading, user } = useAuth();

  // Also check localStorage as fallback during state hydration
  const hasToken = !!localStorage.getItem('token');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Allow if authenticated via state OR localStorage token exists (hydrating)
  if (!isAuthenticated && !hasToken) {
    const pathSlug = window.location.pathname.split('/')[1];
    if (pathSlug && pathSlug !== 'super-admin' && pathSlug !== 'app' && pathSlug !== 'landing') {
      return <Navigate to={`/${pathSlug}/login`} />;
    }
    return <Navigate to="/landing" />;
  }

  if (requireSuperAdmin && !isSuperAdmin && !loading) {
    // Wait a bit - user might still be loading
    if (hasToken && !user) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      );
    }
    const slug = user?.company?.subdomain;
    return <Navigate to={slug ? `/${slug}/painel` : "/landing"} />;
  }

  return children;
};

const AppRoutes = () => {
  const { isAuthenticated, isSuperAdmin, user } = useAuth();
  const companySlug = user?.company?.subdomain;

  return (
    <Routes>
      {/* Public pages */}
      <Route path="/landing" element={<LandingPage />} />
      <Route path="/admin-login" element={<AdminLoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/__impersonate__" element={<ImpersonateHandler />} />

      {/* Protected */}
      <Route path="/super-admin/*" element={<PrivateRoute requireSuperAdmin={true}><SuperAdminDashboard /></PrivateRoute>} />
      <Route path="/app/*" element={
        isAuthenticated && !isSuperAdmin && companySlug
          ? <Navigate to={`/${companySlug}/painel`} replace />
          : <PrivateRoute><CompanyDashboard /></PrivateRoute>
      } />

      {/* Legacy redirects */}
      <Route path="/login" element={<Navigate to="/landing" />} />
      <Route path="/crm/*" element={<Navigate to="/landing" />} />
      <Route path="/scheduling/*" element={<Navigate to="/landing" />} />
      <Route path="/booking/:slug" element={<PublicBooking />} />
      <Route path="/indoor/:slug" element={<IndoorDisplay />} />

      {/* Default */}
      <Route path="/" element={
        isAuthenticated
          ? <Navigate to={isSuperAdmin ? "/super-admin" : (companySlug ? `/${companySlug}/painel` : "/landing")} />
          : <Navigate to="/landing" />
      } />

      {/* Company routes: /:slug/login, /:slug/agenda, /:slug/indoor, /:slug/painel */}
      <Route path="/:slug/login" element={<CompanyLoginPage />} />
      <Route path="/:slug/agenda" element={<PublicBooking />} />
      <Route path="/:slug/indoor" element={<IndoorDisplay />} />
      <Route path="/:slug/painel/*" element={<PrivateRoute><CompanyDashboard /></PrivateRoute>} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
        <Toaster position="top-right" richColors />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
