import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import worker from "../src/index.js";

const JOB_ID = "11111111-2222-4333-8444-555555555555";
const LEAD_ID = "66666666-7777-4888-8999-000000000000";
const USER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BASE = "https://media.example.com";

function fakeJwt(sub = USER_ID) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ sub })}.signature`;
}

class FakeBucket {
  multipart = new Map();

  constructor() {
    this.objects = new Map();
  }

  async put(key, body, options = {}) {
    const bytes = body ? new Uint8Array(await new Response(body).arrayBuffer()) : new Uint8Array();
    this.objects.set(key, { bytes, options });
    return { key, size: bytes.length, httpEtag: `"etag-${key}"` };
  }

  async head(key) {
    const stored = this.objects.get(key);
    return stored ? { size: stored.bytes.length, httpEtag: `"etag-${key}"` } : null;
  }

  async get(key, options = {}) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const range = options.range;
    const bytes = range
      ? stored.bytes.slice(range.offset, range.offset + range.length)
      : stored.bytes;
    return { body: bytes, size: stored.bytes.length, httpEtag: `"etag-${key}"` };
  }

  async delete(key) {
    this.objects.delete(key);
  }

  async createMultipartUpload(key, options = {}) {
    const uploadId = `upload+id/${this.multipart.size + 1}`;
    this.multipart.set(uploadId, { key, options, parts: new Map() });
    return { uploadId, key };
  }

  resumeMultipartUpload(key, uploadId) {
    const bucket = this;
    return {
      async uploadPart(partNumber, body) {
        const record = bucket.multipart.get(uploadId);
        if (!record || record.key !== key) throw new Error("unknown upload");
        const bytes = new Uint8Array(await new Response(body).arrayBuffer());
        record.parts.set(partNumber, bytes);
        return { partNumber, etag: `etag-${partNumber}` };
      },
      async complete(parts) {
        const record = bucket.multipart.get(uploadId);
        if (!record) throw new Error("unknown upload");
        const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
        const chunks = ordered.map((part) => record.parts.get(part.partNumber) ?? new Uint8Array());
        const size = chunks.reduce((total, chunk) => total + chunk.length, 0);
        const merged = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        bucket.objects.set(record.key, { body: merged, httpMetadata: record.options.httpMetadata });
        bucket.multipart.delete(uploadId);
        return { size };
      },
      async abort() {
        bucket.multipart.delete(uploadId);
      },
    };
  }
}

let bucket;
let env;
let supabaseRequests;
let supabaseHandlers;
const realFetch = globalThis.fetch;

beforeEach(() => {
  bucket = new FakeBucket();
  env = {
    MEDIA_BUCKET: bucket,
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  };
  supabaseRequests = [];
  supabaseHandlers = [];
  globalThis.fetch = async (input, init = {}) => {
    const request = new Request(input, init);
    assert.ok(request.url.startsWith("https://supabase.test/rest/v1/"), `unexpected fetch: ${request.url}`);
    const record = {
      url: request.url,
      method: request.method,
      apikey: request.headers.get("apikey"),
      authorization: request.headers.get("Authorization"),
      body: request.method === "POST" ? await request.json() : null,
    };
    supabaseRequests.push(record);
    const handler = supabaseHandlers.shift();
    assert.ok(handler, `no handler queued for ${request.method} ${request.url}`);
    return handler(record);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function queueSupabase(status, body) {
  supabaseHandlers.push(() =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function uploadRequest({ token = fakeJwt(), projectId = JOB_ID, projectKind = "jobs", headers = {}, body = new Uint8Array([1, 2, 3, 4]) } = {}) {
  const finalHeaders = {
    "Content-Type": "image/jpeg",
    "x-media-type": "image",
    "Content-Length": String(body.length),
    ...headers,
  };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  return new Request(`${BASE}/v1/${projectKind}/${projectId}/media`, {
    method: "PUT",
    headers: finalHeaders,
    body,
  });
}

async function seedMediaRow({ mediaKind = "image" } = {}) {
  const extension = mediaKind === "video" ? "mp4" : "jpg";
  const mimeType = mediaKind === "video" ? "video/mp4" : "image/jpeg";
  const bytes = new Uint8Array(Array.from({ length: 64 }, (_v, i) => i));
  const mediaId = crypto.randomUUID();
  const objectKey = `jobs/${JOB_ID}/${mediaId}.${extension}`;
  await bucket.put(objectKey, bytes, { httpMetadata: { contentType: mimeType } });
  return {
    bytes,
    row: {
      id: mediaId,
      job_id: JOB_ID,
      object_key: objectKey,
      media_type: mediaKind,
      mime_type: mimeType,
      original_filename: "site photo.jpg",
      byte_size: bytes.length,
    },
  };
}

test("health responds without auth and without internals", async () => {
  const response = await worker.fetch(new Request(`${BASE}/health`), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("OPTIONS returns CORS without credentials", async () => {
  const response = await worker.fetch(new Request(`${BASE}/v1/media/x`, { method: "OPTIONS" }), env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /x-media-type/);
  assert.equal(response.headers.get("Access-Control-Allow-Credentials"), null);
});

test("upload requires a bearer token", async () => {
  const response = await worker.fetch(uploadRequest({ token: null }), env);
  assert.equal(response.status, 401);
});

test("upload rejects a non-UUID job id", async () => {
  const response = await worker.fetch(uploadRequest({ projectId: "not-a-uuid" }), env);
  assert.equal(response.status, 400);
});

test("upload rejects unsupported content types", async () => {
  const response = await worker.fetch(
    uploadRequest({ headers: { "Content-Type": "application/pdf" } }),
    env,
  );
  assert.equal(response.status, 415);
});

test("upload rejects mismatched x-media-type", async () => {
  const response = await worker.fetch(
    uploadRequest({ headers: { "x-media-type": "video" } }),
    env,
  );
  assert.equal(response.status, 400);
});

test("upload without a usable Content-Length returns 411", async () => {
  const response = await worker.fetch(
    uploadRequest({ headers: { "Content-Length": "banana" } }),
    env,
  );
  assert.equal(response.status, 411);
});

test("browser upload can declare its Blob size with x-file-size", async () => {
  queueSupabase(200, [{ id: JOB_ID }]);
  supabaseHandlers.push((record) =>
    new Response(JSON.stringify([record.body]), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );
  const response = await worker.fetch(
    uploadRequest({ headers: { "Content-Length": "", "x-file-size": "4" } }),
    env,
  );
  assert.equal(response.status, 201);
});

test("upload over the image cap returns 413", async () => {
  const response = await worker.fetch(
    uploadRequest({ headers: { "Content-Length": String(26 * 1024 * 1024) } }),
    env,
  );
  assert.equal(response.status, 413);
});

test("upload over the video cap returns 413", async () => {
  const response = await worker.fetch(
    uploadRequest({
      headers: {
        "Content-Type": "video/mp4",
        "x-media-type": "video",
        "Content-Length": String(96 * 1024 * 1024),
      },
    }),
    env,
  );
  assert.equal(response.status, 413);
});

test("upload 404s when the job is not visible to the caller", async () => {
  queueSupabase(200, []);
  const response = await worker.fetch(uploadRequest(), env);
  assert.equal(response.status, 404);
  assert.equal(bucket.objects.size, 0);
});

test("successful upload stores R2 object, inserts metadata, returns row", async () => {
  queueSupabase(200, [{ id: JOB_ID }]);
  supabaseHandlers.push((record) =>
    new Response(JSON.stringify([record.body]), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );

  const response = await worker.fetch(
    uploadRequest({
      headers: {
        "x-original-filename": "../weird name!!.jpg",
        "x-media-width": "4032",
        "x-media-height": "3024",
        "x-captured-at": "2026-08-17T12:00:00.000Z",
      },
    }),
    env,
  );
  assert.equal(response.status, 201);
  const row = await response.json();

  assert.equal(row.job_id, JOB_ID);
  assert.equal(row.media_type, "image");
  assert.equal(row.mime_type, "image/jpeg");
  assert.equal(row.uploaded_by, USER_ID);
  assert.equal(row.byte_size, 4);
  assert.equal(row.width, 4032);
  assert.equal(row.height, 3024);
  assert.equal(row.captured_at, "2026-08-17T12:00:00.000Z");
  assert.match(row.object_key, new RegExp(`^jobs/${JOB_ID}/${row.id}\\.jpg$`));
  assert.equal(row.original_filename, "weird_name_.jpg");

  assert.ok(bucket.objects.has(row.object_key), "object stored in R2");
  const stored = bucket.objects.get(row.object_key);
  assert.equal(stored.options.httpMetadata.contentType, "image/jpeg");
  assert.equal(stored.options.customMetadata.uploaded_by, USER_ID);
  assert.ok(!JSON.stringify(stored.options.customMetadata).includes("Bearer"));

  // Both Supabase calls used the caller's JWT plus the publishable key.
  for (const request of supabaseRequests) {
    assert.equal(request.apikey, "sb_publishable_test");
    assert.match(request.authorization, /^Bearer /);
  }
});

test("successful lead upload uses the lead table, column, and R2 prefix", async () => {
  queueSupabase(200, [{ id: LEAD_ID }]);
  supabaseHandlers.push((record) =>
    new Response(JSON.stringify([record.body]), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
  );

  const response = await worker.fetch(
    uploadRequest({ projectId: LEAD_ID, projectKind: "leads" }),
    env,
  );
  assert.equal(response.status, 201);
  const row = await response.json();

  assert.equal(row.lead_id, LEAD_ID);
  assert.equal(row.job_id, undefined);
  assert.match(row.object_key, new RegExp(`^leads/${LEAD_ID}/${row.id}\\.jpg$`));
  assert.match(supabaseRequests[0].url, /\/rest\/v1\/leads\?/);
  assert.equal(bucket.objects.get(row.object_key).options.customMetadata.project_kind, "lead");
});

test("metadata insert failure deletes the R2 object", async () => {
  queueSupabase(200, [{ id: JOB_ID }]);
  queueSupabase(403, { message: "denied" });

  const response = await worker.fetch(uploadRequest(), env);
  assert.equal(response.status, 403);
  assert.equal(bucket.objects.size, 0, "orphaned R2 object was removed");
});

test("media GET requires auth and hides unknown rows", async () => {
  const noAuth = await worker.fetch(new Request(`${BASE}/v1/media/${crypto.randomUUID()}`), env);
  assert.equal(noAuth.status, 401);

  queueSupabase(200, []);
  const missing = await worker.fetch(
    new Request(`${BASE}/v1/media/${crypto.randomUUID()}`, {
      headers: { Authorization: `Bearer ${fakeJwt()}` },
    }),
    env,
  );
  assert.equal(missing.status, 404);
});

test("media GET returns bytes with safe headers", async () => {
  const { row, bytes } = await seedMediaRow();
  queueSupabase(200, [row]);

  const response = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}`, {
      headers: { Authorization: `Bearer ${fakeJwt()}` },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(response.headers.get("Content-Length"), String(bytes.length));
  assert.match(response.headers.get("Cache-Control"), /private/);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(response.headers.get("Content-Disposition"), /^inline; filename="site_photo.jpg"/);
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.ok(response.headers.get("ETag"));
  const received = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(received, bytes);
});

