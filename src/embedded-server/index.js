const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

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
  if (!fs.existsSync(DATA_FILE)) return { customers: [], items: [], sales: [], dispatches: [], collections: [], seq: { customer: 0, item: 0, sale: 0, dispatch: 0, collection: 0 } };
  const x = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  x.dispatches = x.dispatches || []; x.collections = x.collections || [];
  x.seq = x.seq || {}; x.seq.dispatch = x.seq.dispatch || 0; x.seq.collection = x.seq.collection || 0;
  return x;
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
  const { customerCode, itemId, qty, price, paymentMethod = 'cash', lines = [] } = req.body;
  if (!customerCode) return res.status(400).json({ error: 'Cari kodu zorunlu.' });
  const normalizedLines = Array.isArray(lines) && lines.length
    ? lines.map((line) => ({
      itemId: Number(line.itemId),
      qty: Number(line.qty),
      price: Number(line.price),
    }))
    : [{ itemId: Number(itemId), qty: Number(qty), price: Number(price) }];

  if (!normalizedLines.length || normalizedLines.some((line) => !line.itemId || line.qty <= 0 || line.price <= 0)) {
    return res.status(400).json({ error: 'Eksik/yanlış satış verisi.' });
  }

  const store = loadStore();
  let total = 0;
  for (const line of normalizedLines) {
    const item = store.items.find((x) => x.id === line.itemId);
    if (!item) return res.status(400).json({ error: `Stok bulunamadı. ID: ${line.itemId}` });
    if (item.qty < line.qty) return res.status(400).json({ error: `Negatif stok yasak. Yetersiz miktar. ID: ${line.itemId}` });
  }

  for (const line of normalizedLines) {
    const item = store.items.find((x) => x.id === line.itemId);
    item.qty -= line.qty;
    total += line.qty * line.price;
  }

  const primary = normalizedLines[0];
  const id = ++store.seq.sale;
  store.sales.push({
    id,
    customer_code: customerCode,
    item_id: primary.itemId,
    qty: normalizedLines.reduce((acc, line) => acc + line.qty, 0),
    price: primary.price,
    payment_method: paymentMethod,
    total,
    line_count: normalizedLines.length,
    status: 'posted',
    created_at: new Date().toISOString(),
  });
  saveStore(store);
  publish({ entityType: 'sale', entityId: id, action: 'posted' });
  res.status(201).json({ id });
});


app.get('/api/dispatch-notes', (req, res) => {
  const { page, pageSize } = paged(req);
  const store = loadStore();
  const rows = store.dispatches.slice((page - 1) * pageSize, page * pageSize).reverse();
  res.json({ page, pageSize, total: store.dispatches.length, rows });
});

app.post('/api/dispatch-notes', (req, res) => {
  const { noteNo, customerCode, itemId, qty, kind = 'İrsaliye', reserveStock = false } = req.body;
  if (!customerCode || !itemId || Number(qty) <= 0) return res.status(400).json({ error: 'Eksik/yanlış irsaliye verisi.' });
  const store = loadStore();
  const item = store.items.find(x => x.id === Number(itemId));
  if (!item) return res.status(400).json({ error: 'Stok bulunamadı.' });

  if (reserveStock) {
    if (item.qty < Number(qty)) return res.status(400).json({ error: 'Negatif stok yasak. Yetersiz miktar.' });
    item.qty -= Number(qty);
  }

  const id = ++store.seq.dispatch;
  store.dispatches.push({ id, note_no: (noteNo || '').trim() || `IRS-${Date.now()}`, customer_code: customerCode, item_id: Number(itemId), qty: Number(qty), kind, status: 'posted', created_at: new Date().toISOString() });
  saveStore(store);
  publish({ entityType: 'dispatch', entityId: id, action: 'posted' });
  res.status(201).json({ id });
});

app.get('/api/collections', (req, res) => {
  const { page, pageSize } = paged(req);
  const store = loadStore();
  const rows = store.collections.slice((page - 1) * pageSize, page * pageSize).reverse();
  res.json({ page, pageSize, total: store.collections.length, rows });
});

