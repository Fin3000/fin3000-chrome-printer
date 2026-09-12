import { apiUrl, ExtensionConfig } from './config.js';
import { deadlineSignal, ExtensionError, isRecord } from './core.js';
import {
  AuthState,
  clearAuth,
  clearOperation,
  clearRefreshMarker,
  readAuth,
  readRefreshMarker,
  writeAuth,
  writeRefreshMarker,
  writeStatus,
} from './storage.js';

let refreshPromise: Promise<AuthState> | undefined;

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function randomUrlToken(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  tokenType: string;
}

function parseTokenResponse(value: unknown, fallbackRefreshToken = ''): TokenResponse {
  if (!isRecord(value)) throw new ExtensionError('TOKEN_RESPONSE_INVALID');
  const accessToken = value['access_token'];
  const refreshToken = value['refresh_token'] ?? fallbackRefreshToken;
  const expiresIn = value['expires_in'];
  const scope = value['scope'];
  const tokenType = value['token_type'];
  if (
    typeof accessToken !== 'string' ||
    accessToken.length < 16 ||
    typeof refreshToken !== 'string' ||
    refreshToken.length < 16 ||
    typeof expiresIn !== 'number' ||
    expiresIn < 60 ||
    scope !== 'intake:write' ||
    String(tokenType).toLowerCase() !== 'bearer'
  ) {
    throw new ExtensionError('TOKEN_RESPONSE_INVALID');
  }
  return { accessToken, refreshToken, expiresIn, scope, tokenType: String(tokenType) };
}

async function tokenRequest(
  config: ExtensionConfig,
  body: URLSearchParams,
  deadlineAt: number,
  fallbackRefreshToken = '',
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(apiUrl(config, '/o/token/'), {
      method: 'POST',
      body,
      credentials: 'omit',
      redirect: 'error',
      signal: deadlineSignal(deadlineAt),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch {
    throw new ExtensionError('TOKEN_NETWORK_FAILED');
  }
  if (!response.ok) throw new ExtensionError('TOKEN_REJECTED');
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ExtensionError('TOKEN_RESPONSE_INVALID');
  }
  return parseTokenResponse(await response.json(), fallbackRefreshToken);
}

async function loadPrincipal(
  config: ExtensionConfig,
  accessToken: string,
  deadlineAt: number,
): Promise<{ subject: string; accountName: string }> {
  let response: Response;
  try {
    response = await fetch(
      apiUrl(config, '/api/v1/accounting/incoming-invoices/browser-print/principal/'),
      {
        credentials: 'omit',
        redirect: 'error',
        signal: deadlineSignal(deadlineAt),
        headers: { Authorization: 'Bearer ' + accessToken },
      },
    );
  } catch {
    throw new ExtensionError('PRINCIPAL_NETWORK_FAILED');
  }
  if (!response.ok) throw new ExtensionError('PRINCIPAL_REJECTED');
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ExtensionError('PRINCIPAL_RESPONSE_INVALID');
  }
  const value: unknown = await response.json();
  if (
    !isRecord(value) ||
    typeof value['subject'] !== 'string' ||
    !value['subject'].startsWith('bp_') ||
    typeof value['accountName'] !== 'string' ||
    !value['accountName'].trim() ||
    value['protocolVersion'] !== 1
  ) {
    throw new ExtensionError('PRINCIPAL_RESPONSE_INVALID');
  }
  return {
    subject: value['subject'],
    accountName: value['accountName'].trim(),
  };
}

export async function verifyCurrentPrincipal(
  config: ExtensionConfig,
  deadlineAt = Date.now() + Math.min(config.operationDeadlineMs, 30_000),
): Promise<AuthState> {
  const auth = await validAuth(config, deadlineAt);
  const principal = await loadPrincipal(config, auth.accessToken, deadlineAt);
  if (principal.subject !== auth.subject) {
    await Promise.all([clearAuth(), clearOperation()]);
    throw new ExtensionError('ACCOUNT_CHANGED');
  }
  if (principal.accountName !== auth.accountName) {
    const updated = { ...auth, accountName: principal.accountName };
    await writeAuth(updated);
    return updated;
  }
  return auth;
}

