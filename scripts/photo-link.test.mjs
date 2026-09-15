import test from 'node:test';
import assert from 'node:assert/strict';
import {photoIdFromHash,photoLink,validPhotoId} from '../src/lib/photo-link.ts';
const id='a37b4ca2-76af-447b-85eb-b56096286743';
test('photo links round-trip an original UUID and preserve the project query string',()=>{
 const link=photoLink('/jobs/project','?section=photos',id);
 assert.equal(link,`/jobs/project?section=photos#photo=${id}`);
 assert.equal(photoIdFromHash(new URL(link,'https://serviceflow.example').hash),id);
 assert.equal(photoLink('/jobs/project','?section=photos',null),'/jobs/project?section=photos');
});
test('malformed links cannot become database filters',()=>{
 for(const value of ['', 'not-a-uuid', `${id},job_id.neq.x`, '<script>']) {
  assert.equal(validPhotoId(value),false);assert.equal(photoIdFromHash(`#photo=${encodeURIComponent(value)}`),null);
 }
 assert.equal(photoIdFromHash('#description'),null);
});
