const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const HTML_FILE = path.join(ROOT, '工位盘点看板.html');
const DATA_FILE = path.join(ROOT, 'workspace_shared_state.json');

// ── SSE 客户端列表 ──
const sseClients = [];

const defaultState = {
  layouts: { '17F': {}, '18F': {} },
  modifiedData: {},
  updatedAt: 0
};

function readState() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState, null, 2), 'utf8');
      return { ...defaultState, updatedAt: Date.now() };
    }
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      layouts: data.layouts || { '17F': {}, '18F': {} },
      modifiedData: data.modifiedData || {},
      updatedAt: data.updatedAt || Date.now()
    };
  } catch (err) {
    return { ...defaultState, updatedAt: Date.now() };
  }
}

function writeState(input) {
  const state = {
    layouts: input.layouts || { '17F': {}, '18F': {} },
    modifiedData: input.modifiedData || {},
    updatedAt: Date.now()
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), 'utf8');
  return state;
}

// ── 向所有 SSE 客户端广播 ──
function broadcastSSE() {
  const msg = 'data: updated\n\n';
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(msg);
    } catch (e) {
      sseClients.splice(i, 1);
    }
  }
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('文件不存在');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // ── SSE 实时推送端点 ──
  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('data: connected\n\n');
    sseClients.push(res);
    // 客户端断开时自动清理
    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, readState());
    return;
  }

  if (url.pathname === '/api/state' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const input = JSON.parse(body || '{}');
        const saved = writeState(input);
        sendJson(res, saved);
        broadcastSSE(); // 保存后立即广播给所有人
      } catch (err) {
        sendJson(res, { error: 'JSON 格式不正确' }, 400);
      }
    });
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/工位盘点看板.html') {
    sendFile(res, HTML_FILE, 'text/html; charset=utf-8');
    return;
  }

  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('禁止访问');
    return;
  }
  sendFile(res, filePath, 'application/octet-stream');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`共享工位看板服务已启动：http://localhost:${PORT}`);
  console.log(`共享数据文件：${DATA_FILE}`);
});