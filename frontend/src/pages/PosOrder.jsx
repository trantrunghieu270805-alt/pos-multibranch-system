import { useEffect, useState } from 'react';
import api from '../services/api';

function PosOrder() {
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/products')
      .then(({ data }) => setProducts(data))
      .catch(() => setError('Không tải được thực đơn. Hãy kiểm tra kết nối API.'));
  }, []);

  return (
    <section>
      <h1>Order tại bàn & thanh toán</h1>
      <p className="muted">Chọn món trong thực đơn để bắt đầu tạo order.</p>
      {error && <p role="alert">{error}</p>}
      <div className="product-grid">
        {products.map((product) => (
          <article className="panel product-card" key={product.id}>
            <span className="product-category">{product.category}</span>
            <h2>{product.name}</h2>
            <strong>{Number(product.price).toLocaleString('vi-VN')} ₫</strong>
          </article>
        ))}
        {!error && products.length === 0 && <p className="muted">Chưa có món trong thực đơn.</p>}
      </div>
    </section>
  );
}

export default PosOrder;
