import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleMediaSelection } from '../src/lib/media-selection.ts';
test('shift selection spans the visible range in either direction and can deselect it', () => {
  const ids=['a','b','c','d','e'];
  assert.deepEqual([...toggleMediaSelection(new Set(['b']),ids,'e','b',true)],['b','c','d','e']);
  assert.deepEqual([...toggleMediaSelection(new Set(['e']),ids,'b','e',true)],['e','b','c','d']);
  assert.deepEqual([...toggleMediaSelection(new Set(ids),ids,'b','e',true)],['a']);
});
test('cleared or filtered-out anchors do not select an unintended range', () => {
  assert.deepEqual([...toggleMediaSelection(new Set(),['a','b','c'],'c','a',true)],['c']);
  assert.deepEqual([...toggleMediaSelection(new Set(['a']),['b','c'],'c','a',true)],['a','c']);
});
test('selection remains bounded and does not mutate previous state', () => {
  const ids=Array.from({length:600},(_,i)=>String(i));
  const initial=new Set(['0']);
  const result=toggleMediaSelection(initial,ids,'599','0',true);
  assert.equal(result.size,500);
  assert.deepEqual([...initial],['0']);
});
