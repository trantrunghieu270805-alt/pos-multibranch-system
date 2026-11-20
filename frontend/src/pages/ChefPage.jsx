import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Clock3, Flame } from 'lucide-react';
import RoleLayout from '../components/RoleLayout';
import { api, socket } from '../services/api';

function ChefPage() {
  const [orders, setOrders] = useState([]);
  const [busyOrder, setBusyOrder] = useState(null);
  const [error, setError] = useState('');

  const loadOrders = useCallback(async () => {
    const { data } = await api.get('/chef/orders');
    setOrders(data);
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        await loadOrders();
        if (active) setError('');
      } catch {
        if (active) setError('Không tải được đơn hàng của chi nhánh.');
      }
    };
    refresh();
    socket.on('order_updated', refresh);
    return () => {
      active = false;
      socket.off('order_updated', refresh);
    };
  }, [loadOrders]);

  const updateStatus = async (order, status) => {
    setBusyOrder(order.OrderID);
    setError('');
    try {
      await api.patch(`/chef/orders/${order.OrderID}/status`, { status });
      await loadOrders();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể cập nhật trạng thái đơn.');
    } finally {
      setBusyOrder(null);
    }
  };

  return (
    <RoleLayout title="Màn hình bếp · KDS">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Đơn chờ chế biến</h2>
          <p className="text-sm text-slate-500">Chỉ hiển thị đơn đã được quản lý duyệt thuộc chi nhánh của bạn.</p>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700">{orders.length} đơn</span>
      </div>
      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {orders.map((order) => (
          <article key={order.OrderID} className="flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div>
              <div className={`flex items-center justify-between px-4 py-3 font-bold text-white ${order.Status === 'Chờ chế biến' ? 'bg-rose-500' : 'bg-amber-500'}`}>
                <span>Đơn #{order.OrderID}{order.TableName ? ` · ${order.TableName}` : ''}</span>
                <span className="rounded-full bg-black/20 px-2.5 py-1 text-xs">{order.Status}</span>
              </div>
              <div className="space-y-3 p-4">
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock3 className="h-3.5 w-3.5" />{new Date(order.CreatedAt).toLocaleTimeString('vi-VN')}
                  <span className="ml-auto">{order.DeliveryArea}</span>
                </p>
                {order.items.map((item) => (
                  <div key={item.OrderItemID} className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm">
                    <span className="font-medium text-slate-800">{item.ProductName}</span>
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1 font-bold">×{item.Quantity}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t bg-slate-50 p-4">
              {order.Status === 'Chờ chế biến' ? (
                <button type="button" disabled={busyOrder === order.OrderID}
                  onClick={() => updateStatus(order, 'Đang chế biến')}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
                  <Flame className="h-4 w-4" /> Bắt đầu nấu
                </button>
              ) : (
                <button type="button" disabled={busyOrder === order.OrderID}
                  onClick={() => updateStatus(order, 'Bếp hoàn thành')}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                  <CheckCircle className="h-4 w-4" /> Báo cáo hoàn thành món
                </button>
              )}
            </div>
          </article>
        ))}
        {!orders.length && !error && (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
            Hiện chưa có đơn hàng cần chế biến.
          </div>
        )}
      </div>
    </RoleLayout>
  );
}

export default ChefPage;
