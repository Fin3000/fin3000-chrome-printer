import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CliError,
  deriveExtensionId,
  loadProfile,
  parseCliArgs,
} from './browser-extension-cli.mjs';

test('G1 profile keeps the fixed local extension identity', async () => {
  const { extensionId, profile } = await loadProfile('g1-probe');

  assert.equal(extensionId, 'bglmjpfbiofbjcidiceblanlmmfikjil');
  assert.equal(deriveExtensionId(profile.publicKey), extensionId);
  assert.equal(profile.printerId, 'fin3000-incoming-invoice');
  assert.equal(profile.printerName, 'An Fin3000 senden');
  assert.deepEqual(profile.callbackDelaysSeconds, [2, 30, 90, 300]);
  assert.equal('allowedHosts' in profile, false);
  assert.equal('startUrl' in profile, false);
});

test('CLI accepts only the explicit G1 profile', () => {
  assert.deepEqual(parseCliArgs(['--profile', 'g1-probe', '--no-launch']), {
    noLaunch: true,
    profile: 'g1-probe',
  });
  assert.throws(() => parseCliArgs([]), CliError);
  assert.throws(() => parseCliArgs(['--profile', 'production']), CliError);
});
