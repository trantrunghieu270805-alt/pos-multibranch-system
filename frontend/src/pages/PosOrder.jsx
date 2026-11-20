import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Minus, Plus, Send, ShoppingCart, Trash2, UtensilsCrossed } from 'lucide-react';
import { api, socket } from '../services/api';

function PosOrder({ branchId }) {
  const [tables, setTables] = useState([]);
  const [menu, setMenu] = useState({ categories: [], products: [] });
  const [selectedCategory, setSelectedCategory] = useState(0);
  const [selectedTable, setSelectedTable] = useState(null);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [menuError, setMenuError] = useState('');
  const [tableError, setTableError] = useState('');
  const [actionError, setActionError] = useState('');

  const refreshTables = useCallback(async () => {
    if (!branchId) return [];
    const { data } = await api.get(`/tables/${branchId}`);
    return data;
  }, [branchId]);

  useEffect(() => {
    let active = true;
    api.get('/menu')
      .then(({ data }) => {
        if (active) setMenu(data);
      })
      .catch(() => {
        if (active) setMenuError('Không tải được thực đơn. Hãy kiểm tra kết nối API.');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setTables([]);
    setSelectedTable(null);
    setCart([]);
    setTablesLoading(Boolean(branchId));
    setTableError('');

    const loadTables = async () => {
      try {
        const data = await refreshTables();
        if (!active) return;
        setTables(data);
        setTableError('');
        setSelectedTable((current) => (
          current ? data.find((table) => table.TableID === current.TableID) || null : null
        ));
      } catch {
        if (active) setTableError('Không tải được danh sách bàn.');
      } finally {
        if (active) setTablesLoading(false);
      }
    };

    if (branchId) {
      loadTables();
      socket.on('order_updated', loadTables);
      socket.connect();
    }

    return () => {
      active = false;
      socket.off('order_updated', loadTables);
      socket.disconnect();
    };
  }, [branchId, refreshTables]);

  const addToCart = (product) => {
    if (selectedTable?.Status !== 'Trống') return;
    setCart((previous) => {
      const existing = previous.find((item) => item.ProductID === product.ProductID);
      if (existing) {
        return previous.map((item) => (
          item.ProductID === product.ProductID
            ? { ...item, quantity: item.quantity + 1 }
            : item
        ));
      }
      return [...previous, { ...product, quantity: 1, note: '' }];
    });
  };

  const updateQuantity = (productId, delta) => {
    setCart((previous) => previous
      .map((item) => (
        item.ProductID === productId
          ? { ...item, quantity: item.quantity + delta }
          : item
      ))
      .filter((item) => item.quantity > 0));
  };

  const handleSubmitOrder = async () => {
    if (!selectedTable || selectedTable.Status !== 'Trống' || cart.length === 0) return;
    setLoading(true);
    setActionError('');
    try {
      await api.post('/orders', {
        branchId,
        tableId: selectedTable.TableID,
        items: cart,
      });
      setCart([]);
      window.alert(`Đã gửi đơn cho ${selectedTable.TableName} xuống Bếp!`);
    } catch {
      setActionError('Không gửi được đơn hàng. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const handlePayOrder = async (orderId) => {
    if (!window.confirm('Xác nhận khách đã thanh toán và giải phóng bàn?')) return;
    setPaymentLoading(true);
    setActionError('');
    try {
      await api.patch(`/orders/${orderId}/status`, { status: 'Đã thanh toán' });
      setSelectedTable(null);
    } catch {
      setActionError('Không thể thanh toán đơn hàng. Vui lòng thử lại.');
    } finally {
      setPaymentLoading(false);
    }
  };

  const filteredProducts = selectedCategory === 0
    ? menu.products
    : menu.products.filter((product) => product.CategoryID === selectedCategory);
  const totalCart = cart.reduce((sum, item) => sum + Number(item.Price) * item.quantity, 0);
  const canAddItems = selectedTable?.Status === 'Trống';
  const error = actionError || tableError || menuError;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="space-y-6 lg:col-span-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-bold text-slate-800">1. Chọn bàn phục vụ</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {tables.map((table) => {
              const isBusy = table.Status === 'Đang phục vụ';
              const isSelected = selectedTable?.TableID === table.TableID;
              return (
                <button
                  type="button"
                  key={table.TableID}
                  onClick={() => setSelectedTable(table)}
                  aria-pressed={isSelected}
                  className={`rounded-xl border-2 p-3 text-center transition ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200'
                      : isBusy
                        ? 'border-amber-300 bg-amber-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="block font-bold text-slate-800">{table.TableName}</span>
                  <span className={`mt-1 block text-xs font-medium ${
                    isBusy ? 'text-amber-600' : 'text-emerald-600'
                  }`}
                  >
                    {table.Status}
                  </span>
                </button>
              );
            })}
            {branchId && tables.length === 0 && !tablesLoading && !tableError && (
              <p className="col-span-full text-sm text-slate-500">Chi nhánh chưa có bàn.</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-slate-800">2. Thực đơn món</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategory(0)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  selectedCategory === 0 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                Tất cả
              </button>
              {menu.categories.map((category) => (
                <button
                  type="button"
                  key={category.CategoryID}
                  onClick={() => setSelectedCategory(category.CategoryID)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    selectedCategory === category.CategoryID
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {category.CategoryName}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {filteredProducts.map((product) => (
              <button
                type="button"
                key={product.ProductID}
                onClick={() => addToCart(product)}
                disabled={!canAddItems}
                className="group overflow-hidden rounded-xl border border-slate-200 text-left transition hover:border-indigo-400 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex h-28 items-center justify-center bg-slate-100">
                  {product.ImageUrl
                    ? <img src={product.ImageUrl} alt={product.ProductName} className="h-full w-full object-cover" />
                    : <UtensilsCrossed className="h-8 w-8 text-slate-400" aria-hidden="true" />}
                </div>
                <div className="p-3">
                  <span className="block truncate text-sm font-semibold text-slate-800">{product.ProductName}</span>
                  <span className="mt-1 block text-sm font-bold text-indigo-600">
                    {Number(product.Price).toLocaleString('vi-VN')}đ
                  </span>
                </div>
              </button>
            ))}
            {filteredProducts.length === 0 && (
              <p className="col-span-full py-4 text-sm text-slate-500">Không có món trong danh mục này.</p>
            )}
          </div>
          {!canAddItems && (
            <p className="mt-4 text-sm text-slate-500">
              Chọn một bàn trống để thêm món vào giỏ hàng.
            </p>
          )}
        </section>
      </div>

      <aside className="lg:col-span-4">
        <section className="sticky top-24 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <ShoppingCart className="h-5 w-5 text-indigo-600" />
              <span>{selectedTable ? `Đơn hàng - ${selectedTable.TableName}` : 'Chưa chọn bàn'}</span>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setCart([])}
                aria-label="Xóa toàn bộ giỏ hàng"
                className="text-rose-500 hover:text-rose-700"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          {error && <p className="mb-4 text-sm text-rose-600" role="alert">{error}</p>}

          {selectedTable?.ActiveOrderID && (
            <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div>
                <p className="text-xs font-medium text-amber-800">Đơn #{selectedTable.ActiveOrderID} đang mở</p>
                <p className="font-bold text-amber-900">
                  {Number(selectedTable.ActiveTotal).toLocaleString('vi-VN')}đ
                </p>
              </div>
              <button
                type="button"
                onClick={() => handlePayOrder(selectedTable.ActiveOrderID)}
                disabled={paymentLoading}
                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {paymentLoading ? 'Đang xử lý...' : 'Thanh toán'}
              </button>
            </div>
          )}

          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {cart.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">Chọn bàn trống và nhấn món để thêm</p>
            ) : (
              cart.map((item) => (
                <div key={item.ProductID} className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{item.ProductName}</p>
                    <p className="text-xs text-slate-500">
                      {(Number(item.Price) * item.quantity).toLocaleString('vi-VN')}đ
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.ProductID, -1)}
                      aria-label={`Giảm số lượng ${item.ProductName}`}
                      className="rounded-md border bg-white p-1 hover:bg-slate-100"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-5 text-center text-sm font-bold">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(item.ProductID, 1)}
                      aria-label={`Tăng số lượng ${item.ProductName}`}
                      className="rounded-md border bg-white p-1 hover:bg-slate-100"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 border-t pt-4">
            <div className="mb-4 flex justify-between text-lg font-bold text-slate-800">
              <span>Tổng cộng:</span>
              <span className="text-indigo-600">{totalCart.toLocaleString('vi-VN')}đ</span>
            </div>
            <button
              type="button"
              disabled={!canAddItems || cart.length === 0 || loading}
              onClick={handleSubmitOrder}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 font-semibold text-white transition hover:bg-indigo-700 disabled:bg-slate-300"
            >
              <Send className="h-4 w-4" />
              {loading ? 'Đang gửi...' : 'Gửi đơn xuống Bếp'}
            </button>
          </div>
        </section>
      </aside>
    </div>
  );
}

export default PosOrder;
