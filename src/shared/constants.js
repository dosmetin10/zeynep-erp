const WINDOWS = {
  mainMenu: 'mainMenu',
  customersWindow: 'customersWindow',
  stockWindow: 'stockWindow',
  salesWindow: 'salesWindow',
  purchaseWindow: 'purchaseWindow',
  cashWindow: 'cashWindow',
  bankWindow: 'bankWindow',
  proposalWindow: 'proposalWindow',
  invoiceWindow: 'invoiceWindow',
  reportsWindow: 'reportsWindow',
  settingsWindow: 'settingsWindow',
  usersWindow: 'usersWindow',
  backupWindow: 'backupWindow',
};

const IPC = {
  authSetup: 'auth:setupAdmin',
  authLogin: 'auth:login',
  openModuleWindow: 'window:openModule',
  dataList: 'data:list',
  dataCreate: 'data:create',
  salesCreate: 'sales:createInvoice',
  paymentsCreate: 'payments:create',
  reportSummary: 'reports:summary',
  backupCreate: 'backup:create',
  backupRestore: 'backup:restore',
  legacyImport: 'legacy:importJson',
};

module.exports = { WINDOWS, IPC };
