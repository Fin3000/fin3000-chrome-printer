import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { deriveExtensionId, frontendRoot } from './browser-extension-cli.mjs';
import { portsForSlug } from './qa-ports.mjs';

const PROFILE_KEYS = [
  '$schema',
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
  'publicKey',
  'uploadOrigins',
];

const PRODUCT_PROFILES = new Set(['qa', 'store-id-qa', 'production']);

export const productLocales = [
  'bg',
  'cs',
  'da',
  'de',
  'el',
  'en',
  'es',
  'et',
  'fi',
  'fr',
  'ga',
  'hi',
  'hr',
  'hu',
  'it',
  'lt',
  'lv',
  'nl',
  'no',
  'pl',
  'pt',
  'ro',
  'sk',
  'sv',
  'tr',
  'uk',
];

export class ProductCliError extends Error {
  constructor(code, problem, cause, next, exitCode = 2) {
    super(problem);
    this.code = code;
    this.causeText = cause;
    this.next = next;
    this.exitCode = exitCode;
  }
}

export function failProduct(error) {
  const value =
    error instanceof ProductCliError
      ? error
      : new ProductCliError(
          'EXTENSION_BUILD_FAILED',
          'Das Browser-Erweiterungsartefakt konnte nicht erstellt werden.',
          error instanceof Error ? error.message : String(error),
          'npm run extension:doctor',
          4,
        );
  process.stderr.write(
    `${value.code}: ${value.message} Ursache: ${value.causeText} ` +
      `Nächster Schritt: ${value.next}\n`,
  );
  process.exitCode = value.exitCode;
}

function exactKeys(value, keys) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function exactOrigin(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.origin !== value || parsed.username || parsed.password) throw new Error();
    return parsed.origin;
  } catch {
    throw new ProductCliError(
      'CFG_PROFILE_INVALID',
      `${label} ist keine exakte Origin.`,
      String(value),
      'browser-extension/config/qa.json prüfen',
    );
  }
}

function applyQaEnvironment(profile) {
  const slug = process.env.QA_SLUG;
  const ports = slug ? portsForSlug(slug) : null;
  const apiOrigin =
    process.env.FIN3000_EXTENSION_API_ORIGIN ||
    (ports ? `http://127.0.0.1:${ports.backend}` : profile.apiOrigin);
  const frontendOrigin =
    process.env.FIN3000_EXTENSION_FRONTEND_ORIGIN ||
    (ports ? `http://127.0.0.1:${ports.frontend}` : profile.frontendOrigin);
  const uploadOrigins = process.env.FIN3000_EXTENSION_UPLOAD_ORIGINS
    ? process.env.FIN3000_EXTENSION_UPLOAD_ORIGINS.split(',').map((value) => value.trim())
    : profile.uploadOrigins;
  return { ...profile, apiOrigin, frontendOrigin, uploadOrigins };
}