test("media GET serves byte ranges for video playback", async () => {
  const { row, bytes } = await seedMediaRow({ mediaKind: "video" });
  queueSupabase(200, [row]);

  const response = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}`, {
      headers: { Authorization: `Bearer ${fakeJwt()}`, Range: "bytes=8-15" },
    }),
    env,
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), `bytes 8-15/${bytes.length}`);
  assert.equal(response.headers.get("Content-Length"), "8");
  const received = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(received, bytes.slice(8, 16));
});

test("media GET supports open-ended and suffix ranges", async () => {
  const { row, bytes } = await seedMediaRow({ mediaKind: "video" });

  queueSupabase(200, [row]);
  const openEnded = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}`, {
      headers: { Authorization: `Bearer ${fakeJwt()}`, Range: "bytes=60-" },
    }),
    env,
  );
  assert.equal(openEnded.status, 206);
  assert.equal(openEnded.headers.get("Content-Range"), `bytes 60-63/${bytes.length}`);

  queueSupabase(200, [row]);
  const suffix = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}`, {
      headers: { Authorization: `Bearer ${fakeJwt()}`, Range: "bytes=-4" },
    }),
    env,
  );
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("Content-Range"), `bytes 60-63/${bytes.length}`);
});

test("media GET rejects unsatisfiable ranges with 416", async () => {
  const { row, bytes } = await seedMediaRow({ mediaKind: "video" });
  queueSupabase(200, [row]);

  const response = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}`, {
      headers: { Authorization: `Bearer ${fakeJwt()}`, Range: "bytes=4000-" },
    }),
    env,
  );
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("Content-Range"), `bytes */${bytes.length}`);
});

