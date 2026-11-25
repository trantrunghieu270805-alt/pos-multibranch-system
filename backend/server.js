require('dotenv').config();

const bcrypt = require('bcryptjs');
const cors = require('cors');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { getPool, sql } = require('./config/db');
const { authenticateToken, authorizeRoles, requireRole } = require('./middleware/auth');

if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 bytes.');
}

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  },
});

const deliveryAreas = [
  'Quận 1',
  'Quận 3',
  'Bình Thạnh',
  'Thủ Đức',
  'Gò Vấp',
  'Tân Bình',
  'Phú Nhuận',
  'Quận 7',
  'Quận 10',
  'Bình Tân',
];
const passwordPattern = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const userRoles = ['OWNER', 'CUSTOMER', 'MANAGER', 'CHEF', 'SHIPPER'];
const employeeRoles = ['MANAGER', 'CHEF', 'SHIPPER'];
const workflowStatuses = [
  'Chờ thanh toán',
  'Chờ xác nhận thanh toán',
  'Chờ duyệt',
  'Chờ chế biến',
  'Đang chế biến',
  'Bếp hoàn thành',
  'Chờ Shipper xác nhận',
  'Đang giao hàng',
  'Hoàn tất',
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : null;
}

function parseBranchFilter(value) {
  if (value === undefined || value === 'all') return null;
  return positiveInteger(value);
}

function publicUser(user) {
  return {
    UserID: user.UserID,
    FullName: user.FullName,
    Username: user.Username,
    Role: user.Role,
    BranchID: user.BranchID,
    DeliveryArea: user.DeliveryArea,
    Phone: user.Phone,
    IsActive: user.IsActive,
  };
}

function createToken(user) {
  return jwt.sign(
    {
      sub: String(user.UserID),
      role: user.Role,
      branchId: user.BranchID,
    },
    process.env.JWT_SECRET,
    { expiresIn: '8h', issuer: 'pos-multibranch-system' },
  );
}

function emitOrderUpdate({ orderId, status, branchId, customerId, shipperId, deliveryArea, action }) {
  let recipients = io.to('role:MANAGER').to('role:OWNER');
  if (branchId) recipients = recipients.to(`branch:${branchId}`);
  if (customerId) recipients = recipients.to(`user:${customerId}`);
  if (shipperId) recipients = recipients.to(`user:${shipperId}`);
  if (status === 'Bếp hoàn thành' && deliveryArea) {
    recipients = recipients.to(`delivery-area:${deliveryArea}`);
  }
  recipients.emit('order_updated', { orderId, status, branchId, action });
}

async function inTransaction(pool, callback) {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await callback(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      console.error('Failed to roll back SQL transaction:', rollbackError);
    }
    throw error;
  }
}

async function loadUser(userId, executor) {
  const result = await new sql.Request(executor)
    .input('userId', sql.Int, userId)
    .query(`
      SELECT UserID, FullName, Username, Role, BranchID, DeliveryArea, Phone, IsActive
      FROM dbo.Users
      WHERE UserID = @userId
    `);
  return result.recordset[0] || null;
}

async function attachOrderItems(pool, orders) {
  return Promise.all(orders.map(async (order) => {
    const result = await pool.request()
      .input('orderId', sql.Int, order.OrderID)
      .query(`
        SELECT oi.OrderItemID, oi.ProductID, p.ProductName, oi.Quantity, oi.UnitPrice, oi.Note
        FROM dbo.OrderItems oi
        JOIN dbo.Products p ON p.ProductID = oi.ProductID
        WHERE oi.OrderID = @orderId
        ORDER BY oi.OrderItemID
      `);
    return { ...order, items: result.recordset };
  }));
}

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: '1mb' }));

io.use((socket, next) => {
  let payload;
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required.'));
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'pos-multibranch-system',
    });
    if (!positiveInteger(payload.sub) || !userRoles.includes(payload.role)) {
      return next(new Error('Invalid authentication token.'));
    }
  } catch {
    return next(new Error('Invalid authentication token.'));
  }

  const userId = positiveInteger(payload.sub);
  getPool()
    .then((pool) => loadUser(userId, pool))
    .then((user) => {
      if (!user || !user.IsActive || !userRoles.includes(user.Role)) {
        next(new Error('Account is inactive.'));
        return;
      }
      socket.user = { userId, role: user.Role, branchId: user.BranchID };
      next();
    })
    .catch(next);
});

io.on('connection', (socket) => {
  const { userId, role } = socket.user;
  socket.join(`role:${role}`);
  socket.join(`user:${userId}`);
  if (role === 'CHEF') {
    getPool()
      .then((pool) => loadUser(userId, pool))
      .then((chef) => {
        const branchId = positiveInteger(chef && chef.BranchID);
        if (branchId) {
          socket.data.branchId = branchId;
          socket.join(`branch:${branchId}`);
        }
      })
      .catch((error) => {
        console.error('Failed to subscribe chef to branch:', error);
        socket.disconnect(true);
      });
  }

  const joinShipperArea = (area) => {
    if (socket.data.deliveryArea) socket.leave(`delivery-area:${socket.data.deliveryArea}`);
    socket.data.deliveryArea = area;
    if (area) socket.join(`delivery-area:${area}`);
  };

  if (role === 'SHIPPER') {
    getPool()
      .then((pool) => loadUser(userId, pool))
      .then((shipper) => joinShipperArea(shipper && deliveryAreas.includes(shipper.DeliveryArea) ? shipper.DeliveryArea : null))
      .catch((error) => {
        console.error('Failed to subscribe shipper to delivery area:', error);
        socket.disconnect(true);
      });

    socket.on('join_delivery_area', async (requestedArea) => {
      try {
        const pool = await getPool();
        const shipper = await loadUser(userId, pool);
        if (shipper && shipper.DeliveryArea === requestedArea && deliveryAreas.includes(requestedArea)) {
          joinShipperArea(requestedArea);
        }
      } catch (error) {
        console.error('Failed to update shipper delivery-area subscription:', error);
        socket.emit('socket_error', { message: 'Không thể cập nhật đăng ký thông báo khu vực.' });
      }
    });
  }

  socket.on('join_branch', (value) => {
    const requestedBranch = positiveInteger(value);
    if (requestedBranch && (role === 'MANAGER' || (role === 'CHEF' && requestedBranch === socket.data.branchId))) {
      socket.join(`branch:${requestedBranch}`);
    }
  });
});

