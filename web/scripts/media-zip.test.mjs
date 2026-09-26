import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { archiveFilename, mediaZipStream } from '../src/lib/media-zip.ts';

function file(name, bytes) {
 return {name,open:async()=>new ReadableStream({start(controller){
  controller.enqueue(bytes.subarray(0,2));controller.enqueue(bytes.subarray(2));controller.close();
 }})};
}
test('streamed archive preserves photo/video bytes and unique names', async()=>{
 const image = new Uint8Array([255,216,1,2,255,217]);
 const video = new Uint8Array([0,0,0,20,102,116,121,112]);
 const stream = mediaZipStream([file('a-photo.jpg',image),file('b-video.mp4',video)]);
 const files = unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()));
 assert.deepEqual(files['a-photo.jpg'],image);
 assert.deepEqual(files['b-video.mp4'],video);
});
test('archive names cannot escape their directory and repeated camera names remain unique',()=>{
 assert.equal(archiveFilename('../../IMG.jpg','12345678-abcd','jpg'),'12345678-abcd-_.._IMG.jpg');
 assert.notEqual(archiveFilename('IMG.jpg','12345678-abcd','jpg'),archiveFilename('IMG.jpg','87654321-abcd','jpg'));
});
test('upstream failures fail the download rather than silently producing a partial archive',async()=>{
 const stream = mediaZipStream([{name:'missing.jpg',open:async()=>{throw new Error('Unavailable');}}]);
 await assert.rejects(new Response(stream).arrayBuffer(),/Unavailable/);
});
test('cancelling a download aborts the active source and never opens the next one',async()=>{
 let signal, openedSecond=false;
 const stream=mediaZipStream([{name:'first',open:async value=>{signal=value;return new ReadableStream({pull(c){c.enqueue(new Uint8Array([1]));}});}},{name:'second',open:async()=>{openedSecond=true;throw Error();}}]);
 const reader=stream.getReader();await reader.read();await reader.cancel();
 assert.equal(signal.aborted,true);assert.equal(openedSecond,false);
});
