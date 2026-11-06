import test from 'node:test';
import assert from 'node:assert/strict';
import { photoDay } from '../src/lib/media-format.ts';

test('photo days count Ottawa calendar days from the first photo', () => {
  const first = '2026-10-28T03:30:00Z'; // Oct 27, 11:30 p.m. in Ottawa
  assert.equal(photoDay(first, first), 1);
  assert.equal(photoDay('2026-10-28T14:00:00Z', first), 2);
  assert.equal(photoDay('2026-11-06T14:00:00Z', first), 11, 'across the clock change');
  assert.equal(photoDay('2027-01-02T15:00:00+00:00', '2026-12-31T15:00:00+00:00'), 3, 'across the new year');
});