app.get('/api/health', asyncRoute(async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query('SELECT DB_NAME() AS databaseName');
  res.json({ status: 'ok', databaseConnected: true, databaseName: result.recordset[0].databaseName });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : null;

  if (fullName.length < 2 || fullName.length > 120 || username.length < 3 || username.length > 80) {
    throw new HttpError(400, 'Họ tên phải từ 2-120 ký tự và tên đăng nhập từ 3-80 ký tự.');
  }
  if (!passwordPattern.test(password)) {
    throw new HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, chữ số và ký tự đặc biệt (@$!%*?&).');
  }
  if (phone && phone.length > 30) {
    throw new HttpError(400, 'Số điện thoại không hợp lệ.');
  }
  if (body.role && body.role !== 'CUSTOMER') {
    throw new HttpError(403, 'Đăng ký công khai chỉ hỗ trợ vai trò khách hàng.');
  }

  const pool = await getPool();
  const existing = await pool.request()
    .input('username', sql.NVarChar(80), username)
    .query('SELECT UserID FROM dbo.Users WHERE Username = @username');
  if (existing.recordset.length) throw new HttpError(409, 'Tên đăng nhập đã được sử dụng.');

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.request()
    .input('fullName', sql.NVarChar(120), fullName)
    .input('username', sql.NVarChar(80), username)
    .input('passwordHash', sql.NVarChar(100), passwordHash)
    .input('phone', sql.NVarChar(30), phone || null)
    .query(`
      INSERT INTO dbo.Users (FullName, Username, PasswordHash, Role, Phone)
      OUTPUT INSERTED.UserID, INSERTED.FullName, INSERTED.Username, INSERTED.Role,
        INSERTED.BranchID, INSERTED.DeliveryArea, INSERTED.Phone, INSERTED.IsActive
      VALUES (@fullName, @username, @passwordHash, N'CUSTOMER', @phone)
    `);
  res.status(201).json({ user: publicUser(result.recordset[0]) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) throw new HttpError(400, 'Vui lòng nhập tên đăng nhập và mật khẩu.');

  const pool = await getPool();
  const result = await pool.request()
    .input('username', sql.NVarChar(80), username)
    .query(`
      SELECT UserID, FullName, Username, PasswordHash, Role, BranchID, DeliveryArea, Phone, IsActive
      FROM dbo.Users
      WHERE Username = @username
    `);
  const user = result.recordset[0];
  if (!user || !(await bcrypt.compare(password, user.PasswordHash))) {
    throw new HttpError(401, 'Tên đăng nhập hoặc mật khẩu không chính xác.');
  }
  if (!user.IsActive) throw new HttpError(403, 'Tài khoản đã bị khóa. Vui lòng liên hệ Chủ doanh nghiệp.');
  res.json({ token: createToken(user), user: publicUser(user) });
}));

app.get('/api/auth/me', authenticateToken, asyncRoute(async (req, res) => {
  const pool = await getPool();
  const user = await loadUser(req.user.userId, pool);
  if (!user) throw new HttpError(401, 'Tài khoản không còn tồn tại.');
  res.json({ user: publicUser(user) });
}));

