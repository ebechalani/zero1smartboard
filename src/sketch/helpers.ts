/**
 * The 7-segment helper functions of the generated sketches, verbatim (docs/BLOCKS.md §11.3), shared
 * by the Blocks generator and the Python translator (docs/PYTHON.md §3.8, §4.8). Blockly-free.
 * Both need the SEG_DATA, SEG_LATCH and SEG_CLOCK pin constants; showDigit needs showSegments.
 */

export type SegmentHelperName = 'showSegments' | 'showDigit';

/** The helper texts, in the order they are emitted. */
export const SEGMENT_HELPERS: Readonly<Record<SegmentHelperName, string>> = {
  showSegments: `void showSegments(byte pattern) {          // 74HC595: a = bit 0 … g = bit 6, dp = bit 7
  digitalWrite(SEG_LATCH, LOW);
  shiftOut(SEG_DATA, SEG_CLOCK, MSBFIRST, pattern);
  digitalWrite(SEG_LATCH, HIGH);
}`,
  showDigit: `void showDigit(int digit) {
  const byte DIGITS[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
  if (digit < 0 || digit > 9) { showSegments(0); return; }
  showSegments(DIGITS[digit]);
}`,
};
