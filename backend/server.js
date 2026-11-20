require('dotenv').config();

const cors = require('cors');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { getPool } = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  },
});

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/branches', async (_req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .query('SELECT Id AS id, Name AS name, Address AS address FROM dbo.Branches WHERE IsActive = 1 ORDER BY Name');
    res.json(result.recordset);
  } catch (error) {
    next(error);
  }
});

app.get('/api/products', async (_req, res, next) => {
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .query('SELECT Id AS id, Name AS name, Price AS price, Category AS category FROM dbo.Products WHERE IsAvailable = 1 ORDER BY Category, Name');
    res.json(result.recordset);
  } catch (error) {
    next(error);
  }
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Đã xảy ra lỗi máy chủ.' });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`POS API listening on http://localhost:${port}`);
});
