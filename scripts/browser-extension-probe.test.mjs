import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  ACTIVE_KEEPALIVE_INTERVAL_MS,
  PRINTER_CAPABILITIES,
  ProbeAdmissionError,
  createExactlyOnceCallback,
  findPdfMagic,
  inspectPrintJob,
  normalizeDelaySeconds,
} from '../browser-extension/probe/core.js';
import { frontendRoot } from './browser-extension-cli.mjs';

function printJob(document, contentType = 'application/pdf') {
  return {
    contentType,
    document,
    printerId: 'fin3000-incoming-invoice',
    ticket: { deliberately: 'not inspected' },
    title: 'must never enter diagnostics',
  };
}

test('capabilities expose exactly the promised PDF profile', () => {
  assert.deepEqual(PRINTER_CAPABILITIES.printer.supported_content_type, [
    { content_type: 'application/pdf' },
  ]);
  assert.deepEqual(PRINTER_CAPABILITIES.printer.copies, { default: 1, max: 1 });
  assert.deepEqual(PRINTER_CAPABILITIES.printer.dpi.option, [
    { horizontal_dpi: 300, vertical_dpi: 300, is_default: true },
  ]);
  assert.equal(PRINTER_CAPABILITIES.printer.media_size.option[0].name, 'ISO_A4');
});

test('PDF admission reads only a small prefix and returns safe metadata', async () => {
  const document = new Blob(['preamble\n%PDF-1.4\nbody'], { type: 'application/pdf' });
  const metadata = await inspectPrintJob(printJob(document), 20 * 1024 * 1024);

  assert.deepEqual(metadata, {
    blobType: 'application/pdf',
    byteSize: document.size,
    contentType: 'application/pdf',
    magicOffset: 9,
  });
  assert.equal('document' in metadata, false);
  assert.equal('title' in metadata, false);
  assert.equal('ticket' in metadata, false);
  assert.equal('url' in metadata, false);
});

test('PDF admission fails closed for invalid type, magic and size', async () => {
  await assert.rejects(
    inspectPrintJob(printJob(new Blob(['%PDF-1.4']), 'text/plain'), 100),
    (error) => error instanceof ProbeAdmissionError && error.code === 'INVALID_CONTENT_TYPE',
  );
  await assert.rejects(
    inspectPrintJob(printJob(new Blob(['not a pdf'])), 100),
    (error) => error instanceof ProbeAdmissionError && error.code === 'PDF_MAGIC_MISSING',
  );
  await assert.rejects(
    inspectPrintJob(printJob(new Blob(['%PDF-1.4'])), 2),
    (error) => error instanceof ProbeAdmissionError && error.code === 'DOCUMENT_TOO_LARGE',
  );
});

test('callback wrapper invokes Chrome exactly once', () => {
  const results = [];
  const callback = createExactlyOnceCallback((result) => results.push(result));

  assert.equal(callback('OK'), true);
  assert.equal(callback('FAILED'), false);
  assert.deepEqual(results, ['OK']);
});

test('delay selection accepts only the measured G1 values', () => {
  const allowed = [2, 30, 90, 300];
  assert.equal(normalizeDelaySeconds('90', allowed, 2), 90);
  assert.equal(normalizeDelaySeconds(7, allowed, 2), 2);
  assert.ok(ACTIVE_KEEPALIVE_INTERVAL_MS < 30_000);
});

test('service worker contains no portal or print-document diagnostics', async () => {
  const source = await readFile(
    path.join(frontendRoot, 'browser-extension', 'probe', 'background.js'),
    'utf8',
  );
  for (const forbidden of [
    'vodafone',
    'host_permissions',
    'printJob.title',
    'printJob.ticket',
    'printJob.document.text',
  ]) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test('fixture is a plausible PDF with a valid startxref offset', async () => {
  const fixture = await readFile(
    path.join(frontendRoot, 'browser-extension', 'fixtures', 'hello-world.pdf'),
  );
  assert.equal(findPdfMagic(fixture.subarray(0, 1029)), 0);
  const text = fixture.toString('latin1');
  const xrefOffset = Number(text.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  assert.equal(text.slice(xrefOffset, xrefOffset + 4), 'xref');
});
