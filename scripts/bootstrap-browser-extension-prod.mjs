import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { frontendRoot } from './browser-extension-cli.mjs';
import { failProduct, sha256 } from './browser-extension-product-cli.mjs';

try {
  const root = path.join(frontendRoot, 'dist', 'browser-extension', 'production-bootstrap');
  const unpacked = path.join(root, 'unpacked');
  const zipPath = path.join(root, 'fin3000-store-id-reservation.zip');
  await rm(root, { recursive: true, force: true });
  await mkdir(unpacked, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: 'Fin3000 Chrome-Druckziel (Reservierung)',
    description: 'Nicht funktionsfähiges Artefakt zur Reservierung der Chrome-Web-Store-ID.',
    version: '0.0.1',
    icons: { 128: 'icon.png' },
  };
  await Promise.all([
    writeFile(
      path.join(unpacked, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    ),
    copyFile(
      path.join(frontendRoot, 'public', 'images', 'icon-192.png'),
      path.join(unpacked, 'icon.png'),
    ),
  ]);
  const epoch = new Date('1980-01-01T00:00:00.000Z');
  for (const file of ['icon.png', 'manifest.json']) {
    await chmod(path.join(unpacked, file), 0o644);
    await utimes(path.join(unpacked, file), epoch, epoch);
  }
  const zip = spawnSync('zip', ['-X', '-q', zipPath, 'icon.png', 'manifest.json'], {
    cwd: unpacked,
    encoding: 'utf8',
  });
  if (zip.status !== 0) throw new Error(zip.stderr || 'zip failed');
  process.stdout.write(
    `${JSON.stringify({
      status: 'READY_FOR_DRAFT_ONLY',
      functional: false,
      zipPath,
      sha256: sha256(await readFile(zipPath)),
      next: 'Chrome-Web-Store-Draft hochladen, aber nicht veröffentlichen.',
    })}\n`,
  );
} catch (error) {
  failProduct(error);
}
