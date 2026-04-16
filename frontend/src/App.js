import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Toaster } from './components/ui/sonner';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import LandingPage from './pages/Public/LandingPage';
import SuperAdminDashboard from './pages/SuperAdmin/Dashboard';
import CompanyDashboard from './pages/Company/Dashboard';
import PublicBooking from './pages/Public/BookingPage';
import IndoorDisplay from './pages/Public/IndoorDisplay';
import './index.css';

const PrivateRoute = ({ children, requireSuperAdmin = false }) => {
  const { isAuthenticated, isSuperAdmin, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return <Navigate to="/app" />;
  }

  return children;
};

const AppRoutes = () => {
  const { isAuthenticated, isSuperAdmin } = useAuth();

  return (
    <Routes>
      {/* Public */}
      <Route path="/landing" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/booking/:slug" element={<PublicBooking />} />
      <Route path="/indoor/:slug" element={<IndoorDisplay />} />

      {/* Protected */}
      <Route
        path="/super-admin/*"
        element={
          <PrivateRoute requireSuperAdmin={true}>
            <SuperAdminDashboard />
          </PrivateRoute>
        }
      />
      <Route
        path="/app/*"
        element={
          <PrivateRoute>
            <CompanyDashboard />
          </PrivateRoute>
        }
      />

      {/* Legacy routes redirect */}
      <Route path="/crm/*" element={<Navigate to="/app" />} />
      <Route path="/scheduling/*" element={<Navigate to="/app" />} />

      {/* Default Route */}
      <Route
        path="/"
        element={
          isAuthenticated ? (
            isSuperAdmin ? (
              <Navigate to="/super-admin" />
            ) : (
              <Navigate to="/app" />
            )
          ) : (
            <Navigate to="/landing" />
          )
        }
      />
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
