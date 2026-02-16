const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.SERVER_PORT || 3777);
const DATA_FILE = path.resolve(process.cwd(), 'mtn-embedded.json');

function resolveStaticDir() {
  const candidates = [
    path.resolve(__dirname, '../../../client-src/web'),
    path.resolve(__dirname, '../../client-src/web'),
    path.resolve(process.cwd(), 'client-src/web'),
    path.resolve(process.cwd(), 'MTN_OfficePack/client/web'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function loadStore() {
  if (!fs.existsSync(DATA_FILE)) return { customers: [], items: [], sales: [], seq: { customer: 0, item: 0, sale: 0 } };
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

const app = express();
app.use(express.json());

const clients = new Set();
function publish(ev) {
  const payload = `data: ${JSON.stringify({ ...ev, ts: Date.now() })}\n\n`;
  for (const c of clients) c.write(payload);
}


function nextCode(prefix, values) {
  let max = 0;
  for (const v of values) {
    const m = String(v || '').match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function paged(req) {
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));
  const q = String(req.query.q || '').trim().toLowerCase();
  return { page, pageSize, q };
}

app.get('/api/health-check', (_req, res) => {
  res.json({ ok: true, mode: 'embedded-json', ts: Date.now() });
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});


app.get('/api/codes/next', (_req, res) => {
  const store = loadStore();
  const type = String(_req.query.type || '');
  if (type === 'customer') return res.json({ code: nextCode('CR', store.customers.map(x => x.code)) });
  if (type === 'stock') return res.json({ code: nextCode('STK', store.items.map(x => x.sku)) });
  return res.status(400).json({ error: 'Geçersiz kod tipi.' });
});

app.get('/api/customers', (req, res) => {
  const { page, pageSize, q } = paged(req);
  const store = loadStore();
  const filtered = q ? store.customers.filter(x => [x.code, x.name, x.city].join(' ').toLowerCase().includes(q)) : store.customers;
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize).reverse();
  res.json({ page, pageSize, total: filtered.length, rows });
});

app.post('/api/customers', (req, res) => {
  const { code, name, type = 'customer', phone = '', city = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'Cari kod ve ad zorunlu.' });
  const store = loadStore();
  const finalCode = (code || '').trim() || nextCode('CR', store.customers.map(x => x.code));
  if (store.customers.some(x => x.code === finalCode)) return res.status(400).json({ error: 'Cari kodu zaten var.' });
  const id = ++store.seq.customer;
  store.customers.push({ id, code: finalCode, name, type, phone, city, created_at: new Date().toISOString() });
  saveStore(store);
  publish({ entityType: 'customer', entityId: id, action: 'create' });
  res.status(201).json({ id });
});

app.put('/api/customers/:id', (req, res) => {
  const id = Number(req.params.id);
  const store = loadStore();
  const idx = store.customers.findIndex(x => x.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Cari bulunamadı.' });
  store.customers[idx] = { ...store.customers[idx], ...req.body };
  saveStore(store);
  publish({ entityType: 'customer', entityId: id, action: 'update' });
  res.json({ ok: true });
});

app.get('/api/inventory/items', (req, res) => {
  const { page, pageSize, q } = paged(req);
  const store = loadStore();
  const filtered = q ? store.items.filter(x => [x.sku, x.name].join(' ').toLowerCase().includes(q)) : store.items;
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize).reverse();
  res.json({ page, pageSize, total: filtered.length, rows });
});

app.post('/api/inventory/items', (req, res) => {
  const { sku, name, qty = 0, avgCost = 0 } = req.body;
  if (!name) return res.status(400).json({ error: 'Stok kodu ve adı zorunlu.' });
  const store = loadStore();
  const finalSku = (sku || '').trim() || nextCode('STK', store.items.map(x => x.sku));
  if (store.items.some(x => x.sku === finalSku)) return res.status(400).json({ error: 'Stok kodu zaten var.' });
  const id = ++store.seq.item;
  store.items.push({ id, sku: finalSku, name, qty: Number(qty), avg_cost: Number(avgCost), created_at: new Date().toISOString() });
  saveStore(store);
  publish({ entityType: 'inventory', entityId: id, action: 'create' });
  res.status(201).json({ id });
});

app.get('/api/sales', (req, res) => {
  const { page, pageSize } = paged(req);
  const store = loadStore();
  const rows = store.sales.slice((page - 1) * pageSize, page * pageSize).reverse();
  res.json({ page, pageSize, total: store.sales.length, rows });
});

app.post('/api/sales', (req, res) => {
  const { customerCode, itemId, qty, price, paymentMethod = 'cash' } = req.body;
  if (!customerCode || !itemId || qty <= 0 || price <= 0) return res.status(400).json({ error: 'Eksik/yanlış satış verisi.' });
  const store = loadStore();
  const item = store.items.find(x => x.id === Number(itemId));
  if (!item) return res.status(400).json({ error: 'Stok bulunamadı.' });
  if (item.qty < Number(qty)) return res.status(400).json({ error: 'Negatif stok yasak. Yetersiz miktar.' });
  item.qty -= Number(qty);
  const id = ++store.seq.sale;
  const total = Number(qty) * Number(price);
  store.sales.push({ id, customer_code: customerCode, item_id: Number(itemId), qty: Number(qty), price: Number(price), payment_method: paymentMethod, total, status: 'posted', created_at: new Date().toISOString() });
  saveStore(store);
  publish({ entityType: 'sale', entityId: id, action: 'posted' });
  res.status(201).json({ id });
});

app.get('/api/reports/trial-balance', (_req, res) => {
  const store = loadStore();
  const totalSales = store.sales.reduce((a, b) => a + (b.total || 0), 0);
  res.json([{ account_code: '600', dr: 0, cr: totalSales }, { account_code: '100', dr: totalSales, cr: 0 }]);
});

const staticDir = resolveStaticDir();
if (staticDir) app.use('/', express.static(staticDir));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Embedded MTN server running on ${PORT} data=${DATA_FILE} static=${staticDir || 'none'}`);
});
