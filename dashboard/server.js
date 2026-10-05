const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const sqlite3 = require('sqlite3').verbose();

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.DASHBOARD_PORT || 3000);
const startedAt = Date.now();
const dbPath = path.join(__dirname, '..', 'db', 'database.db');
const appPidPath = path.join(__dirname, '..', 'bot.pid');
const smtpPort = Number(process.env.SMTP_PORT || 25);

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

function pidState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { state: 'not detected', pid: null };
  try {
    process.kill(pid, 0);
    return { state: 'running', pid };
  } catch {
    return { state: 'stopped', pid };
  }
}

function readApplicationState() {
  try {
    const raw = fs.readFileSync(appPidPath, 'utf8').trim();
    return pidState(Number(raw));
  } catch {
    return { state: 'not detected', pid: null };
  }
}

function tcpHealth(port, host = '127.0.0.1', timeoutMs = 900) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (state) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(state);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done('reachable'));
    socket.once('timeout', () => done('unreachable'));
    socket.once('error', () => done('unreachable'));
    socket.connect(port, host);
  });
}

async function metrics() {
  const [users, slots, licenses, bots, emails] = await Promise.all([
    countTable('users'),
    countTable('slots'),
    countTable('usedLicenses'),
    countTable('autosecure'),
    countTable('emails'),
  ]);

  const application = readApplicationState();
  const smtp = { port: smtpPort, state: await tcpHealth(smtpPort) };

  const events = [
    {
      title: application.state === 'running' ? 'Application process detected' : 'Application process not detected',
      detail: application.pid ? `PID ${application.pid}` : 'No managed process ID is available.'
    },
    {
      title: smtp.state === 'reachable' ? 'Mail transport reachable' : 'Mail transport not reachable',
      detail: `SMTP health check on port ${smtp.port}`
    },
    {
      title: 'Database counters refreshed',
      detail: 'Only aggregate counts are exposed by the dashboard.'
    }
  ];

  return {
    ok: true,
    service: {
      dashboard: 'online',
      api: 'online',
      database: db.open ? 'connected' : 'unknown',
      application: application.state,
      smtp: smtp.state,
      environment: process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : 'server'
    },
    runtime: {
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      node: process.version,
      platform: process.platform,
      pid: process.pid
    },
    application,
    smtp,
    database: {
      users,
      slots,
      licenses,
      botRecords: bots,
      mailRecords: emails
    },
    activity: events,
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
    const requestPath = new URL(req.url, 'http://127.0.0.1').pathname;

    if (requestPath === '/api/metrics' || requestPath === '/api/health') {
      const data = await metrics();
      res.writeHead(200, {
        'Content-Type': MIME['.json'],
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(JSON.stringify(data));
    }

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
