import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { passwordPattern } from '../constants';

function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', username: '', phone: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    if (!passwordPattern.test(form.password)) {
      setError('Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, chữ số và ký tự đặc biệt (@$!%*?&).');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        fullName: form.fullName,
        username: form.username,
        phone: form.phone,
        password: form.password,
      });
      navigate('/login', { replace: true, state: { message: 'Tạo tài khoản thành công. Hãy đăng nhập.' } });
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể tạo tài khoản. Hãy thử lại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-xl rounded-3xl bg-white p-8 shadow-xl sm:p-10">
        <p className="text-sm font-bold text-indigo-600">OmniPOS Chain</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Tạo tài khoản khách hàng</h1>
        <p className="mt-2 text-sm text-slate-500">
          Vai trò nội bộ được cấp riêng, không thể tự đăng ký để tránh tự nâng quyền.
        </p>

        <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            Họ và tên
            <input required minLength={2} maxLength={120} value={form.fullName} onChange={update('fullName')}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            Tên đăng nhập
            <input required minLength={3} maxLength={80} autoComplete="username" value={form.username} onChange={update('username')}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            Số điện thoại
            <input maxLength={30} autoComplete="tel" value={form.phone} onChange={update('phone')}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            Vai trò
            <select disabled value="CUSTOMER" className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-slate-600">
              <option value="CUSTOMER">Khách hàng</option>
            </select>
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            Mật khẩu
            <input type="password" required autoComplete="new-password" value={form.password} onChange={update('password')}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          </label>
          <p className="text-xs text-slate-500">Tối thiểu 8 ký tự, có chữ hoa, chữ số và ký tự đặc biệt (@$!%*?&).</p>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700">
            Xác nhận mật khẩu
            <input type="password" required autoComplete="new-password" value={form.confirmPassword} onChange={update('confirmPassword')}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
          </label>
          {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
          <button type="submit" disabled={submitting}
            className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
            {submitting ? 'Đang tạo tài khoản...' : 'Đăng ký'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Đã có tài khoản? <Link to="/login" className="font-semibold text-indigo-600">Đăng nhập</Link>
        </p>
      </section>
    </main>
  );
}

export default RegisterPage;
