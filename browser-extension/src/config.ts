export interface ExtensionConfig {
  profile: 'qa' | 'store-id-qa' | 'production';
  profileVersion: 1;
  protocolVersion: 1;
  extensionVersion: string;
  extensionId: string;
  minimumChromeVersion: string;
  printerId: 'fin3000-incoming-invoice';
  oauthClientId: string;
  apiOrigin: string;
  frontendOrigin: string;
  uploadOrigins: string[];
  maxFileBytes: number;
  operationDeadlineMs: number;
  operationTtlMs: number;
}

let configPromise: Promise<ExtensionConfig> | undefined;

function exactOrigin(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(label + '_INVALID');
  const parsed = new URL(value);
  if (parsed.origin !== value || parsed.username || parsed.password) {
    throw new Error(label + '_INVALID');
  }
  return parsed.origin;
}

export function validateConfig(raw: unknown): ExtensionConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('CONFIG_INVALID');
  }
  const value = raw as Record<string, unknown>;
  const expectedKeys = [
    'apiOrigin',
    'extensionId',
    'extensionVersion',
    'frontendOrigin',
    'maxFileBytes',
    'minimumChromeVersion',
    'oauthClientId',
    'operationDeadlineMs',
    'operationTtlMs',
    'printerId',
    'profile',
    'profileVersion',
    'protocolVersion',
    'uploadOrigins',
  ];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error('CONFIG_KEYS_INVALID');
  }
  if (
    !['qa', 'store-id-qa', 'production'].includes(String(value['profile'])) ||
    value['profileVersion'] !== 1 ||
    value['protocolVersion'] !== 1 ||
    value['printerId'] !== 'fin3000-incoming-invoice' ||
    !/^[a-p]{32}$/.test(String(value['extensionId'])) ||
    !/^\d+\.\d+\.\d+$/.test(String(value['extensionVersion'])) ||
    !/^\d+$/.test(String(value['minimumChromeVersion'])) ||
    typeof value['oauthClientId'] !== 'string' ||
    !value['oauthClientId'] ||
    value['maxFileBytes'] !== 20 * 1024 * 1024 ||
    typeof value['operationDeadlineMs'] !== 'number' ||
    value['operationDeadlineMs'] < 30_000 ||
    value['operationDeadlineMs'] > 300_000 ||
    typeof value['operationTtlMs'] !== 'number' ||
    value['operationTtlMs'] < 300_000 ||
    value['operationTtlMs'] > 86_400_000 ||
    !Array.isArray(value['uploadOrigins']) ||
    value['uploadOrigins'].length === 0
  ) {
    throw new Error('CONFIG_INVARIANT_FAILED');
  }

  const extensionId = String(value['extensionId']);
  if (chrome.runtime.id !== extensionId) throw new Error('EXTENSION_ID_MISMATCH');
  const redirectUrl = chrome.identity.getRedirectURL();
  if (redirectUrl !== 'https://' + extensionId + '.chromiumapp.org/') {
    throw new Error('OAUTH_REDIRECT_MISMATCH');
  }

  const profile = value['profile'] as ExtensionConfig['profile'];
  const apiOrigin = exactOrigin(value['apiOrigin'], 'API_ORIGIN');
  const frontendOrigin = exactOrigin(value['frontendOrigin'], 'FRONTEND_ORIGIN');
  const uploadOrigins = value['uploadOrigins'].map((origin) =>
    exactOrigin(origin, 'UPLOAD_ORIGIN'),
  );
  if (new Set(uploadOrigins).size !== uploadOrigins.length) {
    throw new Error('UPLOAD_ORIGIN_DUPLICATE');
  }
  if (
    profile === 'production' &&
    [apiOrigin, frontendOrigin, ...uploadOrigins].some((origin) => !origin.startsWith('https://'))
  ) {
    throw new Error('PRODUCTION_HTTPS_REQUIRED');
  }

  return {
    profile,
    profileVersion: 1,
    protocolVersion: 1,
    extensionVersion: String(value['extensionVersion']),
    extensionId,
    minimumChromeVersion: String(value['minimumChromeVersion']),
    printerId: 'fin3000-incoming-invoice',
    oauthClientId: value['oauthClientId'],
    apiOrigin,
    frontendOrigin,
    uploadOrigins,
    maxFileBytes: value['maxFileBytes'],
    operationDeadlineMs: value['operationDeadlineMs'],
    operationTtlMs: value['operationTtlMs'],
  };
}

export function loadConfig(): Promise<ExtensionConfig> {
  configPromise ??= fetch(chrome.runtime.getURL('config.json'), {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  })
    .then((response) => {
      if (!response.ok) throw new Error('CONFIG_LOAD_FAILED');
      return response.json() as Promise<unknown>;
    })
    .then(validateConfig);
  return configPromise;
}

export function apiUrl(config: ExtensionConfig, path: string): string {
  if (!path.startsWith('/')) throw new Error('API_PATH_INVALID');
  const url = new URL(path, config.apiOrigin);
  if (url.origin !== config.apiOrigin) throw new Error('API_ORIGIN_MISMATCH');
  return url.href;
}