app.get('/api/branches', authenticateToken, asyncRoute(async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT BranchID, BranchName, Address, BankID, AccountNo, AccountName
    FROM dbo.Branches
    WHERE IsActive = 1
    ORDER BY BranchName
  `);
  res.json(result.recordset);
}));

app.get('/api/owner/users', authenticateToken, requireRole('OWNER'), asyncRoute(async (req, res) => {
  const role = req.query.role || null;
  const branchFilter = parseBranchFilter(req.query.branchId);
  if (role && !userRoles.includes(role)) throw new HttpError(400, 'Vai trò lọc không hợp lệ.');
  if (req.query.branchId !== undefined && req.query.branchId !== 'all' && !branchFilter) {
    throw new HttpError(400, 'Chi nhánh lọc không hợp lệ.');
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('role', sql.NVarChar(20), role)
    .input('branchId', sql.Int, branchFilter)
    .query(`
      SELECT u.UserID, u.FullName, u.Username, u.Role, u.BranchID, b.BranchName,
        u.DeliveryArea, u.Phone, u.IsActive, u.CreatedAt
      FROM dbo.Users u
      LEFT JOIN dbo.Branches b ON b.BranchID = u.BranchID
      WHERE (@role IS NULL OR u.Role = @role)
        AND (@branchId IS NULL OR u.BranchID = @branchId)
      ORDER BY u.Role, u.FullName
    `);
  res.json(result.recordset);
}));

app.post('/api/owner/users', authenticateToken, requireRole('OWNER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : null;
  const role = body.role;
  const branchId = body.branchId == null || body.branchId === '' ? null : positiveInteger(body.branchId);
  const deliveryArea = body.deliveryArea || null;

  if (fullName.length < 2 || fullName.length > 120 || username.length < 3 || username.length > 80) {
    throw new HttpError(400, 'Họ tên phải từ 2-120 ký tự và tên đăng nhập từ 3-80 ký tự.');
  }
  if (!passwordPattern.test(password)) {
    throw new HttpError(400, 'Mật khẩu cần ít nhất 8 ký tự, gồm chữ hoa, chữ số và ký tự đặc biệt (@$!%*?&).');
  }
  if (!employeeRoles.includes(role)) {
    throw new HttpError(400, 'Chỉ có thể tạo tài khoản Quản lý, Đầu bếp hoặc Shipper.');
  }
  if (phone && phone.length > 30) throw new HttpError(400, 'Số điện thoại không hợp lệ.');
  if (body.branchId != null && body.branchId !== '' && !branchId) {
    throw new HttpError(400, 'Chi nhánh không hợp lệ.');
  }
  if (role === 'CHEF' && !branchId) throw new HttpError(400, 'Đầu bếp phải được gán chi nhánh.');
  if (role === 'SHIPPER' && !deliveryAreas.includes(deliveryArea)) {
    throw new HttpError(400, 'Shipper phải được gán khu vực giao hàng hợp lệ.');
  }

  const pool = await getPool();
  if (branchId) {
    const branch = await pool.request()
      .input('branchId', sql.Int, branchId)
      .query('SELECT BranchID FROM dbo.Branches WHERE BranchID = @branchId AND IsActive = 1');
    if (!branch.recordset.length) throw new HttpError(400, 'Không tìm thấy chi nhánh đang hoạt động.');
  }
  const existing = await pool.request()
    .input('username', sql.NVarChar(80), username)
    .query('SELECT UserID FROM dbo.Users WHERE Username = @username');
  if (existing.recordset.length) throw new HttpError(409, 'Tên đăng nhập đã được sử dụng.');

  const passwordHash = await bcrypt.hash(password, 12);
  const result = await pool.request()
    .input('fullName', sql.NVarChar(120), fullName)
    .input('username', sql.NVarChar(80), username)
    .input('passwordHash', sql.NVarChar(100), passwordHash)
    .input('role', sql.NVarChar(20), role)
    .input('branchId', sql.Int, branchId)
    .input('deliveryArea', sql.NVarChar(100), role === 'SHIPPER' ? deliveryArea : null)
    .input('phone', sql.NVarChar(30), phone || null)
    .query(`
      INSERT INTO dbo.Users (FullName, Username, PasswordHash, Role, BranchID, DeliveryArea, Phone)
      OUTPUT INSERTED.UserID, INSERTED.FullName, INSERTED.Username, INSERTED.Role,
        INSERTED.BranchID, INSERTED.DeliveryArea, INSERTED.Phone, INSERTED.IsActive
      VALUES (@fullName, @username, @passwordHash, @role, @branchId, @deliveryArea, @phone)
    `);
  res.status(201).json({ user: publicUser(result.recordset[0]) });
}));

app.patch('/api/owner/users/:userId', authenticateToken, requireRole('OWNER'), asyncRoute(async (req, res) => {
  const userId = positiveInteger(req.params.userId);
  const body = req.body || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  if (!userId) throw new HttpError(400, 'Mã tài khoản không hợp lệ.');
  if (!['Role', 'BranchID', 'DeliveryArea', 'IsActive'].some(has)) {
    throw new HttpError(400, 'Không có thông tin cần cập nhật.');
  }
  if (has('Role') && !userRoles.includes(body.Role)) throw new HttpError(400, 'Vai trò không hợp lệ.');
  if (has('IsActive') && typeof body.IsActive !== 'boolean') {
    throw new HttpError(400, 'Trạng thái tài khoản không hợp lệ.');
  }

  const pool = await getPool();
  const updatedUser = await inTransaction(pool, async (transaction) => {
    const result = await new sql.Request(transaction)
      .input('userId', sql.Int, userId)
      .query('SELECT UserID, Role, BranchID, DeliveryArea, IsActive FROM dbo.Users WITH (UPDLOCK, HOLDLOCK) WHERE UserID = @userId');
    const current = result.recordset[0];
    if (!current) throw new HttpError(404, 'Không tìm thấy tài khoản.');

    const role = has('Role') ? body.Role : current.Role;
    const requestedBranch = has('BranchID') ? body.BranchID : current.BranchID;
    const requestedBranchId = requestedBranch == null || requestedBranch === '' ? null : positiveInteger(requestedBranch);
    if (requestedBranch != null && requestedBranch !== '' && !requestedBranchId) {
      throw new HttpError(400, 'Chi nhánh không hợp lệ.');
    }
    const branchId = role === 'CUSTOMER' || role === 'OWNER' ? null : requestedBranchId;
    if (has('BranchID') && (role === 'CUSTOMER' || role === 'OWNER') && requestedBranchId) {
      throw new HttpError(400, 'Vai trò này không thể được gán chi nhánh.');
    }
    const requestedArea = has('DeliveryArea') ? body.DeliveryArea : current.DeliveryArea;
    const deliveryArea = role === 'SHIPPER' ? requestedArea : null;
    const isActive = has('IsActive') ? body.IsActive : current.IsActive;
    if (role === 'CHEF' && !branchId) throw new HttpError(400, 'Đầu bếp phải được gán chi nhánh.');
    if (role === 'SHIPPER' && !deliveryAreas.includes(deliveryArea)) {
      throw new HttpError(400, 'Shipper phải được gán khu vực giao hàng hợp lệ.');
    }
    if (userId === req.user.userId && (!isActive || role !== 'OWNER')) {
      throw new HttpError(400, 'Bạn không thể tự khóa hoặc đổi vai trò tài khoản của mình.');
    }
    if (branchId) {
      const branch = await new sql.Request(transaction)
        .input('branchId', sql.Int, branchId)
        .query('SELECT BranchID FROM dbo.Branches WHERE BranchID = @branchId AND IsActive = 1');
      if (!branch.recordset.length) throw new HttpError(400, 'Không tìm thấy chi nhánh đang hoạt động.');
    }
    if (current.Role === 'OWNER' && current.IsActive && (!isActive || role !== 'OWNER')) {
      const activeOwners = await new sql.Request(transaction)
        .query("SELECT UserID FROM dbo.Users WITH (UPDLOCK, HOLDLOCK) WHERE Role = N'OWNER' AND IsActive = 1");
      if (activeOwners.recordset.length <= 1) {
        throw new HttpError(409, 'Không thể khóa hoặc đổi vai trò Chủ doanh nghiệp đang hoạt động cuối cùng.');
      }
    }

    const updated = await new sql.Request(transaction)
      .input('userId', sql.Int, userId)
      .input('role', sql.NVarChar(20), role)
      .input('branchId', sql.Int, role === 'CUSTOMER' || role === 'OWNER' ? null : branchId)
      .input('deliveryArea', sql.NVarChar(100), deliveryArea)
      .input('isActive', sql.Bit, isActive)
      .query(`
        UPDATE dbo.Users
        SET Role = @role, BranchID = @branchId, DeliveryArea = @deliveryArea, IsActive = @isActive
        OUTPUT INSERTED.UserID, INSERTED.FullName, INSERTED.Username, INSERTED.Role,
          INSERTED.BranchID, INSERTED.DeliveryArea, INSERTED.Phone, INSERTED.IsActive
        WHERE UserID = @userId
      `);
    return updated.recordset[0];
  });
  io.in(`user:${userId}`).disconnectSockets(true);
  res.json({ user: publicUser(updatedUser) });
}));

app.delete('/api/owner/users/:userId', authenticateToken, requireRole('OWNER'), asyncRoute(async (req, res) => {
  const userId = positiveInteger(req.params.userId);
  if (!userId) throw new HttpError(400, 'Mã tài khoản không hợp lệ.');
  if (userId === req.user.userId) throw new HttpError(400, 'Bạn không thể xóa tài khoản của mình.');

  const pool = await getPool();
  await inTransaction(pool, async (transaction) => {
    const result = await new sql.Request(transaction)
      .input('userId', sql.Int, userId)
      .query('SELECT UserID, Role, IsActive FROM dbo.Users WITH (UPDLOCK, HOLDLOCK) WHERE UserID = @userId');
    const target = result.recordset[0];
    if (!target) throw new HttpError(404, 'Không tìm thấy tài khoản.');

    if (target.Role === 'OWNER' && target.IsActive) {
      const activeOwners = await new sql.Request(transaction)
        .query("SELECT UserID FROM dbo.Users WITH (UPDLOCK, HOLDLOCK) WHERE Role = N'OWNER' AND IsActive = 1");
      if (activeOwners.recordset.length <= 1) {
        throw new HttpError(409, 'Không thể xóa Chủ doanh nghiệp đang hoạt động cuối cùng.');
      }
    }

    const references = await new sql.Request(transaction)
      .input('userId', sql.Int, userId)
      .query('SELECT TOP (1) OrderID FROM dbo.Orders WHERE CustomerID = @userId OR ShipperID = @userId');
    if (references.recordset.length) {
      throw new HttpError(409, 'Tài khoản đã có đơn hàng liên quan. Hãy khóa tài khoản thay vì xóa.');
    }

    await new sql.Request(transaction)
      .input('userId', sql.Int, userId)
      .query('DELETE FROM dbo.Users WHERE UserID = @userId');
  });
  io.in(`user:${userId}`).disconnectSockets(true);
  res.status(204).end();
}));

app.get('/api/owner/branches', authenticateToken, requireRole('OWNER'), asyncRoute(async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT b.BranchID, b.BranchName, b.Address, b.IsActive, b.BankID, b.AccountNo, b.AccountName,
      COUNT(o.OrderID) AS OrderCount,
      ISNULL(SUM(o.TotalAmount), 0) AS TotalRevenue,
      ISNULL(SUM(CASE WHEN o.Status IN (
        N'Chờ chế biến', N'Đang chế biến', N'Bếp hoàn thành',
        N'Chờ Shipper xác nhận', N'Đang giao hàng', N'Hoàn tất'
      ) THEN o.TotalAmount ELSE 0 END), 0) AS PaidRevenue
    FROM dbo.Branches b
    LEFT JOIN dbo.Orders o ON o.BranchID = b.BranchID
    GROUP BY b.BranchID, b.BranchName, b.Address, b.IsActive, b.BankID, b.AccountNo, b.AccountName
    ORDER BY b.BranchName
  `);
  res.json(result.recordset);
}));

