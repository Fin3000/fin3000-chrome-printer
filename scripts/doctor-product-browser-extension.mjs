import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

import { frontendRoot } from './browser-extension-cli.mjs';
import {
  failProduct,
  loadProductProfile,
  ProductCliError,
  productLocales,
} from './browser-extension-product-cli.mjs';

function chromiumVersion() {
  const candidates = [
    process.env.FIN3000_CHROMIUM,
    '/snap/chromium/current/usr/lib/chromium-browser/chrome',
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const value = execFileSync(candidate, ['--version'], { encoding: 'utf8' }).trim();
      const major = Number(value.match(/(\d+)\./)?.[1]);
      if (major) return { executable: candidate, major, value };
    } catch {
      // Continue with the next known Chrome/Chromium executable.
    }
  }
  throw new ProductCliError(
    'CHROME_NOT_FOUND',
    'Chrome oder Chromium wurde nicht gefunden.',
    'Kein bekanntes Browser-Binary ist ausführbar.',
    'FIN3000_CHROMIUM auf das Chrome-Binary setzen',
  );
}

async function apiProbe(origin) {
  try {
    const response = await fetch(new URL('/.well-known/oauth-authorization-server', origin), {
      redirect: 'error',
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return `HTTP ${response.status}`;
    const value = await response.json();
    return value.token_endpoint && value.authorization_endpoint
      ? 'OAuth metadata ready'
      : 'metadata incomplete';
  } catch {
    return 'offline (optional)';
  }
}

try {
  const { profile, redirectUri } = await loadProductProfile('qa');
  const required = [
    'browser-extension/manifest.product.template.json',
    'browser-extension/popup.html',
    'browser-extension/popup.css',
    'browser-extension/src/background.ts',
    'browser-extension/src/intake.ts',
    'browser-extension/src/oauth.ts',
    'browser-extension/fixtures/hello-world.pdf',
    ...productLocales.map((locale) => `browser-extension/_locales/${locale}/messages.json`),
  ];
  await Promise.all(required.map((file) => access(path.join(frontendRoot, file))));
  if (process.versions.node !== '22.22.3') {
    throw new ProductCliError(
      'NODE_VERSION_UNSUPPORTED',
      'Für den reproduzierbaren Build ist Node 22.22.3 erforderlich.',
      `Gefunden: ${process.versions.node}`,
      'Node 22.22.3 aktivieren',
    );
  }
  const chromium = chromiumVersion();
  if (chromium.major < Number(profile.minimumChromeVersion)) {
    throw new ProductCliError(
      'CHROME_VERSION_UNSUPPORTED',
      `Chrome ${profile.minimumChromeVersion} oder neuer ist erforderlich.`,
      chromium.value,
      'Chrome aktualisieren',
    );
  }
  const api = await apiProbe(profile.apiOrigin);
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      profile: profile.profile,
      extensionId: profile.extensionId,
      oauthRedirect: redirectUri,
      apiOrigin: profile.apiOrigin,
      api,
      localeCount: productLocales.length,
      chromium: chromium.value,
      node: process.versions.node,
    })}\n`,
  );
} catch (error) {
  failProduct(error);
}
