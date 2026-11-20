import { LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

const roleLabels = {
  CUSTOMER: 'Khách hàng',
  MANAGER: 'Quản lý / điều phối',
  CHEF: 'Đầu bếp - KDS',
  SHIPPER: 'Nhân viên giao hàng',
};

function RoleLayout({ title, children }) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 bg-slate-900 text-white shadow-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
          <div>
            <p className="text-sm font-bold text-indigo-300">OmniPOS Chain</p>
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">{user?.FullName}</p>
              <p className="text-xs text-slate-400">{roleLabels[user?.Role]}</p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
            >
              <LogOut className="h-4 w-4" />
              Đăng xuất
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}

export default RoleLayout;
