// Explicit live QA runner. Only the named test fixture is writable. Credentials
// are read from a private local file and never included in output or reports.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const source='https://bwbckdkouqghdadpkjvn.supabase.co';
const worker='https://project-media-worker.jadslim-fai.workers.dev';
const project='5cce599f-9d30-49b9-b064-89dccaa17c25';
const credentials=JSON.parse(await readFile('/Users/jad/.codex/migration-reports/financial-separation/credentials.json','utf8'));
const key=credentials.source_key;
const report={startedAt:new Date().toISOString(),project,checks:[]};
let actor;
async function api(path,token=key,options={}) {
  return fetch(source+path,{...options,headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(30000)});
}
async function json(response,label) {
  if(!response.ok)throw new Error(`${label}: HTTP ${response.status}`);
  return response.json();
}
function checked(name){report.checks.push(name);console.log('PASS',name);}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try {
  const fixture=await json(await api(`/rest/v1/leads?id=eq.${project}&select=metadata`),'fixture lookup');
  assert.equal(fixture[0]?.metadata?.qa_fixture,'serviceflow_photo_qa_20260914');
  const email=`sf-photo-qa-${randomUUID()}@example.invalid`;
  const password=randomBytes(36).toString('base64url');
  const user=await json(await api('/auth/v1/admin/users',key,{method:'POST',body:JSON.stringify({email,password,email_confirm:true,user_metadata:{qa_fixture:'serviceflow_photo_qa_20260914'}})}),'create QA user');
  actor=user.id;report.actor=actor;
  const employee=await api('/rest/v1/employees',key,{method:'POST',body:JSON.stringify({id:actor,role:'manager',is_active:true,email,full_name:'Photo Workflow QA — TEST ONLY'})});
  assert.ok(employee.ok,'QA employee created');
  const session=await json(await api('/auth/v1/token?grant_type=password',key,{method:'POST',body:JSON.stringify({email,password})}),'QA sign-in');
  const token=session.access_token;
  const bytes=await readFile(new URL('../apps/mobile/assets/serviceflow-icon.png',import.meta.url));
  const mediaId=randomUUID();report.mediaId=mediaId;
  const upload=()=>fetch(`${worker}/v1/leads/${project}/media`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,
    'Content-Type':'image/png','x-media-type':'image','x-file-size':String(bytes.length),'x-upload-id':mediaId,'x-original-filename':'serviceflow-icon.png'},body:bytes,signal:AbortSignal.timeout(60000)});
  const responses=await Promise.all([upload(),upload()]);
  const rows=await Promise.all(responses.map(response=>json(response,'concurrent upload')));
  assert.ok(rows.every(row=>row.id===mediaId));checked('concurrent upload keeps one logical photo');
  const saved=await json(await api(`/rest/v1/job_media?id=eq.${mediaId}&select=id,object_key,source_metadata`),'row check');
  assert.equal(saved.length,1);report.objectKey=saved[0].object_key;
  assert.equal((await json(await upload(),'retry')).id,mediaId);checked('upload replay returns original ID');
  const mediaRequest=(suffix='',method='GET')=>fetch(`${worker}/v1/media/${mediaId}${suffix}`,{method,headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
  let original=await mediaRequest();assert.equal(original.status,200);
  assert.equal(hash(Buffer.from(await original.arrayBuffer())),hash(bytes));checked('download checksum matches uploaded original');
  assert.equal((await fetch(`${worker}/v1/media/${mediaId}`)).status,401);checked('anonymous original access denied');
  const preview=await mediaRequest('/thumbnail');report.previewStatus=preview.status;
  assert.equal(preview.status,200,'live preview generated');
  const previewBytes=Buffer.from(await preview.arrayBuffer());
  assert.equal(preview.headers.get('content-type'),'image/webp');
  assert.equal(previewBytes.toString('ascii',0,4),'RIFF');assert.equal(previewBytes.toString('ascii',8,12),'WEBP');
  assert.ok(previewBytes.length<bytes.length);report.originalBytes=bytes.length;report.previewBytes=previewBytes.length;
  checked('real image transformation produces smaller WebP');
  const secondPreview=await mediaRequest('/thumbnail');
  assert.equal(hash(Buffer.from(await secondPreview.arrayBuffer())),hash(previewBytes));checked('cached preview matches first preview');
  const editRevision=randomUUID();
  const details={requested_project_id:project,requested_media_id:mediaId,expected_revision:null,requested_revision:editRevision,requested_description:'QA only: live photo workflow verified.',requested_tags:['QA','Before']};
  const rpc=(name,body)=>api(`/rest/v1/rpc/${name}`,token,{method:'POST',body:JSON.stringify(body)});
  const edited=await json(await rpc('edit_photo_details',details),'edit details');assert.equal(edited.description,details.requested_description);
  assert.deepEqual(await json(await rpc('edit_photo_details',details),'edit retry'),edited);checked('description/tag edit and exact retry');
  const stale=await rpc('edit_photo_details',{...details,requested_revision:randomUUID(),requested_description:'stale'});
  assert.equal(stale.status,409);assert.equal((await stale.json()).code,'PT409');checked('stale edit rejected');
  const trashRevision=randomUUID();
  await json(await rpc('set_photo_trash',{requested_project_id:project,requested_media_id:mediaId,requested_trashed:true,expected_revision:null,requested_revision:trashRevision}),'trash');
  assert.equal((await mediaRequest()).status,404);assert.equal((await mediaRequest('/thumbnail')).status,404);checked('trash hides originals and cached previews');
  const retained=await mediaRequest('/trash');assert.equal(retained.status,200);
  assert.equal(hash(Buffer.from(await retained.arrayBuffer())),hash(bytes));checked('manager trash preview retains original bytes');
  await json(await rpc('set_photo_trash',{requested_project_id:project,requested_media_id:mediaId,requested_trashed:false,expected_revision:trashRevision,requested_revision:randomUUID()}),'restore');
  original=await mediaRequest();assert.equal(original.status,200);assert.equal(hash(Buffer.from(await original.arrayBuffer())),hash(bytes));checked('restore returns identical original');
  assert.equal((await mediaRequest('','DELETE')).status,204);checked('legacy mobile delete endpoint performs soft delete');
  const trashed=await json(await rpc('get_photo_trash',{requested_media_id:mediaId}),'trash lookup');
  await json(await rpc('set_photo_trash',{requested_project_id:project,requested_media_id:mediaId,requested_trashed:false,expected_revision:trashed[0].source_metadata.photo_trash_revision,requested_revision:randomUUID()}),'final restore');
  report.completed=true;
}catch(error){report.error=error.message;console.error('FAIL',error.message);process.exitCode=1;}
finally {
  if(actor){
    const inactive=await api(`/rest/v1/employees?id=eq.${actor}`,key,{method:'PATCH',body:JSON.stringify({is_active:false})});
    const banned=await api(`/auth/v1/admin/users/${actor}`,key,{method:'PUT',body:JSON.stringify({ban_duration:'876000h'})});
    report.testAccountDisabled=inactive.ok&&banned.ok;
    if(!report.testAccountDisabled){console.error('QA account cleanup needs attention');process.exitCode=1;}
  }
  report.finishedAt=new Date().toISOString();
  const directory='/Users/jad/.codex/migration-reports/photo-workflow';await mkdir(directory,{recursive:true,mode:0o700});
  await writeFile(`${directory}/live-${Date.now()}.json`,JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify(report));
}