test("media HEAD returns headers with no body", async () => {
  const { row, bytes } = await seedMediaRow();
  queueSupabase(200, [row]);

  const response = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${fakeJwt()}` },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Length"), String(bytes.length));
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test("multipart upload assembles parts and records metadata once", async () => {
  const projectId = crypto.randomUUID();
  queueSupabase(200, [{ id: projectId }]);

  const start = await worker.fetch(
    new Request(`${BASE}/v1/jobs/${projectId}/media/multipart`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fakeJwt()}`,
        "x-media-content-type": "video/mp4",
        "x-file-size": "12",
      },
    }),
    env,
  );
  assert.equal(start.status, 200);
  const { objectKey, uploadId } = await start.json();
  assert.match(objectKey, new RegExp(`^jobs/${projectId}/`));

  for (const [index, chunk] of [[1, "aaaa"], [2, "bbbb"], [3, "cccc"]]) {
    queueSupabase(200, [{ id: projectId }]);
    const part = await worker.fetch(
      new Request(`${BASE}/v1/media-uploads/${encodeURIComponent(uploadId)}/parts`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${fakeJwt()}`,
          "x-object-key": objectKey,
          "x-part-number": String(index),
        },
        body: chunk,
      }),
      env,
    );
    assert.equal(part.status, 200);
  }

  queueSupabase(200, [{ id: projectId }]);
  queueSupabase(201, [{ id: "created" }]);
  const complete = await worker.fetch(
    new Request(`${BASE}/v1/media-uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: "POST",
      headers: { Authorization: `Bearer ${fakeJwt()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        objectKey,
        mimeType: "video/mp4",
        parts: [
          { partNumber: 1, etag: "etag-1" },
          { partNumber: 2, etag: "etag-2" },
          { partNumber: 3, etag: "etag-3" },
        ],
      }),
    }),
    env,
  );
  assert.equal(complete.status, 201);
  const stored = bucket.objects.get(objectKey);
  assert.equal(new TextDecoder().decode(stored.body), "aaaabbbbcccc");
});

test("multipart part upload refuses a key the caller cannot reach", async () => {
  const projectId = crypto.randomUUID();
  queueSupabase(200, []);
  const response = await worker.fetch(
    new Request(`${BASE}/v1/media-uploads/some-upload/parts`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${fakeJwt()}`,
        "x-object-key": `jobs/${projectId}/${crypto.randomUUID()}.mp4`,
        "x-part-number": "1",
      },
      body: "data",
    }),
    env,
  );
  assert.equal(response.status, 404);
});

