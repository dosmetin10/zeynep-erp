const STORAGE_KEY = 'mtn.erp.state.v1';

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
  stockForm: document.getElementById('stockForm'),
  stockRows: document.getElementById('stockRows'),
  cashForm: document.getElementById('cashForm'),
  cashRows: document.getElementById('cashRows'),
  dashboard: document.getElementById('dashboard'),
  reportBox: document.getElementById('reportBox'),
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
  els.cashForm.addEventListener('submit', addCashTxn);
  els.backupBtn.addEventListener('click', saveBackup);
  els.restoreBtn.addEventListener('click', loadBackup);
  els.logoutBtn.addEventListener('click', logout);
}

function onLogin(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const username = String(form.get('username')).trim().toLowerCase();
  const password = String(form.get('password'));

  if (!users[username] || users[username] !== password) {
    toast('Hatalı giriş bilgisi.');
    return;
  }

  currentUser = username;
  els.welcomeText.textContent = `Hoş geldiniz, ${username.toUpperCase()}`;
  els.loginScreen.classList.remove('active');
  els.appScreen.classList.add('active');
  e.target.reset();
}

function switchTab(e) {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  const tab = btn.dataset.tab;

  document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((x) => x.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(tab).classList.add('active');
}

function addCustomer(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  state.customers.push({
    type: String(f.get('type')),
    name: String(f.get('name')).trim(),
    phone: String(f.get('phone')).trim(),
    balance: Number(f.get('balance') || 0),
    createdAt: new Date().toISOString(),
  });
  persist();
  e.target.reset();
  renderAll();
  toast('Cari kart kaydedildi.');
}

function upsertStock(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const code = String(f.get('code')).trim().toUpperCase();
  const existing = state.stock.find((s) => s.code === code);

  if (existing) {
    existing.name = String(f.get('name')).trim();
    existing.unit = String(f.get('unit'));
    existing.quantity = Number(f.get('quantity'));
    existing.price = Number(f.get('price'));
    existing.updatedAt = new Date().toISOString();
    toast('Stok kartı güncellendi.');
  } else {
    state.stock.push({
      code,
      name: String(f.get('name')).trim(),
      unit: String(f.get('unit')),
      quantity: Number(f.get('quantity')),
      price: Number(f.get('price')),
      updatedAt: new Date().toISOString(),
    });
    toast('Yeni stok kartı oluşturuldu.');
  }

  persist();
  e.target.reset();
  renderAll();
}

function addCashTxn(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  state.cash.push({
    date: new Date().toISOString(),
    type: String(f.get('type')),
    description: String(f.get('description')).trim(),
    amount: Number(f.get('amount')),
  });
  persist();
  e.target.reset();
  renderAll();
  toast('Kasa hareketi işlendi.');
}

async function saveBackup() {
  if (!window.mtnApi) {
    toast('Yedekleme API bulunamadı.');
    return;
  }

  const result = await window.mtnApi.saveBackup(state);
  toast(result.message);
}

async function loadBackup() {
  if (!window.mtnApi) {
    toast('Yedekleme API bulunamadı.');
    return;
  }

  try {
    const result = await window.mtnApi.loadBackup();
    if (!result.ok) {
      toast(result.message);
      return;
    }

    Object.assign(state, sanitizeState(result.payload));
    persist();
    renderAll();
    toast(result.message);
  } catch {
    toast('Yedek dosyası okunamadı.');
  }
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
  renderDashboard();
  renderReport();
}

function renderCustomers() {
  els.customerRows.innerHTML = state.customers
    .slice()
    .reverse()
    .map(
      (x) => `<tr><td>${x.type}</td><td>${x.name}</td><td>${x.phone || '-'}</td><td>${formatMoney(x.balance)}</td></tr>`,
    )
    .join('');
}

function renderStock() {
  els.stockRows.innerHTML = state.stock
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, 'tr'))
    .map(
      (x) =>
        `<tr><td>${x.code}</td><td>${x.name}</td><td>${x.quantity}</td><td>${x.unit}</td><td>${formatMoney(
          x.price,
        )}</td></tr>`,
    )
    .join('');
}

function renderCash() {
  els.cashRows.innerHTML = state.cash
    .slice()
    .reverse()
    .map(
      (x) =>
        `<tr><td>${new Date(x.date).toLocaleDateString('tr-TR')}</td><td>${x.type}</td><td>${x.description}</td><td>${formatMoney(
          x.amount,
        )}</td></tr>`,
    )
    .join('');
}

function renderDashboard() {
  const totalStockValue = state.stock.reduce((sum, x) => sum + x.quantity * x.price, 0);
  const totalCustomers = state.customers.length;
  const cashBalance = state.cash.reduce((sum, x) => sum + (x.type === 'Gelir' ? x.amount : -x.amount), 0);
  const criticalStock = state.stock.filter((x) => x.quantity <= 5).length;

  els.dashboard.innerHTML = `
    <div class="kpi-grid">
      <article class="kpi"><span>Toplam Cari</span><strong>${totalCustomers}</strong></article>
      <article class="kpi"><span>Stok Portföy Değeri</span><strong>${formatMoney(totalStockValue)}</strong></article>
      <article class="kpi"><span>Kasa Bakiye</span><strong>${formatMoney(cashBalance)}</strong></article>
      <article class="kpi"><span>Kritik Stok Kalemi</span><strong>${criticalStock}</strong></article>
    </div>
  `;
}

function renderReport() {
  const customerBalance = state.customers.reduce((sum, x) => sum + x.balance, 0);
  const stockQty = state.stock.reduce((sum, x) => sum + x.quantity, 0);
  const income = state.cash.filter((x) => x.type === 'Gelir').reduce((sum, x) => sum + x.amount, 0);
  const expense = state.cash.filter((x) => x.type === 'Gider').reduce((sum, x) => sum + x.amount, 0);

  els.reportBox.innerHTML = `
    <ul>
      <li>Toplam Cari Bakiyesi: <strong>${formatMoney(customerBalance)}</strong></li>
      <li>Toplam Stok Adedi: <strong>${stockQty}</strong></li>
      <li>Toplam Gelir: <strong>${formatMoney(income)}</strong></li>
      <li>Toplam Gider: <strong>${formatMoney(expense)}</strong></li>
      <li>Net Nakit Akışı: <strong>${formatMoney(income - expense)}</strong></li>
    </ul>
  `;
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
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2400);
}
