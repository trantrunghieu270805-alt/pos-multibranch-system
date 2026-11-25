import { cloneElement, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, Building2, Download, LockKeyhole, Plus, Search, ShieldCheck, Trash2, UnlockKeyhole, Users,
} from 'lucide-react';
import RoleLayout from '../components/RoleLayout';
import { api, socket } from '../services/api';
import { deliveryAreas, passwordPattern } from '../constants';

const userRoles = ['OWNER', 'MANAGER', 'CHEF', 'SHIPPER', 'CUSTOMER'];
const roleLabels = {
  OWNER: 'Chủ doanh nghiệp',
  MANAGER: 'Quản lý',
  CHEF: 'Đầu bếp',
  SHIPPER: 'Shipper',
  CUSTOMER: 'Khách hàng',
};
const emptyAnalytics = {
  summary: { TotalRevenue: 0, PaidRevenue: 0, OrderCount: 0 },
  months: Array.from({ length: 12 }, (_, index) => ({
    Month: index + 1,
    TotalRevenue: 0,
    PaidRevenue: 0,
    OrderCount: 0,
  })),
};

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
}

function OwnerDashboard() {
  const [tab, setTab] = useState('overview');
  const [year, setYear] = useState(new Date().getFullYear());
  const [branchFilter, setBranchFilter] = useState('all');
  const [analytics, setAnalytics] = useState(emptyAnalytics);
  const [branches, setBranches] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [userBranchFilter, setUserBranchFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyUser, setBusyUser] = useState(null);
  const [editingBankBranch, setEditingBankBranch] = useState(null);
  const [bankForm, setBankForm] = useState({ BankID: '', AccountNo: '', AccountName: '' });
  const [newUser, setNewUser] = useState({
    fullName: '',
    username: '',
    password: '',
    phone: '',
    role: 'MANAGER',
    branchId: '',
    deliveryArea: deliveryAreas[0],
  });

  const loadRevenue = useCallback(async () => {
    const [analyticsResponse, branchesResponse] = await Promise.all([
      api.get('/owner/analytics/monthly', { params: { year, branchId: branchFilter } }),
      api.get('/owner/branches'),
    ]);
    setAnalytics(analyticsResponse.data);
    setBranches(branchesResponse.data);
  }, [branchFilter, year]);

  const loadUsers = useCallback(async () => {
    const { data } = await api.get('/owner/users');
    setUsers(data);
  }, []);

  const refreshRevenue = useCallback(async () => {
    try {
      await loadRevenue();
      setError('');
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không tải được số liệu doanh thu.');
    } finally {
      setLoading(false);
    }
  }, [loadRevenue]);

  useEffect(() => {
    refreshRevenue();
  }, [refreshRevenue]);

  useEffect(() => {
    let active = true;
    loadUsers().catch((requestError) => {
      if (active) setError(requestError.response?.data?.error || 'Không tải được danh sách tài khoản.');
    });
    const handleOrderUpdate = () => refreshRevenue();
    socket.on('order_updated', handleOrderUpdate);
    return () => {
      active = false;
      socket.off('order_updated', handleOrderUpdate);
    };
  }, [loadUsers, refreshRevenue]);

  const activeStaffCount = users.filter((user) => (
    user.IsActive && ['MANAGER', 'CHEF', 'SHIPPER'].includes(user.Role)
  )).length;
  const activeBranchCount = branches.filter((branch) => branch.IsActive).length;
  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi');
    return users.filter((user) => {
      const matchesRole = roleFilter === 'all' || user.Role === roleFilter;
      const matchesBranch = userBranchFilter === 'all'
        || String(user.BranchID || '') === userBranchFilter;
      const matchesSearch = !needle
        || [user.FullName, user.Username, user.Phone, user.BranchName]
          .some((value) => String(value || '').toLocaleLowerCase('vi').includes(needle));
      return matchesRole && matchesBranch && matchesSearch;
    });
  }, [roleFilter, search, userBranchFilter, users]);

  const chartData = analytics.months.map((month) => ({
    ...month,
    label: `T${month.Month}`,
  }));
  const years = Array.from({ length: 7 }, (_, index) => new Date().getFullYear() - index);

  const exportReport = async () => {
    setExporting(true);
    setError('');
    setNotice('');
    try {
      const XLSX = await import('xlsx');
      const [reportResponse, monthlyResponse] = await Promise.all([
        api.get('/owner/reports/revenue', { params: { year, month: 'all' } }),
        api.get('/owner/analytics/monthly', { params: { year, branchId: 'all' } }),
      ]);
      const workbook = XLSX.utils.book_new();
      const branchRows = reportResponse.data.branches.map((branch) => ({
        'Chi nhánh': branch.BranchName,
        'Địa chỉ': branch.Address || '',
        'Đơn hoàn tất': Number(branch.CompletedOrderCount || 0),
        'Đơn đang xử lý': Number(branch.ProcessingOrderCount || 0),
        'Doanh thu tiền mặt': Number(branch.CashRevenue || 0),
        'Doanh thu VietQR': Number(branch.VietQrRevenue || 0),
        'Tổng doanh thu': Number(branch.TotalRevenue || 0),
      }));
      const monthRows = monthlyResponse.data.months.map((month) => ({
        'Tháng': `Tháng ${month.Month}`,
        'Tổng doanh thu đơn hàng': Number(month.TotalRevenue || 0),
        'Doanh thu đã thanh toán': Number(month.PaidRevenue || 0),
        'Số đơn hàng': Number(month.OrderCount || 0),
      }));
      const branchSheet = XLSX.utils.json_to_sheet(branchRows);
      const monthSheet = XLSX.utils.json_to_sheet(monthRows);
      branchSheet['!cols'] = [{ wch: 28 }, { wch: 36 }, { wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 20 }, { wch: 30 }];
      monthSheet['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 25 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(workbook, branchSheet, 'Tổng hợp theo chi nhánh');
      XLSX.utils.book_append_sheet(workbook, monthSheet, 'Doanh thu 12 tháng');
      XLSX.writeFile(workbook, `BaoCaoDoanhThu_MultiBranchPOS_${year}.xlsx`);
      setNotice(`Đã xuất báo cáo doanh thu năm ${year}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể xuất báo cáo doanh thu.');
    } finally {
      setExporting(false);
    }
  };

  const updateUser = async (user, changes) => {
    setBusyUser(user.UserID);
    setError('');
    setNotice('');
    try {
      const { data } = await api.patch(`/owner/users/${user.UserID}`, changes);
      const branch = branches.find((item) => item.BranchID === data.user.BranchID);
      setUsers((current) => current.map((item) => (
        item.UserID === user.UserID ? { ...data.user, BranchName: branch?.BranchName || null } : item
      )));
      setNotice(`Đã cập nhật tài khoản ${data.user.Username}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể cập nhật tài khoản.');
    } finally {
      setBusyUser(null);
    }
  };

  const changeUserRole = (user, role) => {
    const changes = { Role: role };
    if (role === 'CHEF') changes.BranchID = user.BranchID || branches[0]?.BranchID || null;
    if (role === 'SHIPPER') changes.DeliveryArea = user.DeliveryArea || deliveryAreas[0];
    if (role === 'OWNER' || role === 'CUSTOMER') changes.BranchID = null;
    updateUser(user, changes);
  };

  const removeUser = async (user) => {
    if (!window.confirm(`Xóa tài khoản ${user.Username}? Nếu tài khoản đã phát sinh đơn hàng, hãy khóa thay vì xóa.`)) return;
    setBusyUser(user.UserID);
    setError('');
    setNotice('');
    try {
      await api.delete(`/owner/users/${user.UserID}`);
      setUsers((current) => current.filter((item) => item.UserID !== user.UserID));
      setNotice(`Đã xóa tài khoản ${user.Username}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể xóa tài khoản.');
    } finally {
      setBusyUser(null);
    }
  };

  const createUser = async (event) => {
    event.preventDefault();
    setCreating(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/owner/users', {
        ...newUser,
        branchId: newUser.branchId || null,
        phone: newUser.phone || null,
      });
      await loadUsers();
      setShowCreate(false);
      setNewUser({
        fullName: '',
        username: '',
        password: '',
        phone: '',
        role: 'MANAGER',
        branchId: '',
        deliveryArea: deliveryAreas[0],
      });
      setNotice(`Đã tạo tài khoản ${data.user.Username}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể tạo tài khoản.');
    } finally {
      setCreating(false);
    }
  };

  const editBankDetails = (branch) => {
    setEditingBankBranch(branch.BranchID);
    setBankForm({
      BankID: branch.BankID || '',
      AccountNo: branch.AccountNo || '',
      AccountName: branch.AccountName || '',
    });
  };

  const saveBankDetails = async (branchId) => {
    setError('');
    setNotice('');
    try {
      const { data } = await api.patch(`/owner/branches/${branchId}`, bankForm);
      setBranches((current) => current.map((branch) => (
        branch.BranchID === branchId ? { ...branch, ...data.branch } : branch
      )));
      setEditingBankBranch(null);
      setNotice(`Đã cập nhật thông tin VietQR cho ${data.branch.BranchName}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể cập nhật thông tin VietQR.');
    }
  };

  return (
    <RoleLayout title="Điều hành toàn chuỗi">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Tổng quan doanh nghiệp</h2>
          <p className="text-sm text-slate-500">Doanh thu và nhân sự trên toàn bộ chi nhánh.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            ['overview', 'Tổng quan', Activity],
            ['users', 'Người dùng', Users],
            ['branches', 'Chi nhánh', Building2],
          ].map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${
                tab === key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 shadow-sm'
              }`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
      {notice && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700" role="status">{notice}</p>}

      {tab === 'overview' && (
        <section className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap gap-3">
              <label className="text-sm font-medium text-slate-600">
                Năm
                <select value={year} onChange={(event) => setYear(Number(event.target.value))}
                  className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2">
                  {years.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-600">
                Chi nhánh
                <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}
                  className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2">
                  <option value="all">Toàn chuỗi</option>
                  {branches.map((branch) => <option key={branch.BranchID} value={branch.BranchID}>{branch.BranchName}</option>)}
                </select>
              </label>
            </div>
            <button type="button" onClick={exportReport} disabled={exporting}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              <Download className="h-4 w-4" />
              {exporting ? 'Đang xuất...' : 'Xuất báo cáo Excel (.xlsx)'}
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label={`Tổng doanh thu · ${year}`} value={formatMoney(analytics.summary.TotalRevenue)} icon={<Activity />} />
            <KpiCard label="Doanh thu đã thanh toán" value={formatMoney(analytics.summary.PaidRevenue)} icon={<ShieldCheck />} />
            <KpiCard label="Tổng số đơn hàng" value={`${Number(analytics.summary.OrderCount || 0).toLocaleString('vi-VN')} đơn`} icon={<Activity />} />
            <KpiCard label="Chi nhánh · Nhân sự hoạt động" value={`${activeBranchCount} · ${activeStaffCount}`} icon={<Users />} />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5">
              <h3 className="text-lg font-bold text-slate-800">Doanh thu theo tháng</h3>
              <p className="text-sm text-slate-500">Tổng giá trị đơn và số đơn trong năm {year}.</p>
            </div>
            {loading ? (
              <div className="flex h-80 items-center justify-center text-sm text-slate-500">Đang tải biểu đồ...</div>
            ) : (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" />
                    <YAxis tickFormatter={(value) => `${Number(value).toLocaleString('vi-VN')}`} />
                    <Tooltip formatter={(value) => [formatMoney(value), 'Doanh thu']} />
                    <Bar dataKey="TotalRevenue" name="Doanh thu" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </section>
      )}

      {tab === 'users' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap gap-2">
              <label className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tìm tên, tài khoản, SĐT..."
                  className="w-64 rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" />
              </label>
              <select aria-label="Lọc vai trò" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="all">Tất cả vai trò</option>
                {userRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
              </select>
              <select aria-label="Lọc chi nhánh" value={userBranchFilter} onChange={(event) => setUserBranchFilter(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="all">Tất cả chi nhánh</option>
                {branches.map((branch) => <option key={branch.BranchID} value={branch.BranchID}>{branch.BranchName}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => setShowCreate(true)}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
              <Plus className="h-4 w-4" />Tạo tài khoản mới
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Tài khoản</th><th className="px-4 py-3">Vai trò</th>
                  <th className="px-4 py-3">Chi nhánh</th><th className="px-4 py-3">Khu vực giao</th>
                  <th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map((user) => (
                  <tr key={user.UserID} className={user.IsActive ? '' : 'bg-slate-50 text-slate-400'}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{user.FullName}</p>
                      <p className="text-xs text-slate-500">{user.Username}{user.Phone ? ` · ${user.Phone}` : ''}</p>
                    </td>
                    <td className="px-4 py-3">
                      <select aria-label={`Vai trò ${user.Username}`} disabled={busyUser === user.UserID}
                        value={user.Role} onChange={(event) => changeUserRole(user, event.target.value)}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5">
                        {userRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select aria-label={`Chi nhánh ${user.Username}`} disabled={busyUser === user.UserID || ['OWNER', 'CUSTOMER'].includes(user.Role)}
                        value={user.BranchID || ''} onChange={(event) => updateUser(user, { BranchID: event.target.value || null })}
                        className="max-w-56 rounded-lg border border-slate-300 bg-white px-2 py-1.5">
                        <option value="">Chưa gán</option>
                        {branches.map((branch) => <option key={branch.BranchID} value={branch.BranchID}>{branch.BranchName}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {user.Role === 'SHIPPER' ? (
                        <select aria-label={`Khu vực ${user.Username}`} disabled={busyUser === user.UserID}
                          value={user.DeliveryArea || ''} onChange={(event) => updateUser(user, { DeliveryArea: event.target.value })}
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5">
                          {deliveryAreas.map((area) => <option key={area} value={area}>{area}</option>)}
                        </select>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.IsActive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                        {user.IsActive ? 'Hoạt động' : 'Đã khóa'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button type="button" disabled={busyUser === user.UserID}
                          onClick={() => updateUser(user, { IsActive: !user.IsActive })}
                          title={user.IsActive ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}
                          className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                          {user.IsActive ? <LockKeyhole className="h-4 w-4" /> : <UnlockKeyhole className="h-4 w-4" />}
                        </button>
                        <button type="button" disabled={busyUser === user.UserID}
                          onClick={() => removeUser(user)}
                          title="Xóa tài khoản"
                          className="rounded-lg border border-rose-100 p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filteredUsers.length && <tr><td colSpan="6" className="px-4 py-10 text-center text-slate-500">Không tìm thấy tài khoản phù hợp.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'branches' && (
        <section className="grid gap-4 lg:grid-cols-2">
          {branches.map((branch) => (
            <article key={branch.BranchID} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-800">{branch.BranchName}</h3>
                  <p className="mt-1 text-sm text-slate-500">{branch.Address || 'Chưa có địa chỉ'}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${branch.IsActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {branch.IsActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Tổng doanh thu</p><p className="mt-1 font-bold text-indigo-600">{formatMoney(branch.TotalRevenue)}</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Đã thanh toán</p><p className="mt-1 font-bold text-emerald-700">{formatMoney(branch.PaidRevenue)}</p></div>
              </div>
              <div className="mt-4 rounded-xl border border-slate-100 p-3 text-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-700">Tài khoản VietQR</p>
                  {editingBankBranch !== branch.BranchID && (
                    <button type="button" onClick={() => editBankDetails(branch)}
                      className="text-xs font-semibold text-indigo-600 hover:underline">
                      Cập nhật
                    </button>
                  )}
                </div>
                {editingBankBranch === branch.BranchID ? (
                  <div className="space-y-2">
                    {[
                      ['BankID', 'Mã ngân hàng'],
                      ['AccountNo', 'Số tài khoản'],
                      ['AccountName', 'Tên chủ tài khoản'],
                    ].map(([field, label]) => (
                      <label key={field} className="block text-xs text-slate-500">
                        {label}
                        <input value={bankForm[field]} onChange={(event) => setBankForm((current) => ({ ...current, [field]: event.target.value }))}
                          maxLength={field === 'AccountName' ? 120 : 50}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700" />
                      </label>
                    ))}
                    <div className="flex justify-end gap-2 pt-1">
                      <button type="button" onClick={() => setEditingBankBranch(null)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600">Hủy</button>
                      <button type="button" onClick={() => saveBankDetails(branch.BranchID)}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white">Lưu</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p><span className="text-slate-500">Ngân hàng:</span> {branch.BankID || 'Chưa cấu hình'}</p>
                    <p><span className="text-slate-500">Số tài khoản:</span> {branch.AccountNo || 'Chưa cấu hình'}</p>
                    <p><span className="text-slate-500">Chủ tài khoản:</span> {branch.AccountName || 'Chưa cấu hình'}</p>
                  </>
                )}
              </div>
            </article>
          ))}
          {!branches.length && <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 lg:col-span-2">Chưa có dữ liệu chi nhánh.</p>}
        </section>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <form onSubmit={createUser} className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-xl font-bold text-slate-900">Tạo tài khoản nhân sự</h3><p className="text-sm text-slate-500">Mật khẩu cần chữ hoa, số và ký tự đặc biệt.</p></div>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100">Đóng</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Họ tên"><input required minLength="2" maxLength="120" value={newUser.fullName} onChange={(event) => setNewUser({ ...newUser, fullName: event.target.value })} /></FormField>
              <FormField label="Tên đăng nhập"><input required minLength="3" maxLength="80" autoComplete="off" value={newUser.username} onChange={(event) => setNewUser({ ...newUser, username: event.target.value })} /></FormField>
              <FormField label="Mật khẩu"><input required type="password" autoComplete="new-password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} /></FormField>
              <FormField label="Số điện thoại"><input value={newUser.phone} maxLength="30" onChange={(event) => setNewUser({ ...newUser, phone: event.target.value })} /></FormField>
              <FormField label="Vai trò">
                <select value={newUser.role} onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}>
                  {['MANAGER', 'CHEF', 'SHIPPER'].map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                </select>
              </FormField>
              {newUser.role !== 'SHIPPER' ? (
                <FormField label={newUser.role === 'CHEF' ? 'Chi nhánh phụ trách' : 'Chi nhánh (không bắt buộc)'}>
                  <select required={newUser.role === 'CHEF'} value={newUser.branchId} onChange={(event) => setNewUser({ ...newUser, branchId: event.target.value })}>
                    <option value="">Chọn chi nhánh</option>
                    {branches.filter((branch) => branch.IsActive).map((branch) => <option key={branch.BranchID} value={branch.BranchID}>{branch.BranchName}</option>)}
                  </select>
                </FormField>
              ) : (
                <FormField label="Khu vực giao hàng">
                  <select value={newUser.deliveryArea} onChange={(event) => setNewUser({ ...newUser, deliveryArea: event.target.value })}>
                    {deliveryAreas.map((area) => <option key={area} value={area}>{area}</option>)}
                  </select>
                </FormField>
              )}
            </div>
            {!passwordPattern.test(newUser.password) && newUser.password.length > 0 && (
              <p className="text-xs text-rose-600">Mật khẩu cần tối thiểu 8 ký tự, có chữ hoa, chữ số và ký tự đặc biệt (@$!%*?&).</p>
            )}
            <div className="flex justify-end gap-2 border-t pt-4">
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Hủy</button>
              <button type="submit" disabled={creating || !passwordPattern.test(newUser.password)}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                {creating ? 'Đang tạo...' : 'Tạo tài khoản'}
              </button>
            </div>
          </form>
        </div>
      )}
    </RoleLayout>
  );
}

function KpiCard({ label, value, icon }) {
  return (
    <article className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="rounded-xl bg-indigo-50 p-3 text-indigo-600">{icon}</div>
      <div><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-xl font-bold text-slate-800">{value}</p></div>
    </article>
  );
}

function FormField({ label, children }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-slate-700">
      {label}
      {cloneElement(children, { className: 'w-full rounded-lg border border-slate-300 px-3 py-2' })}
    </label>
  );
}

export default OwnerDashboard;