test("multipart start rejects photos and oversized videos", async () => {
  const projectId = crypto.randomUUID();
  const photo = await worker.fetch(
    new Request(`${BASE}/v1/jobs/${projectId}/media/multipart`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fakeJwt()}`,
        "x-media-content-type": "image/jpeg",
        "x-file-size": "1024",
      },
    }),
    env,
  );
  assert.equal(photo.status, 400);

  const huge = await worker.fetch(
    new Request(`${BASE}/v1/jobs/${projectId}/media/multipart`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fakeJwt()}`,
        "x-media-content-type": "video/mp4",
        "x-file-size": String(2 * 1024 * 1024 * 1024),
      },
    }),
    env,
  );
  assert.equal(huge.status, 413);
});

test("thumbnail extracts a frame from a video without exposing the bucket", async () => {
  const { row } = await seedMediaRow({ mediaKind: "video" });
  queueSupabase(200, [row]);
  const calls = [];
  env.MEDIA = {
    input(body) {
      calls.push({ stage: "input", hasBody: Boolean(body) });
      return {
        transform(options) {
          calls.push({ stage: "transform", options });
          return this;
        },
        output(options) {
          calls.push({ stage: "output", options });
          return this;
        },
        response: async () => new Response(new Uint8Array([1, 2, 3])),
      };
    },
  };

  const response = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}/thumbnail`, {
      headers: { Authorization: `Bearer ${fakeJwt()}` },
    }),
    env,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.match(response.headers.get("Cache-Control"), /private/);
  assert.equal(calls[0].hasBody, true);
  assert.equal(calls[2].options.mode, "frame");
  assert.equal(calls[2].options.format, "jpg");

  // The frame is stored, so a second request serves it without transforming.
  queueSupabase(200, [row]);
  env.MEDIA = { input: () => assert.fail("cached frame must not be re-transformed") };
  const second = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}/thumbnail`, {
      headers: { Authorization: `Bearer ${fakeJwt()}` },
    }),
    env,
  );
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("Content-Type"), "image/jpeg");
});

