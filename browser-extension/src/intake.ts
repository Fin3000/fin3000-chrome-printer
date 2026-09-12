import { apiUrl, ExtensionConfig } from './config.js';
import { assertPdfDocument, deadlineSignal, ExtensionError, isRecord } from './core.js';
import { validAuth, verifyCurrentPrincipal } from './oauth.js';
import {
  PrintOperation,
  clearOperation,
  readOperation,
  writeOperation,
  writeStatus,
} from './storage.js';

interface IntakeItem {
  id: string;
  clientItemId: string;
  acceptedAt: string | null;
}

interface IntakeBatch {
  id: string;
  clientBatchId: string;
  items: IntakeItem[];
}

interface UploadIntent {
  method: 'POST';
  url: string;
  fields: Record<string, string>;
}

class IntakeResponseError extends ExtensionError {
  constructor(
    code: string,
    readonly status: number,
    readonly retryAfterMs: number,
  ) {
    super(code);
  }
}

const RECONCILE_RETRY_DELAYS_MS = [0, 500, 1_500, 3_000] as const;

function responseRetryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 5_000) : 0;
}

function parseItem(value: unknown): IntakeItem {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['clientItemId'] !== 'string' ||
    !(
      value['acceptedAt'] === null ||
      (typeof value['acceptedAt'] === 'string' && Boolean(value['acceptedAt']))
    )
  ) {
    throw new ExtensionError('ITEM_RESPONSE_INVALID');
  }
  return {
    id: value['id'],
    clientItemId: value['clientItemId'],
    acceptedAt: value['acceptedAt'],
  };
}

function parseBatch(value: unknown): IntakeBatch {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'string' ||
    typeof value['clientBatchId'] !== 'string' ||
    !Array.isArray(value['items']) ||
    value['items'].length !== 1
  ) {
    throw new ExtensionError('BATCH_RESPONSE_INVALID');
  }
  return {
    id: value['id'],
    clientBatchId: value['clientBatchId'],
    items: value['items'].map(parseItem),
  };
}

function parseIntent(value: unknown, config: ExtensionConfig): UploadIntent {
  if (
    !isRecord(value) ||
    value['method'] !== 'POST' ||
    typeof value['url'] !== 'string' ||
    !isRecord(value['fields']) ||
    Object.values(value['fields']).some((field) => typeof field !== 'string')
  ) {
    throw new ExtensionError('INTENT_RESPONSE_INVALID');
  }
  const url = new URL(value['url']);
  if (!config.uploadOrigins.includes(url.origin) || url.protocol !== 'https:') {
    throw new ExtensionError('UPLOAD_ORIGIN_REJECTED');
  }
  return {
    method: 'POST',
    url: url.href,
    fields: value['fields'] as Record<string, string>,
  };
}

async function authorizedFetch(
  config: ExtensionConfig,
  path: string,
  deadlineAt: number,
  init: RequestInit = {},
): Promise<Response> {
  const auth = await validAuth(config, deadlineAt);
  try {
    return await fetch(apiUrl(config, path), {
      ...init,
      credentials: 'omit',
      redirect: 'error',
      signal: deadlineSignal(deadlineAt),
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
        Authorization: 'Bearer ' + auth.accessToken,
      },
    });
  } catch {
    throw new ExtensionError('API_NETWORK_FAILED');
  }
}

async function jsonResponse(response: Response, errorCode: string): Promise<unknown> {
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new ExtensionError('AUTH_EXPIRED');
    throw new IntakeResponseError(errorCode, response.status, responseRetryAfterMs(response));
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ExtensionError('API_RESPONSE_INVALID');
  }
  try {
    return await response.json();
  } catch {
    throw new ExtensionError('API_RESPONSE_INVALID');
  }
}

async function updateOperation(
  operation: PrintOperation,
  changes: Partial<PrintOperation>,
): Promise<PrintOperation> {
  const updated = { ...operation, ...changes, updatedAt: Date.now() };
  await writeOperation(updated);
  return updated;
}

