import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, Clock, Flame } from 'lucide-react';
import { api, socket } from '../services/api';

function KitchenKDS({ branchId }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState('');

  const fetchKdsOrders = useCallback(async () => {
    if (!branchId) return [];
    const { data } = await api.get(`/kds/${branchId}`);
    return data;
  }, [branchId]);

  useEffect(() => {
    let active = true;
    setOrders([]);
    setError('');
    setLoading(Boolean(branchId));

    const loadOrders = async () => {
      try {
        const data = await fetchKdsOrders();
        if (active) {
          setOrders(data);
          setError('');
        }
      } catch {
        if (active) setError('Không tải được danh sách đơn bếp.');
      } finally {
        if (active) setLoading(false);
      }
    };

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    if (branchId) {
      loadOrders();
      socket.on('order_updated', loadOrders);
      socket.on('connect', handleConnect);
      socket.on('disconnect', handleDisconnect);
      socket.connect();
    } else {
      setConnected(false);
    }

    return () => {
      active = false;
      socket.off('order_updated', loadOrders);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.disconnect();
    };
  }, [branchId, fetchKdsOrders]);

  const updateStatus = async (orderId, status) => {
    setUpdatingOrderId(orderId);
    setError('');
    try {
      await api.patch(`/orders/${orderId}/status`, { status });
      setOrders(await fetchKdsOrders());
    } catch {
      setError('Không cập nhật được trạng thái đơn hàng. Vui lòng thử lại.');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  return (
    <section>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Màn hình Bếp (KDS) - Real-time</h2>
          <p className="text-sm text-slate-500">Đơn hàng mới từ nhân viên order sẽ tự động hiển thị tại đây</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full bg-indigo-100 px-4 py-1.5 text-sm font-semibold text-indigo-700">
            Đang xử lý: {orders.length} đơn
          </span>
          <span className="text-xs text-slate-500" role="status">
            Thời gian thực: {connected ? 'Đã kết nối' : 'Đang kết nối...'}
          </span>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-rose-600" role="alert">{error}</p>}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-500">
          Đang tải đơn hàng...
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-400">
          {branchId ? 'Hiện chưa có đơn hàng nào đang chờ chế biến.' : 'Vui lòng chọn chi nhánh.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {orders.map((order) => (
            <article
              key={order.OrderID}
              className="flex flex-col justify-between overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm"
            >
              <div>
                <div className={`flex items-center justify-between px-4 py-3 font-bold text-white ${
                  order.Status === 'Chờ chế biến'
                    ? 'bg-rose-500'
                    : order.Status === 'Đang chế biến'
                      ? 'bg-amber-500'
                      : 'bg-emerald-600'
                }`}
                >
                  <span>Đơn #{order.OrderID} - {order.TableName}</span>
                  <span className="rounded-full bg-black/20 px-2.5 py-1 text-xs">{order.Status}</span>
                </div>

                <div className="space-y-2 p-4">
                  <div className="mb-3 flex items-center gap-1.5 text-xs text-slate-400">
                    <Clock className="h-3.5 w-3.5" />
                    {new Date(order.CreatedAt).toLocaleTimeString('vi-VN')}
                  </div>
                  {(order.items || []).map((item) => (
                    <div key={item.OrderItemID} className="flex items-center justify-between border-b pb-2">
                      <div>
                        <span className="font-medium text-slate-800">{item.ProductName}</span>
                        {item.Note && <p className="text-xs text-slate-500">{item.Note}</p>}
                      </div>
                      <span className="rounded-lg bg-slate-100 px-2.5 py-0.5 font-bold text-slate-800">
                        x{item.Quantity}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 border-t bg-slate-50 p-4">
                {order.Status === 'Chờ chế biến' && (
                  <button
                    type="button"
                    onClick={() => updateStatus(order.OrderID, 'Đang chế biến')}
                    disabled={updatingOrderId === order.OrderID}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                  >
                    <Flame className="h-4 w-4" />
                    {updatingOrderId === order.OrderID ? 'Đang cập nhật...' : 'Bắt đầu chế biến'}
                  </button>
                )}
                {order.Status === 'Đang chế biến' && (
                  <button
                    type="button"
                    onClick={() => updateStatus(order.OrderID, 'Hoàn thành')}
                    disabled={updatingOrderId === order.OrderID}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle className="h-4 w-4" />
                    {updatingOrderId === order.OrderID ? 'Đang cập nhật...' : 'Báo xong món'}
                  </button>
                )}
                {order.Status === 'Hoàn thành' && (
                  <div className="w-full py-2 text-center text-sm font-semibold text-emerald-700">
                    Đã sẵn sàng mang ra bàn
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default KitchenKDS;
