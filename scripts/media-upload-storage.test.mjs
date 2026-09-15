import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeUploads, loadUploads, forgetUploads, listUploadScopes } from '../src/lib/media-upload-storage.ts';

function photo(id, status='queued') {
  return { id, file:new File(['fixture bytes'],'cuisine été.jpg',{type:'image/jpeg',lastModified:12345}),status,progress:63 };
}

test('recovery retains bytes, filename, date and stable ID after an interrupted upload', async()=>{
  await storeUploads('user-a/project-a',[photo('upload-1','uploading')]);
  const [restored]=await loadUploads('user-a/project-a');
  assert.equal(restored.id,'upload-1');
  assert.equal(restored.status,'queued');
  assert.equal(restored.progress,0);
  assert.equal(restored.file.name,'cuisine été.jpg');
  assert.equal(restored.file.lastModified,12345);
  assert.equal(await restored.file.text(),'fixture bytes');
});

test('another account or project cannot load a queue through its scope',async()=>{
  assert.deepEqual(await loadUploads('user-b/project-a'),[]);
  assert.deepEqual(await loadUploads('user-a/project-b'),[]);
});

test('failed and cancelled uploads remain paused when reopening the page',async()=>{
  await storeUploads('user-a/paused',[photo('failed','failed'),photo('cancelled','cancelled')]);
  assert.deepEqual((await loadUploads('user-a/paused')).map(item=>item.status).sort(),['cancelled','failed']);
});

test('updating a queued item replaces its state without duplicating its file',async()=>{
  await storeUploads('user-a/retry',[photo('same','failed')]);
  await storeUploads('user-a/retry',[photo('same','queued')]);
  const saved=await loadUploads('user-a/retry');
  assert.equal(saved.length,1); assert.equal(saved[0].status,'queued');
});

test('completed-file cleanup removes only the requested account/project item',async()=>{
  await storeUploads('user-a/cleanup',[photo('one'),photo('two')]);
  await storeUploads('user-b/cleanup',[photo('one')]);
  await forgetUploads('user-a/cleanup',['one']);
  assert.deepEqual((await loadUploads('user-a/cleanup')).map(item=>item.id),['two']);
  assert.equal((await loadUploads('user-b/cleanup')).length,1);
});


test('global recovery discovers only the signed-in account scopes without duplicate projects',async()=>{
 await storeUploads('recover-user/jobs/one',[photo('a'),photo('b')]);
 await storeUploads('recover-user/leads/two',[photo('c','cancelled')]);
 await storeUploads('recover-user-other/jobs/secret',[photo('d')]);
 assert.deepEqual(await listUploadScopes('recover-user'),['recover-user/jobs/one','recover-user/leads/two']);
 assert.deepEqual(await listUploadScopes('no-such-user'),[]);
 await forgetUploads('recover-user/jobs/one',['a','b']);
 assert.deepEqual(await listUploadScopes('recover-user'),['recover-user/leads/two']);
});


test('recovery retains retry budget and backoff so reopening does not reset failed attempts',async()=>{
 await storeUploads('retry-owner/jobs/one',[{...photo('retrying'),attempts:3,retryAt:123456789}]);
 const [saved]=await loadUploads('retry-owner/jobs/one');
 assert.equal(saved.attempts,3);assert.equal(saved.retryAt,123456789);assert.equal(saved.id,'retrying');
});


test('late writes cannot resurrect completed or cleared recovery files',async()=>{
 const scope='racing-user/jobs/one';
 await storeUploads(scope,[photo('finished','uploading')]);
 await forgetUploads(scope,['finished']);
 await storeUploads(scope,[photo('finished','failed')]);
 assert.deepEqual(await loadUploads(scope),[]);
 assert.deepEqual(await listUploadScopes('racing-user'),[]);
});

test('retirement wins in either concurrent transaction order',async()=>{
 for(const reverse of [false,true]) {
  const scope=`concurrent-${reverse}/jobs/one`;
  await storeUploads(scope,[photo('same','uploading')]);
  const write=()=>storeUploads(scope,[photo('same','failed')]);
  const retire=()=>forgetUploads(scope,['same']);
  await Promise.all(reverse?[retire(),write()]:[write(),retire()]);
  assert.deepEqual(await loadUploads(scope),[]);
 }
});

test('retired IDs do not prevent a fresh upload or affect another project',async()=>{
 await forgetUploads('retired-owner/jobs/one',['old']);
 await storeUploads('retired-owner/jobs/one',[photo('old'),photo('new')]);
 await storeUploads('retired-owner/jobs/two',[photo('old')]);
 assert.deepEqual((await loadUploads('retired-owner/jobs/one')).map(item=>item.id),['new']);
 assert.deepEqual((await loadUploads('retired-owner/jobs/two')).map(item=>item.id),['old']);
});

test('retirement removes the saved file bytes and metadata',async()=>{
 const scope='cleanup-bytes/jobs/one';
 await storeUploads(scope,[photo('done')]);
 await forgetUploads(scope,['done']);
 const db=await new Promise((resolve,reject)=>{
  const request=indexedDB.open('serviceflow-photo-uploads',1);
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 try {
  const record=await new Promise((resolve,reject)=>{
   const request=db.transaction('files','readonly').objectStore('files').get(`${scope}/done`);
   request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  assert.deepEqual(record,{key:`${scope}/done`,retired:true});
 } finally {db.close();}
});
