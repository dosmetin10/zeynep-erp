const STORAGE_KEY = 'mtn.erp.state.v2';

const users = {
  mtn: '1453',
  muhasebe: '1453',
};

const els = {
  loginScreen: document.getElementById('loginScreen'),
  appScreen: document.getElementById('appScreen'),
  loginForm: document.getElementById('loginForm'),
  welcomeText: document.getElementById('welcomeText'),
  tabs: document.getElementById('tabs'),
  customerForm: document.getElementById('customerForm'),
  customerRows: document.getElementById('customerRows'),
  customerSearch: document.getElementById('customerSearch'),
  stockForm: document.getElementById('stockForm'),
  stockRows: document.getElementById('stockRows'),
  stockSearch: document.getElementById('stockSearch'),
  cashForm: document.getElementById('cashForm'),
  cashRows: document.getElementById('cashRows'),
  saleForm: document.getElementById('saleForm'),
  saleRows: document.getElementById('saleRows'),
  saleCustomerSelect: document.getElementById('saleCustomerSelect'),
  saleStockSelect: document.getElementById('saleStockSelect'),
  dashboardKpis: document.getElementById('dashboardKpis'),
  criticalAlerts: document.getElementById('criticalAlerts'),
  recentActivities: document.getElementById('recentActivities'),
  reportBox: document.getElementById('reportBox'),
  exportCsvBtn: document.getElementById('exportCsvBtn'),
  backupBtn: document.getElementById('backupBtn'),
  restoreBtn: document.getElementById('restoreBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  toast: document.getElementById('toast'),
};

const state = loadState();
let currentUser = null;

bindEvents();
renderAll();

function bindEvents() {
  els.loginForm.addEventListener('submit', onLogin);
  els.tabs.addEventListener('click', switchTab);
  els.customerForm.addEventListener('submit', addCustomer);
  els.stockForm.addEventListener('submit', upsertStock);
  els.cashForm.addEventListener('submit', addCashTransaction);
  els.saleForm.addEventListener('submit', createSaleInvoice);
  els.customerSearch.addEventListener('input', renderCustomers);
  els.stockSearch.addEventListener('input', renderStock);
  els.backupBtn.addEventListener('click', saveBackup);
  els.restoreBtn.addEventListener('click', loadBackup);
  els.exportCsvBtn.addEventListener('click', exportCsv);
  els.logoutBtn.addEventListener('click', logout);
}

function onLogin(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const username = String(form.get('username')).trim().toLowerCase();
  const password = String(form.get('password'));

  if (!users[username] || users[username] !== password) {
    toast('Hatalı kullanıcı adı veya şifre.');
    return;
  }

  currentUser = username;
  els.welcomeText.textContent = `Hoş geldiniz, ${username.toUpperCase()}. Son yedekleme: ${state.meta.lastBackup || 'Yok'}`;
  els.loginScreen.classList.remove('active');
  els.appScreen.classList.add('active');
  event.target.reset();
}

function switchTab(event) {
  const button = event.target.closest('button[data-tab]');
  if (!button) return;

  const tabId = button.dataset.tab;
  document.querySelectorAll('.tabs button').forEach((item) => item.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

function addCustomer(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const customer = {
    id: crypto.randomUUID(),
    type: String(form.get('type')),
    name: String(form.get('name')).trim(),
    phone: String(form.get('phone')).trim(),
    taxNo: String(form.get('taxNo')).trim(),
    balance: Number(form.get('balance') || 0),
    createdAt: new Date().toISOString(),
  };

  if (!customer.name) {
    toast('Cari unvanı zorunludur.');
    return;
  }

  state.customers.push(customer);
  registerActivity(`${customer.name} için cari kart açıldı.`);
  persist();
  event.target.reset();
  renderAll();
  toast('Cari kart kaydedildi.');
}

function upsertStock(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const code = String(form.get('code')).trim().toUpperCase();
  const quantity = Number(form.get('quantity'));
  const price = Number(form.get('price'));
  const minLevel = Number(form.get('minLevel'));

  if (!code || quantity < 0 || price < 0 || minLevel < 0) {
    toast('Stok alanlarını kontrol edin.');
    return;
  }

  const existing = state.stock.find((item) => item.code === code);
  if (existing) {
    existing.name = String(form.get('name')).trim();
    existing.unit = String(form.get('unit'));
    existing.quantity = quantity;
    existing.price = price;
    existing.minLevel = minLevel;
    existing.updatedAt = new Date().toISOString();
    registerActivity(`${existing.code} kodlu stok kartı güncellendi.`);
    toast('Stok kartı güncellendi.');
  } else {
    const newItem = {
      code,
      name: String(form.get('name')).trim(),
      unit: String(form.get('unit')),
      quantity,
      price,
      minLevel,
      updatedAt: new Date().toISOString(),
    };
    state.stock.push(newItem);
    registerActivity(`${newItem.code} kodlu yeni stok kartı açıldı.`);
    toast('Yeni stok kartı eklendi.');
  }

  persist();
  event.target.reset();
  renderAll();
}

function addCashTransaction(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const amount = Number(form.get('amount'));

  if (amount <= 0) {
    toast('Kasa tutarı 0’dan büyük olmalı.');
    return;
  }

  const txn = {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    type: String(form.get('type')),
    description: String(form.get('description')).trim(),
    amount,
  };

  state.cash.push(txn);
  registerActivity(`Kasa ${txn.type.toLowerCase()} işlemi: ${txn.description}`);
  persist();
  event.target.reset();
  renderAll();
  toast('Kasa hareketi kaydedildi.');
}

function createSaleInvoice(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const customerId = String(form.get('customerId'));
  const stockCode = String(form.get('stockCode'));
  const quantity = Number(form.get('quantity'));
  const unitPrice = Number(form.get('unitPrice'));
  const discountRate = Number(form.get('discountRate') || 0);

  const customer = state.customers.find((item) => item.id === customerId);
  const stockItem = state.stock.find((item) => item.code === stockCode);

  if (!customer || !stockItem) {
    toast('Müşteri veya stok kaydı bulunamadı.');
    return;
  }

  if (quantity <= 0 || unitPrice < 0 || discountRate < 0 || discountRate > 100) {
    toast('Satış verilerini kontrol edin.');
    return;
  }

  if (stockItem.quantity < quantity) {
    toast(`Yetersiz stok: ${stockItem.name} için mevcut ${stockItem.quantity} ${stockItem.unit}.`);
    return;
  }

  const grossTotal = quantity * unitPrice;
  const discountTotal = (grossTotal * discountRate) / 100;
  const netTotal = grossTotal - discountTotal;

  const invoice = {
    id: generateInvoiceNo(),
    date: new Date().toISOString(),
    customerId,
    customerName: customer.name,
    stockCode,
    stockName: stockItem.name,
    quantity,
    unitPrice,
    discountRate,
    netTotal,
  };

  stockItem.quantity -= quantity;
  customer.balance += netTotal;
  state.sales.push(invoice);

  registerActivity(`Satış faturası ${invoice.id} kesildi (${customer.name}).`);
  persist();
  event.target.reset();
  renderAll();
  toast(`Fatura oluşturuldu: ${invoice.id}`);
}

async function saveBackup() {
  if (!window.mtnApi) return toast('Yedekleme API erişimi yok.');

  const result = await window.mtnApi.saveBackup(state);
  if (result.ok) {
    state.meta.lastBackup = new Date().toLocaleString('tr-TR');
    persist();
    renderAll();
  }
  toast(result.message);
}

async function loadBackup() {
  if (!window.mtnApi) return toast('Yedekleme API erişimi yok.');

  try {
    const result = await window.mtnApi.loadBackup();
    if (!result.ok) return toast(result.message);
    Object.assign(state, sanitizeState(result.payload));
    registerActivity('Yedek dosyasından geri yükleme yapıldı.');
    persist();
    renderAll();
    toast(result.message);
  } catch {
    toast('Yedek dosyası okunamadı veya bozuk.');
  }
}

async function exportCsv() {
  if (!window.mtnApi) return toast('CSV dışa aktarma kullanılamıyor.');

  const rows = [
    ['FaturaNo', 'Tarih', 'Musteri', 'StokKodu', 'StokAdi', 'Miktar', 'BirimFiyat', 'Iskonto', 'NetTutar'].join(','),
    ...state.sales.map((sale) => [
      sale.id,
      new Date(sale.date).toLocaleDateString('tr-TR'),
      csvEscape(sale.customerName),
      sale.stockCode,
      csvEscape(sale.stockName),
      sale.quantity,
      sale.unitPrice.toFixed(2),
      sale.discountRate,
      sale.netTotal.toFixed(2),
    ].join(',')),
  ].join('\n');

  const result = await window.mtnApi.exportCsvReport({
    filename: `satis-raporu-${new Date().toISOString().slice(0, 10)}.csv`,
    content: rows,
  });

  toast(result.message);
}

function logout() {
  currentUser = null;
  els.appScreen.classList.remove('active');
  els.loginScreen.classList.add('active');
  toast('Çıkış yapıldı.');
}

function renderAll() {
  renderCustomers();
  renderStock();
  renderCash();
  renderSales();
  renderSaleSelectors();
  renderDashboard();
  renderReports();
}

function renderCustomers() {
  const query = els.customerSearch.value.trim().toLocaleLowerCase('tr');
  const rows = state.customers
    .filter((item) => item.name.toLocaleLowerCase('tr').includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    .map(
      (item) =>
        `<tr><td>${item.type}</td><td>${item.name}</td><td>${item.phone || '-'}</td><td>${formatMoney(item.balance)}</td></tr>`,
    );

  els.customerRows.innerHTML = rows.join('') || `<tr><td colspan="4" class="muted">Cari kayıt yok.</td></tr>`;
}

function renderStock() {
  const query = els.stockSearch.value.trim().toLocaleLowerCase('tr');
  const rows = state.stock
    .filter(
      (item) =>
        item.code.toLocaleLowerCase('tr').includes(query) ||
        item.name.toLocaleLowerCase('tr').includes(query),
    )
    .sort((a, b) => a.code.localeCompare(b.code, 'tr'))
    .map(
      (item) => `<tr class="${item.quantity <= item.minLevel ? 'warning-row' : ''}">
        <td>${item.code}</td>
        <td>${item.name}</td>
        <td>${item.quantity}</td>
        <td>${item.minLevel}</td>
        <td>${item.unit}</td>
        <td>${formatMoney(item.price)}</td>
      </tr>`,
    );

  els.stockRows.innerHTML = rows.join('') || `<tr><td colspan="6" class="muted">Stok kayıt yok.</td></tr>`;
}

function renderCash() {
  const rows = state.cash
    .slice()
    .reverse()
    .map(
      (item) =>
        `<tr><td>${new Date(item.date).toLocaleDateString('tr-TR')}</td><td>${item.type}</td><td>${item.description}</td><td>${formatMoney(item.amount)}</td></tr>`,
    );
  els.cashRows.innerHTML = rows.join('') || `<tr><td colspan="4" class="muted">Kasa hareketi yok.</td></tr>`;
}

function renderSales() {
  const rows = state.sales
    .slice()
    .reverse()
    .map(
      (item) =>
        `<tr><td>${item.id}</td><td>${item.customerName}</td><td>${new Date(item.date).toLocaleDateString('tr-TR')}</td><td>${formatMoney(item.netTotal)}</td></tr>`,
    );

  els.saleRows.innerHTML = rows.join('') || `<tr><td colspan="4" class="muted">Satış faturası yok.</td></tr>`;
}

function renderSaleSelectors() {
  const customerOptions = state.customers
    .filter((item) => item.type === 'Müşteri')
    .map((item) => `<option value="${item.id}">${item.name}</option>`);

  els.saleCustomerSelect.innerHTML = customerOptions.length
    ? customerOptions.join('')
    : '<option value="">Önce müşteri ekleyin</option>';

  const stockOptions = state.stock
    .filter((item) => item.quantity > 0)
    .map((item) => `<option value="${item.code}">${item.code} - ${item.name} (Stok: ${item.quantity})</option>`);

  els.saleStockSelect.innerHTML = stockOptions.length
    ? stockOptions.join('')
    : '<option value="">Önce stok ekleyin</option>';
}

function renderDashboard() {
  const totalReceivable = state.customers
    .filter((item) => item.type === 'Müşteri')
    .reduce((sum, item) => sum + item.balance, 0);
  const stockValue = state.stock.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const cashBalance = state.cash.reduce((sum, item) => sum + (item.type === 'Gelir' ? item.amount : -item.amount), 0);
  const monthlySales = state.sales
    .filter((item) => new Date(item.date).getMonth() === new Date().getMonth())
    .reduce((sum, item) => sum + item.netTotal, 0);

  els.dashboardKpis.innerHTML = `
    <article class="kpi"><span>Müşteri Alacağı</span><strong>${formatMoney(totalReceivable)}</strong></article>
    <article class="kpi"><span>Stok Portföy Değeri</span><strong>${formatMoney(stockValue)}</strong></article>
    <article class="kpi"><span>Kasa Net Bakiye</span><strong>${formatMoney(cashBalance)}</strong></article>
    <article class="kpi"><span>Aylık Satış Cirosu</span><strong>${formatMoney(monthlySales)}</strong></article>
  `;

  const critical = state.stock.filter((item) => item.quantity <= item.minLevel);
  els.criticalAlerts.innerHTML = critical.length
    ? critical.map((item) => `<li>${item.code} - ${item.name}: kritik seviye (${item.quantity} ${item.unit})</li>`).join('')
    : '<li class="muted">Kritik stok uyarısı bulunmuyor.</li>';

  els.recentActivities.innerHTML = state.activities.length
    ? state.activities
        .slice()
        .reverse()
        .slice(0, 8)
        .map((item) => `<li><strong>${new Date(item.date).toLocaleString('tr-TR')}:</strong> ${item.text}</li>`)
        .join('')
    : '<li class="muted">Henüz operasyon hareketi yok.</li>';
}

function renderReports() {
  const income = state.cash.filter((item) => item.type === 'Gelir').reduce((sum, item) => sum + item.amount, 0);
  const expense = state.cash.filter((item) => item.type === 'Gider').reduce((sum, item) => sum + item.amount, 0);
  const totalSales = state.sales.reduce((sum, item) => sum + item.netTotal, 0);
  const bestCustomer = findBestCustomer();

  els.reportBox.innerHTML = `
    <ul>
      <li>Toplam Cari Kartı: <strong>${state.customers.length}</strong></li>
      <li>Toplam Stok Kalemi: <strong>${state.stock.length}</strong></li>
      <li>Kesilen Satış Faturası: <strong>${state.sales.length}</strong></li>
      <li>Toplam Satış Cirosu: <strong>${formatMoney(totalSales)}</strong></li>
      <li>Toplam Gelir: <strong>${formatMoney(income)}</strong></li>
      <li>Toplam Gider: <strong>${formatMoney(expense)}</strong></li>
      <li>Net Nakit Akışı: <strong>${formatMoney(income - expense)}</strong></li>
      <li>En Yüksek Satış Yapılan Cari: <strong>${bestCustomer}</strong></li>
    </ul>
  `;
}

function findBestCustomer() {
  if (!state.sales.length) return 'Veri yok';
  const grouped = new Map();
  state.sales.forEach((item) => grouped.set(item.customerName, (grouped.get(item.customerName) || 0) + item.netTotal));

  let bestName = 'Veri yok';
  let bestValue = -1;
  grouped.forEach((value, key) => {
    if (value > bestValue) {
      bestValue = value;
      bestName = `${key} (${formatMoney(value)})`;
    }
  });

  return bestName;
}

function registerActivity(text) {
  state.activities.push({ id: crypto.randomUUID(), text, date: new Date().toISOString(), user: currentUser || 'system' });
  if (state.activities.length > 200) state.activities = state.activities.slice(-200);
}

function generateInvoiceNo() {
  const seq = String(state.sales.length + 1).padStart(5, '0');
  return `SF-${new Date().getFullYear()}-${seq}`;
}

function csvEscape(value) {
  const stringValue = String(value ?? '');
  return `"${stringValue.replaceAll('"', '""')}"`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeState(JSON.parse(raw)) : sanitizeState({});
  } catch {
    return sanitizeState({});
  }
}

function sanitizeState(data) {
  return {
    customers: Array.isArray(data.customers) ? data.customers : [],
    stock: Array.isArray(data.stock) ? data.stock : [],
    cash: Array.isArray(data.cash) ? data.cash : [],
    sales: Array.isArray(data.sales) ? data.sales : [],
    activities: Array.isArray(data.activities) ? data.activities : [],
    meta: typeof data.meta === 'object' && data.meta ? data.meta : { lastBackup: null },
  };
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatMoney(value) {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(value) || 0);
}

let toastTimer;
function toast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add('show');
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}
