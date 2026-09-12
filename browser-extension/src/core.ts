export type PrintResult = 'OK' | 'FAILED' | 'INVALID_TICKET' | 'INVALID_DATA';

// Desktop Chrome forwards the CDD object itself from this callback. The
// @types/chrome shape currently adds another `capabilities` property; passing
// that wrapper through on Chrome 150 produces `capabilities.capabilities` and
// leaves the native Print button disabled.
export const PRINTER_CAPABILITIES: chrome.printerProvider.PrinterCapabilities = {
  version: '1.0',
  printer: {
    supported_content_type: [{ content_type: 'application/pdf' }],
    color: {
      option: [{ type: 'STANDARD_COLOR', is_default: true }, { type: 'STANDARD_MONOCHROME' }],
    },
    copies: { default: 1, max: 1 },
    dpi: {
      option: [{ horizontal_dpi: 300, vertical_dpi: 300, is_default: true }],
    },
    media_size: {
      option: [
        {
          name: 'ISO_A4',
          width_microns: 210000,
          height_microns: 297000,
          is_default: true,
        },
      ],
    },
  },
} as unknown as chrome.printerProvider.PrinterCapabilities;

export const EMPTY_PRINTER_CAPABILITIES =
  {} as unknown as chrome.printerProvider.PrinterCapabilities;

export class ExtensionError extends Error {
  constructor(
    readonly code: string,
    readonly printResult: PrintResult = 'FAILED',
  ) {
    super(code);
  }
}

export function createExactlyOnceCallback(
  callback: (result: PrintResult) => void,
): (result: PrintResult) => boolean {
  let called = false;
  return (result) => {
    if (called) return false;
    called = true;
    callback(result);
    return true;
  };
}

export function normalizePdfFilename(title: string): string {
  const cleaned = (title || 'Fin3000-Dokument')
    .normalize('NFC')
    .replaceAll('\\', '/')
    .split('/')
    .at(-1)!
    .split('')
    .filter((character) => {
      const codePoint = character.charCodeAt(0);
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join('')
    .trim()
    .replace(/\.pdf$/i, '')
    .trim();
  const stem = cleaned || 'Fin3000-Dokument';
  return stem.slice(0, 251) + '.pdf';
}

export async function assertPdfDocument(
  printJob: chrome.printerProvider.PrintJob,
  printerId: string,
  maxFileBytes: number,
): Promise<{ blob: Blob; filename: string }> {
  if (printJob.printerId !== printerId) {
    throw new ExtensionError('INVALID_PRINTER');
  }
  if (
    printJob.contentType !== 'application/pdf' ||
    !(printJob.document instanceof Blob) ||
    !['', 'application/pdf'].includes(printJob.document.type)
  ) {
    throw new ExtensionError('INVALID_PDF', 'INVALID_DATA');
  }
  if (printJob.document.size < 1) {
    throw new ExtensionError('EMPTY_PDF', 'INVALID_DATA');
  }
  if (printJob.document.size > maxFileBytes) {
    throw new ExtensionError('PDF_TOO_LARGE', 'INVALID_DATA');
  }
  const prefix = new Uint8Array(await printJob.document.slice(0, 1029).arrayBuffer());
  const magic = [0x25, 0x50, 0x44, 0x46, 0x2d];
  let found = false;
  for (let index = 0; index <= Math.min(prefix.length - magic.length, 1024); index += 1) {
    if (magic.every((byte, offset) => prefix[index + offset] === byte)) {
      found = true;
      break;
    }
  }
  if (!found) throw new ExtensionError('INVALID_PDF', 'INVALID_DATA');
  return { blob: printJob.document, filename: normalizePdfFilename(printJob.title) };
}

export function i18n(key: string, substitutions?: string | string[]): string {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function deadlineSignal(deadlineAt: number): AbortSignal {
  const remaining = Math.max(1, deadlineAt - Date.now());
  return AbortSignal.timeout(remaining);
}
