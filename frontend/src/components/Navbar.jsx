import { BarChart3, ChefHat, Store, UtensilsCrossed } from 'lucide-react';

function Navbar({ activeTab, setActiveTab, branches, selectedBranch, setSelectedBranch }) {
  const tabs = [
    { id: 'pos', label: 'Order tại bàn (POS)', icon: UtensilsCrossed },
    { id: 'kds', label: 'Màn hình Bếp (KDS)', icon: ChefHat },
    { id: 'dashboard', label: 'Quản lý Trung tâm', icon: BarChart3 },
  ];

  return (
    <header className="sticky top-0 z-50 bg-slate-900 text-white shadow-lg">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-indigo-500 p-2">
            <Store className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-tight">OmniPOS Chain</h1>
            <p className="text-xs text-slate-400">Hệ thống Bán hàng &amp; KDS Đa chi nhánh</p>
          </div>
        </div>

        <nav aria-label="Điều hướng chính" className="flex items-center gap-2 rounded-xl bg-slate-800 p-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <label className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Chi nhánh:</span>
          <select
            value={selectedBranch}
            onChange={(event) => setSelectedBranch(Number(event.target.value))}
            disabled={branches.length === 0}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {branches.map((branch) => (
              <option key={branch.BranchID} value={branch.BranchID}>
                {branch.BranchName}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}

export default Navbar;
