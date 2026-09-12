import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  emitRecord,
  fail,
  frontendRoot,
  currentCommit,
  loadProfile,
  parseCliArgs,
  requireFile,
} from './browser-extension-cli.mjs';

const command = 'extension:doctor';

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
      const output = execFileSync(candidate, ['--version'], { encoding: 'utf8' }).trim();
      const match = output.match(/(\d+)\./);
      if (match) {
        return { executable: candidate, major: Number(match[1]), version: output };
      }
    } catch {
      // Try the next known Chromium executable.
    }
  }
  throw new Error('Chromium was not found');
}

try {
  const args = parseCliArgs(process.argv.slice(2));
  const { extensionId, profile, profilePath } = await loadProfile(args.profile);
  const requiredFiles = [
    'browser-extension/manifest.template.json',
    'browser-extension/probe/background.js',
    'browser-extension/probe/core.js',
    'browser-extension/probe/probe-report.css',
    'browser-extension/probe/probe-report.html',
    'browser-extension/probe/probe-report.js',
    'browser-extension/fixtures/hello-world.pdf',
  ];
  await Promise.all(requiredFiles.map((relativePath) => requireFile(path.join(frontendRoot, relativePath))));

  const manifest = JSON.parse(
    (await readFile(path.join(frontendRoot, 'browser-extension/manifest.template.json'), 'utf8'))
      .replace('__MINIMUM_CHROME_VERSION__', profile.minimumChromeVersion)
      .replace('__PUBLIC_KEY__', profile.publicKey),
  );
  if (JSON.stringify(manifest.permissions) !== JSON.stringify(['printerProvider', 'storage'])) {
    throw new Error('G1 manifest permissions drifted');
  }
  if ('host_permissions' in manifest || 'content_scripts' in manifest) {
    throw new Error('G1 must not have portal access');
  }

  const nodeVersion = process.versions.node;
  if (nodeVersion !== '22.22.3') {
    throw new Error(`Node 22.22.3 is required, found ${nodeVersion}`);
  }
  const chromium = chromiumVersion();
  if (chromium.major < Number(profile.minimumChromeVersion)) {
    throw new Error(`Chrome ${profile.minimumChromeVersion}+ is required`);
  }
  emitRecord({
    command,
    commit: currentCommit(),
    extensionId,
    helpCode: null,
    permissions: manifest.permissions,
    profile: profile.profile,
    profilePath,
    profileVersion: profile.profileVersion,
    runtime: { chromium: chromium.version, node: nodeVersion },
    status: 'PASS',
  });
} catch (error) {
  fail(command, process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : '', error, 3);
}
