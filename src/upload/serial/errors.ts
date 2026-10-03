/** Error type thrown by the uploader. `code` is stable (UI can translate on it); `message` is student-friendly English. */

export type UploadErrorCode =
  | 'HEX_PARSE' // .hex text is malformed
  | 'HEX_CHECKSUM' // a record's checksum is wrong (corrupt file)
  | 'TOO_LARGE' // program would overwrite the bootloader
  | 'NO_ANSWER' // nothing at all came back from the board
  | 'NOT_IN_SYNC' // bytes came back, but never the bootloader's 0x14 0x10
  | 'SIGNATURE_MISMATCH' // not an ATmega328P
  | 'PROTOCOL' // bootloader stopped answering / answered wrongly mid-upload
  | 'VERIFY_FAILED' // read-back differs from what was written
  | 'ABORTED' // user cancelled
  | 'PORT' // could not open / lost the serial port
  | 'UNSUPPORTED'; // no Web Serial in this browser

export class UploadError extends Error {
  readonly code: UploadErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: UploadErrorCode, message: string, details: Record<string, unknown> = {}, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UploadError';
    this.code = code;
    this.details = details;
  }
}

export const MESSAGES = {
  noAnswer:
    'No answer from the board — is the Arduino IDE Serial Monitor (or another program or browser tab) using this port? ' +
    'Close it, check that you picked the right port and that the USB cable is plugged in, then try again.',
  notInSync: (seen: string) =>
    `The board answered, but not like an Arduino bootloader (it sent ${seen}). The automatic reset probably did not work: ` +
    'press the RESET button on the board right after clicking Upload, or unplug and replug the USB cable.',
  aborted: 'Upload cancelled. The board may now hold an incomplete program — upload again before using it.',
  openTimeout:
    'The port did not open: it is probably not the board (a Bluetooth port, for example). ' +
    'Choose the board\'s port: the same COM port as in the Arduino IDE.',
  tooLarge: (size: number, max: number) =>
    `The program is too big: ${size} bytes, but this board only has room for ${max} bytes (the rest holds the bootloader).`,
  signature: (got: string, want: string) =>
    `This board does not look like an Arduino UNO (chip signature ${got}, expected ${want}). Check the selected port.`,
  protocol: (what: string) =>
    `The board stopped answering correctly during the upload (${what}). Unplug and replug the board, then try again.`,
  verify: (addr: number, wrote: number, read: number) =>
    `Verification failed at address 0x${addr.toString(16).padStart(4, '0')}: wrote 0x${hex2(wrote)}, read back 0x${hex2(read)}. ` +
    'Try uploading again; if it keeps failing, the board may be damaged.',
} as const;

export function hex2(b: number): string {
  return b.toString(16).toUpperCase().padStart(2, '0');
}

export function hexBytes(bytes: ArrayLike<number>, max = 16): string {
  const parts: string[] = [];
  for (let i = 0; i < Math.min(bytes.length, max); i++) parts.push(hex2(bytes[i]));
  return parts.join(' ') + (bytes.length > max ? ' …' : '');
}
