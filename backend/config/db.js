const sql = require('mssql');
require('dotenv').config();

const instanceName = process.env.DB_INSTANCE;
const config = {
  server: process.env.DB_SERVER,
  ...(instanceName ? {} : { port: Number(process.env.DB_PORT || 1433) }),
  database: process.env.DB_DATABASE || process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    ...(instanceName ? { instanceName } : {}),
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }

  return poolPromise;
}

module.exports = { getPool, sql };
