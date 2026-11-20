import { useCallback, useEffect, useState } from 'react';
import { Activity, Building2, DollarSign, ShoppingBag } from 'lucide-react';
import { api, socket } from '../services/api';

const emptyStats = {
  summary: { TotalOrders: 0, TotalRevenue: 0, PaidRevenue: 0 },
  byBranch: [],
  recentOrders: [],
};

function CentralDashboard() {
  const [stats, setStats] = useState(emptyStats);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState('');

  const fetchStats = useCallback(async () => {
    const { data } = await api.get('/dashboard/stats');
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    const loadStats = async () => {
      try {
        const data = await fetchStats();
        if (active) {
          setStats(data);
          setError('');
        }
      } catch {
        if (active) setError('Không tải được số liệu tổng quan.');
      } finally {
        if (active) setLoading(false);
      }
    };

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    loadStats();
    socket.on('order_updated', loadStats);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.connect();

    return () => {
      active = false;
      socket.off('order_updated', loadStats);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.disconnect();
    };
  }, [fetchStats]);

  const formatCurrency = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Trung tâm Điều hành Đa chi nhánh</h2>
          <p className="text-sm text-slate-500">Đồng bộ doanh thu &amp; đơn hàng toàn hệ thống theo thời gian thực</p>
        </div>
        <span className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${
          connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
        }`}
        >
          <Activity className={`h-4 w-4 ${connected ? 'animate-pulse' : ''}`} />
          {connected ? 'Live Sync' : 'Đang kết nối'}
        </span>
      </div>

      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <article className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="rounded-xl bg-indigo-100 p-3 text-indigo-600">
            <DollarSign className="h-7 w-7" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Tổng giá trị đơn hàng</p>
            <p className="text-2xl font-bold text-slate-800">{formatCurrency(stats.summary.TotalRevenue)}</p>
          </div>
        </article>

        <article className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="rounded-xl bg-emerald-100 p-3 text-emerald-600">
            <DollarSign className="h-7 w-7" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Doanh thu đã thanh toán</p>
            <p className="text-2xl font-bold text-emerald-600">{formatCurrency(stats.summary.PaidRevenue)}</p>
          </div>
        </article>

        <article className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="rounded-xl bg-amber-100 p-3 text-amber-600">
            <ShoppingBag className="h-7 w-7" />
          </div>
          <div>
            <p className="text-sm text-slate-500">Tổng số đơn toàn chuỗi</p>
            <p className="text-2xl font-bold text-slate-800">{stats.summary.TotalOrders} đơn</p>
          </div>
        </article>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          Đang tải số liệu...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 flex items-center gap-2 font-bold text-slate-800">
              <Building2 className="h-5 w-5 text-indigo-600" />
              Doanh thu theo từng chi nhánh
            </h3>
            <div className="space-y-4">
              {stats.byBranch.map((branch) => (
                <div key={branch.BranchID} className="flex items-center justify-between rounded-xl bg-slate-50 p-4">
                  <div>
                    <p className="font-bold text-slate-800">{branch.BranchName}</p>
                    <p className="text-xs text-slate-500">{branch.OrderCount} đơn hàng</p>
                  </div>
                  <p className="text-lg font-bold text-indigo-600">{formatCurrency(branch.Revenue)}</p>
                </div>
              ))}
              {stats.byBranch.length === 0 && (
                <p className="text-sm text-slate-500">Chưa có dữ liệu chi nhánh.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 font-bold text-slate-800">Đơn hàng mới nhất toàn chuỗi</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Mã</th>
                    <th className="px-3 py-2">Chi nhánh</th>
                    <th className="px-3 py-2">Bàn</th>
                    <th className="px-3 py-2">Tổng tiền</th>
                    <th className="px-3 py-2">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {stats.recentOrders.map((order) => (
                    <tr key={order.OrderID}>
                      <td className="px-3 py-2.5 font-semibold">#{order.OrderID}</td>
                      <td className="px-3 py-2.5">{order.BranchName}</td>
                      <td className="px-3 py-2.5">{order.TableName || '—'}</td>
                      <td className="px-3 py-2.5 font-semibold">{formatCurrency(order.TotalAmount)}</td>
                      <td className="px-3 py-2.5">
                        <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">
                          {order.Status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {stats.recentOrders.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">Chưa có đơn hàng.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default CentralDashboard;
