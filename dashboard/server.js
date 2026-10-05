const http = require('http');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.DASHBOARD_PORT || 3000);
const startedAt = Date.now();
const dbPath = path.join(__dirname, '..', 'db', 'database.db');

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) console.error('[DASHBOARD] Database unavailable:', err.message);
});

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || {}));
  });
}

async function countTable(name) {
  try {
    if (!/^[A-Za-z0-9_]+$/.test(name)) return null;
    const row = await query(`SELECT COUNT(*) AS count FROM "${name}"`);
    return Number(row.count || 0);
  } catch {
    return null;
  }
}

async function metrics() {
  const [users, slots, licenses, bots] = await Promise.all([
    countTable('users'),
    countTable('slots'),
    countTable('usedLicenses'),
    countTable('autosecure'),
  ]);

  return {
    ok: true,
    service: {
      dashboard: 'online',
      api: 'online',
      database: db.open ? 'connected' : 'unknown',
      environment: process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'server'
    },
    runtime: {
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      node: process.version,
      platform: process.platform,
      pid: process.pid
    },
    database: {
      users,
      slots,
      licenses,
      botRecords: bots
    },
    generatedAt: new Date().toISOString()
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/metrics') {
      const data = await metrics();
      res.writeHead(200, {
        'Content-Type': MIME['.json'],
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify(data));
    }

    const requestPath = new URL(req.url, 'http://127.0.0.1').pathname;
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const filePath = path.resolve(ROOT, relative);

    if (!filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, body) => {
      if (err) {
        res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(err.code === 'ENOENT' ? 'Not found' : 'Internal server error');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
      });
      res.end(body);
    });
  } catch (error) {
    console.error('[DASHBOARD] Request error:', error);
    res.writeHead(500);
    res.end('Internal server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[DASHBOARD] Monitoring dashboard listening on port ${PORT}`);
});
