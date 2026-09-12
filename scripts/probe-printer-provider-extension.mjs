import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  emitRecord,
  fail,
  frontendRoot,
  currentCommit,
  loadProfile,
  parseCliArgs,
  sha256File,
} from './browser-extension-cli.mjs';

const command = 'extension:g1';
const allowedBuildFiles = new Set([
  'background.js',
  'core.js',
  'hello-world.pdf',
  'icon.svg',
  'manifest.json',
  'probe-report.css',
  'probe-report.html',
  'probe-report.js',
]);

function renderManifest(template, profile) {
  return `${template
    .replace('__MINIMUM_CHROME_VERSION__', profile.minimumChromeVersion)
    .replace('__PUBLIC_KEY__', profile.publicKey)}\n`;
}

function renderProfileTemplate(template, profile) {
  if (!template.includes('__PROFILE_CONFIG__')) {
    throw new Error('profile template marker is missing');
  }
  return `${template.replace('__PROFILE_CONFIG__', JSON.stringify(profile))}\n`;
}

async function assertExpectedBuildFiles(outputDirectory) {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const expected = [...allowedBuildFiles].sort();
  if (entries.some((entry) => !entry.isFile()) || JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`unexpected probe output: ${names.join(', ')}`);
  }
}

function launchChromium(outputDirectory, reportUrl) {
  const executable =
    process.env.FIN3000_CHROMIUM ||
    (process.platform === 'linux'
      ? '/snap/chromium/current/usr/lib/chromium-browser/chrome'
      : 'chromium');
  const profileDirectory =
    process.env.FIN3000_PROBE_PROFILE_DIR ||
    path.join(os.homedir(), '.gstack', 'fin3000-printer-provider-g1-profile');
  const args = [
    `--user-data-dir=${profileDirectory}`,
    `--disable-extensions-except=${outputDirectory}`,
    `--load-extension=${outputDirectory}`,
    '--no-default-browser-check',
    '--no-first-run',
  ];
  if (process.env.FIN3000_CHROMIUM_NO_SANDBOX === '1') {
    args.push('--no-sandbox');
  }
  args.push(reportUrl);
  const child = spawn(executable, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { browserPid: child.pid, profileDirectory };
}

try {
  const args = parseCliArgs(process.argv.slice(2));
  const { extensionId, profile } = await loadProfile(args.profile);
  const outputDirectory = path.join(frontendRoot, 'dist', 'browser-extension', profile.profile);
  if (!outputDirectory.startsWith(path.join(frontendRoot, 'dist', 'browser-extension') + path.sep)) {
    throw new Error('unsafe probe output directory');
  }
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const sourceDirectory = path.join(frontendRoot, 'browser-extension', 'probe');
  const manifestTemplate = await readFile(
    path.join(frontendRoot, 'browser-extension', 'manifest.template.json'),
    'utf8',
  );
  const backgroundTemplate = await readFile(path.join(sourceDirectory, 'background.js'), 'utf8');
  const reportScriptTemplate = await readFile(path.join(sourceDirectory, 'probe-report.js'), 'utf8');

  await Promise.all([
    writeFile(path.join(outputDirectory, 'manifest.json'), renderManifest(manifestTemplate, profile), 'utf8'),
    writeFile(
      path.join(outputDirectory, 'background.js'),
      renderProfileTemplate(backgroundTemplate, profile),
      'utf8',
    ),
    writeFile(
      path.join(outputDirectory, 'probe-report.js'),
      renderProfileTemplate(reportScriptTemplate, profile),
      'utf8',
    ),
    copyFile(path.join(sourceDirectory, 'core.js'), path.join(outputDirectory, 'core.js')),
    copyFile(path.join(sourceDirectory, 'probe-report.css'), path.join(outputDirectory, 'probe-report.css')),
    copyFile(path.join(sourceDirectory, 'probe-report.html'), path.join(outputDirectory, 'probe-report.html')),
    copyFile(
      path.join(frontendRoot, 'browser-extension', 'fixtures', 'hello-world.pdf'),
      path.join(outputDirectory, 'hello-world.pdf'),
    ),
    copyFile(path.join(frontendRoot, 'public', 'images', 'logo-icon.svg'), path.join(outputDirectory, 'icon.svg')),
  ]);
  await assertExpectedBuildFiles(outputDirectory);

  const hashes = {};
  for (const fileName of [...allowedBuildFiles].sort()) {
    hashes[fileName] = await sha256File(path.join(outputDirectory, fileName));
  }
  const artifactHash = createHash('sha256')
    .update(Object.entries(hashes).map(([name, hash]) => `${name}:${hash}`).join('\n'))
    .digest('hex');
  const reportUrl = `chrome-extension://${extensionId}/probe-report.html`;
  const launch = args.noLaunch ? null : launchChromium(outputDirectory, reportUrl);

  emitRecord({
    artifactHash,
    command,
    commit: currentCommit(),
    extensionId,
    files: hashes,
    helpCode: null,
    launch,
    loadUnpackedPath: outputDirectory,
    profile: profile.profile,
    profileVersion: profile.profileVersion,
    reportUrl,
    status: 'PASS',
  });
} catch (error) {
  fail(command, process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : '', error, 4);
}
