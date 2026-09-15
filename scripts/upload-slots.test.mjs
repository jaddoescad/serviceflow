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
