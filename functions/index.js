/**
 * Luma Agency — Cloud Functions entry point.
 *
 * Every privileged operation in the system is exported from here. Each callable
 * re-validates the caller's custom claims server-side: the browser's permission
 * checks are for rendering only and are never trusted.
 *
 * Region: europe-west1 (must match FUNCTIONS_REGION in js/firebase-config.js).
 */

const { setGlobalOptions } = require('firebase-functions/v2');
const { REGION } = require('./lib/admin');

setGlobalOptions({
  region: REGION,
  maxInstances: 10,
  memory: '256MiB',
  timeoutSeconds: 60
});

/* ------------------------------------------------------------------ auth */
const authFns = require('./auth');

exports.resolveUsername = authFns.resolveUsername;
exports.reportLoginResult = authFns.reportLoginResult;
exports.requestPasswordReset = authFns.requestPasswordReset;
exports.completePasswordChange = authFns.completePasswordChange;

exports.createEmployee = authFns.createEmployee;
exports.updateEmployeeAccess = authFns.updateEmployeeAccess;
exports.setEmployeeStatus = authFns.setEmployeeStatus;
exports.resetEmployeePassword = authFns.resetEmployeePassword;
exports.updateEmployeeFinance = authFns.updateEmployeeFinance;
exports.updateOwnBanking = authFns.updateOwnBanking;
exports.updateLeaveBalance = authFns.updateLeaveBalance;
exports.registerPushToken = authFns.registerPushToken;

/* ------------------------------------------------------ permanent deletion */
const deletion = require('./deletion');

exports.deleteEmployee = deletion.deleteEmployee;
exports.deleteClient = deletion.deleteClient;
exports.deleteRequest = deletion.deleteRequest;
exports.deleteChat = deletion.deleteChat;

/* ---------------------------------------------------- credentials vault */
const vault = require('./encryption');

exports.vaultList = vault.vaultList;
exports.vaultAdd = vault.vaultAdd;
exports.vaultUpdate = vault.vaultUpdate;
exports.vaultDelete = vault.vaultDelete;
exports.vaultReveal = vault.vaultReveal;

/* --------------------------------------------------------------- finance */
const finance = require('./finance');
const financeExpenses = require('./finance/expenses');

exports.createInvoice = finance.createInvoice;
exports.recordPayment = finance.recordPayment;
exports.voidPayment = finance.voidPayment;
exports.cancelInvoice = finance.cancelInvoice;
exports.saveContract = finance.saveContract;
exports.saveExpense = financeExpenses.saveExpense;
exports.decideExpense = financeExpenses.decideExpense;
exports.saveAdBudget = financeExpenses.saveAdBudget;
exports.recordAdSpend = financeExpenses.recordAdSpend;

const treasury = require('./finance/treasury');
const payroll = require('./finance/payroll');

exports.saveAccount = treasury.saveAccount;
exports.recordTransaction = treasury.recordTransaction;
exports.transferFunds = treasury.transferFunds;
exports.reverseTransaction = treasury.reverseTransaction;
exports.reconcileTransactions = treasury.reconcileTransactions;

exports.createPayrollRun = payroll.createPayrollRun;
exports.updatePayrollLine = payroll.updatePayrollLine;
exports.approvePayrollRun = payroll.approvePayrollRun;
exports.payPayrollRun = payroll.payPayrollRun;

/* ------------------------------------------------------ AI accountant */
const ai = require('./ai');

exports.askAccountant = ai.askAccountant;

const taskAssistant = require('./ai/task-assistant');
exports.askTaskAssistant = taskAssistant.askTaskAssistant;

/* --------------------------------------------------------- notifications */
const notifications = require('./notifications');

exports.onTaskCreated = notifications.onTaskCreated;
exports.onTaskUpdated = notifications.onTaskUpdated;
exports.onTaskComment = notifications.onTaskComment;
exports.onRequestCreated = notifications.onRequestCreated;
exports.onRequestDecided = notifications.onRequestDecided;
exports.onRequestThreadMessage = notifications.onRequestThreadMessage;
exports.onChatMessage = notifications.onChatMessage;
exports.onClientUpdated = notifications.onClientUpdated;
exports.dailyDeadlineDigest = notifications.dailyDeadlineDigest;
exports.nightlyMaintenance = notifications.nightlyMaintenance;

/* ------------------------------------------------- documents & requests */
const documents = require('./pdf');

exports.assignRequestNumber = documents.assignRequestNumber;
exports.decideRequest = documents.decideRequest;
exports.getRequestDocument = documents.getRequestDocument;
