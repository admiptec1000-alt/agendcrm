import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Toaster } from './components/ui/sonner';

// Pages
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import SuperAdminDashboard from './pages/SuperAdmin/Dashboard';
import CRMDashboard from './pages/CRM/Dashboard';
import SchedulingDashboard from './pages/Scheduling/Dashboard';
import PublicBooking from './pages/Public/BookingPage';
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
    return <Navigate to="/" />;
  }

  return children;
};

const AppRoutes = () => {
  const { isAuthenticated, isSuperAdmin, hasCRM, hasScheduling } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/booking/:slug" element={<PublicBooking />} />

      <Route
        path="/super-admin/*"
        element={
          <PrivateRoute requireSuperAdmin={true}>
            <SuperAdminDashboard />
          </PrivateRoute>
        }
      />

      <Route
        path="/crm/*"
        element={
          <PrivateRoute>
            <CRMDashboard />
          </PrivateRoute>
        }
      />

      <Route
        path="/scheduling/*"
        element={
          <PrivateRoute>
            <SchedulingDashboard />
          </PrivateRoute>
        }
      />

      <Route
        path="/"
        element={
          isAuthenticated ? (
            isSuperAdmin ? (
              <Navigate to="/super-admin" />
            ) : hasCRM ? (
              <Navigate to="/crm" />
            ) : hasScheduling ? (
              <Navigate to="/scheduling" />
            ) : (
              <Navigate to="/crm" />
            )
          ) : (
            <Navigate to="/login" />
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
