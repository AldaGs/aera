/**
 * Self-check for the pure keypad logic in src/ui/keypad.ts.
 * Run with `npx tsx scripts/check-keypad.ts`.
 */
import {
  pushKey,
  backspace,
  timeBufferToSec,
  fmtTimeBuffer,
  secToBuffer,
  distanceBufferToMeters,
  metersToBuffer,
} from '../src/ui/keypad';

let failed = false;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed = true;
  } else {
    console.log('ok:', msg);
  }
}

// time microwave entry: 1, 3, 0 -> "130" -> 1:30
let buf = '';
buf = pushKey(buf, '1');
buf = pushKey(buf, '3');
buf = pushKey(buf, '0');
assert(timeBufferToSec(buf) === 90, `microwave 1,3,0 -> 90s (got ${timeBufferToSec(buf)})`);
assert(fmtTimeBuffer(buf) === '1:30', `fmt "130" -> 1:30 (got ${fmtTimeBuffer(buf)})`);

// leading zeros: 0,0,5 -> "005" -> 0:05
buf = pushKey(pushKey(pushKey('', '0'), '0'), '5');
assert(timeBufferToSec(buf) === 5, `microwave leading zeros 0,0,5 -> 5s (got ${timeBufferToSec(buf)})`);

// backspace
buf = '130';
buf = backspace(buf);
assert(buf === '13', `backspace "130" -> "13" (got "${buf}")`);
assert(timeBufferToSec(buf) === 13, `"13" -> 13s (got ${timeBufferToSec(buf)})`);

// secToBuffer round-trips
assert(timeBufferToSec(secToBuffer(300)) === 300, 'secToBuffer(300) round-trips');
assert(timeBufferToSec(secToBuffer(65)) === 65, 'secToBuffer(65) round-trips');

// distance km decimal
buf = pushKey(pushKey(pushKey('', '1', { decimal: true }), '.', { decimal: true }), '5', { decimal: true });
assert(buf === '1.5', `km decimal buffer "1.5" (got "${buf}")`);
assert(distanceBufferToMeters(buf, 'km') === 1500, `1.5 km -> 1500 m (got ${distanceBufferToMeters(buf, 'km')})`);
// only one decimal point allowed
buf = pushKey(buf, '.', { decimal: true });
assert(buf === '1.5', 'second "." is ignored');

// distance m integer: '.' pressed without decimal mode is ignored
buf = pushKey(pushKey(pushKey('', '4'), '.'), '00'[0]);
buf = pushKey(buf, '0');
assert(buf === '400', `m-mode buffer ignores "." (got "${buf}")`);
assert(distanceBufferToMeters(buf, 'm') === 400, `"400" m -> 400 m (got ${distanceBufferToMeters(buf, 'm')})`);

// leading zeros in distance
assert(distanceBufferToMeters('005', 'm') === 5, 'distance leading zeros "005" -> 5 m');

// metersToBuffer round-trips
assert(distanceBufferToMeters(metersToBuffer(1500, 'km'), 'km') === 1500, 'metersToBuffer km round-trips');
assert(distanceBufferToMeters(metersToBuffer(400, 'm'), 'm') === 400, 'metersToBuffer m round-trips');

// maxDigits cap (time buffer caps at 4)
buf = '';
for (const d of ['1', '2', '3', '4', '5']) buf = pushKey(buf, d);
assert(buf === '1234', `maxDigits caps buffer at 4 (got "${buf}")`);

if (failed) {
  console.error('\nkeypad checks FAILED');
  process.exitCode = 1;
} else {
  console.log('\nall keypad checks passed');
}
