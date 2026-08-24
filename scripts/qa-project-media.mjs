import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  buildProjectMediaUploadPath,
  buildUploadHeaders,
  inferAssetMimeType,
  normalizeProjectMediaApiUrl,
  normalizeProjectMediaKind,
  resolveMediaKind,
  sanitizeDisplayFilename,
} from "../src/lib/projectMediaModel.js";

assert.equal(normalizeProjectMediaApiUrl(" https://media.example.com/// "), "https://media.example.com");
assert.equal(normalizeProjectMediaApiUrl(""), "");
assert.equal(normalizeProjectMediaKind("lead"), "lead");
assert.equal(normalizeProjectMediaKind("job"), "job");
assert.equal(normalizeProjectMediaKind("unexpected"), "job");
assert.equal(
  buildProjectMediaUploadPath("11111111-2222-4333-8444-555555555555", "lead"),
  "/v1/leads/11111111-2222-4333-8444-555555555555/media",
);
assert.equal(
  buildProjectMediaUploadPath("11111111-2222-4333-8444-555555555555", "job"),
  "/v1/jobs/11111111-2222-4333-8444-555555555555/media",
);

assert.equal(resolveMediaKind("image/jpeg; charset=binary"), "image");
assert.equal(resolveMediaKind("VIDEO/MP4"), "video");
assert.equal(resolveMediaKind("application/pdf"), null);

assert.equal(inferAssetMimeType({ mimeType: "image/heic" }), "image/heic");
assert.equal(inferAssetMimeType({ fileName: "walkthrough.MOV" }), "video/quicktime");
assert.equal(inferAssetMimeType({ uri: "file:///tmp/progress.webp?x=1" }), "image/webp");
assert.equal(inferAssetMimeType({ type: "video" }), "video/mp4");

assert.equal(sanitizeDisplayFilename("../../Front room (after).jpg"), "Front_room_after_.jpg");
assert.equal(sanitizeDisplayFilename(".."), "");
assert.equal(MAX_IMAGE_BYTES, 25 * 1024 * 1024);
assert.equal(MAX_VIDEO_BYTES, 95 * 1024 * 1024);

const headers = buildUploadHeaders({
  token: "test-token",
  mimeType: "video/mp4",
  mediaKind: "video",
  asset: {
    fileName: "walk through.mp4",
    width: 1920,
    height: 1080,
    duration: 12_345,
    creationTime: Date.parse("2026-08-17T15:00:00.000Z"),
  },
});
assert.deepEqual(headers, {
  Authorization: "Bearer test-token",
  "Content-Type": "video/mp4",
  "x-media-type": "video",
  "x-original-filename": "walk_through.mp4",
  "x-media-width": "1920",
  "x-media-height": "1080",
  "x-media-duration-ms": "12345",
  "x-captured-at": "2026-08-17T15:00:00.000Z",
});

const screenSource = await readFile(new URL("../src/screens/ProjectDetailScreen.js", import.meta.url), "utf8");
assert.match(screenSource, /launchCameraAsync/);
assert.match(screenSource, /launchImageLibraryAsync/);
assert.match(screenSource, /Photos and videos/);
assert.match(screenSource, /<ProjectCameraScreen/);
assert.match(screenSource, /<FlatList/);
assert.match(screenSource, /PanResponder/);
assert.match(screenSource, /styles\.zoomableMedia/);
assert.match(screenSource, /zoomableMedia:\s*\{[\s\S]*?width: '100%'[\s\S]*?height: '100%'/);
assert.match(screenSource, /projectKind = isLead \? 'lead' : 'job'/);
assert.doesNotMatch(screenSource, /This lead becomes operational after an accepted quote creates a job/);
assert.doesNotMatch(screenSource, /companycam-project-photos/);
assert.doesNotMatch(screenSource, /CompanyCam Photos/);

const cameraSource = await readFile(new URL("../src/components/ProjectCameraScreen.js", import.meta.url), "utf8");
assert.match(cameraSource, /react-native-vision-camera/);
assert.match(cameraSource, /<Camera/);
assert.match(cameraSource, /capturePhotoToFile/);
assert.match(cameraSource, /createRecorder/);
assert.match(cameraSource, /stopRecording/);
assert.match(cameraSource, /onCapture\?\./);
assert.match(cameraSource, /outputs=\{outputs\}/);
assert.match(cameraSource, /enableAudio: mode === "video" && microphonePermission\.hasPermission/);
assert.match(cameraSource, /onInterruptionStarted=\{handleCameraInterruptionStarted\}/);
assert.match(cameraSource, /Show more/);
assert.match(cameraSource, /enableNativeZoomGesture/);
assert.match(cameraSource, /sessionStatusUploaded/);

const queueSource = await readFile(new URL("../src/lib/useProjectMediaUploadQueue.js", import.meta.url), "utf8");
assert.match(queueSource, /status: "queued"/);
assert.match(queueSource, /status: "uploaded"/);
assert.match(queueSource, /RETRY_DELAYS_MS/);
assert.match(queueSource, /clearCompleted/);
assert.match(queueSource, /uploadProjectMedia/);
assert.match(queueSource, /onUploadedRef\.current\?\./);

const configSource = await readFile(new URL("../app.config.js", import.meta.url), "utf8");
assert.match(configSource, /projectMediaApiUrl/);
assert.match(configSource, /NSCameraUsageDescription/);
assert.match(configSource, /NSMicrophoneUsageDescription/);
assert.doesNotMatch(configSource, /"expo-camera"/);
assert.match(configSource, /runtimeVersion: "1\.5\.0"/);

console.log("Project media mobile QA passed.");
