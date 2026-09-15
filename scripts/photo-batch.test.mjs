import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePhotoBatch,runPhotoBatch} from '../src/lib/photo-batch.ts';
const photo=(id,tags=['Before'])=>({id,tags,description:'Keep this description',revision:'prior-edit',trashRevision:'prior-trash',originalFilename:`${id}.jpg`});
test('tag addition preserves descriptions, existing tags and individual revisions',()=>{
 const input=photo('a'); const [entry]=preparePhotoBatch([input,input],'add-tags',[' Kitchen','Before','Kitchen ']);
 assert.deepEqual(entry.tags,['Before','Kitchen']);assert.equal(entry.item.description,input.description);
 assert.equal(entry.item.revision,'prior-edit');assert.equal(entry.item.trashRevision,'prior-trash');
 input.tags.push('Later');assert.deepEqual(entry.item.tags,['Before']);
});
test('tag removal affects only explicitly named tags',()=>{
 const [entry]=preparePhotoBatch([photo('a',['Kitchen','Before','After'])],'remove-tags',['Before']);
 assert.deepEqual(entry.tags,['Kitchen','After']);
 assert.throws(()=>preparePhotoBatch([photo('a',Array.from({length:30},(_,i)=>String(i)))],'add-tags',['one more']),/30 tags/);
 assert.throws(()=>preparePhotoBatch([photo('a')],'add-tags',[' ']),/at least one/);
});
test('partial and ambiguous failures retain identities and retry only unfinished records',async()=>{
 const batch=preparePhotoBatch([photo('a'),photo('b'),photo('c')],'trash',[]);
 const ids=batch.map(entry=>entry.revision);const calls=[];
 await runPhotoBatch(batch,async entry=>{calls.push(entry.item.id);if(entry.item.id==='b')throw Error('lost reply');return {ok:entry.item.id==='a',error:'Conflict'};},()=>{});
 assert.deepEqual(batch.map(entry=>entry.done),[true,false,false]);
 await runPhotoBatch(batch,async entry=>{calls.push(entry.item.id);return {ok:true};},()=>{});
 assert.deepEqual(calls,['a','b','c','b','c']);assert.deepEqual(batch.map(entry=>entry.revision),ids);
 assert.ok(batch.every(entry=>entry.done&&!entry.error));
});

test('tag names containing commas remain one tag',()=>{
 const [entry]=preparePhotoBatch([photo('a')],'add-tags',['Kitchen, main floor']);
 assert.deepEqual(entry.tags,['Before','Kitchen, main floor']);
 const [removed]=preparePhotoBatch([photo('a',entry.tags)],'remove-tags',['Kitchen, main floor']);
 assert.deepEqual(removed.tags,['Before']);
});