app.patch('/api/owner/branches/:branchId', authenticateToken, requireRole('OWNER'), asyncRoute(async (req, res) => {
  const branchId = positiveInteger(req.params.branchId);
  const body = req.body || {};
  const fields = ['BankID', 'AccountNo', 'AccountName'];
  if (!branchId) throw new HttpError(400, 'Mã chi nhánh không hợp lệ.');
  if (!fields.some((field) => Object.prototype.hasOwnProperty.call(body, field))) {
    throw new HttpError(400, 'Không có thông tin ngân hàng cần cập nhật.');
  }

  const values = fields.map((field) => {
    const value = body[field] == null ? '' : String(body[field]).trim();
    const maxLength = field === 'AccountName' ? 120 : 50;
    if (value.length > maxLength) throw new HttpError(400, `Thông tin ${field} vượt quá độ dài cho phép.`);
    return value || null;
  });
  if (values.some(Boolean) && values.some((value) => !value)) {
    throw new HttpError(400, 'Hãy nhập đầy đủ ngân hàng, số tài khoản và tên chủ tài khoản.');
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('branchId', sql.Int, branchId)
    .input('bankId', sql.NVarChar(50), values[0])
    .input('accountNo', sql.NVarChar(50), values[1])
    .input('accountName', sql.NVarChar(120), values[2])
    .query(`
      UPDATE dbo.Branches
      SET BankID = @bankId, AccountNo = @accountNo, AccountName = @accountName
      OUTPUT INSERTED.BranchID, INSERTED.BranchName, INSERTED.BankID, INSERTED.AccountNo, INSERTED.AccountName
      WHERE BranchID = @branchId
    `);
  if (!result.recordset.length) throw new HttpError(404, 'Không tìm thấy chi nhánh.');
  res.json({ branch: result.recordset[0] });
}));

app.get('/api/owner/analytics/monthly', authenticateToken, requireRole('OWNER'), asyncRoute(async (req, res) => {
  const year = parseYear(req.query.year);
  const branchFilter = parseBranchFilter(req.query.branchId);
  if (!year) throw new HttpError(400, 'Năm phải nằm trong khoảng 2000-2100.');
  if (req.query.branchId !== undefined && req.query.branchId !== 'all' && !branchFilter) {
    throw new HttpError(400, 'Chi nhánh lọc không hợp lệ.');
  }

  const pool = await getPool();
  const result = await pool.request()
    .input('year', sql.Int, year)
    .input('branchId', sql.Int, branchFilter)
    .query(`
      WITH MonthNumbers AS (
        SELECT MonthNumber
        FROM (VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10), (11), (12)) months(MonthNumber)
      )
      SELECT months.MonthNumber AS Month,
        ISNULL(SUM(o.TotalAmount), 0) AS TotalRevenue,
        ISNULL(SUM(CASE WHEN o.Status IN (
          N'Chờ chế biến', N'Đang chế biến', N'Bếp hoàn thành',
          N'Chờ Shipper xác nhận', N'Đang giao hàng', N'Hoàn tất'
        ) THEN o.TotalAmount ELSE 0 END), 0) AS PaidRevenue,
        COUNT(o.OrderID) AS OrderCount
      FROM MonthNumbers months
      LEFT JOIN dbo.Orders o
        ON YEAR(o.CreatedAt) = @year
        AND MONTH(o.CreatedAt) = months.MonthNumber
        AND (@branchId IS NULL OR o.BranchID = @branchId)
      GROUP BY months.MonthNumber
      ORDER BY months.MonthNumber
    `);
  const months = result.recordset;
  const summary = months.reduce((total, month) => ({
    TotalRevenue: total.TotalRevenue + Number(month.TotalRevenue),
    PaidRevenue: total.PaidRevenue + Number(month.PaidRevenue),
    OrderCount: total.OrderCount + Number(month.OrderCount),
  }), { TotalRevenue: 0, PaidRevenue: 0, OrderCount: 0 });
  res.json({ year, branchId: req.query.branchId || 'all', summary, months });
}));

app.get('/api/owner/reports/revenue', authenticateToken, requireRole('OWNER'), asyncRoute(async (req, res) => {
  const year = parseYear(req.query.year);
  const monthQuery = req.query.month === undefined ? 'all' : req.query.month;
  const month = monthQuery === 'all' ? null : positiveInteger(monthQuery);
  if (!year) throw new HttpError(400, 'Năm phải nằm trong khoảng 2000-2100.');
  if (monthQuery !== 'all' && (!month || month > 12)) throw new HttpError(400, 'Tháng không hợp lệ.');

  const pool = await getPool();
  const result = await pool.request()
    .input('year', sql.Int, year)
    .input('month', sql.Int, month)
    .query(`
      SELECT b.BranchID, b.BranchName, b.Address,
        SUM(CASE WHEN o.Status = N'Hoàn tất' THEN 1 ELSE 0 END) AS CompletedOrderCount,
        SUM(CASE WHEN o.OrderID IS NOT NULL AND o.Status <> N'Hoàn tất' THEN 1 ELSE 0 END) AS ProcessingOrderCount,
        ISNULL(SUM(CASE WHEN o.PaymentMethod = N'CASH' AND o.Status IN (
          N'Chờ chế biến', N'Đang chế biến', N'Bếp hoàn thành',
          N'Chờ Shipper xác nhận', N'Đang giao hàng', N'Hoàn tất'
        ) THEN o.TotalAmount ELSE 0 END), 0) AS CashRevenue,
        ISNULL(SUM(CASE WHEN o.PaymentMethod = N'VIETQR' AND o.Status IN (
          N'Chờ chế biến', N'Đang chế biến', N'Bếp hoàn thành',
          N'Chờ Shipper xác nhận', N'Đang giao hàng', N'Hoàn tất'
        ) THEN o.TotalAmount ELSE 0 END), 0) AS VietQrRevenue,
        ISNULL(SUM(CASE WHEN o.Status IN (
          N'Chờ chế biến', N'Đang chế biến', N'Bếp hoàn thành',
          N'Chờ Shipper xác nhận', N'Đang giao hàng', N'Hoàn tất'
        ) THEN o.TotalAmount ELSE 0 END), 0) AS TotalRevenue
      FROM dbo.Branches b
      LEFT JOIN dbo.Orders o
        ON o.BranchID = b.BranchID
        AND YEAR(o.CreatedAt) = @year
        AND (@month IS NULL OR MONTH(o.CreatedAt) = @month)
      GROUP BY b.BranchID, b.BranchName, b.Address
      ORDER BY b.BranchName
    `);
  res.json({ year, month: month || 'all', branches: result.recordset });
}));

app.get('/api/menu', authenticateToken, authorizeRoles('CUSTOMER', 'MANAGER', 'CHEF'), asyncRoute(async (_req, res) => {
  const pool = await getPool();
  const [categories, products] = await Promise.all([
    pool.request().query('SELECT CategoryID, CategoryName FROM dbo.Categories ORDER BY CategoryName'),
    pool.request().query(`
      SELECT p.ProductID, p.ProductName, p.Price, p.ImageUrl, p.CategoryID, c.CategoryName
      FROM dbo.Products p
      JOIN dbo.Categories c ON c.CategoryID = p.CategoryID
      WHERE p.IsAvailable = 1
      ORDER BY c.CategoryName, p.ProductName
    `),
  ]);
  res.json({ categories: categories.recordset, products: products.recordset });
}));

app.get('/api/customer/orders', authenticateToken, authorizeRoles('CUSTOMER'), asyncRoute(async (req, res) => {
  const pool = await getPool();
  const result = await pool.request()
    .input('customerId', sql.Int, req.user.userId)
    .query(`
      SELECT o.OrderID, o.BranchID, b.BranchName, o.TotalAmount, o.Status, o.CreatedAt,
        o.DeliveryAddress, o.DeliveryArea, o.ShipperID, shipper.FullName AS ShipperName,
        shipper.Phone AS ShipperPhone
      FROM dbo.Orders o
      JOIN dbo.Branches b ON b.BranchID = o.BranchID
      LEFT JOIN dbo.Users shipper ON shipper.UserID = o.ShipperID
      WHERE o.CustomerID = @customerId
      ORDER BY o.CreatedAt DESC
    `);
  res.json(await attachOrderItems(pool, result.recordset));
}));

app.post('/api/customer/orders/:orderId/payment-confirmation', authenticateToken, authorizeRoles('CUSTOMER'), asyncRoute(async (req, res) => {
  const orderId = positiveInteger(req.params.orderId);
  if (!orderId) throw new HttpError(400, 'Mã đơn hàng không hợp lệ.');

  const pool = await getPool();
  const order = await inTransaction(pool, async (transaction) => {
    const current = await new sql.Request(transaction)
      .input('orderId', sql.Int, orderId)
      .input('customerId', sql.Int, req.user.userId)
      .query(`
        SELECT OrderID, BranchID, Status
        FROM dbo.Orders WITH (UPDLOCK, ROWLOCK)
        WHERE OrderID = @orderId AND CustomerID = @customerId
      `);
    const row = current.recordset[0];
    if (!row) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    if (row.Status === 'Chờ xác nhận thanh toán') return row;
    if (row.Status !== 'Chờ thanh toán') {
      throw new HttpError(409, 'Đơn hàng không còn ở trạng thái chờ thanh toán.');
    }

    await new sql.Request(transaction)
      .input('orderId', sql.Int, orderId)
      .query("UPDATE dbo.Orders SET Status = N'Chờ xác nhận thanh toán' WHERE OrderID = @orderId");
    return { ...row, Status: 'Chờ xác nhận thanh toán' };
  });

  emitOrderUpdate({
    orderId,
    status: order.Status,
    branchId: order.BranchID,
    customerId: req.user.userId,
    action: 'PAYMENT_REPORTED',
  });
  res.json({ orderId, status: order.Status });
}));

app.post('/api/customer/orders', authenticateToken, authorizeRoles('CUSTOMER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const branchId = positiveInteger(body.branchId);
  const deliveryAddress = typeof body.deliveryAddress === 'string' ? body.deliveryAddress.trim() : '';
  const deliveryArea = body.deliveryArea;
  const hasLatitude = body.latitude !== undefined && body.latitude !== null;
  const hasLongitude = body.longitude !== undefined && body.longitude !== null;
  const latitude = hasLatitude ? body.latitude : null;
  const longitude = hasLongitude ? body.longitude : null;
  const items = body.items;
  if (!branchId) throw new HttpError(400, 'Vui lòng chọn chi nhánh.');
  if (!deliveryAddress || deliveryAddress.length > 255) {
    throw new HttpError(400, 'Địa chỉ giao hàng là bắt buộc và tối đa 255 ký tự.');
  }
  if (!deliveryAreas.includes(deliveryArea)) throw new HttpError(400, 'Khu vực giao hàng không hợp lệ.');
  if (hasLatitude !== hasLongitude || (hasLatitude && (
    typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
  ))) {
    throw new HttpError(400, 'Tọa độ giao hàng không hợp lệ.');
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new HttpError(400, 'Đơn hàng cần có từ 1 đến 50 món.');
  }

  const normalizedItems = items.map((item) => {
    const productId = positiveInteger(item && (item.ProductID || item.productId));
    const quantity = positiveInteger(item && item.quantity);
    const note = item && item.note != null ? item.note : '';
    if (!productId || !quantity || quantity > 100 || typeof note !== 'string' || note.length > 255) {
      throw new HttpError(400, 'Thông tin món trong giỏ hàng không hợp lệ.');
    }
    return { productId, quantity, note };
  });

  const pool = await getPool();
  const result = await inTransaction(pool, async (transaction) => {
    const branch = await new sql.Request(transaction)
      .input('branchId', sql.Int, branchId)
      .query('SELECT BranchID FROM dbo.Branches WHERE BranchID = @branchId AND IsActive = 1');
    if (!branch.recordset.length) throw new HttpError(404, 'Không tìm thấy chi nhánh đang hoạt động.');

    const pricedItems = [];
    for (const item of normalizedItems) {
      const productResult = await new sql.Request(transaction)
        .input('productId', sql.Int, item.productId)
        .query('SELECT ProductID, Price FROM dbo.Products WHERE ProductID = @productId AND IsAvailable = 1');
      const product = productResult.recordset[0];
      if (!product) throw new HttpError(400, `Món ${item.productId} không tồn tại hoặc đã hết hàng.`);
      pricedItems.push({ ...item, price: product.Price });
    }

    const totalAmount = pricedItems.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
    const orderResult = await new sql.Request(transaction)
      .input('branchId', sql.Int, branchId)
      .input('customerId', sql.Int, req.user.userId)
      .input('deliveryAddress', sql.NVarChar(255), deliveryAddress)
      .input('deliveryArea', sql.NVarChar(100), deliveryArea)
      .input('latitude', sql.Decimal(9, 6), latitude)
      .input('longitude', sql.Decimal(9, 6), longitude)
      .input('totalAmount', sql.Decimal(18, 0), totalAmount)
      .query(`
        INSERT INTO dbo.Orders
          (BranchID, TableID, CustomerID, DeliveryAddress, DeliveryArea, Latitude, Longitude, TotalAmount, Status, PaymentMethod)
        OUTPUT INSERTED.OrderID
        VALUES
          (@branchId, NULL, @customerId, @deliveryAddress, @deliveryArea, @latitude, @longitude, @totalAmount, N'Chờ thanh toán', N'VIETQR')
      `);
    const orderId = orderResult.recordset[0].OrderID;

    for (const item of pricedItems) {
      await new sql.Request(transaction)
        .input('orderId', sql.Int, orderId)
        .input('productId', sql.Int, item.productId)
        .input('quantity', sql.Int, item.quantity)
        .input('unitPrice', sql.Decimal(18, 0), item.price)
        .input('note', sql.NVarChar(255), item.note)
        .query(`
          INSERT INTO dbo.OrderItems (OrderID, ProductID, Quantity, UnitPrice, Note)
          VALUES (@orderId, @productId, @quantity, @unitPrice, @note)
        `);
    }
    return { orderId, totalAmount };
  });

  emitOrderUpdate({
    orderId: result.orderId,
    status: 'Chờ thanh toán',
    branchId,
    customerId: req.user.userId,
    action: 'ORDER_CREATED',
  });
  res.status(201).json({ ...result, status: 'Chờ thanh toán' });
}));

