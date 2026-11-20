require('dotenv').config();

const bcrypt = require('bcryptjs');
const cors = require('cors');
const express = require('express');
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { getPool, sql } = require('./config/db');
const { authenticateToken, authorizeRoles } = require('./middleware/auth');

if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 bytes.');
}

const app = express();
const server = http.createServer(app);
const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const io = new Server(server, {
  cors: {
    origin: allowedOrigin,
    methods: ['GET', 'POST', 'PATCH'],
  },
});

const deliveryAreas = ['Quận 1', 'Bình Thạnh', 'Thủ Đức', 'Quận 3', 'Gò Vấp', 'Quận 7', 'Tân Bình'];
const passwordPattern = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const workflowStatuses = ['Chờ duyệt', 'Chờ chế biến', 'Đang chế biến', 'Bếp hoàn thành', 'Đang giao hàng', 'Hoàn tất'];

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

function publicUser(user) {
  return {
    UserID: user.UserID,
    FullName: user.FullName,
    Username: user.Username,
    Role: user.Role,
    BranchID: user.BranchID,
    DeliveryArea: user.DeliveryArea,
    Phone: user.Phone,
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
  let recipients = io.to('role:MANAGER');
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
      SELECT UserID, FullName, Username, Role, BranchID, DeliveryArea, Phone
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
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required.'));
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'pos-multibranch-system',
    });
    const userId = positiveInteger(payload.sub);
    if (!userId || !['CUSTOMER', 'MANAGER', 'CHEF', 'SHIPPER'].includes(payload.role)) {
      return next(new Error('Invalid authentication token.'));
    }
    socket.user = { userId, role: payload.role, branchId: payload.branchId || null };
    next();
  } catch {
    next(new Error('Invalid authentication token.'));
  }
});

io.on('connection', (socket) => {
  const { userId, role, branchId } = socket.user;
  socket.join(`role:${role}`);
  socket.join(`user:${userId}`);
  if (role === 'CHEF' && branchId) socket.join(`branch:${branchId}`);

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
    if (role === 'MANAGER' || (role === 'CHEF' && requestedBranch === branchId)) {
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
        INSERTED.BranchID, INSERTED.DeliveryArea, INSERTED.Phone
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
      SELECT UserID, FullName, Username, PasswordHash, Role, BranchID, DeliveryArea, Phone
      FROM dbo.Users
      WHERE Username = @username
    `);
  const user = result.recordset[0];
  if (!user || !(await bcrypt.compare(password, user.PasswordHash))) {
    throw new HttpError(401, 'Tên đăng nhập hoặc mật khẩu không chính xác.');
  }
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
    SELECT BranchID, BranchName, Address
    FROM dbo.Branches
    WHERE IsActive = 1
    ORDER BY BranchName
  `);
  res.json(result.recordset);
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

app.post('/api/customer/orders', authenticateToken, authorizeRoles('CUSTOMER'), asyncRoute(async (req, res) => {
  const body = req.body || {};
  const branchId = positiveInteger(body.branchId);
  const deliveryAddress = typeof body.deliveryAddress === 'string' ? body.deliveryAddress.trim() : '';
  const deliveryArea = body.deliveryArea;
  const items = body.items;
  if (!branchId) throw new HttpError(400, 'Vui lòng chọn chi nhánh.');
  if (!deliveryAddress || deliveryAddress.length > 255) {
    throw new HttpError(400, 'Địa chỉ giao hàng là bắt buộc và tối đa 255 ký tự.');
  }
  if (!deliveryAreas.includes(deliveryArea)) throw new HttpError(400, 'Khu vực giao hàng không hợp lệ.');
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
      .input('totalAmount', sql.Decimal(18, 0), totalAmount)
      .query(`
        INSERT INTO dbo.Orders
          (BranchID, TableID, CustomerID, DeliveryAddress, DeliveryArea, TotalAmount, Status)
        OUTPUT INSERTED.OrderID
        VALUES
          (@branchId, NULL, @customerId, @deliveryAddress, @deliveryArea, @totalAmount, N'Chờ duyệt')
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
    return orderId;
  });

  emitOrderUpdate({
    orderId: result,
    status: 'Chờ duyệt',
    branchId,
    customerId: req.user.userId,
    action: 'ORDER_CREATED',
  });
  res.status(201).json({ orderId: result, status: 'Chờ duyệt' });
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
    if (row.Status !== 'Chờ duyệt') throw new HttpError(409, 'Đơn hàng không còn ở trạng thái chờ duyệt.');

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
      .query("UPDATE dbo.Orders SET ShipperID = @shipperId, Status = N'Đang giao hàng' WHERE OrderID = @orderId");
    return order;
  });

  emitOrderUpdate({
    orderId,
    status: 'Đang giao hàng',
    branchId: result.BranchID,
    customerId: result.CustomerID,
    shipperId,
    action: 'SHIPPER_ASSIGNED',
  });
  res.json({ orderId, shipperId, status: 'Đang giao hàng' });
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
  if (!req.user.branchId) throw new HttpError(403, 'Tài khoản đầu bếp chưa được gán chi nhánh.');
  const pool = await getPool();
  const result = await pool.request()
    .input('branchId', sql.Int, req.user.branchId)
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
  if (!req.user.branchId) throw new HttpError(403, 'Tài khoản đầu bếp chưa được gán chi nhánh.');

  const expectedStatus = nextStatus === 'Đang chế biến' ? 'Chờ chế biến' : 'Đang chế biến';
  const pool = await getPool();
  const result = await pool.request()
    .input('orderId', sql.Int, orderId)
    .input('branchId', sql.Int, req.user.branchId)
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
        customer.Phone AS CustomerPhone, o.ShipperID
      FROM dbo.Orders o
      JOIN dbo.Branches b ON b.BranchID = o.BranchID
      LEFT JOIN dbo.Users customer ON customer.UserID = o.CustomerID
      WHERE (o.ShipperID = @shipperId AND o.Status = N'Đang giao hàng')
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
        WHERE OrderID = @orderId AND ShipperID IS NULL
          AND Status = N'Bếp hoàn thành' AND DeliveryArea = @deliveryArea
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
