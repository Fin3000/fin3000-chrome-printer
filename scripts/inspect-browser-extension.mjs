import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { failProduct, ProductCliError, productLocales } from './browser-extension-product-cli.mjs';

export async function inspectExtension(directory, expectedProfile = '') {
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const permissions = [...(manifest.permissions || [])].sort();
  const expectedPermissions = ['identity', 'notifications', 'printerProvider', 'storage'];
  if (JSON.stringify(permissions) !== JSON.stringify(expectedPermissions.sort())) {
    throw new ProductCliError(
      'HOST_PERMISSION_BROAD',
      'Die Extension-Rechte weichen vom Minimalvertrag ab.',
      permissions.join(', '),
      'browser-extension/manifest.product.template.json prüfen',
    );
  }
  if (
    manifest.content_scripts ||
    manifest.optional_permissions ||
    manifest.optional_host_permissions ||
    manifest.externally_connectable ||
    permissions.some((name) => ['cookies', 'tabs', 'webRequest'].includes(name))
  ) {
    throw new ProductCliError(
      'HOST_PERMISSION_BROAD',
      'Portalzugriff ist im Produktartefakt verboten.',
      'Content-Script oder Portalberechtigung gefunden.',
      'browser-extension/manifest.product.template.json prüfen',
    );
  }
  const hosts = manifest.host_permissions || [];
  if (
    hosts.length < 2 ||
    hosts.some(
      (host) =>
        typeof host !== 'string' ||
        !host.endsWith('/*') ||
        host.includes('*://') ||
        host.includes('://*') ||
        /vodafone|telekom/i.test(host),
    )
  ) {
    throw new ProductCliError(
      'HOST_PERMISSION_BROAD',
      'Host-Rechte müssen exakte Fin3000-/Quarantäne-Origins sein.',
      JSON.stringify(hosts),
      'das gewählte Extension-Profil prüfen',
    );
  }

  const config = JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8'));
  const expectedHosts = [config.apiOrigin, ...(config.uploadOrigins || [])]
    .map((origin) => `${origin}/*`)
    .sort();
  if (JSON.stringify([...hosts].sort()) !== JSON.stringify(expectedHosts)) {
    throw new ProductCliError(
      'HOST_PERMISSION_BROAD',
      'Host-Rechte müssen exakt der Laufzeitkonfiguration entsprechen.',
      JSON.stringify(hosts),
      'Manifest und config.json mit dem gewählten Extension-Profil neu erzeugen',
    );
  }
  if (expectedProfile && config.profile !== expectedProfile) {
    throw new ProductCliError(
      'CFG_PROFILE_INVALID',
      'Build und erwartetes Profil stimmen nicht überein.',
      `${config.profile} statt ${expectedProfile}`,
      'den passenden Buildbefehl erneut ausführen',
    );
  }
  let notForStoreNotice = '';
  try {
    notForStoreNotice = await readFile(path.join(directory, 'NOT_FOR_STORE.txt'), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (
    (config.profile === 'store-id-qa' && !notForStoreNotice.includes('NOT FOR CHROME WEB STORE')) ||
    (config.profile !== 'store-id-qa' && notForStoreNotice)
  ) {
    throw new ProductCliError(
      'ARTIFACT_POLICY_INVALID',
      'Die Store-ID-QA-Markierung stimmt nicht mit dem Profil überein.',
      config.profile,
      'den passenden Buildbefehl erneut ausführen',
    );
  }
  const de = JSON.parse(
    await readFile(path.join(directory, '_locales', 'de', 'messages.json'), 'utf8'),
  );
  const localeKeys = Object.keys(de).sort();
  for (const locale of productLocales) {
    const file = path.join(directory, '_locales', locale, 'messages.json');
    const messages = JSON.parse(await readFile(file, 'utf8'));
    if (JSON.stringify(Object.keys(messages).sort()) !== JSON.stringify(localeKeys)) {
      throw new ProductCliError(
        'LOCALE_PARITY_INVALID',
        `Der Extension-Katalog ${locale} hat einen anderen Key-Tree.`,
        file,
        'alle 26 browser-extension/_locales-Kataloge angleichen',
      );
    }
    if (
      Object.values(messages).some(
        (entry) => !entry || typeof entry.message !== 'string' || !entry.message.trim(),
      )
    ) {
      throw new ProductCliError(
        'LOCALE_PARITY_INVALID',
        `Der Extension-Katalog ${locale} enthält leere Texte.`,
        file,
        'den Katalog vervollständigen',
      );
    }
  }

  const forbiddenNames = [];
  const executableFiles = [];
  async function walk(current, prefix = '') {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) await walk(path.join(current, entry.name), relative);
      else {
        if (relative.endsWith('.map')) forbiddenNames.push(relative);
        if (/\.(?:css|html|js)$/.test(relative)) executableFiles.push(relative);
        const metadata = await stat(path.join(current, entry.name));
        if (metadata.size > 25 * 1024 * 1024) forbiddenNames.push(relative);
      }
    }
  }
  await walk(directory);
  if (forbiddenNames.length) {
    throw new ProductCliError(
      'ARTIFACT_POLICY_INVALID',
      'Das Artefakt enthält verbotene Dateien.',
      forbiddenNames.join(', '),
      'npm run extension:build:qa erneut ausführen',
    );
  }
  const executableSources = await Promise.all(
    executableFiles.map(async (file) => ({
      file,
      source: await readFile(path.join(directory, file), 'utf8'),
    })),
  );
  const remoteCodePattern =
    /(?:from\s*|import\s*\(\s*|importScripts\s*\(\s*)['"]https?:\/\/|\b(?:src|href)\s*=\s*['"]https?:\/\/|@import\s+(?:url\()?['"]?https?:\/\/|(?:^|[^\w.])eval\s*\(|new\s+Function\s*\(/im;
  const remoteCodeFile = executableSources.find(({ source }) => remoteCodePattern.test(source));
  if (remoteCodeFile) {
    throw new ProductCliError(
      'REMOTE_CODE_POLICY_INVALID',
      'Das Artefakt darf keinen entfernten oder dynamisch ausgewerteten Code laden.',
      remoteCodeFile.file,
      'alle JS-, HTML- und CSS-Dateien auf ausschließlich lokale Ressourcen prüfen',
    );
  }
  const portalCodeFile = executableSources.find(({ source }) =>
    /vodafone|telekom|content_scripts|chrome\.cookies/i.test(source),
  );
  if (portalCodeFile) {
    throw new ProductCliError(
      'ARTIFACT_POLICY_INVALID',
      'Der Worker enthält Portal- oder Cookie-Code.',
      `Verbotene Konstante in ${portalCodeFile.file} gefunden.`,
      'browser-extension/src prüfen',
    );
  }
  return {
    profile: config.profile,
    extensionId: config.extensionId,
    permissions,
    hostPermissions: hosts,
    localeCount: productLocales.length,
    fileCount: (await readdir(directory, { recursive: true })).length,
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const directory = process.argv[2];
  if (!directory) {
    failProduct(
      new ProductCliError(
        'CFG_PROFILE_INVALID',
        'Der Artefaktpfad fehlt.',
        'Kein Verzeichnis übergeben.',
        'npm run extension:inspect -- dist/browser-extension/qa/unpacked',
      ),
    );
  } else {
    inspectExtension(path.resolve(directory))
      .then((result) => process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result })}\n`))
      .catch(failProduct);
  }
}
