import { useEffect, useState } from 'react';
import { socket } from '../services/api';

function KitchenKDS() {
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.connect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.disconnect();
    };
  }, []);

  return (
    <section>
      <h1>Màn hình bếp (KDS)</h1>
      <div className="panel">
        <p className="muted">
          Trạng thái kết nối thời gian thực: <strong>{connected ? 'Đã kết nối' : 'Đang ngắt kết nối'}</strong>
        </p>
        <p>Order mới sẽ hiển thị tại đây khi API phát sự kiện bếp.</p>
      </div>
    </section>
  );
}

export default KitchenKDS;
