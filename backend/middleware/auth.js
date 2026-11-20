const jwt = require('jsonwebtoken');

const roles = new Set(['CUSTOMER', 'MANAGER', 'CHEF', 'SHIPPER']);

function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Bạn cần đăng nhập để tiếp tục.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'pos-multibranch-system',
    });
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId < 1 || !roles.has(payload.role)) {
      return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });
    }

    req.user = {
      userId,
      role: payload.role,
      branchId: payload.branchId == null ? null : Number(payload.branchId),
    };
    next();
  } catch {
    res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
  }
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    next();
  };
}

module.exports = { authenticateToken, authorizeRoles };