async function findBatch(
  config: ExtensionConfig,
  clientBatchId: string,
  deadlineAt: number,
): Promise<IntakeBatch | null> {
  const response = await authorizedFetch(
    config,
    '/api/v1/accounting/incoming-invoices/browser-print/batches/?clientBatchId=' +
      encodeURIComponent(clientBatchId),
    deadlineAt,
  );
  const value = await jsonResponse(response, 'BATCH_LOOKUP_FAILED');
  if (!isRecord(value) || !Array.isArray(value['results'])) {
    throw new ExtensionError('BATCH_LOOKUP_INVALID');
  }
  if (value['results'].length === 0) return null;
  if (value['results'].length !== 1) throw new ExtensionError('BATCH_LOOKUP_AMBIGUOUS');
  return parseBatch(value['results'][0]);
}

async function getItem(
  config: ExtensionConfig,
  itemId: string,
  deadlineAt: number,
): Promise<IntakeItem> {
  const response = await authorizedFetch(
    config,
    '/api/v1/accounting/incoming-invoices/browser-print/items/' + itemId + '/',
    deadlineAt,
  );
  return parseItem(await jsonResponse(response, 'ITEM_LOOKUP_FAILED'));
}

async function acceptCompletedItem(item: IntakeItem, operation: PrintOperation): Promise<boolean> {
  if (!item.acceptedAt) return false;
  await updateOperation(operation, { stage: 'accepted' });
  await writeStatus('success', 'statusAccepted');
  return true;
}

async function createManifest(
  config: ExtensionConfig,
  operation: PrintOperation,
  filename: string,
  size: number,
  deadlineAt: number,
): Promise<IntakeBatch> {
  const body = JSON.stringify({
    clientBatchId: operation.clientBatchId,
    items: [
      {
        clientItemId: operation.clientItemId,
        name: filename,
        size,
        contentType: 'application/pdf',
      },
    ],
  });
  try {
    const response = await authorizedFetch(
      config,
      '/api/v1/accounting/incoming-invoices/browser-print/manifest/',
      deadlineAt,
      { method: 'POST', body },
    );
    return parseBatch(await jsonResponse(response, 'MANIFEST_REJECTED'));
  } catch (error) {
    if (!(error instanceof ExtensionError) || error.code !== 'API_NETWORK_FAILED') throw error;
    const existing = await findBatch(config, operation.clientBatchId, deadlineAt);
    if (existing) return existing;
    const response = await authorizedFetch(
      config,
      '/api/v1/accounting/incoming-invoices/browser-print/manifest/',
      deadlineAt,
      { method: 'POST', body },
    );
    return parseBatch(await jsonResponse(response, 'MANIFEST_REJECTED'));
  }
}

async function createIntent(
  config: ExtensionConfig,
  itemId: string,
  deadlineAt: number,
): Promise<UploadIntent> {
  const path = '/api/v1/accounting/incoming-invoices/browser-print/items/' + itemId + '/intent/';
  try {
    const response = await authorizedFetch(config, path, deadlineAt, {
      method: 'POST',
      body: '{}',
    });
    return parseIntent(await jsonResponse(response, 'INTENT_REJECTED'), config);
  } catch (error) {
    if (!(error instanceof ExtensionError) || error.code !== 'API_NETWORK_FAILED') throw error;
    const response = await authorizedFetch(config, path, deadlineAt, {
      method: 'POST',
      body: '{}',
    });
    return parseIntent(await jsonResponse(response, 'INTENT_REJECTED'), config);
  }
}

async function uploadBlob(
  intent: UploadIntent,
  blob: Blob,
  filename: string,
  deadlineAt: number,
): Promise<boolean> {
  const form = new FormData();
  for (const [key, value] of Object.entries(intent.fields)) form.append(key, value);
  form.append('file', blob, filename);
  try {
    const response = await fetch(intent.url, {
      method: 'POST',
      body: form,
      credentials: 'omit',
      redirect: 'error',
      signal: deadlineSignal(deadlineAt),
    });
    if (!response.ok) {
      if (
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500
      ) {
        return false;
      }
      throw new ExtensionError('UPLOAD_REJECTED');
    }
    return true;
  } catch (error) {
    if (error instanceof ExtensionError) throw error;
    return false;
  }
}

