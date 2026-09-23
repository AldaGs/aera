/**
 * Pure keypad-entry logic for the step-value editor (2b). No React, no DOM —
 * the editor keeps a raw digit-entry `buffer` string and calls these to turn
 * key presses into a value and to render the buffer back to text.
 */

/** Push a digit (or '.' when `decimal`) onto the buffer, capped at `maxDigits` digits. */
export function pushKey(
  buffer: string,
  key: string,
  opts: { decimal?: boolean; maxDigits?: number } = {},
): string {
  if (key === '.') {
    if (!opts.decimal || buffer.includes('.')) return buffer;
    return buffer + '.';
  }
  if (!/^[0-9]$/.test(key)) return buffer;
  const digitCount = buffer.replace('.', '').length;
  if (digitCount >= (opts.maxDigits ?? 4)) return buffer;
  return buffer + key;
}

export function backspace(buffer: string): string {
  return buffer.slice(0, -1);
}

/** "Microwave" mm:ss from a raw digit buffer: the last 2 digits are seconds,
 * whatever remains is minutes. Empty buffer -> 0. */
export function timeBufferToSec(buffer: string): number {
  const digits = buffer.replace(/\D/g, '').slice(-4);
  if (!digits) return 0;
  const secDigits = digits.slice(-2);
  const minDigits = digits.slice(0, -2) || '0';
  return parseInt(minDigits, 10) * 60 + Math.min(parseInt(secDigits, 10), 59);
}

export function fmtTimeBuffer(buffer: string): string {
  const sec = timeBufferToSec(buffer);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Seconds -> the digit buffer that reproduces them via `timeBufferToSec` (for editing an existing value). */
export function secToBuffer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}${String(s).padStart(2, '0')}`;
}

/** Distance buffer -> meters. 'km' unit: decimal buffer is km. 'm' unit: integer buffer is meters. */
export function distanceBufferToMeters(buffer: string, unit: 'km' | 'm'): number {
  const v = parseFloat(buffer) || 0;
  return unit === 'km' ? Math.round(v * 1000) : Math.round(v);
}

/** Meters -> the digit buffer that reproduces them via `distanceBufferToMeters` for the given unit. */
export function metersToBuffer(m: number, unit: 'km' | 'm'): string {
  return unit === 'km' ? String(m / 1000) : String(Math.round(m));
}
