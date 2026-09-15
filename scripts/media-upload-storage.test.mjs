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