export async function loadProductProfile(profileName) {
  if (!PRODUCT_PROFILES.has(profileName)) {
    throw new ProductCliError(
      'CFG_PROFILE_INVALID',
      'Das Profil muss qa, store-id-qa oder production sein.',
      `Empfangen: ${profileName || '(leer)'}`,
      'npm run extension:build:qa',
    );
  }
  const configDirectory = path.join(frontendRoot, 'browser-extension', 'config');
  const qaProfilePath = path.join(configDirectory, 'qa.json');
  const productionProfilePath = path.join(configDirectory, 'production.template.json');
  const profilePath = profileName === 'production' ? productionProfilePath : qaProfilePath;
  let profile;
  if (profileName === 'store-id-qa') {
    const qa = applyQaEnvironment(JSON.parse(await readFile(qaProfilePath, 'utf8')));
    const production = JSON.parse(await readFile(productionProfilePath, 'utf8'));
    profile = {
      ...qa,
      profile: 'store-id-qa',
      extensionId: production.extensionId,
      publicKey: production.publicKey,
      oauthClientId: production.oauthClientId,
    };
  } else {
    profile = JSON.parse(await readFile(profilePath, 'utf8'));
  }
  if (!exactKeys(profile, PROFILE_KEYS) || profile.profile !== profileName) {
    throw new ProductCliError(
      'CFG_PROFILE_INVALID',
      'Das Profil hat fehlende, unbekannte oder widersprüchliche Felder.',
      profilePath,
      `${profilePath} gegen product.schema.json prüfen`,
    );
  }
  if (profileName === 'qa') profile = applyQaEnvironment(profile);
  const invariantValid =
    profile.profileVersion === 1 &&
    profile.protocolVersion === 1 &&
    profile.printerId === 'fin3000-incoming-invoice' &&
    /^\d+\.\d+\.\d+$/.test(profile.extensionVersion) &&
    /^\d+$/.test(profile.minimumChromeVersion) &&
    typeof profile.oauthClientId === 'string' &&
    profile.oauthClientId.length > 0 &&
    profile.maxFileBytes === 20 * 1024 * 1024 &&
    Number.isInteger(profile.operationDeadlineMs) &&
    profile.operationDeadlineMs >= 30_000 &&
    profile.operationDeadlineMs <= 300_000 &&
    Number.isInteger(profile.operationTtlMs) &&
    profile.operationTtlMs >= 300_000 &&
    profile.operationTtlMs <= 86_400_000 &&
    Array.isArray(profile.uploadOrigins) &&
    profile.uploadOrigins.length > 0 &&
    new Set(profile.uploadOrigins).size === profile.uploadOrigins.length;
  if (!invariantValid) {
    throw new ProductCliError(
      'CFG_PROFILE_INVALID',
      'Das Profil verletzt den Fin3000-Produktvertrag.',
      profilePath,
      `${profilePath} gegen product.schema.json prüfen`,
    );
  }
  if (
    profileName === 'production' &&
    JSON.stringify(profile).match(/__(?:[A-Z0-9_]+)__|\bqa\b|localhost|127\.0\.0\.1/i)
  ) {
    throw new ProductCliError(
      'QA_VALUE_IN_PROD',
      'Das Produktionsprofil ist absichtlich noch nicht freigeschaltet.',
      'Store-ID, Manifest-Key oder Produktionskonfiguration fehlen.',
      'Erst nach lokaler Abnahme npm run extension:bootstrap:prod ausführen',
    );
  }
  const apiOrigin = exactOrigin(profile.apiOrigin, 'apiOrigin');
  const frontendOrigin = exactOrigin(profile.frontendOrigin, 'frontendOrigin');
  const uploadOrigins = profile.uploadOrigins.map((origin) => exactOrigin(origin, 'uploadOrigin'));
  if (
    profileName === 'production' &&
    [apiOrigin, frontendOrigin, ...uploadOrigins].some((origin) => !origin.startsWith('https://'))
  ) {
    throw new ProductCliError(
      'CFG_PROFILE_INVALID',
      'Produktion erlaubt ausschließlich HTTPS-Origins.',
      profilePath,
      `${profilePath} korrigieren`,
    );
  }
  let derivedId;
  try {
    derivedId = deriveExtensionId(profile.publicKey);
  } catch (error) {
    throw new ProductCliError(
      'CFG_PROFILE_INVALID',
      'Der Manifest-Key ist ungültig.',
      error instanceof Error ? error.message : String(error),
      `${profilePath} korrigieren`,
    );
  }
  if (derivedId !== profile.extensionId) {
    throw new ProductCliError(
      'EXTENSION_ID_DRIFT',
      'Manifest-Key und Extension-ID passen nicht zusammen.',
      `Erwartet ${derivedId}, konfiguriert ${profile.extensionId}`,
      `${profilePath} korrigieren`,
    );
  }
  const redirectUri = `https://${profile.extensionId}.chromiumapp.org/`;
  return {
    profile: { ...profile, apiOrigin, frontendOrigin, uploadOrigins },
    profilePath,
    redirectUri,
  };
}

export function runtimeConfig(profile) {
  const { publicKey: _publicKey, $schema: _schema, ...runtime } = profile;
  return runtime;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
