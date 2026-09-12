import {
  ACTIVE_KEEPALIVE_INTERVAL_MS,
  PRINTER_CAPABILITIES,
  PRINTER_ID,
  createExactlyOnceCallback,
  inspectPrintJob,
  normalizeDelaySeconds,
  safeFailureCode,
} from './core.js';

const PROFILE = __PROFILE_CONFIG__;
const HISTORY_LIMIT = 50;
const REPORT_PATH = 'probe-report.html';

let activePrint = null;

function capturedAt() {
  return new Date().toISOString();
}

function chromeMajorVersion() {
  const match = navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/);
  return match ? Number(match[1]) : null;
}

async function appendRecord(record) {
  const { probeHistory = [] } = await chrome.storage.local.get('probeHistory');
  await chrome.storage.local.set({
    probeHistory: [record, ...probeHistory].slice(0, HISTORY_LIMIT),
    probeResult: record,
  });
}

async function clearActiveMarker(operationId) {
  const { probeActive } = await chrome.storage.local.get('probeActive');
  if (probeActive?.operationId === operationId) {
    await chrome.storage.local.remove('probeActive');
  }
}

async function finishActivePrint(active, result, status, extra = {}) {
  const callbackInvoked = active.callback(result);
  if (!callbackInvoked) {
    return;
  }
  if (active.timerId !== null) {
    clearTimeout(active.timerId);
  }
  if (active.keepAliveId !== null) {
    clearInterval(active.keepAliveId);
  }
  if (activePrint?.operationId === active.operationId) {
    activePrint = null;
  }
  await clearActiveMarker(active.operationId);
  await appendRecord({
    callbackCount: 1,
    callbackDelaySeconds: active.delaySeconds,
    callbackResult: result,
    capturedAt: capturedAt(),
    operationId: active.operationId,
    profile: PROFILE.profile,
    profileVersion: PROFILE.profileVersion,
    status,
    ...extra,
  });
}

async function selectedDelaySeconds() {
  const { probeDelaySeconds } = await chrome.storage.local.get('probeDelaySeconds');
  return normalizeDelaySeconds(
    probeDelaySeconds,
    PROFILE.callbackDelaysSeconds,
    PROFILE.defaultCallbackDelaySeconds,
  );
}

async function handlePrintRequested(printJob, resultCallback) {
  const operationId = crypto.randomUUID();
  const callback = createExactlyOnceCallback(resultCallback);
  const active = {
    callback,
    delaySeconds: PROFILE.defaultCallbackDelaySeconds,
    keepAliveId: null,
    operationId,
    timerId: null,
  };

  if (activePrint) {
    const busy = {
      ...active,
      delaySeconds: 0,
    };
    await finishActivePrint(busy, 'FAILED', 'FAILED_BUSY', {
      errorCode: 'ACTIVE_PRINT_EXISTS',
    });
    return;
  }

  activePrint = active;
  active.keepAliveId = setInterval(() => {
    void chrome.storage.local.get('probeActive').catch(() => undefined);
  }, ACTIVE_KEEPALIVE_INTERVAL_MS);

  try {
    const delaySeconds = await selectedDelaySeconds();
    active.delaySeconds = delaySeconds;
    await chrome.storage.local.set({
      probeActive: {
        capturedAt: capturedAt(),
        callbackDelaySeconds: delaySeconds,
        operationId,
        status: 'WAITING_CALLBACK',
      },
    });

    const document = await inspectPrintJob(printJob, PROFILE.maxFileBytes);
    await appendRecord({
      callbackDelaySeconds: delaySeconds,
      capturedAt: capturedAt(),
      document,
      operationId,
      profile: PROFILE.profile,
      profileVersion: PROFILE.profileVersion,
      status: 'PDF_RECEIVED',
    });

    active.timerId = setTimeout(() => {
      void finishActivePrint(active, 'OK', 'PASS', { document });
    }, delaySeconds * 1000);
  } catch (error) {
    const errorCode = safeFailureCode(error);
    const result = errorCode === 'INVALID_PRINTER' ? 'FAILED' : 'INVALID_DATA';
    await finishActivePrint(active, result, 'FAILED_ADMISSION', { errorCode });
  }
}

async function initializeProbe() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const apiAvailable = Boolean(
    chrome.printerProvider?.onGetPrintersRequested &&
      chrome.printerProvider?.onGetCapabilityRequested &&
      chrome.printerProvider?.onPrintRequested,
  );
  const { probeActive } = await chrome.storage.local.get('probeActive');
  if (probeActive) {
    await appendRecord({
      callbackCount: 0,
      callbackResult: 'FAILED_BY_CHROME_OR_WORKER_RESTART',
      capturedAt: capturedAt(),
      operationId: probeActive.operationId,
      profile: PROFILE.profile,
      profileVersion: PROFILE.profileVersion,
      status: 'FAILED_WORKER_RESTART',
    });
    await chrome.storage.local.remove('probeActive');
  }
  await chrome.storage.local.set({
    probeRuntime: {
      apiAvailable,
      chromeMajorVersion: chromeMajorVersion(),
      initializedAt: capturedAt(),
      printerId: PROFILE.printerId,
    },
  });
  await chrome.action.setBadgeBackgroundColor({ color: apiAvailable ? '#15803d' : '#b91c1c' });
  await chrome.action.setBadgeText({ text: apiAvailable ? 'G1' : '!' });
}

if (chrome.printerProvider) {
  chrome.printerProvider.onGetPrintersRequested.addListener((resultCallback) => {
    resultCallback([
      {
        description: PROFILE.printerDescription,
        id: PROFILE.printerId,
        name: PROFILE.printerName,
      },
    ]);
  });

  chrome.printerProvider.onGetCapabilityRequested.addListener((printerId, resultCallback) => {
    resultCallback(printerId === PRINTER_ID ? PRINTER_CAPABILITIES : {});
  });

  chrome.printerProvider.onPrintRequested.addListener((printJob, resultCallback) => {
    void handlePrintRequested(printJob, resultCallback);
  });
}

chrome.runtime.onInstalled.addListener(() => void initializeProbe());
chrome.runtime.onStartup.addListener(() => void initializeProbe());
chrome.runtime.onSuspend.addListener(() => {
  if (activePrint) {
    void finishActivePrint(activePrint, 'FAILED', 'FAILED_WORKER_SUSPEND', {
      errorCode: 'WORKER_SUSPENDED',
    });
  }
});
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL(REPORT_PATH) });
});

void initializeProbe();