app.get('/api/manager/orders', authenticateToken, authorizeRoles('MANAGER'), asyncRoute(async (req, res) => {
  const status = req.query.status || null;
  if (status && !workflowStatuses.includes(status)) throw new HttpError(400, 'Trạng thái đơn hàng không hợp lệ.');

  const pool = await getPool();
  const result = await pool.request()
    .input('status', sql.NVarChar(30), status)
    .query(`
      SELECT o.OrderID, o.BranchID, b.BranchName, o.TotalAmount, o.Status, o.CreatedAt,
        o.DeliveryAddress, o.DeliveryArea, o.CustomerID, customer.FullName AS CustomerName,
        customer.Phone AS CustomerPhone, o.ShipperID, shipper.FullName AS ShipperName,
        shipper.Phone AS ShipperPhone
      FROM dbo.Orders o
      JOIN dbo.Branches b ON b.BranchID = o.BranchID
      LEFT JOIN dbo.Users customer ON customer.UserID = o.CustomerID
      LEFT JOIN dbo.Users shipper ON shipper.UserID = o.ShipperID
      WHERE @status IS NULL OR o.Status = @status
      ORDER BY o.CreatedAt DESC
    `);
  res.json(await attachOrderItems(pool, result.recordset));
}));

app.post('/api/manager/orders/:orderId/approve', authenticateToken, authorizeRoles('MANAGER'), asyncRoute(async (req, res) => {
  const orderId = positiveInteger(req.params.orderId);
  if (!orderId) throw new HttpError(400, 'Mã đơn hàng không hợp lệ.');
  const pool = await getPool();
  const order = await inTransaction(pool, async (transaction) => {
    const current = await new sql.Request(transaction)
      .input('orderId', sql.Int, orderId)
      .query('SELECT OrderID, BranchID, CustomerID, Status FROM dbo.Orders WITH (UPDLOCK, ROWLOCK) WHERE OrderID = @orderId');
    const row = current.recordset[0];
    if (!row) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    if (!['Chờ xác nhận thanh toán', 'Chờ duyệt'].includes(row.Status)) {
      throw new HttpError(409, 'Khách hàng chưa báo đã chuyển khoản hoặc đơn không còn chờ xác nhận.');
    }

    await new sql.Request(transaction)
      .input('orderId', sql.Int, orderId)
      .query("UPDATE dbo.Orders SET Status = N'Chờ chế biến' WHERE OrderID = @orderId");
    return row;
  });

  emitOrderUpdate({
    orderId,
    status: 'Chờ chế biến',
    branchId: order.BranchID,
    customerId: order.CustomerID,
    action: 'ORDER_APPROVED',
  });
  res.json({ orderId, status: 'Chờ chế biến' });
}));

