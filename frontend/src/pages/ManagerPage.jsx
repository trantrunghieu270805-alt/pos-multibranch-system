import { useCallback, useEffect, useState } from 'react';
import { Activity, Building2, ClipboardList, DollarSign, Truck } from 'lucide-react';
import RoleLayout from '../components/RoleLayout';
import { api, socket } from '../services/api';

function ManagerPage() {
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState({ summary: {}, byBranch: [], recentOrders: [] });
  const [tables, setTables] = useState([]);
  const [shippers, setShippers] = useState({});
  const [selectedShipper, setSelectedShipper] = useState({});
  const [busyOrder, setBusyOrder] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadData = useCallback(async () => {
    const [orderResponse, statsResponse, tableResponse] = await Promise.all([
      api.get('/manager/orders'),
      api.get('/manager/stats'),
      api.get('/manager/tables'),
    ]);
    setOrders(orderResponse.data);
    setStats(statsResponse.data);
    setTables(tableResponse.data);

    const areas = [...new Set(orderResponse.data
      .filter((order) => order.Status === 'Bếp hoàn thành' && !order.ShipperID)
      .map((order) => order.DeliveryArea)
      .filter(Boolean))];
    const shipperResponses = await Promise.all(areas.map(async (area) => {
      const { data } = await api.get('/manager/shippers', { params: { area } });
      return [area, data];
    }));
    setShippers(Object.fromEntries(shipperResponses));
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        await loadData();
        if (active) setError('');
      } catch {
        if (active) setError('Không tải được dữ liệu điều phối và thống kê.');
      }
    };

    refresh();
    socket.on('order_updated', refresh);
    return () => {
      active = false;
      socket.off('order_updated', refresh);
    };
  }, [loadData]);

  const runOrderAction = async (order, action) => {
    setBusyOrder(order.OrderID);
    setError('');
    setNotice('');
    try {
      if (action === 'approve') {
        await api.post(`/manager/orders/${order.OrderID}/approve`);
        setNotice(`Đã duyệt đơn #${order.OrderID} và chuyển xuống bếp.`);
      } else {
        const shipperId = Number(selectedShipper[order.OrderID]);
        if (!shipperId) {
          setError('Hãy chọn Shipper trước khi điều phối.');
          return;
        }
        await api.post(`/manager/orders/${order.OrderID}/dispatch`, { shipperId });
        setNotice(`Đã giao đơn #${order.OrderID} cho Shipper.`);
      }
      await loadData();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể cập nhật đơn hàng.');
    } finally {
      setBusyOrder(null);
    }
  };

  const formatMoney = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;

  return (
    <RoleLayout title="Điều phối & thống kê">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setTab('orders')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${tab === 'orders' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}>
          <ClipboardList className="h-4 w-4" /> Duyệt đơn & điều phối
        </button>
        <button type="button" onClick={() => setTab('stats')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${tab === 'stats' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}>
          <Activity className="h-4 w-4" /> Thống kê & bàn
        </button>
      </div>

      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
      {notice && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700" role="status">{notice}</p>}

      {tab === 'orders' ? (
        <section>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-800">Đơn hàng toàn hệ thống</h2>
              <p className="text-sm text-slate-500">Danh sách cập nhật tự động khi đơn hàng thay đổi.</p>
            </div>
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">{orders.length} đơn</span>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {orders.map((order) => (
              <article key={order.OrderID} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-800">Đơn #{order.OrderID} · {order.BranchName}</h3>
                    <p className="mt-1 text-xs text-slate-500">{new Date(order.CreatedAt).toLocaleString('vi-VN')}</p>
                  </div>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{order.Status}</span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-slate-500">Khách hàng</p><p className="font-medium">{order.CustomerName || '—'}</p></div>
                  <div><p className="text-xs text-slate-500">Điện thoại</p><p className="font-medium">{order.CustomerPhone || '—'}</p></div>
                  <div><p className="text-xs text-slate-500">Khu vực</p><p className="font-medium">{order.DeliveryArea || '—'}</p></div>
                  <div><p className="text-xs text-slate-500">Tổng tiền</p><p className="font-bold text-indigo-600">{formatMoney(order.TotalAmount)}</p></div>
                </div>
                <p className="mt-3 text-sm text-slate-600">{order.DeliveryAddress || 'Không có địa chỉ giao hàng'}</p>
                <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  {(order.items || []).map((item) => <li key={item.OrderItemID}>{item.ProductName} × {item.Quantity}</li>)}
                </ul>

                {order.Status === 'Chờ duyệt' && (
                  <button type="button" disabled={busyOrder === order.OrderID}
                    onClick={() => runOrderAction(order, 'approve')}
                    className="mt-4 w-full rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                    {busyOrder === order.OrderID ? 'Đang xử lý...' : 'Duyệt đơn'}
                  </button>
                )}
                {order.Status === 'Bếp hoàn thành' && !order.ShipperID && (
                  <div className="mt-4 flex gap-2">
                    <select aria-label={`Chọn Shipper cho đơn ${order.OrderID}`}
                      value={selectedShipper[order.OrderID] || ''}
                      onChange={(event) => setSelectedShipper((current) => ({ ...current, [order.OrderID]: event.target.value }))}
                      className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-sm">
                      <option value="">Shipper · {order.DeliveryArea}</option>
                      {(shippers[order.DeliveryArea] || []).map((shipper) => (
                        <option key={shipper.UserID} value={shipper.UserID}>
                          {shipper.FullName}{shipper.Phone ? ` · ${shipper.Phone}` : ''}
                        </option>
                      ))}
                    </select>
                    <button type="button" disabled={busyOrder === order.OrderID || !(shippers[order.DeliveryArea] || []).length}
                      onClick={() => runOrderAction(order, 'dispatch')}
                      className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300">
                      <Truck className="h-4 w-4" /> Giao
                    </button>
                  </div>
                )}
                {order.ShipperName && <p className="mt-3 text-sm text-emerald-700">Shipper: {order.ShipperName} · {order.ShipperPhone || 'Chưa có SĐT'}</p>}
              </article>
            ))}
            {!orders.length && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 lg:col-span-2">Chưa có đơn hàng.</div>}
          </div>
        </section>
      ) : (
        <section className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard icon={<DollarSign />} label="Tổng giá trị đơn" value={formatMoney(stats.summary.TotalRevenue)} />
            <StatCard icon={<DollarSign />} label="Doanh thu hoàn tất" value={formatMoney(stats.summary.PaidRevenue)} />
            <StatCard icon={<ClipboardList />} label="Tổng số đơn" value={`${stats.summary.TotalOrders || 0} đơn`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 flex items-center gap-2 font-bold text-slate-800"><Building2 className="h-5 w-5 text-indigo-600" /> Doanh thu theo chi nhánh</h2>
              <div className="space-y-3">
                {stats.byBranch.map((branch) => (
                  <div key={branch.BranchID} className="flex justify-between rounded-xl bg-slate-50 p-4">
                    <div><p className="font-semibold">{branch.BranchName}</p><p className="text-xs text-slate-500">{branch.OrderCount} đơn</p></div>
                    <p className="font-bold text-indigo-600">{formatMoney(branch.Revenue)}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="mb-4 font-bold text-slate-800">Đơn hàng mới nhất</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="text-xs text-slate-500"><th className="py-2">Mã</th><th>Chi nhánh</th><th>Tổng tiền</th><th>Trạng thái</th></tr></thead>
                  <tbody className="divide-y">
                    {stats.recentOrders.map((order) => (
                      <tr key={order.OrderID}><td className="py-2.5">#{order.OrderID}</td><td>{order.BranchName}</td><td>{formatMoney(order.TotalAmount)}</td><td>{order.Status}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 font-bold text-slate-800">Bàn theo chi nhánh</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tables.map((table) => (
                <div key={table.TableID} className="rounded-xl bg-slate-50 p-4">
                  <p className="font-semibold">{table.TableName}</p>
                  <p className="text-xs text-slate-500">{table.BranchName}</p>
                  <p className={`mt-2 text-sm font-semibold ${table.Status === 'Available' ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {table.Status === 'Available' ? 'Trống' : 'Đang phục vụ'}
                  </p>
                </div>
              ))}
              {!tables.length && <p className="text-sm text-slate-500">Chưa có dữ liệu bàn.</p>}
            </div>
          </div>
        </section>
      )}
    </RoleLayout>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="rounded-xl bg-indigo-50 p-3 text-indigo-600">{icon}</div>
      <div><p className="text-sm text-slate-500">{label}</p><p className="text-xl font-bold text-slate-800">{value}</p></div>
    </div>
  );
}

export default ManagerPage;
