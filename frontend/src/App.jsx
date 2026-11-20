import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import ProtectedRoute from './auth/ProtectedRoute';
import { rolePaths } from './constants';
import ChefPage from './pages/ChefPage';
import CustomerPage from './pages/CustomerPage';
import LoginPage from './pages/LoginPage';
import ManagerPage from './pages/ManagerPage';
import RegisterPage from './pages/RegisterPage';
import ShipperPage from './pages/ShipperPage';

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-slate-500">Đang tải...</div>;
  return <Navigate to={user ? rolePaths[user.Role] || '/login' : '/login'} replace />;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-slate-500">Đang kiểm tra phiên đăng nhập...</div>;
  if (user) return <Navigate to={rolePaths[user.Role] || '/login'} replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
      <Route path="/customer" element={
        <ProtectedRoute roles={['CUSTOMER']}><CustomerPage /></ProtectedRoute>
      } />
      <Route path="/manager" element={
        <ProtectedRoute roles={['MANAGER']}><ManagerPage /></ProtectedRoute>
      } />
      <Route path="/chef" element={
        <ProtectedRoute roles={['CHEF']}><ChefPage /></ProtectedRoute>
      } />
      <Route path="/shipper" element={
        <ProtectedRoute roles={['SHIPPER']}><ShipperPage /></ProtectedRoute>
      } />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