app.get('/api/manager/shippers', authenticateToken, authorizeRoles('MANAGER'), asyncRoute(async (req, res) => {
  const area = req.query.area;
  if (!deliveryAreas.includes(area)) throw new HttpError(400, 'Khu vực giao hàng không hợp lệ.');
  const pool = await getPool();
  const result = await pool.request()
    .input('area', sql.NVarChar(100), area)
    .query(`
      SELECT UserID, FullName, Phone, DeliveryArea
      FROM dbo.Users
      WHERE Role = N'SHIPPER' AND DeliveryArea = @area
      ORDER BY FullName
    `);
  res.json(result.recordset);
}));

app.post('/api/manager/orders/:orderId/dispatch', authenticateToken, authorizeRoles('MANAGER'), asyncRoute(async (req, res) => {
  const orderId = positiveInteger(req.params.orderId);
  const shipperId = positiveInteger(req.body && req.body.shipperId);
  if (!orderId || !shipperId) throw new HttpError(400, 'Mã đơn hàng hoặc Shipper không hợp lệ.');

  const pool = await getPool();
  const result = await inTransaction(pool, async (transaction) => {
    const orderResult = await new sql.Request(transaction)
      .input('orderId', sql.Int, orderId)
      .query(`
        SELECT OrderID, BranchID, CustomerID, DeliveryArea, ShipperID, Status
        FROM dbo.Orders WITH (UPDLOCK, ROWLOCK)
        WHERE OrderID = @orderId
      `);
    const order = orderResult.recordset[0];
    if (!order) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
    if (order.Status !== 'Bếp hoàn thành' || order.ShipperID) {
      throw new HttpError(409, 'Chỉ điều phối đơn bếp đã hoàn thành và chưa có Shipper.');
    }

    const shipperResult = await new sql.Request(transaction)
      .input('shipperId', sql.Int, shipperId)
      .input('deliveryArea', sql.NVarChar(100), order.DeliveryArea)
      .query(`
        SELECT UserID, DeliveryArea
        FROM dbo.Users
        WHERE UserID = @shipperId AND Role = N'SHIPPER' AND DeliveryArea = @deliveryArea
      `);
    if (!shipperResult.recordset.length) {
      throw new HttpError(400, 'Shipper không thuộc khu vực giao hàng của đơn.');
    }

    await new sql.Request(transaction)
      .input('orderId', sql.Int, orderId)
      .input('shipperId', sql.Int, shipperId)
      .query("UPDATE dbo.Orders SET ShipperID = @shipperId, Status = N'Chờ Shipper xác nhận' WHERE OrderID = @orderId");
    return order;
  });

  emitOrderUpdate({
    orderId,
    status: 'Chờ Shipper xác nhận',
    branchId: result.BranchID,
    customerId: result.CustomerID,
    shipperId,
    action: 'SHIPPER_ASSIGNED',
  });
  res.json({ orderId, shipperId, status: 'Chờ Shipper xác nhận' });
}));

