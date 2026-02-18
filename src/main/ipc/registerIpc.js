const { ipcMain } = require('electron');
const { IPC, WINDOWS } = require('../../shared/constants');
const auth = require('../security/authService');
const erp = require('../services/erpService');
const backup = require('../services/backupService');
const { importLegacyJson } = require('../services/importService');
const { openDb } = require('../db/db');
const { logAudit } = require('../services/auditService');

function registerIpc(windowManager) {
  const allowedDataModules = ['customers', 'suppliers', 'stock', 'sales'];

  ipcMain.handle(IPC.authSetup, (_e, payload) => auth.setupAdmin(payload));
  ipcMain.handle(IPC.authLogin, (_e, payload) => auth.login(payload));

  ipcMain.handle(IPC.openModuleWindow, (_e, { token, windowName }) => {
    auth.requireSession(token);
    if (!Object.values(WINDOWS).includes(windowName)) throw new Error('Ref:IPC-001');
    windowManager.openWindow(windowName);
    return { ok: true };
  });

  ipcMain.handle(IPC.dataList, (_e, { token, moduleName, search }) => {
    auth.requireSession(token);
    if (!allowedDataModules.includes(moduleName)) throw new Error('Ref:IPC-002');
    return erp.list(moduleName, search || '');
  });

  ipcMain.handle(IPC.dataCreate, (_e, { token, moduleName, data }) => {
    const session = auth.requireRole(token, 'operator');
    let result;
    if (moduleName === 'customers') result = erp.createParty({ ...data, type: 'customer' });
    else if (moduleName === 'suppliers') result = erp.createParty({ ...data, type: 'supplier' });
    else if (moduleName === 'stock') result = erp.createProduct(data);
    else throw new Error('Ref:IPC-003');

    logAudit({ actorUserId: session.userId, action: 'create', entityType: moduleName, entityId: result.id, afterJson: result });
    return result;
  });

  ipcMain.handle(IPC.salesCreate, (_e, { token, data }) => {
    const session = auth.requireRole(token, 'operator');
    const created = erp.createSalesInvoice({ ...data, createdBy: session.userId });
    logAudit({ actorUserId: session.userId, action: 'sales_invoice_create', entityType: 'invoice', entityId: created.id, afterJson: created });
    return created;
  });

  ipcMain.handle(IPC.paymentsCreate, (_e, { token, data }) => {
    const session = auth.requireRole(token, 'operator');
    const created = erp.createPayment({ ...data, createdBy: session.userId });
    logAudit({ actorUserId: session.userId, action: 'payment_create', entityType: 'payment', entityId: created.id, afterJson: created });
    return created;
  });

  ipcMain.handle(IPC.reportSummary, (_e, { token }) => {
    auth.requireSession(token);
    const db = openDb();
    return {
      customerCount: db.prepare("SELECT COUNT(*) c FROM parties WHERE type='customer'").get().c,
      stockCount: db.prepare('SELECT COUNT(*) c FROM products').get().c,
      salesTotal: db.prepare("SELECT COALESCE(SUM(net_total),0) s FROM invoices WHERE type='sales' AND status='posted'").get().s,
      voucherCount: db.prepare('SELECT COUNT(*) c FROM journal_vouchers').get().c,
    };
  });

  ipcMain.handle(IPC.backupCreate, ({}, { token }) => {
    auth.requireRole(token, 'admin');
    return backup.backupCreate();
  });
  ipcMain.handle(IPC.backupRestore, ({}, { token }) => {
    auth.requireRole(token, 'admin');
    return backup.backupRestore();
  });

  ipcMain.handle(IPC.legacyImport, (_e, { token }) => {
    auth.requireRole(token, 'admin');
    return importLegacyJson();
  });
}

module.exports = { registerIpc };