async function completeUpload(
  config: ExtensionConfig,
  itemId: string,
  clientItemId: string,
  deadlineAt: number,
): Promise<IntakeItem> {
  const path = '/api/v1/accounting/incoming-invoices/browser-print/items/' + itemId + '/complete/';
  const body = JSON.stringify({ clientItemId });
  try {
    const response = await authorizedFetch(config, path, deadlineAt, {
      method: 'POST',
      body,
    });
    const value = await jsonResponse(response, 'COMPLETION_REJECTED');
    if (!isRecord(value) || value['custody'] !== 'stored_isolated') {
      throw new ExtensionError('CUSTODY_NOT_CONFIRMED');
    }
    return parseItem(value);
  } catch (error) {
    if (!(error instanceof ExtensionError) || error.code !== 'API_NETWORK_FAILED') throw error;
    const item = await getItem(config, itemId, deadlineAt);
    if (item.acceptedAt) return item;
    const retry = await authorizedFetch(config, path, deadlineAt, {
      method: 'POST',
      body,
    });
    const value = await jsonResponse(retry, 'COMPLETION_REJECTED');
    if (!isRecord(value) || value['custody'] !== 'stored_isolated') {
      throw new ExtensionError('CUSTODY_NOT_CONFIRMED');
    }
    return parseItem(value);
  }
}

export async function transferPrintJob(
  config: ExtensionConfig,
  printJob: chrome.printerProvider.PrintJob,
): Promise<{ kind: 'accepted'; operationId: string }> {
  const now = Date.now();
  const deadlineAt = now + config.operationDeadlineMs;
  const auth = await verifyCurrentPrincipal(config, deadlineAt);
  const { blob, filename } = await assertPdfDocument(
    printJob,
    config.printerId,
    config.maxFileBytes,
  );
  let operation: PrintOperation = {
    protocolVersion: 1,
    operationId: crypto.randomUUID(),
    subject: auth.subject,
    clientBatchId: crypto.randomUUID(),
    clientItemId: crypto.randomUUID(),
    stage: 'manifest',
    createdAt: now,
    updatedAt: now,
  };
  await writeOperation(operation);
  await writeStatus('sending', 'statusSending');

  try {
    const batch = await createManifest(config, operation, filename, blob.size, deadlineAt);
    const item = batch.items[0]!;
    if (item.clientItemId !== operation.clientItemId) {
      throw new ExtensionError('MANIFEST_IDENTITY_MISMATCH');
    }
    operation = await updateOperation(operation, {
      serverBatchId: batch.id,
      serverItemId: item.id,
      stage: 'intent',
    });
    if (await acceptCompletedItem(item, operation)) {
      return { kind: 'accepted', operationId: operation.operationId };
    }

    const intent = await createIntent(config, item.id, deadlineAt);
    operation = await updateOperation(operation, { stage: 'upload' });
    const uploadResponseKnown = await uploadBlob(intent, blob, filename, deadlineAt);
    operation = await updateOperation(operation, { stage: 'completion' });
    const completed = await completeUpload(config, item.id, operation.clientItemId, deadlineAt);
    if (!(await acceptCompletedItem(completed, operation))) {
      throw new ExtensionError(
        uploadResponseKnown ? 'CUSTODY_NOT_CONFIRMED' : 'UPLOAD_OUTCOME_UNKNOWN',
      );
    }
    return { kind: 'accepted', operationId: operation.operationId };
  } catch (error) {
    const current = await readOperation();
    const ambiguous =
      error instanceof ExtensionError &&
      current !== null &&
      (error.code === 'API_NETWORK_FAILED' ||
        error.code === 'TOKEN_NETWORK_FAILED' ||
        error.code === 'AUTH_EXPIRED' ||
        error.code === 'CUSTODY_NOT_CONFIRMED' ||
        error.code === 'UPLOAD_OUTCOME_UNKNOWN' ||
        (current.stage === 'completion' && error.code !== 'UPLOAD_REJECTED'));
    if (ambiguous) {
      await writeStatus('checking', 'statusChecking');
      throw new ExtensionError('TRANSFER_OUTCOME_UNKNOWN');
    }
    await clearOperation();
    throw error;
  }
}

function isRetryableRecoveryError(error: unknown): boolean {
  if (
    error instanceof IntakeResponseError &&
    (error.status === 425 || error.status === 429 || error.status >= 500)
  ) {
    return true;
  }
  return (
    error instanceof ExtensionError &&
    ['API_NETWORK_FAILED', 'TOKEN_NETWORK_FAILED', 'PRINCIPAL_NETWORK_FAILED'].includes(error.code)
  );
}

