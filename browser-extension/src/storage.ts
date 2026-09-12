export interface AuthState {
  protocolVersion: 1;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subject: string;
  accountName: string;
}

export type OperationStage =
  | 'manifest'
  | 'intent'
  | 'upload'
  | 'completion'
  | 'checking'
  | 'accepted';

export interface PrintOperation {
  protocolVersion: 1;
  operationId: string;
  subject: string;
  clientBatchId: string;
  clientItemId: string;
  serverBatchId?: string;
  serverItemId?: string;
  stage: OperationStage;
  createdAt: number;
  updatedAt: number;
}

export interface RefreshMarker {
  protocolVersion: 1;
  subject: string;
  startedAt: number;
}

export type UiStatusKind = 'ready' | 'sending' | 'success' | 'checking' | 'error';

export interface UiStatus {
  kind: UiStatusKind;
  messageKey: string;
  updatedAt: number;
}

const AUTH_KEY = 'authState';
const OPERATION_KEY = 'printOperation';
const STATUS_KEY = 'uiStatus';
const REFRESH_KEY = 'refreshPending';
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

export class StorageSchemaError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validAuthState(value: unknown): value is AuthState {
  return (
    record(value) &&
    value['protocolVersion'] === 1 &&
    typeof value['accessToken'] === 'string' &&
    typeof value['refreshToken'] === 'string' &&
    typeof value['expiresAt'] === 'number' &&
    typeof value['subject'] === 'string' &&
    value['subject'].startsWith('bp_') &&
    typeof value['accountName'] === 'string' &&
    Boolean(value['accountName'].trim())
  );
}

function validOperation(value: unknown): value is PrintOperation {
  const stages: OperationStage[] = [
    'manifest',
    'intent',
    'upload',
    'completion',
    'checking',
    'accepted',
  ];
  return (
    record(value) &&
    value['protocolVersion'] === 1 &&
    typeof value['operationId'] === 'string' &&
    typeof value['subject'] === 'string' &&
    value['subject'].startsWith('bp_') &&
    typeof value['clientBatchId'] === 'string' &&
    typeof value['clientItemId'] === 'string' &&
    stages.includes(value['stage'] as OperationStage) &&
    typeof value['createdAt'] === 'number' &&
    typeof value['updatedAt'] === 'number' &&
    (value['serverBatchId'] === undefined || typeof value['serverBatchId'] === 'string') &&
    (value['serverItemId'] === undefined || typeof value['serverItemId'] === 'string')
  );
}

export async function initializeStorage(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

export async function readAuth(): Promise<AuthState | null> {
  const result = await chrome.storage.local.get(AUTH_KEY);
  const value: unknown = result[AUTH_KEY];
  if (value === undefined) return null;
  if (!validAuthState(value)) {
    await clearAuth();
    return null;
  }
  return value;
}

export async function writeAuth(value: AuthState): Promise<void> {
  await chrome.storage.local.set({ [AUTH_KEY]: value });
}

export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove(AUTH_KEY);
}

export async function readRefreshMarker(): Promise<RefreshMarker | null> {
  const result = await chrome.storage.local.get(REFRESH_KEY);
  const value: unknown = result[REFRESH_KEY];
  if (value === undefined) return null;
  if (
    !record(value) ||
    value['protocolVersion'] !== 1 ||
    typeof value['subject'] !== 'string' ||
    typeof value['startedAt'] !== 'number'
  ) {
    return { protocolVersion: 1, subject: 'invalid', startedAt: 0 };
  }
  return value as unknown as RefreshMarker;
}

export async function writeRefreshMarker(value: RefreshMarker): Promise<void> {
  await chrome.storage.local.set({ [REFRESH_KEY]: value });
}

export async function clearRefreshMarker(): Promise<void> {
  await chrome.storage.local.remove(REFRESH_KEY);
}

export async function readOperation(): Promise<PrintOperation | null> {
  const result = await chrome.storage.local.get(OPERATION_KEY);
  const value: unknown = result[OPERATION_KEY];
  if (value === undefined) return null;
  if (!validOperation(value)) throw new StorageSchemaError('OPERATION_SCHEMA_UNSUPPORTED');
  return value;
}

export async function writeOperation(value: PrintOperation): Promise<void> {
  await chrome.storage.local.set({ [OPERATION_KEY]: value });
}

export async function clearOperation(): Promise<void> {
  await chrome.storage.local.remove(OPERATION_KEY);
}

export async function clearStatus(): Promise<void> {
  await chrome.storage.local.remove(STATUS_KEY);
}

export async function writeStatus(kind: UiStatusKind, messageKey: string): Promise<void> {
  await chrome.storage.local.set({
    [STATUS_KEY]: { kind, messageKey, updatedAt: Date.now() } satisfies UiStatus,
  });
}

export async function readStatus(): Promise<UiStatus> {
  const result = await chrome.storage.local.get(STATUS_KEY);
  const value: unknown = result[STATUS_KEY];
  const status =
    record(value) &&
    ['ready', 'sending', 'success', 'checking', 'error'].includes(String(value['kind'])) &&
    typeof value['messageKey'] === 'string' &&
    typeof value['updatedAt'] === 'number'
      ? (value as unknown as UiStatus)
      : undefined;
  if (status && Date.now() - status.updatedAt <= STATUS_TTL_MS) return status;
  if (value !== undefined) await clearStatus();
  return {
    kind: 'ready',
    messageKey: 'statusReady',
    updatedAt: Date.now(),
  };
}

export async function expireOperation(ttlMs: number): Promise<void> {
  const operation = await readOperation();
  if (operation && Date.now() - operation.updatedAt > ttlMs) {
    await Promise.all([clearOperation(), clearStatus()]);
  }
}