export async function connectAccount(config: ExtensionConfig): Promise<AuthState> {
  const verifier = randomUrlToken(48);
  const state = randomUrlToken();
  const challenge = await pkceChallenge(verifier);
  const redirectUri = chrome.identity.getRedirectURL();
  const authorizeUrl = new URL('/oauth/authorize', config.frontendOrigin);
  authorizeUrl.search = new URLSearchParams({
    client_id: config.oauthClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'intake:write',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  let resultUrl: string | undefined;
  try {
    resultUrl = await chrome.identity.launchWebAuthFlow({
      url: authorizeUrl.href,
      interactive: true,
    });
  } catch {
    throw new ExtensionError('OAUTH_CANCELLED');
  }
  if (!resultUrl) throw new ExtensionError('OAUTH_CANCELLED');
  const deadlineAt = Date.now() + Math.min(config.operationDeadlineMs, 30_000);
  let result: URL;
  try {
    result = new URL(resultUrl);
  } catch {
    throw new ExtensionError('OAUTH_REDIRECT_INVALID');
  }
  const expected = new URL(redirectUri);
  if (result.origin !== expected.origin || result.pathname !== expected.pathname) {
    throw new ExtensionError('OAUTH_REDIRECT_INVALID');
  }
  if (result.searchParams.get('iss') !== config.apiOrigin) {
    throw new ExtensionError('OAUTH_ISSUER_INVALID');
  }
  if (result.searchParams.get('state') !== state) {
    throw new ExtensionError('OAUTH_STATE_INVALID');
  }
  if (result.searchParams.has('error')) throw new ExtensionError('OAUTH_DENIED');
  const code = result.searchParams.get('code');
  if (!code) throw new ExtensionError('OAUTH_CODE_MISSING');

  const token = await tokenRequest(
    config,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.oauthClientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
    deadlineAt,
  );
  const principal = await loadPrincipal(config, token.accessToken, deadlineAt);
  const previous = await readAuth();
  if (previous && previous.subject !== principal.subject) await clearOperation();
  const auth: AuthState = {
    protocolVersion: 1,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Date.now() + token.expiresIn * 1000,
    subject: principal.subject,
    accountName: principal.accountName,
  };
  await writeAuth(auth);
  await clearRefreshMarker();
  await writeStatus('ready', 'statusReady');
  return auth;
}

async function refreshAccount(
  config: ExtensionConfig,
  current: AuthState,
  deadlineAt: number,
): Promise<AuthState> {
  await writeRefreshMarker({
    protocolVersion: 1,
    subject: current.subject,
    startedAt: Date.now(),
  });
  try {
    const token = await tokenRequest(
      config,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
        client_id: config.oauthClientId,
      }),
      deadlineAt,
      current.refreshToken,
    );
    const principal = await loadPrincipal(config, token.accessToken, deadlineAt);
    if (principal.subject !== current.subject) {
      await clearOperation();
      throw new ExtensionError('ACCOUNT_CHANGED');
    }
    const auth: AuthState = {
      ...current,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: Date.now() + token.expiresIn * 1000,
      accountName: principal.accountName,
    };
    await writeAuth(auth);
    await clearRefreshMarker();
    return auth;
  } catch (error) {
    await Promise.all([clearAuth(), clearRefreshMarker()]);
    throw error;
  }
}

export async function validAuth(
  config: ExtensionConfig,
  deadlineAt = Date.now() + Math.min(config.operationDeadlineMs, 30_000),
): Promise<AuthState> {
  if (!refreshPromise && (await readRefreshMarker())) {
    await Promise.all([clearAuth(), clearRefreshMarker()]);
    throw new ExtensionError('NOT_CONNECTED');
  }
  const current = await readAuth();
  if (!current) throw new ExtensionError('NOT_CONNECTED');
  if (current.expiresAt > Date.now() + 60_000) return current;
  refreshPromise ??= refreshAccount(config, current, deadlineAt).finally(() => {
    refreshPromise = undefined;
  });
  try {
    return await refreshPromise;
  } catch (error) {
    await clearAuth();
    throw error;
  }
}

export async function disconnectAccount(config: ExtensionConfig): Promise<void> {
  const current = await readAuth();
  const deadlineAt = Date.now() + 5_000;
  try {
    if (current) {
      await fetch(apiUrl(config, '/o/revoke_token/'), {
        method: 'POST',
        body: new URLSearchParams({
          token: current.refreshToken,
          client_id: config.oauthClientId,
        }),
        credentials: 'omit',
        redirect: 'error',
        signal: deadlineSignal(deadlineAt),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    }
  } catch {
    // Local disconnect is authoritative even when best-effort revocation is offline.
  } finally {
    await Promise.all([clearAuth(), clearOperation(), clearRefreshMarker()]);
    await writeStatus('ready', 'statusConnectFirst');
  }
}