app.get('/api/manager/stats', authenticateToken, authorizeRoles('MANAGER'), asyncRoute(async (_req, res) => {
  const pool = await getPool();
  const [summary, byBranch, recentOrders] = await Promise.all([
    pool.request().query(`
      SELECT COUNT(OrderID) AS TotalOrders,
        ISNULL(SUM(TotalAmount), 0) AS TotalRevenue,
        ISNULL(SUM(CASE WHEN Status = N'Hoàn tất' THEN TotalAmount ELSE 0 END), 0) AS PaidRevenue
      FROM dbo.Orders
    `),
    pool.request().query(`
      SELECT b.BranchID, b.BranchName, COUNT(o.OrderID) AS OrderCount,
        ISNULL(SUM(o.TotalAmount), 0) AS Revenue
      FROM dbo.Branches b
      LEFT JOIN dbo.Orders o ON o.BranchID = b.BranchID
      GROUP BY b.BranchID, b.BranchName
      ORDER BY b.BranchName
    `),
    pool.request().query(`
      SELECT TOP (10) o.OrderID, b.BranchName, o.DeliveryArea, o.TotalAmount, o.Status, o.CreatedAt
      FROM dbo.Orders o
      JOIN dbo.Branches b ON b.BranchID = o.BranchID
      ORDER BY o.CreatedAt DESC
    `),
  ]);
  res.json({ summary: summary.recordset[0], byBranch: byBranch.recordset, recentOrders: recentOrders.recordset });
}));

app.get('/api/manager/tables', authenticateToken, authorizeRoles('MANAGER'), asyncRoute(async (_req, res) => {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT t.TableID, t.BranchID, b.BranchName, t.TableName, t.Status
    FROM dbo.DiningTables t
    JOIN dbo.Branches b ON b.BranchID = t.BranchID
    ORDER BY b.BranchName, t.TableName
  `);
  res.json(result.recordset);
}));

app.get('/api/chef/orders', authenticateToken, authorizeRoles('CHEF'), asyncRoute(async (req, res) => {
  const pool = await getPool();
  const chef = await loadUser(req.user.userId, pool);
  const branchId = positiveInteger(chef && chef.BranchID);
  if (!branchId) throw new HttpError(403, 'Tài khoản đầu bếp chưa được gán chi nhánh.');
  const result = await pool.request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT o.OrderID, o.BranchID, o.TableID, t.TableName, o.TotalAmount, o.Status,
        o.CreatedAt, o.DeliveryArea, o.DeliveryAddress
      FROM dbo.Orders o
      LEFT JOIN dbo.DiningTables t ON t.TableID = o.TableID
      WHERE o.BranchID = @branchId AND o.Status IN (N'Chờ chế biến', N'Đang chế biến')
      ORDER BY o.CreatedAt
    `);
  res.json(await attachOrderItems(pool, result.recordset));
}));

