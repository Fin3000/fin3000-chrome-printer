export const PRINTER_ID = 'fin3000-incoming-invoice';
export const PDF_CONTENT_TYPE = 'application/pdf';
export const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
export const PDF_PREFIX_BYTES = 1029;
export const ACTIVE_KEEPALIVE_INTERVAL_MS = 20_000;

export const PRINTER_CAPABILITIES = Object.freeze({
  version: '1.0',
  printer: {
    supported_content_type: [{ content_type: PDF_CONTENT_TYPE }],
    color: {
      option: [
        { type: 'STANDARD_COLOR', is_default: true },
        { type: 'STANDARD_MONOCHROME' },
      ],
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
});

export class ProbeAdmissionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function findPdfMagic(bytes) {
  const limit = Math.min(bytes.length - PDF_MAGIC.length, 1024);
  for (let index = 0; index <= limit; index += 1) {
    if (PDF_MAGIC.every((byte, offset) => bytes[index + offset] === byte)) {
      return index;
    }
  }
  return -1;
}

export function createExactlyOnceCallback(callback) {
  let called = false;
  return (result) => {
    if (called) {
      return false;
    }
    called = true;
    callback(result);
    return true;
  };
}

export function normalizeDelaySeconds(value, allowed, fallback) {
  const parsed = Number(value);
  return allowed.includes(parsed) ? parsed : fallback;
}

export async function inspectPrintJob(printJob, maxFileBytes) {
  if (!printJob || printJob.printerId !== PRINTER_ID) {
    throw new ProbeAdmissionError('INVALID_PRINTER', 'Unexpected printer ID');
  }
  if (printJob.contentType !== PDF_CONTENT_TYPE) {
    throw new ProbeAdmissionError('INVALID_CONTENT_TYPE', 'Only application/pdf is accepted');
  }
  if (!(printJob.document instanceof Blob)) {
    throw new ProbeAdmissionError('INVALID_BLOB', 'Print document is not a Blob');
  }
  if (printJob.document.size <= 0) {
    throw new ProbeAdmissionError('EMPTY_DOCUMENT', 'Print document is empty');
  }
  if (printJob.document.size > maxFileBytes) {
    throw new ProbeAdmissionError('DOCUMENT_TOO_LARGE', 'Print document exceeds the size limit');
  }

  const prefix = new Uint8Array(
    await printJob.document.slice(0, PDF_PREFIX_BYTES).arrayBuffer(),
  );
  const magicOffset = findPdfMagic(prefix);
  if (magicOffset < 0) {
    throw new ProbeAdmissionError('PDF_MAGIC_MISSING', 'PDF magic was not found');
  }

  return {
    blobType: printJob.document.type || null,
    byteSize: printJob.document.size,
    contentType: printJob.contentType,
    magicOffset,
  };
}

export function safeFailureCode(error) {
  return error instanceof ProbeAdmissionError ? error.code : 'PROBE_FAILED';
}
