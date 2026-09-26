import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadFailure,uploadRetryAt} from '../src/lib/upload-retry.ts';
import {retryUploadItem} from '../src/lib/media-upload-queue.ts';
test('network and temporary server failures retry with bounded backoff',()=>{
 for(const status of [0,408,429,500,502,503]) {
  const error=uploadFailure('temporary',status);
  assert.equal(uploadRetryAt(error,1,100),1100);
  assert.equal(uploadRetryAt(error,2,100),3100);
  assert.equal(uploadRetryAt(error,3,100),8100);
  assert.equal(uploadRetryAt(error,4,100),null);
 }
});
test('permission, validation, identity conflicts and cancellation never retry automatically',()=>{
 for(const status of [400,401,403,404,409,413,415,422])assert.equal(uploadRetryAt(uploadFailure('permanent',status),1,0),null);
 assert.equal(uploadRetryAt(new DOMException('cancel','AbortError'),1,0),null);
 assert.equal(uploadRetryAt(new Error('storage unavailable'),1,0),null);
});
test('rate limits honor seconds and dates, cap excessive delays, ignore invalid values',()=>{
 assert.equal(uploadRetryAt(uploadFailure('rate limit',429,'20',0),1,0),20000);
 assert.equal(uploadRetryAt(uploadFailure('rate limit',429,'Thu, 01 Jan 1970 00:00:30 GMT',0),1,0),30000);
 assert.equal(uploadRetryAt(uploadFailure('rate limit',429,'999999',0),1,0),300000);
 assert.equal(uploadRetryAt(uploadFailure('rate limit',429,'invalid',0),1,0),1000);
});
test('manual retry resets the retry budget while retaining file and request ID',()=>{
 const item={id:'same-id',file:new File(['x'],'test.jpg',{type:'image/jpeg'}),status:'failed',progress:0,attempts:4,retryAt:999};
 const retry=retryUploadItem(item);assert.equal(retry.id,item.id);assert.equal(retry.file,item.file);
 assert.equal(retry.attempts,0);assert.equal(retry.retryAt,undefined);assert.equal(retry.status,'queued');
});