app.patch('/api/chef/orders/:orderId/status', authenticateToken, authorizeRoles('CHEF'), asyncRoute(async (req, res) => {
  const orderId = positiveInteger(req.params.orderId);
  const nextStatus = req.body && req.body.status;
  if (!orderId || !['Đang chế biến', 'Bếp hoàn thành'].includes(nextStatus)) {
    throw new HttpError(400, 'Mã đơn hàng hoặc trạng thái không hợp lệ.');
  }

  const pool = await getPool();
  const chef = await loadUser(req.user.userId, pool);
  const branchId = positiveInteger(chef && chef.BranchID);
  if (!branchId) throw new HttpError(403, 'Tài khoản đầu bếp chưa được gán chi nhánh.');

  const expectedStatus = nextStatus === 'Đang chế biến' ? 'Chờ chế biến' : 'Đang chế biến';
  const result = await pool.request()
    .input('orderId', sql.Int, orderId)
    .input('branchId', sql.Int, branchId)
    .input('expectedStatus', sql.NVarChar(30), expectedStatus)
    .input('nextStatus', sql.NVarChar(30), nextStatus)
    .query(`
      UPDATE dbo.Orders
      SET Status = @nextStatus
      OUTPUT INSERTED.OrderID, INSERTED.BranchID, INSERTED.CustomerID, INSERTED.ShipperID, INSERTED.DeliveryArea
      WHERE OrderID = @orderId AND BranchID = @branchId AND Status = @expectedStatus
    `);
  const order = result.recordset[0];
  if (!order) throw new HttpError(409, 'Đơn hàng không thuộc chi nhánh hoặc không thể chuyển sang trạng thái này.');

  emitOrderUpdate({
    orderId,
    status: nextStatus,
    branchId: order.BranchID,
    customerId: order.CustomerID,
    shipperId: order.ShipperID,
    deliveryArea: order.DeliveryArea,
    action: 'CHEF_STATUS_CHANGED',
  });
  res.json({ orderId, status: nextStatus });
}));

app.patch('/api/users/delivery-area', authenticateToken, authorizeRoles('SHIPPER'), asyncRoute(async (req, res) => {
  const area = req.body && req.body.deliveryArea;
  if (!deliveryAreas.includes(area)) throw new HttpError(400, 'Khu vực giao hàng không hợp lệ.');
  const pool = await getPool();
  await pool.request()
    .input('userId', sql.Int, req.user.userId)
    .input('area', sql.NVarChar(100), area)
    .query("UPDATE dbo.Users SET DeliveryArea = @area WHERE UserID = @userId AND Role = N'SHIPPER'");
  res.json({ deliveryArea: area });
}));

app.get('/api/shipper/orders', authenticateToken, authorizeRoles('SHIPPER'), asyncRoute(async (req, res) => {
  const pool = await getPool();
  const shipper = await loadUser(req.user.userId, pool);
  if (!shipper || !shipper.DeliveryArea) throw new HttpError(409, 'Hãy chọn khu vực giao hàng trước.');

  const result = await pool.request()
    .input('shipperId', sql.Int, req.user.userId)
    .input('deliveryArea', sql.NVarChar(100), shipper.DeliveryArea)
    .query(`
      SELECT o.OrderID, o.BranchID, b.BranchName, o.TotalAmount, o.Status, o.CreatedAt,
        o.DeliveryAddress, o.DeliveryArea, o.CustomerID, customer.FullName AS CustomerName,
        customer.Phone AS CustomerPhone, o.ShipperID, o.Latitude, o.Longitude
      FROM dbo.Orders o
      JOIN dbo.Branches b ON b.BranchID = o.BranchID
      LEFT JOIN dbo.Users customer ON customer.UserID = o.CustomerID
      WHERE (o.ShipperID = @shipperId AND o.Status IN (N'Chờ Shipper xác nhận', N'Đang giao hàng'))
         OR (o.ShipperID IS NULL AND o.Status = N'Bếp hoàn thành' AND o.DeliveryArea = @deliveryArea)
      ORDER BY o.CreatedAt
    `);
  res.json(await attachOrderItems(pool, result.recordset));
}));

app.post('/api/shipper/orders/:orderId/claim', authenticateToken, authorizeRoles('SHIPPER'), asyncRoute(async (req, res) => {
  const orderId = positiveInteger(req.params.orderId);
  if (!orderId) throw new HttpError(400, 'Mã đơn hàng không hợp lệ.');

  const pool = await getPool();
  const result = await inTransaction(pool, async (transaction) => {
    const shipper = await loadUser(req.user.userId, transaction);
    if (!shipper || !shipper.DeliveryArea) throw new HttpError(409, 'Hãy chọn khu vực giao hàng trước.');
    const update = await new sql.Request(transaction)
      .input('orderId', sql.Int, orderId)
      .input('shipperId', sql.Int, req.user.userId)
      .input('deliveryArea', sql.NVarChar(100), shipper.DeliveryArea)
      .query(`
        UPDATE dbo.Orders
        SET ShipperID = @shipperId, Status = N'Đang giao hàng'
        OUTPUT INSERTED.OrderID, INSERTED.BranchID, INSERTED.CustomerID
        WHERE OrderID = @orderId
          AND (
            (ShipperID IS NULL AND Status = N'Bếp hoàn thành' AND DeliveryArea = @deliveryArea)
            OR (ShipperID = @shipperId AND Status = N'Chờ Shipper xác nhận')
          )
      `);
    if (!update.recordset.length) throw new HttpError(409, 'Đơn không còn khả dụng trong khu vực của bạn.');
    return update.recordset[0];
  });

  emitOrderUpdate({
    orderId,
    status: 'Đang giao hàng',
    branchId: result.BranchID,
    customerId: result.CustomerID,
    shipperId: req.user.userId,
    action: 'SHIPPER_CLAIMED',
  });
  res.json({ orderId, status: 'Đang giao hàng' });
}));

app.patch('/api/shipper/orders/:orderId/complete', authenticateToken, authorizeRoles('SHIPPER'), asyncRoute(async (req, res) => {
  const orderId = positiveInteger(req.params.orderId);
  if (!orderId) throw new HttpError(400, 'Mã đơn hàng không hợp lệ.');
  const pool = await getPool();
  const result = await pool.request()
    .input('orderId', sql.Int, orderId)
    .input('shipperId', sql.Int, req.user.userId)
    .query(`
      UPDATE dbo.Orders
      SET Status = N'Hoàn tất'
      OUTPUT INSERTED.OrderID, INSERTED.BranchID, INSERTED.CustomerID
      WHERE OrderID = @orderId AND ShipperID = @shipperId AND Status = N'Đang giao hàng'
    `);
  const order = result.recordset[0];
  if (!order) throw new HttpError(409, 'Đơn không được giao cho bạn hoặc đã hoàn tất.');

  emitOrderUpdate({
    orderId,
    status: 'Hoàn tất',
    branchId: order.BranchID,
    customerId: order.CustomerID,
    shipperId: req.user.userId,
    action: 'DELIVERY_COMPLETED',
  });
  res.json({ orderId, status: 'Hoàn tất' });
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode
      : 500;
  res.status(status).json({
    error: status < 500 ? error.message : 'Đã xảy ra lỗi máy chủ.',
  });
});

const port = Number(process.env.PORT || 5000);
if (require.main === module) {
  server.listen(port, () => {
    console.log(`POS API listening on http://localhost:${port}`);
  });
}

module.exports = { app, io, server };
