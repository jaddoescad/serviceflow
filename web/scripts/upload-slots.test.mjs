import test from 'node:test';
import assert from 'node:assert/strict';
import {createUploadSlots} from '../src/lib/upload-slots.ts';
test('projects share a two-transfer limit, release once and admit queued transfers fairly',async()=>{
 const slots=createUploadSlots(2);const releaseA=await slots.acquire();const releaseB=await slots.acquire();
 const admitted=[];
 const waitingC=slots.acquire().then(release=>{admitted.push('C');return release;});
 const waitingD=slots.acquire().then(release=>{admitted.push('D');return release;});
 await Promise.resolve();assert.deepEqual(admitted,[]);
 releaseA();const releaseC=await waitingC;assert.deepEqual(admitted,['C']);
 releaseA();await Promise.resolve();assert.deepEqual(admitted,['C']);
 releaseB();const releaseD=await waitingD;assert.deepEqual(admitted,['C','D']);
 releaseC();releaseD();
 const releaseE=await slots.acquire();releaseE();
});

test('cancelling a waiting upload rejects promptly without consuming a transfer slot',async()=>{
 const slots=createUploadSlots(1);const release=await slots.acquire();
 const controller=new AbortController();
 const cancelled=slots.acquire(controller.signal);
 const rejection=assert.rejects(cancelled,{name:'AbortError'});
 const next=slots.acquire();
 controller.abort();await rejection;
 release();const releaseNext=await next;releaseNext();
});

test('an already cancelled upload never enters the queue',async()=>{
 const slots=createUploadSlots(1);const controller=new AbortController();controller.abort();
 await assert.rejects(slots.acquire(controller.signal),{name:'AbortError'});
 const release=await slots.acquire();release();
});

test('aborting after admission does not release another active transfer',async()=>{
 const slots=createUploadSlots(1);const controller=new AbortController();
 const release=await slots.acquire(controller.signal);let admitted=false;
 const next=slots.acquire().then(done=>{admitted=true;return done;});
 controller.abort();await Promise.resolve();assert.equal(admitted,false);
 release();const done=await next;done();
});
