import { useState } from 'react';
import Navbar from './components/Navbar';
import CentralDashboard from './pages/CentralDashboard';
import KitchenKDS from './pages/KitchenKDS';
import PosOrder from './pages/PosOrder';

const pages = {
  order: PosOrder,
  kitchen: KitchenKDS,
  dashboard: CentralDashboard,
};

function App() {
  const [page, setPage] = useState('order');
  const [branchId, setBranchId] = useState('');
  const Page = pages[page];

  return (
    <div className="app-shell">
      <Navbar page={page} onPageChange={setPage} branchId={branchId} onBranchChange={setBranchId} />
      <main>
        <Page branchId={branchId} />
      </main>
    </div>
  );
}

export default App;
