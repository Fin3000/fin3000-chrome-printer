import { loadConfig } from './config.js';
import {
  createExactlyOnceCallback,
  EMPTY_PRINTER_CAPABILITIES,
  ExtensionError,
  i18n,
  PRINTER_CAPABILITIES,
  PrintResult,
} from './core.js';
import { reconcileStoredOperation, transferPrintJob } from './intake.js';
import { connectAccount, disconnectAccount } from './oauth.js';
import {
  expireOperation,
  initializeStorage,
  readAuth,
  readOperation,
  readStatus,
  UiStatus,
  writeStatus,
} from './storage.js';

const KEEPALIVE_INTERVAL_MS = 20_000;
const SUCCESS_NOTIFICATION_ID = 'fin3000-print-accepted';
let activePrint = false;
let reconcilePromise: Promise<void> | undefined;

const badge: Record<UiStatus['kind'], { text: string; color: string }> = {
  ready: { text: '', color: '#2563eb' },
  sending: { text: '…', color: '#2563eb' },
  success: { text: '✓', color: '#15803d' },
  checking: { text: '?', color: '#a16207' },
  error: { text: '!', color: '#b91c1c' },
};

function messageKeyForError(error: unknown): string {
  if (!(error instanceof ExtensionError)) return 'statusNotSent';
  if (
    [
      'NOT_CONNECTED',
      'AUTH_EXPIRED',
      'TOKEN_REJECTED',
      'PRINCIPAL_REJECTED',
      'ACCOUNT_CHANGED',
    ].includes(error.code)
  ) {
    return 'statusConnectFirst';
  }
  if (error.code === 'PDF_TOO_LARGE') return 'statusTooLarge';
  if (['INVALID_PDF', 'EMPTY_PDF', 'INVALID_PRINTER'].includes(error.code)) {
    return 'statusInvalidPdf';
  }
  if (error.code === 'BUSY') return 'statusBusy';
  if (error.code === 'TRANSFER_OUTCOME_UNKNOWN') return 'statusChecking';
  return 'statusNotSent';
}

async function setBadge(status: UiStatus): Promise<void> {
  const value = badge[status.kind];
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: value.color }),
    chrome.action.setBadgeText({ text: value.text }),
  ]);
}

async function notifySuccess(operationId: string): Promise<void> {
  await chrome.notifications.create(`${SUCCESS_NOTIFICATION_ID}-${operationId}`, {
    type: 'basic',
    iconUrl: 'icon.png',
    title: i18n('extensionName'),
    message: i18n('statusAccepted'),
    priority: 2,
  });
}

async function notifyFailure(messageKey: string): Promise<void> {
  await chrome.notifications.create('fin3000-print-result', {
    type: 'basic',
    iconUrl: 'icon.png',
    title: i18n('extensionName'),
    message: i18n(messageKey),
  });
}

async function printerDescription(): Promise<string> {
  const auth = await readAuth();
  return auth
    ? i18n('printerDescriptionConnected', auth.accountName)
    : i18n('printerDescriptionConnect');
}

async function handlePrint(
  printJob: chrome.printerProvider.PrintJob,
  resultCallback: (result: PrintResult) => void,
): Promise<void> {
  const finish = createExactlyOnceCallback(resultCallback);
  if (activePrint) {
    finish('FAILED');
    await Promise.allSettled([writeStatus('error', 'statusBusy'), notifyFailure('statusBusy')]);
    return;
  }
  activePrint = true;
  const keepAlive = setInterval(() => {
    void chrome.storage.local.get('printOperation');
  }, KEEPALIVE_INTERVAL_MS);
  try {
    if (await readOperation()) throw new ExtensionError('BUSY');
    const config = await loadConfig();
    const outcome = await transferPrintJob(config, printJob);
    finish('OK');
    await Promise.allSettled([
      notifySuccess(outcome.operationId),
      chrome.storage.local.remove('printOperation'),
    ]);
  } catch (error) {
    const messageKey = messageKeyForError(error);
    finish(error instanceof ExtensionError ? error.printResult : 'FAILED');
    await Promise.allSettled([
      ...(messageKey === 'statusChecking' ? [] : [writeStatus('error', messageKey)]),
      notifyFailure(messageKey),
    ]);
  } finally {
    clearInterval(keepAlive);
    activePrint = false;
  }
}

async function settleStoredOperation(
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<void> {
  if (!reconcilePromise) {
    reconcilePromise = (async () => {
      const outcome = await reconcileStoredOperation(config);
      if (outcome.kind === 'accepted') {
        await Promise.allSettled([
          notifySuccess(outcome.operationId),
          chrome.storage.local.remove('printOperation'),
        ]);
      }
    })().finally(() => {
      reconcilePromise = undefined;
    });
  }
  await reconcilePromise;
}

async function initialize(): Promise<void> {
  await initializeStorage();
  try {
    const config = await loadConfig();
    await expireOperation(config.operationTtlMs);
    await settleStoredOperation(config);
  } catch {
    await writeStatus('error', 'statusActionFailed');
  }
  await setBadge(await readStatus());
}

chrome.printerProvider.onGetPrintersRequested.addListener((resultCallback) => {
  void printerDescription()
    .then((description) => {
      resultCallback([
        {
          id: 'fin3000-incoming-invoice',
          name: i18n('printerName'),
          description,
        },
      ]);
    })
    .catch(() => resultCallback([]));
});

chrome.printerProvider.onGetCapabilityRequested.addListener((printerId, resultCallback) => {
  resultCallback(
    printerId === 'fin3000-incoming-invoice' ? PRINTER_CAPABILITIES : EMPTY_PRINTER_CAPABILITIES,
  );
});

chrome.printerProvider.onPrintRequested.addListener((printJob, resultCallback) => {
  void handlePrint(printJob, resultCallback);
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void (async () => {
    const config = await loadConfig();
    const command =
      message && typeof message === 'object' && 'command' in message ? String(message.command) : '';
    if (command === 'connect') {
      await connectAccount(config);
      await settleStoredOperation(config);
    } else if (command === 'reconcileState') {
      await expireOperation(config.operationTtlMs);
      await settleStoredOperation(config);
    } else if (command === 'disconnect') await disconnectAccount(config);
    else if (command === 'openInbox') {
      await chrome.tabs.create({
        url: new URL('/accounting/incoming-invoices', config.frontendOrigin).href,
      });
    } else if (command !== 'getState') {
      throw new ExtensionError('MESSAGE_INVALID');
    }
    const auth = await readAuth();
    sendResponse({
      ok: true,
      account: auth ? { accountName: auth.accountName } : null,
      status: await readStatus(),
      activePrint,
    });
  })().catch((error: unknown) => {
    sendResponse({
      ok: false,
      errorCode: error instanceof ExtensionError ? error.code : 'UNEXPECTED_ERROR',
    });
  });
  return true;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes['uiStatus']?.newValue) {
    void setBadge(changes['uiStatus'].newValue as UiStatus);
  }
});

chrome.runtime.onInstalled.addListener(() => void initialize());
chrome.runtime.onStartup.addListener(() => void initialize());
void initialize();
