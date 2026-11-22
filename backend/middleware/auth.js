const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../config/db');

const roles = new Set(['OWNER', 'CUSTOMER', 'MANAGER', 'CHEF', 'SHIPPER']);

function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Bạn cần đăng nhập để tiếp tục.' });
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'pos-multibranch-system',
    });
  } catch {
    return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
  }

  const userId = Number(payload.sub);
  if (!Number.isSafeInteger(userId) || userId < 1 || !roles.has(payload.role)) {
    return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });
  }

  getPool()
    .then((pool) => pool.request()
      .input('userId', sql.Int, userId)
      .query('SELECT UserID, Role, BranchID, DeliveryArea, IsActive FROM dbo.Users WHERE UserID = @userId'))
    .then(({ recordset }) => {
      const user = recordset[0];
      if (!user || !user.IsActive || !roles.has(user.Role)) {
        res.status(401).json({ error: 'Tài khoản không còn hoạt động.' });
        return;
      }

      req.user = {
        userId: user.UserID,
        role: user.Role,
        branchId: user.BranchID,
        deliveryArea: user.DeliveryArea,
      };
      next();
    })
    .catch(next);
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    next();
  };
}

module.exports = { authenticateToken, authorizeRoles: requireRole, requireRole };
