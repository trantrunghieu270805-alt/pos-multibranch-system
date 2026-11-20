import { Navigate, useLocation } from 'react-router-dom';
import { rolePaths } from '../constants';
import { useAuth } from './AuthContext';

function ProtectedRoute({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="p-10 text-center text-slate-500">Đang kiểm tra phiên đăng nhập...</div>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.Role)) {
    return <Navigate to={rolePaths[user.Role] || '/login'} replace />;
  }
  return children;
}

export default ProtectedRoute;
