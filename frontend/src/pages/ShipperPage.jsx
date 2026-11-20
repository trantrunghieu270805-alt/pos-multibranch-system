import { useCallback, useEffect, useState } from 'react';
import { MapPin, PackageCheck, Truck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import RoleLayout from '../components/RoleLayout';
import { deliveryAreas } from '../constants';
import { api, socket } from '../services/api';

function ShipperPage() {
  const { user, refreshUser } = useAuth();
  const [area, setArea] = useState(user?.DeliveryArea || '');
  const [orders, setOrders] = useState([]);
  const [savingArea, setSavingArea] = useState(false);
  const [busyOrder, setBusyOrder] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadOrders = useCallback(async () => {
    const { data } = await api.get('/shipper/orders');
    setOrders(data);
  }, []);

  useEffect(() => {
    setArea(user?.DeliveryArea || '');
  }, [user?.DeliveryArea]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        await loadOrders();
        if (active) setError('');
      } catch (requestError) {
        if (active) {
          setOrders([]);
          if (requestError.response?.status !== 409) {
            setError(requestError.response?.data?.error || 'Không tải được danh sách đơn giao.');
          }
        }
      }
    };
    refresh();
    socket.on('order_updated', refresh);
    return () => {
      active = false;
      socket.off('order_updated', refresh);
    };
  }, [loadOrders, user?.DeliveryArea]);

  const saveArea = async (event) => {
    event.preventDefault();
    setSavingArea(true);
    setError('');
    setNotice('');
    try {
      await api.patch('/users/delivery-area', { deliveryArea: area });
      await refreshUser();
      socket.emit('join_delivery_area', area);
      await loadOrders();
      setNotice(`Đã cập nhật khu vực nhận đơn: ${area}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể cập nhật khu vực.');
    } finally {
      setSavingArea(false);
    }
  };

  const updateOrder = async (order, action) => {
    setBusyOrder(order.OrderID);
    setError('');
    setNotice('');
    try {
      if (action === 'claim') {
        await api.post(`/shipper/orders/${order.OrderID}/claim`);
        setNotice(`Bạn đã nhận giao đơn #${order.OrderID}.`);
      } else {
        await api.patch(`/shipper/orders/${order.OrderID}/complete`);
        setNotice(`Đã xác nhận giao xong đơn #${order.OrderID}.`);
      }
      await loadOrders();
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể cập nhật đơn giao.');
    } finally {
      setBusyOrder(null);
    }
  };

  return (
    <RoleLayout title="Đơn giao hàng">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <MapPin className="h-5 w-5 text-indigo-600" />
          <div>
            <h2 className="font-bold text-slate-800">Khu vực phụ trách</h2>
            <p className="text-sm text-slate-500">Có thể cập nhật khu vực bất cứ lúc nào.</p>
          </div>
        </div>
        <form onSubmit={saveArea} className="flex flex-col gap-3 sm:flex-row">
          <select required value={area} onChange={(event) => setArea(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2.5">
            <option value="" disabled>Chọn khu vực giao hàng</option>
            {deliveryAreas.map((deliveryArea) => <option key={deliveryArea} value={deliveryArea}>{deliveryArea}</option>)}
          </select>
          <button type="submit" disabled={savingArea || !area}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300">
            {savingArea ? 'Đang lưu...' : 'Cập nhật khu vực'}
          </button>
        </form>
      </section>

      {error && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
      {notice && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700" role="status">{notice}</p>}

      <section>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Đơn cần giao</h2>
            <p className="text-sm text-slate-500">Đơn bếp hoàn thành trong khu vực và đơn đã được giao cho bạn.</p>
          </div>
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">{orders.length} đơn</span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {orders.map((order) => {
            const canClaim = order.Status === 'Bếp hoàn thành' && !order.ShipperID;
            return (
              <article key={order.OrderID} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-800">Đơn #{order.OrderID} · {order.BranchName}</h3>
                    <p className="mt-1 text-xs text-slate-500">{new Date(order.CreatedAt).toLocaleString('vi-VN')}</p>
                  </div>
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{order.Status}</span>
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <p><span className="text-slate-500">Địa chỉ:</span> <strong>{order.DeliveryAddress}</strong></p>
                  <p><span className="text-slate-500">Khách hàng:</span> {order.CustomerName || '—'}{order.CustomerPhone ? ` · ${order.CustomerPhone}` : ''}</p>
                  <p><span className="text-slate-500">Khu vực:</span> {order.DeliveryArea}</p>
                  <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    {(order.items || []).map((item) => <li key={item.OrderItemID}>{item.ProductName} × {item.Quantity}</li>)}
                  </ul>
                </div>
                {canClaim ? (
                  <button type="button" disabled={busyOrder === order.OrderID}
                    onClick={() => updateOrder(order, 'claim')}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                    <Truck className="h-4 w-4" /> Nhận giao đơn
                  </button>
                ) : (
                  <button type="button" disabled={busyOrder === order.OrderID}
                    onClick={() => updateOrder(order, 'complete')}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
                    <PackageCheck className="h-4 w-4" /> Xác nhận đã giao
                  </button>
                )}
              </article>
            );
          })}
          {!orders.length && !error && (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 lg:col-span-2">
              {area ? 'Chưa có đơn giao trong khu vực này.' : 'Hãy chọn khu vực giao hàng để xem đơn phù hợp.'}
            </div>
          )}
        </div>
      </section>
    </RoleLayout>
  );
}

export default ShipperPage;
