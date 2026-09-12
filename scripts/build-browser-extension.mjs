import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { frontendRoot } from './browser-extension-cli.mjs';
import {
  canonicalJson,
  failProduct,
  loadProductProfile,
  ProductCliError,
  productLocales,
  runtimeConfig,
  sha256,
} from './browser-extension-product-cli.mjs';
import { inspectExtension } from './inspect-browser-extension.mjs';

const notForStoreNotice =
  'NOT FOR CHROME WEB STORE UPLOAD\n' +
  'This build uses the reserved production extension identity with isolated QA endpoints.\n';

function profileArgument() {
  const index = process.argv.indexOf('--profile');
  return index >= 0 ? process.argv[index + 1] : '';
}

async function filesRecursively(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      result.push(...(await filesRecursively(path.join(directory, entry.name), relative)));
    else result.push(relative);
  }
  return result.sort();
}

function renderManifest(template, profile) {
  const hosts = [profile.apiOrigin, ...profile.uploadOrigins].map((origin) => `${origin}/*`).sort();
  return `${template
    .replace('__EXTENSION_VERSION__', profile.extensionVersion)
    .replace('__MINIMUM_CHROME_VERSION__', profile.minimumChromeVersion)
    .replace('__PUBLIC_KEY__', profile.publicKey)
    .replace('__HOST_PERMISSIONS__', JSON.stringify(hosts))}\n`;
}

async function normalizedZip(unpacked, zipPath) {
  const files = await filesRecursively(unpacked);
  const epoch = new Date('1980-01-01T00:00:00.000Z');
  for (const relative of files) {
    const absolute = path.join(unpacked, relative);
    await chmod(absolute, 0o644);
    await utimes(absolute, epoch, epoch);
  }
  await rm(zipPath, { force: true });
  const result = spawnSync('zip', ['-X', '-q', zipPath, ...files], {
    cwd: unpacked,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || 'zip failed');
}

export async function buildProduct(profileName, outputRootOverride = '') {
  const { profile, redirectUri } = await loadProductProfile(profileName);
  const outputRoot =
    outputRootOverride || path.join(frontendRoot, 'dist', 'browser-extension', profileName);
  const unpacked = path.join(outputRoot, 'unpacked');
  const compile = path.join(outputRoot, '.compiled');
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(unpacked, { recursive: true });

  const tsc = spawnSync(
    process.execPath,
    [
      path.join(frontendRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      path.join(frontendRoot, 'browser-extension', 'tsconfig.json'),
      '--outDir',
      compile,
      '--sourceMap',
      'false',
    ],
    { cwd: frontendRoot, encoding: 'utf8' },
  );
  if (tsc.status !== 0) throw new Error(tsc.stdout || tsc.stderr || 'TypeScript failed');

  const template = await readFile(
    path.join(frontendRoot, 'browser-extension', 'manifest.product.template.json'),
    'utf8',
  );
  const jsFiles = [
    'background.js',
    'config.js',
    'core.js',
    'intake.js',
    'oauth.js',
    'popup.js',
    'storage.js',
  ];
  await Promise.all([
    ...jsFiles.map((file) => copyFile(path.join(compile, file), path.join(unpacked, file))),
    copyFile(
      path.join(frontendRoot, 'browser-extension', 'popup.html'),
      path.join(unpacked, 'popup.html'),
    ),
    copyFile(
      path.join(frontendRoot, 'browser-extension', 'popup.css'),
      path.join(unpacked, 'popup.css'),
    ),
    copyFile(
      path.join(frontendRoot, 'public', 'images', 'icon-192.png'),
      path.join(unpacked, 'icon.png'),
    ),
    writeFile(path.join(unpacked, 'manifest.json'), renderManifest(template, profile), 'utf8'),
    writeFile(
      path.join(unpacked, 'config.json'),
      `${canonicalJson(runtimeConfig(profile))}\n`,
      'utf8',
    ),
  ]);
  for (const locale of productLocales) {
    const target = path.join(unpacked, '_locales', locale);
    await mkdir(target, { recursive: true });
    await copyFile(
      path.join(frontendRoot, 'browser-extension', '_locales', locale, 'messages.json'),
      path.join(target, 'messages.json'),
    );
  }
  if (profileName !== 'production') {
    await copyFile(
      path.join(frontendRoot, 'browser-extension', 'fixtures', 'hello-world.pdf'),
      path.join(unpacked, 'hello-world.pdf'),
    );
  }
  if (profileName === 'store-id-qa') {
    await writeFile(path.join(unpacked, 'NOT_FOR_STORE.txt'), notForStoreNotice, 'utf8');
  }
  await rm(compile, { recursive: true, force: true });
  const inspection = await inspectExtension(unpacked, profileName);
  const zipPath = path.join(outputRoot, `fin3000-chrome-print-${profileName}.zip`);
  await normalizedZip(unpacked, zipPath);
  const files = await filesRecursively(unpacked);
  const digests = [];
  for (const file of files) {
    const contents = await readFile(path.join(unpacked, file));
    digests.push(`${file}:${sha256(contents)}`);
  }
  const artifactHash = createHash('sha256').update(digests.join('\n')).digest('hex');
  const zipHash = sha256(await readFile(zipPath));
  return {
    profile: profileName,
    extensionId: profile.extensionId,
    oauthRedirect: redirectUri,
    apiOrigin: profile.apiOrigin,
    artifactHash,
    zipHash,
    loadUnpackedPath: unpacked,
    zipPath,
    inspection,
    notForStore: profileName === 'store-id-qa',
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  buildProduct(profileArgument())
    .then((result) => {
      process.stdout.write(
        [
          `Profil: ${result.profile}`,
          `Extension-ID: ${result.extensionId}`,
          `OAuth-Redirect: ${result.oauthRedirect}`,
          `API-Origin: ${result.apiOrigin}`,
          `Artefakt-SHA-256: ${result.artifactHash}`,
          `ZIP-SHA-256: ${result.zipHash}`,
          `Load unpacked: ${result.loadUnpackedPath}`,
          ...(result.notForStore ? ['Distribution: NOT_FOR_STORE'] : []),
          'Status: READY',
        ].join('\n') + '\n',
      );
    })
    .catch(failProduct);
}
