import { useEffect, useState } from 'react';
import api from '../services/api';

const links = [
  { id: 'order', label: 'Bán hàng' },
  { id: 'kitchen', label: 'Màn hình bếp' },
  { id: 'dashboard', label: 'Tổng quan' },
];

function Navbar({ page, onPageChange, branchId, onBranchChange }) {
  const [branches, setBranches] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/branches')
      .then(({ data }) => {
        setBranches(data);
        if (data.length > 0) onBranchChange(String(data[0].id));
      })
      .catch(() => setError('Không tải được danh sách chi nhánh.'));
  }, [onBranchChange]);

  return (
    <header className="navbar">
      <a className="brand" href="#" onClick={(event) => event.preventDefault()}>POS đa chi nhánh</a>
      <nav aria-label="Điều hướng chính">
        {links.map((link) => (
          <button
            className={`nav-link${page === link.id ? ' active' : ''}`}
            key={link.id}
            onClick={() => onPageChange(link.id)}
          >
            {link.label}
          </button>
        ))}
      </nav>
      <label className="branch-picker">
        <span>Chi nhánh</span>
        <select value={branchId} onChange={(event) => onBranchChange(event.target.value)}>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>{branch.name}</option>
          ))}
        </select>
      </label>
      {error && <span className="nav-error" role="status">{error}</span>}
    </header>
  );
}

export default Navbar;
