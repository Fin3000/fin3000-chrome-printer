import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const supportedProfiles = new Set(['g1-probe']);

export class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function parseCliArgs(argv) {
  const result = { noLaunch: false, profile: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--profile' && index + 1 < argv.length) {
      if (result.profile) {
        throw new CliError('duplicate --profile', 2);
      }
      result.profile = argv[index + 1];
      index += 1;
    } else if (argument === '--no-launch') {
      result.noLaunch = true;
    } else {
      throw new CliError(`unsupported argument: ${argument}`, 2);
    }
  }
  if (!supportedProfiles.has(result.profile)) {
    throw new CliError('profile must be g1-probe', 2);
  }
  return result;
}

export function deriveExtensionId(publicKey) {
  const keyBytes = Buffer.from(publicKey, 'base64');
  if (keyBytes.length < 100) {
    throw new CliError('publicKey is not a valid DER key', 2);
  }
  const digest = createHash('sha256').update(keyBytes).digest().subarray(0, 16);
  const alphabet = 'abcdefghijklmnop';
  let extensionId = '';
  for (const byte of digest) {
    extensionId += alphabet[byte >> 4] + alphabet[byte & 0x0f];
  }
  return extensionId;
}

function hasExactKeys(value, expectedKeys) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort());
}

export async function loadProfile(profileName) {
  const profilePath = path.join(frontendRoot, 'browser-extension', 'config', `${profileName}.json`);
  const raw = await readFile(profilePath, 'utf8');
  const profile = JSON.parse(raw);
  const expectedKeys = [
    '$schema',
    'callbackDelaysSeconds',
    'defaultCallbackDelaySeconds',
    'maxFileBytes',
    'minimumChromeVersion',
    'printerDescription',
    'printerId',
    'printerName',
    'profile',
    'profileVersion',
    'protocolVersion',
    'publicKey',
  ];
  if (!hasExactKeys(profile, expectedKeys)) {
    throw new CliError('profile has missing or unknown keys', 2);
  }
  if (
    profile.profile !== profileName ||
    profile.profileVersion !== 2 ||
    profile.protocolVersion !== 1 ||
    profile.printerId !== 'fin3000-incoming-invoice' ||
    profile.printerName !== 'An Fin3000 senden' ||
    profile.printerDescription !== 'Fin3000 G1 Canary' ||
    !/^\d+$/.test(profile.minimumChromeVersion) ||
    JSON.stringify(profile.callbackDelaysSeconds) !== JSON.stringify([2, 30, 90, 300]) ||
    !profile.callbackDelaysSeconds.includes(profile.defaultCallbackDelaySeconds) ||
    profile.maxFileBytes !== 20 * 1024 * 1024
  ) {
    throw new CliError('profile invariants failed', 2);
  }
  const extensionId = deriveExtensionId(profile.publicKey);
  return { extensionId, profile, profilePath };
}

export async function sha256File(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export function currentCommit() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: frontendRoot,
    encoding: 'utf8',
  }).trim();
}

export async function requireFile(filePath) {
  await access(filePath);
  return filePath;
}

export function emitRecord(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export function fail(command, profile, error, exitCode = 4) {
  const message = error instanceof Error ? error.message : String(error);
  const effectiveExitCode = error instanceof CliError ? error.exitCode : exitCode;
  emitRecord({
    command,
    helpCode: 'F3-BEXT-G1',
    profile,
    status: 'FAIL',
    summary: message,
  });
  process.exitCode = effectiveExitCode;
}
