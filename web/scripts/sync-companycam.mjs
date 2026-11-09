#!/usr/bin/env node
// Node 22+. Run from web/. Read-only unless --apply is passed.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { ORG, sourceUuid, projectMap, sourceUrl, photoUrl, renderPage, leadMatchesProject } from './companycam-import-lib.mjs';

const REF = 'bwbckdkouqghdadpkjvn';
const BASE = `https://${REF}.supabase.co`;
const ACCOUNT = 'db8c567871fd5f7697613b1313acdfbd';
const BUCKET = 'ottawa-painters-project-media';
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const option = name => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const limit = Number(option('--max-items') ?? Infinity);
const concurrency = Math.max(1,Math.min(12,Number(option('--concurrency') ?? 2)));
const reportPath = option('--report') ?? '/tmp/serviceflow-companycam-import-report.json';
const projectFilter = option('--project-id');
const targetLeadId = option('--target-lead-id');
const expectedTargetId = option('--expect-target-id');
if (targetLeadId && !projectFilter) throw new Error('--target-lead-id requires --project-id');
const report = { startedAt: new Date().toISOString(), apply, documents: [], photos: [], unmatched: [], errors: [] };
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? JSON.parse(execFileSync('supabase', ['projects','api-keys','--project-ref',REF,'--output','json'], {encoding:'utf8',stdio:['ignore','pipe','pipe']})).find(k => k.name === 'service_role').api_key;
const dbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type':'application/json' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    let response;
    try { response = await fetch(url, {...init, signal: AbortSignal.timeout(120_000)}); }
    catch (error) { if (attempt >= 3) throw error; await sleep(1000 * 2 ** attempt); continue; }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await response.body?.cancel(); await sleep(1000 * 2 ** attempt); continue;
    }
    if (!response.ok) throw new Error(`${new URL(url).hostname}: HTTP ${response.status}: ${(await response.text()).slice(0,250)}`);
    return response;
  }
}
async function db(table, query, init = {}) {
  const response = await request(`${BASE}/rest/v1/${table}?${query}`, { ...init, headers: {...dbHeaders,...init.headers} });
  return response.status === 204 ? null : response.json();
}
async function allRows(table, query) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const batch = await db(table, `${query}&limit=1000&offset=${offset}`); rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}
async function source(kind, extra = {}) {
  return (await request(`${BASE}/functions/v1/import-companycam-documents`, {
    method:'POST', headers:dbHeaders, body:JSON.stringify({kind,...extra}),
  })).json();
}
async function* sourceBatches(kind) {
  if (kind === 'photos' && projectFilter) {
    for (let page = 1; ; page++) {
      const data = await (await request(`${BASE}/functions/v1/import-companycam-videos`, {
        method:'POST', headers:dbHeaders, body:JSON.stringify({kind:'photos', projectId:projectFilter, page}),
      })).json();
      if (!Array.isArray(data.photos)) throw new Error('Invalid project photo response');
      yield data.photos;
      if (data.photos.length < 100) return;
      await sleep(400);
    }
  }
  let after;
  const seen = new Set();
  while (true) {
    const data = (await source(kind,{after}))[kind];
    yield data.data;
    if (!data.meta.has_next) return;
    if (!data.meta.next_cursor || seen.has(data.meta.next_cursor)) throw new Error('CompanyCam pagination did not advance');
    after = data.meta.next_cursor; seen.add(after);
    // Keep sustained reads below CompanyCam's per-minute limit.
    await sleep(400);
  }
}
const norm = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
const jobs = await allRows('jobs',`org_id=eq.${ORG}&select=id,lead_id,name,companycam_project_ids,address_line_1,formatted_address,postal_code,contacts(name,email,phone)`);
const linked = projectMap(jobs);
const leads = await allRows('leads',`org_id=eq.${ORG}&select=id,address,postal_code,created_at,metadata,contacts(name,email,phone)`);
for (const lead of leads) {
  const related = jobs.filter(job => job.lead_id === lead.id);
  const target = related.length === 1 ? related[0] : related.length ? null : {...lead,kind:'lead'};
  const ids = [...(lead.metadata?.companycam_project_ids ?? []),lead.metadata?.companycam_project_id].filter(id => /^\d+$/.test(String(id)));
  for (const id of ids) if (!linked.has(String(id))) linked.set(String(id),target);
}
const projects = new Map();
const projectLookups = new Map();
if (targetLeadId) {
  const lead = leads.find(row => row.id === targetLeadId);
  const relatedJobs = jobs.filter(job => job.lead_id === targetLeadId);
  if (!lead || relatedJobs.length > 1) throw new Error('Target lead is missing or has multiple jobs');
  const project = (await source('projects',{projectId:projectFilter})).projects.data;
  if (!leadMatchesProject(lead,project)) throw new Error('Lead identity and creation time do not match source project');
  if (leads.filter(candidate => leadMatchesProject(candidate,project)).length !== 1) throw new Error('Lead identity is ambiguous');
  const target = relatedJobs[0] ?? {...lead,kind:'lead'};
  if (expectedTargetId && target.id !== expectedTargetId) throw new Error('Lead destination changed since inventory');
  linked.set(projectFilter,target);
}
let currentDocuments = [];
let templates = [];
const seenStartProjects = new Set();
async function resolveProject(id) {
  id = String(id);
  let target;
  if (linked.has(id)) target = linked.get(id);
  else {
    if (!projectLookups.has(id)) projectLookups.set(id,matchProject(id));
    target = await projectLookups.get(id);
  }
  if (expectedTargetId && id === projectFilter && target?.id !== expectedTargetId) throw new Error('Project destination changed since inventory');
  return target;
}
async function matchProject(id) {
  const project = (await source('projects',{projectId:id})).projects.data;
  projects.set(id,project);
  const street = norm(project.address?.street_address_1);
  const postal = norm(project.address?.postal_code);
  const contact = project.primary_contact ?? {};
  const candidates = jobs.filter(job => {
    const address = norm(job.address_line_1 || job.formatted_address);
    const sameStreet = street.length >= 6 && (address === street || address.startsWith(street));
    const sameIdentity = (norm(project.name) && norm(job.name) === norm(project.name)) || (norm(contact.name) && norm(job.contacts?.name) === norm(contact.name)) ||
      (contact.email && job.contacts?.email?.toLowerCase() === contact.email.toLowerCase());
    const samePostal = postal && (norm(job.postal_code) === postal || address.includes(postal));
    return sameStreet && sameIdentity && samePostal;
  });
  const job = candidates.length === 1 ? candidates[0] : null;
  linked.set(id,job);
  if (!job) report.unmatched.push({sourceProjectId:id,name:project.name,reason:candidates.length > 1 ? 'ambiguous' : 'no verified job match'});
  return job;
}
if (projectFilter && expectedTargetId) await resolveProject(projectFilter);
async function imageBytes(url) {
  // Validate every redirect; never forward credentials to image hosts.
  for (let count=0; count<5; count++) {
    sourceUrl(url);
    const response = await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(90_000)});
    if ([301,302,303,307,308].includes(response.status)) {
      url = new URL(response.headers.get('location'),url).href; await response.body?.cancel(); continue;
    }
    if (!response.ok) throw new Error(`CompanyCam image download HTTP ${response.status}`);
    const type = (response.headers.get('content-type') ?? '').split(';')[0];
    if (!['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(type)) throw new Error(`Unsupported photo type ${type}`);
    if (Number(response.headers.get('content-length')) > 50 * 1024 ** 2) throw new Error('Image exceeds 50 MB');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 50 * 1024 ** 2) throw new Error('Invalid image size');
    return {bytes,type};
  }
  throw new Error('Too many CompanyCam image redirects');
}
async function insert(table, row) {
  return db(table,'on_conflict=id', { method:'POST', headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(row) });
}
async function importPage(page, existing) {
  const job = await resolveProject(page.project_id);
  if (!job) return;
  const id = sourceUuid('page',page.id);
  const isStart = /Household Information/.test(page.raw_content ?? '') && /Parking.*Access/.test(page.raw_content ?? '');
  const prior = existing.get(String(page.id));
  if (prior) {
    if (isStart) seenStartProjects.add(job.id);
    report.documents.push({sourceId:page.id,id:prior.id,projectId:job.id,status:'exists'}); return;
  }
  if (isStart && seenStartProjects.has(job.id)) {
    report.documents.push({sourceId:page.id,projectId:job.id,status:'skipped',reason:'older job-start page'}); return;
  }
  const blank = isStart ? currentDocuments.find(document => document.project_id === job.id &&
    templates.some(template => template.body_html === document.body_html)) : null;
  // A filled local page requires review before replacing; never create a second
  // job-start template beside it.
  if (isStart && !blank && currentDocuments.some(document => document.project_id === job.id && document.name.toLowerCase() === 'job start template')) {
    report.documents.push({sourceId:page.id,projectId:job.id,status:'skipped',reason:'existing filled job-start page needs review'}); return;
  }
  const targetId = blank?.id ?? id;
  const result = await renderPage(page, async url => {
    const imageId = sourceUuid('page-image',`${page.id}:${url}`);
    const path = `${job.id}/pages/${targetId}/${imageId}`;
    if (apply) {
      const {bytes,type} = await imageBytes(url);
      await request(`${BASE}/storage/v1/object/project-documents/${path}`, {
        method:'POST',headers:{...dbHeaders,'Content-Type':type,'x-upsert':'true'},body:bytes,
      });
    }
    return `/api/jobs/${job.id}/documents/${targetId}/images/${imageId}`;
  });
  const row = {
    id:targetId,org_id:ORG,project_id:job.id,name:isStart ? 'Job Start Template' : (page.title || 'Document').slice(0,200),kind:'page',body_html:result.html,
    mime_type:'text/html',byte_size:Buffer.byteLength(result.html),created_by:null,updated_by:null,
    source_provider:'companycam',source_id:String(page.id),
  };
  if (apply && blank) {
    const updated = await db('project_documents',`id=eq.${targetId}&updated_at=eq.${encodeURIComponent(blank.updated_at)}`,{
      method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(row),
    });
    if (updated.length !== 1) throw new Error('Job-start template changed during import; review required');
  } else if (apply) await insert('project_documents',row);
  if (isStart) seenStartProjects.add(job.id);
  report.documents.push({sourceId:page.id,id:targetId,projectId:job.id,status:apply?'imported':'planned',images:result.images});
}
let cloudflareToken;
async function r2Ready() {
  cloudflareToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!cloudflareToken) {
    let config = await readFile(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`,'utf8');
    const expires = Date.parse(config.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1] ?? '');
    if (Number.isFinite(expires) && expires - Date.now() < 5 * 60_000) {
      execFileSync('../cloudflare/project-media-worker/node_modules/.bin/wrangler',['whoami'],{stdio:['ignore','ignore','pipe'],timeout:60000});
      config = await readFile(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`,'utf8');
    }
    cloudflareToken = config.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
  }
  if (!cloudflareToken) throw new Error('Log into Wrangler or set CLOUDFLARE_API_TOKEN');
  await request(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}`,{headers:{Authorization:`Bearer ${cloudflareToken}`}});
}
async function importPhoto(photo, existing) {
  if (existing.has(String(photo.id))) return;
  const job = await resolveProject(photo.project_id);
  if (!job) return;
  if (photo.status !== 'active' || photo.internal || !['processed','duplicate'].includes(photo.processing_status)) {
    report.photos.push({sourceId:photo.id,status:'skipped',reason:'inactive, private or unprocessed'}); return;
  }
  const id = sourceUuid('photo',photo.id);
  if (!apply) { report.photos.push({sourceId:photo.id,id,projectId:job.id,status:'planned'}); return; }
  const {bytes,type} = await imageBytes(photoUrl(photo));
  const ext = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'}[type];
  const objectKey = `${job.kind === 'lead' ? 'leads' : 'jobs'}/${job.id}/${id}.${ext}`;
  await request(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/objects/${objectKey}`,{
    method:'PUT',headers:{Authorization:`Bearer ${cloudflareToken}`,'Content-Type':type},body:bytes,
  });
  const row = {
    id,org_id:ORG,[job.kind === 'lead' ? 'lead_id' : 'job_id']:job.id,object_key:objectKey,media_type:'image',mime_type:type,
    original_filename:`companycam-${photo.id}.${ext}`,byte_size:bytes.length,captured_at:typeof (photo.captured_at || photo.created_at) === 'number' ? new Date((photo.captured_at || photo.created_at) * 1000).toISOString() : (photo.captured_at || photo.created_at),
    uploaded_by:null,source_provider:'companycam',source_id:String(photo.id),source_project_id:String(photo.project_id),
    source_metadata:{creator_id:photo.creator_id,creator_name:photo.creator_name,description:photo.description,hash:photo.hash,photo_url:photo.photo_url,processing_status:photo.processing_status,import_sha256:createHash('sha256').update(bytes).digest('hex')},
  };
  await insert('job_media',row); existing.add(String(photo.id));
  report.photos.push({sourceId:photo.id,id,projectId:job.id,status:'imported',bytes:bytes.length});
}
async function checkpoint() {
  await writeFile(reportPath,JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2),{mode:0o600});
}
try {
  if (!args.includes('--photos-only')) {
    currentDocuments = await allRows('project_documents',`org_id=eq.${ORG}&select=id,project_id,name,body_html,source_id,updated_at`);
    templates = await allRows('project_document_templates',`org_id=eq.${ORG}&select=body_html`);
    const existing = new Map(currentDocuments.filter(row=>row.source_id).map(row=>[row.source_id,row]));
    const snapshot = option('--snapshot');
    const batches = snapshot ? [(JSON.parse(await readFile(snapshot,'utf8'))).pages] : sourceBatches('pages');
    for await (const batch of batches) {
      for (const page of batch) {
        if (projectFilter && String(page.project_id) !== projectFilter) continue;
        if (report.documents.filter(row=>row.status!=='exists').length >= limit) break;
        try { await importPage(page,existing); if (report.documents.length % 25 === 0) { await checkpoint(); console.log(`Documents processed: ${report.documents.length}`); } } catch (error) { report.errors.push({kind:'page',sourceId:page.id,error:error.message}); }
      }
      await checkpoint(); console.log(`Documents processed: ${report.documents.length}; unmatched projects: ${report.unmatched.length}; errors: ${report.errors.length}`);
    }
  }
  if (!args.includes('--documents-only')) {
    if (apply) await r2Ready();
    const existing = new Set((await allRows('job_media',`org_id=eq.${ORG}&source_provider=eq.companycam&select=source_id`)).map(row=>row.source_id));
    outer: for await (const batch of sourceBatches('photos')) {
      if (report.photos.length >= limit) break;
      const selected = projectFilter ? batch.filter(photo => String(photo.project_id) === projectFilter) : batch;
      // Keep API traffic bounded and checkpoint after every 50 photos.
      for (let offset=0;offset<selected.length;offset+=concurrency) {
        if (report.photos.length>=limit) break outer;
        await Promise.all(selected.slice(offset,offset+Math.min(concurrency,limit-report.photos.length)).map(async photo=>{
          try { await importPhoto(photo,existing); } catch(error) { report.errors.push({kind:'photo',sourceId:photo.id,error:error.message}); }
        }));
        if (apply) await sleep(600);
      }
      await checkpoint(); console.log(`New photos processed: ${report.photos.length}; unmatched projects: ${report.unmatched.length}; errors: ${report.errors.length}`);
    }
  }
} catch(error) { report.errors.push({kind:'run',error:error.message}); }
await checkpoint();
console.log(JSON.stringify({apply,documents:report.documents.length,photos:report.photos.length,unmatched:report.unmatched.length,errors:report.errors.length,report:reportPath}));
if(report.errors.length) process.exitCode=1;
