import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Minus, PackageCheck, Plus, ShoppingBag } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import RoleLayout from '../components/RoleLayout';
import { api, socket } from '../services/api';
import { deliveryAreas } from '../constants';

const AutoLocationButton = lazy(() => import('../components/AutoLocationButton'));

function CustomerPage() {
  const { user } = useAuth();
  const [branches, setBranches] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [branchId, setBranchId] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryArea, setDeliveryArea] = useState('');
  const [coords, setCoords] = useState({ latitude: null, longitude: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [paymentLoadingOrder, setPaymentLoadingOrder] = useState(null);

  const refreshOrders = useCallback(async () => {
    const { data } = await api.get('/customer/orders');
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([api.get('/branches'), api.get('/menu')])
      .then(([branchResponse, menuResponse]) => {
        if (!active) return;
        setBranches(branchResponse.data);
        setProducts(menuResponse.data.products);
        setBranchId((current) => current || String(branchResponse.data[0]?.BranchID || ''));
      })
      .catch(() => {
        if (active) setError('Không tải được chi nhánh hoặc thực đơn.');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadOrders = async () => {
      try {
        const data = await refreshOrders();
        if (active) setOrders(data);
      } catch {
        if (active) setError('Không tải được lịch sử đơn hàng.');
      }
    };

    loadOrders();
    socket.on('order_updated', loadOrders);
    return () => {
      active = false;
      socket.off('order_updated', loadOrders);
    };
  }, [refreshOrders]);

  const addProduct = (product) => {
    setCart((current) => {
      const existing = current.find((item) => item.ProductID === product.ProductID);
      return existing
        ? current.map((item) => item.ProductID === product.ProductID
          ? { ...item, quantity: item.quantity + 1 }
          : item)
        : [...current, { ...product, quantity: 1 }];
    });
  };

  const changeQuantity = (productId, delta) => {
    setCart((current) => current
      .map((item) => item.ProductID === productId
        ? { ...item, quantity: item.quantity + delta }
        : item)
      .filter((item) => item.quantity > 0));
  };

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.Price) * item.quantity, 0),
    [cart],
  );

  const paymentQrUrlFor = (order) => {
    const bankId = import.meta.env.VITE_BANK_ID;
    const accountNo = import.meta.env.VITE_ACCOUNT_NO;
    const accountName = import.meta.env.VITE_ACCOUNT_NAME;
    if (!bankId || !accountNo || !accountName) return '';

    const params = new URLSearchParams({
      amount: String(order.TotalAmount),
      addInfo: `THANHTOAN DON ${order.OrderID}`,
      accountName,
    });
    return `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(accountNo)}-compact2.png?${params}`;
  };

  const confirmPayment = async (order) => {
    setPaymentLoadingOrder(order.OrderID);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/customer/orders/${order.OrderID}/payment-confirmation`);
      setOrders((current) => current.map((item) => (
        item.OrderID === order.OrderID ? { ...item, Status: data.status } : item
      )));
      setNotice(`Đã báo chuyển khoản cho đơn #${order.OrderID}. Quản lý sẽ đối chiếu giao dịch.`);
      try {
        setOrders(await refreshOrders());
      } catch {
        setError('Đã ghi nhận thông báo thanh toán nhưng không tải lại được lịch sử đơn hàng.');
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể gửi thông báo thanh toán.');
    } finally {
      setPaymentLoadingOrder(null);
    }
  };

  const submitOrder = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post('/customer/orders', {
        branchId: Number(branchId),
        deliveryAddress,
        deliveryArea,
        latitude: coords.latitude,
        longitude: coords.longitude,
        items: cart.map(({ ProductID, quantity }) => ({ ProductID, quantity })),
      });
      const newOrder = {
        OrderID: data.orderId,
        BranchName: branches.find((branch) => String(branch.BranchID) === branchId)?.BranchName || '',
        CreatedAt: new Date().toISOString(),
        Status: data.status,
        DeliveryAddress: deliveryAddress,
        DeliveryArea: deliveryArea,
        TotalAmount: data.totalAmount,
        items: cart.map((item) => ({
          OrderItemID: `${data.orderId}-${item.ProductID}`,
          ProductName: item.ProductName,
          Quantity: item.quantity,
        })),
      };
      setOrders((current) => [newOrder, ...current.filter((order) => order.OrderID !== data.orderId)]);
      setCart([]);
      setDeliveryAddress('');
      setCoords({ latitude: null, longitude: null });
      setNotice(`Đã tạo đơn hàng #${data.orderId}. Hãy thanh toán bằng QR trong lịch sử đơn rồi báo đã chuyển khoản.`);
      try {
        setOrders(await refreshOrders());
      } catch {
        setError('Đơn đã được tạo nhưng không tải được lịch sử đơn hàng.');
      }
    } catch (requestError) {
      setError(requestError.response?.data?.error || 'Không thể tạo đơn hàng.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <RoleLayout title="Đặt hàng">
      <section className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-indigo-600" />
              <h2 className="font-bold text-slate-800">Thực đơn</h2>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {products.map((product) => (
                <button key={product.ProductID} type="button" onClick={() => addProduct(product)}
                  className="overflow-hidden rounded-xl border border-slate-200 text-left hover:border-indigo-400 hover:shadow-sm">
                  <div className="flex h-28 items-center justify-center bg-slate-100">
                    {product.ImageUrl
                      ? <img src={product.ImageUrl} alt={product.ProductName} className="h-full w-full object-cover" />
                      : <ShoppingBag className="h-8 w-8 text-slate-400" />}
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-semibold text-slate-800">{product.ProductName}</p>
                    <p className="mt-1 font-bold text-indigo-600">{Number(product.Price).toLocaleString('vi-VN')}đ</p>
                  </div>
                </button>
              ))}
              {products.length === 0 && <p className="col-span-full text-sm text-slate-500">Chưa có món trong thực đơn.</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 font-bold text-slate-800">Lịch sử và trạng thái đơn hàng</h2>
            <div className="space-y-3">
              {orders.map((order) => (
                <article key={order.OrderID} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800">Đơn #{order.OrderID} · {order.BranchName}</p>
                      <p className="text-xs text-slate-500">{new Date(order.CreatedAt).toLocaleString('vi-VN')}</p>
                    </div>
                    <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">{order.Status}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{order.DeliveryAddress} · {order.DeliveryArea}</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{Number(order.TotalAmount).toLocaleString('vi-VN')}đ</p>
                  {order.Status === 'Chờ thanh toán' && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <p className="font-semibold text-amber-900">Thanh toán đơn #{order.OrderID}</p>
                      {paymentQrUrlFor(order) ? (
                        <img
                          src={paymentQrUrlFor(order)}
                          alt={`Mã QR thanh toán đơn hàng ${order.OrderID}`}
                          className="mx-auto mt-2 w-full max-w-56 rounded-lg bg-white p-2"
                        />
                      ) : (
                        <p className="mt-2 text-sm text-rose-700" role="alert">
                          Chưa cấu hình tài khoản nhận thanh toán.
                        </p>
                      )}
                      <p className="mt-2 text-xs text-slate-600">
                        Nội dung: THANHTOAN DON {order.OrderID}. Sau khi chuyển khoản, hãy báo đã thanh toán để quản lý đối chiếu.
                      </p>
                      <button
                        type="button"
                        onClick={() => confirmPayment(order)}
                        disabled={paymentLoadingOrder === order.OrderID}
                        className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        {paymentLoadingOrder === order.OrderID ? 'Đang gửi...' : 'Tôi đã chuyển khoản'}
                      </button>
                    </div>
                  )}
                  {order.Status === 'Chờ xác nhận thanh toán' && (
                    <p className="mt-3 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-800" role="status">
                      Đã báo chuyển khoản. Đơn đang chờ quản lý đối chiếu giao dịch ngân hàng.
                    </p>
                  )}
                  {order.ShipperName && (
                    <p className="mt-1 text-sm text-emerald-700">
                      Shipper: {order.ShipperName}{order.ShipperPhone ? ` · ${order.ShipperPhone}` : ''}
                    </p>
                  )}
                  <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    {(order.items || []).map((item) => (
                      <li key={item.OrderItemID}>{item.ProductName} × {item.Quantity}</li>
                    ))}
                  </ul>
                </article>
              ))}
              {orders.length === 0 && <p className="text-sm text-slate-500">Bạn chưa có đơn hàng.</p>}
            </div>
          </div>
        </div>

        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-24">
          <h2 className="mb-4 font-bold text-slate-800">Thông tin giao hàng</h2>
          <form onSubmit={submitOrder} className="space-y-4">
            <label className="block space-y-1 text-sm font-medium text-slate-700">
              Chi nhánh
              <select required value={branchId} onChange={(event) => setBranchId(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="" disabled>Chọn chi nhánh</option>
                {branches.map((branch) => <option key={branch.BranchID} value={branch.BranchID}>{branch.BranchName}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-700">
              Khu vực giao hàng
              <select required value={deliveryArea} onChange={(event) => setDeliveryArea(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="" disabled>Chọn khu vực</option>
                {deliveryAreas.map((area) => <option key={area} value={area}>{area}</option>)}
              </select>
            </label>
            <Suspense fallback={<p className="text-sm text-slate-500">Đang tải chức năng định vị...</p>}>
              <AutoLocationButton onLocationFound={({ address, area, latitude, longitude }) => {
                setDeliveryAddress(address);
                setDeliveryArea(area);
                setCoords({ latitude, longitude });
              }} />
            </Suspense>
            <label className="block space-y-1 text-sm font-medium text-slate-700">
              Địa chỉ chi tiết
              <textarea required maxLength={255} rows={3} value={deliveryAddress}
                onChange={(event) => {
                  setDeliveryAddress(event.target.value);
                  setCoords({ latitude: null, longitude: null });
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>

            <div className="space-y-3 border-t pt-4">
              {cart.length === 0 ? <p className="text-sm text-slate-500">Chọn món để bắt đầu.</p> : cart.map((item) => (
                <div key={item.ProductID} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.ProductName}</p>
                    <p className="text-xs text-slate-500">{(Number(item.Price) * item.quantity).toLocaleString('vi-VN')}đ</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label="Giảm số lượng" onClick={() => changeQuantity(item.ProductID, -1)}
                      className="rounded border p-1"><Minus className="h-3 w-3" /></button>
                    <span className="text-sm font-bold">{item.quantity}</span>
                    <button type="button" aria-label="Tăng số lượng" onClick={() => changeQuantity(item.ProductID, 1)}
                      className="rounded border p-1"><Plus className="h-3 w-3" /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between border-t pt-4 font-bold">
              <span>Tổng cộng</span><span className="text-indigo-600">{total.toLocaleString('vi-VN')}đ</span>
            </div>
            {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
            {notice && <p className="text-sm text-emerald-700" role="status">{notice}</p>}
            <button type="submit" disabled={loading || !cart.length || !branchId}
              className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300">
              {loading ? 'Đang gửi đơn...' : 'Đặt hàng'}
            </button>
          </form>
        </aside>
      </section>
    </RoleLayout>
  );
}

export default CustomerPage;