test("thumbnail requires auth and reports a missing image binding", async () => {
  const anonymous = await worker.fetch(
    new Request(`${BASE}/v1/media/${crypto.randomUUID()}/thumbnail`),
    env,
  );
  assert.equal(anonymous.status, 401);

  const { row } = await seedMediaRow();
  queueSupabase(200, [row]);
  env.MEDIA = { input: () => assert.fail("photos must not be transformed") };
  const photo = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}/thumbnail`, {
      headers: { Authorization: `Bearer ${fakeJwt()}` },
    }),
    env,
  );
  assert.equal(photo.status, 501);
});

test('image preview resizes private bytes and caches only the derivative',async()=>{
  const {row}=await seedMediaRow();
  queueSupabase(200,[row]);
  const calls=[];
  env.IMAGES={input(stream){
    assert.ok(stream);return {transform(options){calls.push(options);return this;},
      async output(options){calls.push(options);return {response:()=>new Response(new Uint8Array([82,73,70,70]))};}};
  }};
  const request=()=>new Request(`${BASE}/v1/media/${row.id}/thumbnail`,{headers:{Authorization:`Bearer ${fakeJwt()}`}});
  const response=await worker.fetch(request(),env);
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/webp');
  assert.equal(calls[0].width,640);assert.equal(calls[1].format,'image/webp');
  assert.ok(bucket.objects.has(row.object_key));
  assert.ok(bucket.objects.has(`${row.object_key}.preview-v1.webp`));
  queueSupabase(200,[row]);
  env.IMAGES.input=()=>assert.fail('Cached preview should not transform again');
  assert.equal((await worker.fetch(request(),env)).status,200);
  queueSupabase(200,[]);
  assert.equal((await worker.fetch(request(),env)).status,404,'cached file must still pass access checks');
});

test('failed image transform does not poison the preview cache',async()=>{
  const {row}=await seedMediaRow();queueSupabase(200,[row]);
  env.IMAGES={input(){return {transform(){return this;},async output(){return {response:()=>new Response('failed',{status:500})};}};}};
  const response=await worker.fetch(new Request(`${BASE}/v1/media/${row.id}/thumbnail`,{headers:{Authorization:`Bearer ${fakeJwt()}`}}),env);
  assert.equal(response.status,422);assert.ok(bucket.objects.has(row.object_key));
  assert.equal(bucket.objects.has(`${row.object_key}.preview-v1.webp`),false);
});

test("thumbnail falls back with 422 when the transformer cannot read the video", async () => {
  const { row } = await seedMediaRow({ mediaKind: "video" });
  queueSupabase(200, [row]);
  env.MEDIA = {
    input: () => ({
      transform() { return this; },
      output() { return this; },
      response: async () => { throw new Error("unsupported codec"); },
    }),
  };

  const response = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}/thumbnail`, {
      headers: { Authorization: `Bearer ${fakeJwt()}` },
    }),
    env,
  );
  assert.equal(response.status, 422);
});

