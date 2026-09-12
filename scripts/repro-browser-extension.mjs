import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildProduct } from './build-browser-extension.mjs';
import { failProduct, ProductCliError } from './browser-extension-product-cli.mjs';

const profile = process.argv[2] || 'production';
const temporary = await mkdtemp(path.join(os.tmpdir(), 'fin3000-browser-extension-repro-'));
try {
  const first = await buildProduct(profile, path.join(temporary, 'first'));
  const second = await buildProduct(profile, path.join(temporary, 'second'));
  if (first.artifactHash !== second.artifactHash || first.zipHash !== second.zipHash) {
    throw new ProductCliError(
      'ARTIFACT_NOT_REPRODUCIBLE',
      'Zwei saubere Builds sind nicht byteidentisch.',
      `${first.zipHash} != ${second.zipHash}`,
      'npm run extension:inspect -- <Artefaktpfad>',
      5,
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      status: 'PASS',
      profile,
      artifactHash: first.artifactHash,
      zipHash: first.zipHash,
    })}\n`,
  );
} catch (error) {
  failProduct(error);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
