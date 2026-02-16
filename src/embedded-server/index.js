const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.SERVER_PORT || 3777);

function resolveStaticDir() {
  const candidates = [
    path.resolve(__dirname, '../../../client-src/web'),
    path.resolve(__dirname, '../../client-src/web'),
    path.resolve(process.cwd(), 'client-src/web'),
    path.resolve(process.cwd(), 'MTN_OfficePack/client/web'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

const app = express();
app.use(express.json());

app.get('/api/health-check', (_req, res) => {
  res.json({ ok: true, mode: 'embedded', ts: Date.now() });
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const timer = setInterval(() => {
    res.write(`data: ${JSON.stringify({ entityType: 'heartbeat', action: 'tick', ts: Date.now() })}\n\n`);
  }, 1500);
  req.on('close', () => clearInterval(timer));
});

const staticDir = resolveStaticDir();
if (staticDir) {
  app.use('/', express.static(staticDir));
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Embedded MTN server running on ${PORT} static=${staticDir || 'none'}`);
});