app.post('/api/collections', (req, res) => {
  const { customerCode, amount, method = 'cash' } = req.body;
  if (!customerCode || Number(amount) <= 0) return res.status(400).json({ error: 'Eksik/yanlış tahsilat verisi.' });
  const store = loadStore();
  const id = ++store.seq.collection;
  store.collections.push({ id, customer_code: customerCode, amount: Number(amount), method, created_at: new Date().toISOString() });
  saveStore(store);
  publish({ entityType: 'collection', entityId: id, action: 'create' });
  res.status(201).json({ id });
});

app.get('/api/collections/:id/pdf', (req, res) => {
  const store = loadStore();
  const row = store.collections.find(x => x.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Makbuz bulunamadı.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=tahsilat-makbuzu-${row.id}.pdf`);
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);
  doc.fontSize(22).fillColor('#0b3d5e').text('MTN ENERJİ - TAHSİLAT MAKBuzu'.toUpperCase());
  doc.moveDown();
  doc.fontSize(12).fillColor('#000').text(`Makbuz No: TM-${row.id}`);
  doc.text(`Cari Kod: ${row.customer_code}`);
  doc.text(`Tutar: ${row.amount.toFixed(2)} TL`);
  doc.text(`Yöntem: ${row.method}`);
  doc.text(`Tarih: ${row.created_at}`);
  doc.moveDown();
  doc.fontSize(10).fillColor('#666').text('Bu makbuz sistem tarafından üretilmiştir.');
  doc.end();
});


app.get('/api/customers/:code/movements', (req, res) => {
  const code = String(req.params.code);
  const store = loadStore();
  const sales = store.sales.filter(x => x.customer_code === code).map(x => ({ date: x.created_at, type: 'SATIS', amount: x.total, method: x.payment_method, ref_id: x.id }));
  const collections = store.collections.filter(x => x.customer_code === code).map(x => ({ date: x.created_at, type: 'TAHSILAT', amount: x.amount, method: x.method, ref_id: x.id }));
  const rows = [...sales, ...collections].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  res.json({ rows });
});

app.get('/api/sales/:id/pdf', (req, res) => {
  const store = loadStore();
  const sale = store.sales.find(x => x.id === Number(req.params.id));
  if (!sale) return res.status(404).json({ error: 'Satış bulunamadı.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=satis-${sale.id}.pdf`);
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);
  doc.fontSize(20).fillColor('#0b3d5e').text('MTN ENERJİ - SATIŞ BELGESİ');
  doc.moveDown(0.5).fontSize(11).fillColor('#000');
  doc.text(`Belge No: SAT-${sale.id}`);
  doc.text(`Cari Kod: ${sale.customer_code}`);
  doc.text(`Tarih: ${sale.created_at}`);
  doc.text(`Stok ID: ${sale.item_id}`);
  doc.text(`Miktar: ${sale.qty}`);
  doc.text(`Birim Fiyat: ${sale.price}`);
  doc.fontSize(14).text(`Genel Toplam: ${sale.total.toFixed(2)} TL`);
  doc.end();
});

app.get('/api/dispatch-notes/:id/pdf', (req, res) => {
  const store = loadStore();
  const row = store.dispatches.find(x => x.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'İrsaliye bulunamadı.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=irsaliye-${row.id}.pdf`);
  const doc = new PDFDocument({ margin: 40 });
  doc.pipe(res);
  doc.fontSize(20).fillColor('#0b3d5e').text('MTN ENERJİ - İRSALİYE');
  doc.moveDown(0.5).fontSize(11).fillColor('#000');
  doc.text(`İrsaliye No: ${row.note_no}`);
  doc.text(`Cari Kod: ${row.customer_code}`);
  doc.text(`Stok ID: ${row.item_id}`);
  doc.text(`Miktar: ${row.qty}`);
  doc.text(`Tarih: ${row.created_at}`);
  doc.end();
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