test("trash permission failure keeps the original R2 object", async () => {
  const { row } = await seedMediaRow();
  queueSupabase(200, [row]);
  queueSupabase(403, {message:'Not permitted'});

  const response = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${fakeJwt()}` },
    }),
    env,
  );
  assert.equal(response.status, 403);
  assert.ok(bucket.objects.has(row.object_key), "R2 object retained");
});

test("delete moves the photo to recoverable trash without removing bytes", async () => {
  const { row } = await seedMediaRow();
  queueSupabase(200, [row]);
  queueSupabase(200, {photo_trashed_at:new Date().toISOString()});

  const response = await worker.fetch(
    new Request(`${BASE}/v1/media/${row.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${fakeJwt()}` },
    }),
    env,
  );
  assert.equal(response.status, 204);
  assert.equal(bucket.objects.has(row.object_key), true);
});

test('trash preview is gated by the manager-only database RPC',async()=>{
  const {row}=await seedMediaRow();
  queueSupabase(403,{message:'Managers only'});
  const response=await worker.fetch(new Request(`${BASE}/v1/media/${row.id}/trash`,{
    headers:{Authorization:`Bearer ${fakeJwt()}`}}),env);
  assert.equal(response.status,401);
  assert.ok(bucket.objects.has(row.object_key));
});

test('authorized trash preview serves the retained original',async()=>{
  const {row}=await seedMediaRow();
  queueSupabase(200,[{...row,source_metadata:{photo_trashed_at:new Date().toISOString()}}]);
  const response=await worker.fetch(new Request(`${BASE}/v1/media/${row.id}/trash`,{
    headers:{Authorization:`Bearer ${fakeJwt()}`}}),env);
  assert.equal(response.status,200);
  assert.ok((await response.arrayBuffer()).byteLength>0);
});

function ottawaJwt() {
  return `header.${Buffer.from(JSON.stringify({sub:USER_ID,iss:'https://pyzejfhsdewpnvmtqtlw.supabase.co/auth/v1'})).toString('base64url')}.signature`;
}

test('Ottawa Painters tokens cannot upload, delete, or start multipart uploads', async () => {
  for (const [method,path] of [['PUT',`/v1/jobs/${JOB_ID}/media`],['DELETE',`/v1/media/${JOB_ID}`],['POST',`/v1/jobs/${JOB_ID}/media/multipart`]]) {
    const response = await worker.fetch(new Request(BASE+path,{method,headers:{Authorization:`Bearer ${ottawaJwt()}`}}),env);
    assert.equal(response.status,403);
  }
  assert.equal(supabaseRequests.length,0);
});

test('Ottawa Painters media reads validate the token against destination RLS', async () => {
  const {row,bytes}=await seedMediaRow();
  globalThis.fetch = async (url,init) => {
    assert.ok(String(url).startsWith('https://pyzejfhsdewpnvmtqtlw.supabase.co/rest/v1/job_media?'));
    assert.equal(init.headers.Authorization,`Bearer ${ottawaJwt()}`);
    return Response.json([row]);
  };
  const response=await worker.fetch(new Request(`${BASE}/v1/media/${row.id}`,{headers:{Authorization:`Bearer ${ottawaJwt()}`}}),env);
  assert.equal(response.status,200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
});

test('A forged Ottawa Painters issuer cannot bypass destination token validation', async () => {
  const {row}=await seedMediaRow();
  globalThis.fetch=async()=>new Response('{}',{status:401});
  const response=await worker.fetch(new Request(`${BASE}/v1/media/${row.id}`,{headers:{Authorization:`Bearer ${ottawaJwt()}`}}),env);
  assert.equal(response.status,401);
});

const UPLOAD_ID = 'abcdefab-1234-4567-8123-abcdefabcdef';
function savedUpload(overrides = {}) {
  return { id: UPLOAD_ID, job_id: JOB_ID, uploaded_by: USER_ID, mime_type: 'image/jpeg', byte_size: 4, original_filename: null, object_key: 'jobs/saved.jpg', ...overrides };
}

test('retry returns committed photo without writing another object', async () => {
  queueSupabase(200, [{ id: JOB_ID }]);
  queueSupabase(200, [savedUpload()]);
  const response = await worker.fetch(uploadRequest({headers: {'x-upload-id': UPLOAD_ID}}), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, UPLOAD_ID);
  assert.equal(bucket.objects.size, 0);
  assert.equal(supabaseRequests.filter(r => r.method === 'POST').length, 0);
});

test('upload id cannot be reused for another uploader or project', async () => {
  for (const mismatch of [{uploaded_by: JOB_ID}, {job_id: LEAD_ID}, {byte_size: 9}]) {
    queueSupabase(200, [{ id: JOB_ID }]);
    queueSupabase(200, [savedUpload(mismatch)]);
    const response = await worker.fetch(uploadRequest({headers: {'x-upload-id': UPLOAD_ID}}), env);
    assert.equal(response.status, 409);
  }
  assert.equal(bucket.objects.size, 0);
});

test('concurrent losing upload removes only its attempt object', async () => {
  const winner = savedUpload();
  await bucket.put(winner.object_key, new Uint8Array([1,2,3,4]));
  queueSupabase(200, [{ id: JOB_ID }]);
  queueSupabase(200, []);
  queueSupabase(409, {});
  queueSupabase(200, [winner]);
  const response = await worker.fetch(uploadRequest({headers: {'x-upload-id': UPLOAD_ID}}), env);
  assert.equal(response.status, 200);
  assert.deepEqual([...bucket.objects.keys()], [winner.object_key]);
});

test('database response loss after commit preserves uploaded bytes', async () => {
  queueSupabase(200, [{ id: JOB_ID }]);
  queueSupabase(200, []);
  let saved;
  supabaseHandlers.push(record => { saved = record.body; return new Response(null, { status: 502 }); });
  supabaseHandlers.push(() => new Response(JSON.stringify([saved]), {status:200}));
  const response = await worker.fetch(uploadRequest({headers: {'x-upload-id': UPLOAD_ID}}), env);
  assert.equal(response.status, 200);
  assert.equal(bucket.objects.size, 1);
  assert.ok(bucket.objects.has(saved.object_key));
});

test('unknown commit state preserves bytes until status can be resolved', async () => {
  queueSupabase(200, [{ id: JOB_ID }]);
  queueSupabase(200, []);
  queueSupabase(502, {});
  queueSupabase(503, {});
  const response = await worker.fetch(uploadRequest({headers: {'x-upload-id': UPLOAD_ID}}), env);
  assert.equal(response.status, 503);
  assert.equal(bucket.objects.size, 1);
});
