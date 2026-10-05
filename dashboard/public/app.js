const $ = (id) => document.getElementById(id);
const feed = $('feed');
let lastSnapshot = null;

function formatUptime(sec) {
  sec = Number(sec || 0);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [d ? d + 'd' : '', h ? h + 'h' : '', m ? m + 'm' : '', s + 's'].filter(Boolean).join(' ');
}

function write(id, value) {
  $(id).textContent = value ?? '—';
}

function addFeed(title, detail) {
  const item = document.createElement('div');
  item.className = 'feed-item';
  item.innerHTML = '<span class="status-dot"></span><div><strong></strong><small></small></div>';
  item.querySelector('strong').textContent = title;
  item.querySelector('small').textContent = detail;
  feed.prepend(item);
  while (feed.children.length > 4) feed.removeChild(feed.lastChild);
}

async function refresh() {
  $('refresh').disabled = true;
  try {
    const res = await fetch('/api/metrics', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    write('uptime', formatUptime(data.runtime.uptimeSeconds));
    write('users', data.database.users);
    write('bots', data.database.botRecords);
    write('node', data.runtime.node);
    write('platform', data.runtime.platform);
    write('pid', data.runtime.pid);
    write('environment', data.service.environment);
    write('users-detail', data.database.users);
    write('slots', data.database.slots);
    write('licenses', data.database.licenses);
    $('updated').textContent = 'Updated ' + new Date(data.generatedAt).toLocaleTimeString();

    $('dashboard-status').textContent = data.service.dashboard;
    $('api-status').textContent = data.service.api;
    $('db-status').textContent = data.service.database;

    if (!lastSnapshot) {
      addFeed('Monitoring connected', 'Live metrics are available.');
    } else if (JSON.stringify(lastSnapshot.database) !== JSON.stringify(data.database)) {
      addFeed('Database counters changed', 'A new aggregate snapshot is available.');
    }
    lastSnapshot = data;
  } catch (error) {
    $('updated').textContent = 'Update failed';
    addFeed('Metrics request failed', error.message);
  } finally {
    $('refresh').disabled = false;
  }
}

$('refresh').addEventListener('click', refresh);
refresh();
setInterval(refresh, 5000);
