import assert from 'node:assert/strict';
import test from 'node:test';
import {appendUploadFiles,retryUploadItem,validateMediaFile} from '../src/lib/media-upload-queue.ts';
const file=(name,bytes=4,type='image/jpeg')=>new File([new Uint8Array(bytes)],name,{type,lastModified:100});
test('invalid file does not prevent valid files entering queue',()=>{
 const q=appendUploadFiles([],[file('ok.jpg'),file('bad.exe',4,'application/octet-stream')]);
 assert.deepEqual(q.map(x=>x.status),['queued','failed']);
});
test('duplicates in one batch and subsequent selection are skipped',()=>{
 const f=file('one.jpg');const q=appendUploadFiles([],[f,f]);
 assert.equal(q.length,1); assert.equal(appendUploadFiles(q,[f]).length,1);
});
test('retry keeps original upload identity and does not retry successes',()=>{
 const [i]=appendUploadFiles([],[file('one.jpg')]);
 const retry=retryUploadItem({...i,status:'failed',error:'network'});
 assert.equal(retry.id,i.id); assert.equal(retry.status,'queued');assert.equal(retry.error,undefined);
 const success={...i,status:'complete',progress:100};assert.equal(retryUploadItem(success),success);
});
test('invalid files cannot be retried without replacement',()=>{
 const [i]=appendUploadFiles([],[file('empty.jpg',0)]);assert.equal(retryUploadItem(i).status,'failed');
 assert.match(validateMediaFile({name:'huge.jpg',type:'image/jpeg',size:26*1024*1024}),/25 MB/);
});