function retryDelay(error: unknown, attempt: number): number {
  const baseDelay = RECONCILE_RETRY_DELAYS_MS[attempt] ?? 0;
  return error instanceof IntakeResponseError ? Math.max(baseDelay, error.retryAfterMs) : baseDelay;
}

function requiresUserRecovery(error: unknown): boolean {
  return (
    error instanceof ExtensionError &&
    ['NOT_CONNECTED', 'AUTH_EXPIRED', 'TOKEN_REJECTED', 'PRINCIPAL_REJECTED'].includes(error.code)
  );
}

async function delay(milliseconds: number, deadlineAt: number): Promise<void> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new ExtensionError('API_NETWORK_FAILED');
  await new Promise((resolve) => setTimeout(resolve, Math.min(milliseconds, remaining)));
}

async function reconcileOnce(
  config: ExtensionConfig,
  operation: PrintOperation,
  deadlineAt: number,
): Promise<{ kind: 'not-sent' } | { kind: 'accepted'; operationId: string }> {
  let current = operation;
  let item: IntakeItem | null;
  if (current.serverItemId) {
    item = await getItem(config, current.serverItemId, deadlineAt);
  } else {
    const batch = await findBatch(config, current.clientBatchId, deadlineAt);
    if (!batch) return { kind: 'not-sent' };
    item = batch.items[0] ?? null;
    if (!item || item.clientItemId !== current.clientItemId) {
      throw new ExtensionError('MANIFEST_IDENTITY_MISMATCH');
    }
    current = await updateOperation(current, {
      serverBatchId: batch.id,
      serverItemId: item.id,
    });
  }
  if (item.clientItemId !== current.clientItemId) {
    throw new ExtensionError('MANIFEST_IDENTITY_MISMATCH');
  }
  if (await acceptCompletedItem(item, current)) {
    return { kind: 'accepted', operationId: current.operationId };
  }
  if (!['upload', 'completion', 'checking'].includes(current.stage)) {
    return { kind: 'not-sent' };
  }
  const completed = await completeUpload(config, item.id, current.clientItemId, deadlineAt);
  if (await acceptCompletedItem(completed, current)) {
    return { kind: 'accepted', operationId: current.operationId };
  }
  throw new ExtensionError('CUSTODY_NOT_CONFIRMED');
}

export async function reconcileStoredOperation(
  config: ExtensionConfig,
): Promise<{ kind: 'none' | 'pending' | 'not-sent' } | { kind: 'accepted'; operationId: string }> {
  const operation = await readOperation();
  if (!operation) return { kind: 'none' };
  await writeStatus('checking', 'statusChecking');
  const deadlineAt = Date.now() + Math.min(config.operationDeadlineMs, 30_000);
  for (let attempt = 0; attempt < RECONCILE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const current = (await readOperation()) ?? operation;
      const auth = await verifyCurrentPrincipal(config, deadlineAt);
      if (auth.subject !== current.subject) {
        await clearOperation();
        await writeStatus('error', 'statusNotSent');
        return { kind: 'not-sent' };
      }
      if (current.stage === 'accepted') {
        await writeStatus('success', 'statusAccepted');
        return { kind: 'accepted', operationId: current.operationId };
      }
      const outcome = await reconcileOnce(config, current, deadlineAt);
      if (outcome.kind === 'accepted') return outcome;
      await clearOperation();
      await writeStatus('error', 'statusNotSent');
      return outcome;
    } catch (error) {
      const retryable = isRetryableRecoveryError(error);
      const nextAttempt = attempt + 1;
      const wait = retryDelay(error, nextAttempt);
      if (
        retryable &&
        nextAttempt < RECONCILE_RETRY_DELAYS_MS.length &&
        Date.now() + wait < deadlineAt
      ) {
        await delay(wait, deadlineAt);
        continue;
      }
      if (retryable || requiresUserRecovery(error)) {
        await writeStatus('checking', 'statusChecking');
        return { kind: 'pending' };
      }
      await clearOperation();
      await writeStatus('error', 'statusNotSent');
      return { kind: 'not-sent' };
    }
  }
  await writeStatus('checking', 'statusChecking');
  return { kind: 'pending' };
}
