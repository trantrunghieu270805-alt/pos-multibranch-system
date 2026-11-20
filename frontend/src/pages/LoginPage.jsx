import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { rolePaths } from '../constants';

const demoAccounts = [
  ['Khách hàng', 'customer.demo'],
  ['Quản lý', 'manager.demo'],
  ['Đầu bếp', 'chef.demo'],
  ['Shipper', 'shipper.demo'],
];

function LoginPage() {
  const { login, user, loading: authLoading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!authLoading && user) return <Navigate to={rolePaths[user.Role] || '/'} replace />;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const signedInUser = await login(username.trim(), password);
      const requestedPath = location.state?.from?.pathname;
      navigate(requestedPath || rolePaths[signedInUser.Role] || '/', { replace: true });
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể đăng nhập. Hãy thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-xl md:grid-cols-2">
        <section className="p-8 sm:p-10">
          <p className="mb-2 text-sm font-bold text-indigo-600">OmniPOS Chain</p>
          <h1 className="text-3xl font-bold text-slate-900">Đăng nhập</h1>
          <p className="mt-2 text-sm text-slate-500">Đăng nhập để mở trang làm việc theo vai trò.</p>
          {location.state?.message && (
            <p className="mt-4 text-sm text-emerald-700" role="status">{location.state.message}</p>
          )}

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700">
              Tên đăng nhập
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium text-slate-700">
              Mật khẩu
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-600">
            Chưa có tài khoản khách hàng?{' '}
            <Link to="/register" className="font-semibold text-indigo-600 hover:text-indigo-700">Đăng ký</Link>
          </p>
        </section>

        <aside className="bg-slate-900 p-8 text-white sm:p-10">
          <h2 className="text-lg font-bold">Tài khoản demo</h2>
          <p className="mt-2 text-sm text-slate-300">Mật khẩu mẫu cho các tài khoản: <strong>Admin@123</strong></p>
          <ul className="mt-5 space-y-3">
            {demoAccounts.map(([role, account]) => (
              <li key={account} className="rounded-xl bg-slate-800 px-4 py-3">
                <span className="block text-xs text-slate-400">{role}</span>
                <code className="text-sm text-indigo-200">{account}</code>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs leading-5 text-slate-400">
            Tài khoản nội bộ chỉ dùng để kiểm thử. Đăng ký công khai chỉ tạo quyền khách hàng.
          </p>
        </aside>
      </div>
    </main>
  );
}

export default LoginPage;
