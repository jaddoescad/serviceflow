import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import { googleAccessToken } from "./ottawa-customer-rag.mjs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_INBOX_QUERY = "in:inbox newer_than:2d -in:spam -in:trash";
const execFileAsync = promisify(execFile);
const ALLOWED_ATTACHMENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const EXTRACTOR_PATHS = Object.freeze({
  "application/pdf": ["/usr/bin/pdftotext", "/usr/local/bin/pdftotext", "/opt/homebrew/bin/pdftotext"],
  "image/jpeg": ["/usr/bin/tesseract", "/usr/local/bin/tesseract", "/opt/homebrew/bin/tesseract"],
  "image/png": ["/usr/bin/tesseract", "/usr/local/bin/tesseract", "/opt/homebrew/bin/tesseract"],
});
const PYTHON_PATHS = [
  "/usr/local/bin/python3",
  "/usr/bin/python3",
  "/usr/local/bin/python",
  "/opt/hermes/.venv/bin/python",
  "/opt/data/.venv-google/bin/python",
];
const PYTHON_PDF_MODULE_SCRIPT = `
import importlib.util
for name in ("pypdf", "PyPDF2", "pdfminer", "fitz"):
    if importlib.util.find_spec(name) is not None:
        print(name)
        break
`;
const PYTHON_PDF_EXTRACT_SCRIPT = `
import sys
source, module, page_limit = sys.argv[1], sys.argv[2], int(sys.argv[3])
if module in ("pypdf", "PyPDF2"):
    package = __import__(module)
    reader = package.PdfReader(source)
    print("\\n".join((page.extract_text() or "") for page in list(reader.pages)[:page_limit]), end="")
elif module == "pdfminer":
    from pdfminer.high_level import extract_text
    print(extract_text(source, page_numbers=list(range(page_limit))), end="")
elif module == "fitz":
    import fitz
    document = fitz.open(source)
    print("\\n".join(document[index].get_text() for index in range(min(page_limit, len(document)))), end="")
`;
const PDFJS_VENDOR_URL = new URL("../vendor/pdfjs-dist/pdf.mjs", import.meta.url);

function apiError(response, body, action) {
  const detail = typeof body?.error?.message === "string" ? `: ${body.error.message}` : "";
  return new Error(`${action} failed with HTTP ${response.status}${detail}`);
}

function boundedInteger(value, name, fallback, minimum, maximum) {
  if (value === undefined || value === null) return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return parsed;
}

function cleanText(value, name, maximum) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name} is required`);
  if (text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error(`${name} is invalid`);
  return text;
}

export function validateMessageId(value) {
  const id = cleanText(value, "Message ID", 225);
  if (!/^[A-Za-z0-9_-]{5,225}$/.test(id)) throw new Error("Message ID is invalid");
  return id;
}

export function validateAttachmentIndex(value) {
  if (!/^\d+$/.test(String(value ?? ""))) throw new Error("Attachment index must be an integer between 1 and 5");
  const index = Number(value);
  if (index < 1 || index > 5) throw new Error("Attachment index must be an integer between 1 and 5");
  return index;
}

export function validateGmailQuery(value) {
  return cleanText(value, "Gmail query", 500);
}

function decodeBase64Url(value) {
  if (!value) return "";
  const normalized = String(value).replaceAll("-", "+").replaceAll("_", "/");
  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function decodeBase64UrlBytes(value) {
  if (!value) return Buffer.alloc(0);
  const normalized = String(value).replaceAll("-", "+").replaceAll("_", "/");
  try {
    return Buffer.from(normalized, "base64");
  } catch {
    return Buffer.alloc(0);
  }
}

function htmlToText(value) {
  return String(value ?? "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function compactBody(value, maximum = 10_000) {
  const text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function bodyCandidates(part, results = []) {
  if (!part || typeof part !== "object") return results;
  const mimeType = String(part.mimeType ?? "").toLowerCase();
  const filename = String(part.filename ?? "").trim();
  if (!filename && !part.body?.attachmentId && part.body?.data && ["text/plain", "text/html"].includes(mimeType)) {
    results.push({ mimeType, value: decodeBase64Url(part.body.data) });
  }
  for (const child of part.parts ?? []) bodyCandidates(child, results);
  return results;
}

export function extractMessageBody(payload, maximum = 10_000) {
  const candidates = bodyCandidates(payload);
  const plain = candidates.filter((item) => item.mimeType === "text/plain").map((item) => item.value).join("\n\n");
  if (plain.trim()) return compactBody(plain, maximum);
  const html = candidates.filter((item) => item.mimeType === "text/html").map((item) => item.value).join("\n\n");
  return compactBody(htmlToText(html), maximum);
}

function cleanAttachmentFilename(value) {
  const cleaned = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim();
  if (!cleaned) return "(unnamed attachment)";
  return cleaned.length <= 240 ? cleaned : `${cleaned.slice(0, 239)}…`;
}

function lowerMimeType(value) {
  return String(value ?? "application/octet-stream").trim().toLowerCase().split(";", 1)[0];
}

function attachmentParts(part, results = []) {
  if (!part || typeof part !== "object") return results;
  const filename = String(part.filename ?? "").trim();
  const attachmentId = String(part.body?.attachmentId ?? "").trim();
  if (filename || attachmentId) {
    results.push({
      attachment_id: attachmentId || null,
      filename: cleanAttachmentFilename(filename),
      mime_type: lowerMimeType(part.mimeType),
      size_bytes: Number.isFinite(Number(part.body?.size)) ? Number(part.body.size) : null,
    });
  }
  for (const child of part.parts ?? []) attachmentParts(child, results);
  return results;
}

export function extractAttachmentMetadata(payload) {
  return attachmentParts(payload).map(({ attachment_id: _attachmentId, ...metadata }) => metadata);
}

function validMagicBytes(bytes, mimeType) {
  if (mimeType === "application/pdf") return bytes.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

async function pythonPdfExtractor(timeoutMs = 3_000) {
  const python = await firstExecutable(PYTHON_PATHS);
  if (!python) return null;
  try {
    const { stdout } = await execFileAsync(python, ["-c", PYTHON_PDF_MODULE_SCRIPT], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 16 * 1024,
      windowsHide: true,
      env: { LANG: "C.UTF-8", PATH: "/usr/bin:/usr/local/bin" },
    });
    const module = String(stdout ?? "").trim();
    return ["pypdf", "PyPDF2", "pdfminer", "fitz"].includes(module) ? { python, module } : null;
  } catch {
    return null;
  }
}

export async function attachmentExtractorCapabilities() {
  const pdf = await firstExecutable(EXTRACTOR_PATHS["application/pdf"]);
  const pythonPdf = pdf ? null : await pythonPdfExtractor();
  const image = await firstExecutable(EXTRACTOR_PATHS["image/png"]);
  return {
    pdf_text: true,
    image_ocr: Boolean(image),
    allowed_mime_types: [...ALLOWED_ATTACHMENT_TYPES],
  };
}

function compactAttachmentText(value, maximum) {
  const text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  return text.length <= maximum ? text : `${text.slice(0, Math.max(0, maximum - 1))}…`;
}

function ensurePdfJsTextPolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    globalThis.DOMMatrix = class DOMMatrix {
      constructor() {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }
    };
  }
  if (typeof globalThis.ImageData === "undefined") globalThis.ImageData = class ImageData {};
  if (typeof globalThis.Path2D === "undefined") globalThis.Path2D = class Path2D {};
}

async function loadPdfJs() {
  ensurePdfJsTextPolyfills();
  const originalWarn = console.warn;
  console.warn = (...args) => {
    const message = args.map(String).join(" ");
    if (!message.includes('Cannot load "@napi-rs/canvas"')) originalWarn(...args);
  };
  try {
    try {
      return await import("pdfjs-dist/legacy/build/pdf.mjs");
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
      return await import(PDFJS_VENDOR_URL.href);
    }
  } finally {
    console.warn = originalWarn;
  }
}

export async function extractPdfTextPdfJs(bytes, maximumText = 6_000, maximumPages = 5, loader = loadPdfJs) {
  if (!validMagicBytes(bytes, "application/pdf")) return "";
  const { getDocument } = await loader();
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  let document;
  try {
    document = await loadingTask.promise;
    const pageCount = Math.min(maximumPages, document.numPages);
    let result = "";
    for (let pageNumber = 1; pageNumber <= pageCount && result.length < maximumText; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent({ disableCombineTextItems: false });
      const pageText = content.items.map((item) => {
        if (typeof item?.str !== "string") return "";
        return `${item.str}${item.hasEOL ? "\n" : " "}`;
      }).join("");
      result += `${result ? "\n" : ""}${pageText}`;
    }
    return compactAttachmentText(result, maximumText);
  } finally {
    if (document) await document.destroy();
    else await loadingTask.destroy();
  }
}

function decodePdfUnicodeHex(value) {
  const clean = String(value ?? "").replace(/\s+/g, "");
  if (!clean || clean.length % 2 !== 0) return "";
  const bytes = Buffer.from(clean, "hex");
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let result = "";
    for (let index = 2; index + 1 < bytes.length; index += 2) result += String.fromCharCode(bytes.readUInt16BE(index));
    return result;
  }
  if (bytes.length >= 2 && bytes.length % 2 === 0 && bytes.filter((byte, index) => index % 2 === 0 && byte === 0).length >= bytes.length / 4) {
    let result = "";
    for (let index = 0; index + 1 < bytes.length; index += 2) result += String.fromCharCode(bytes.readUInt16BE(index));
    return result;
  }
  return bytes.toString("latin1");
}

function pdfUnicodeMap(streams) {
  const mapping = new Map();
  for (const stream of streams) {
    const text = stream.toString("latin1");
    if (!text.includes("begincmap")) continue;
    for (const match of text.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const source = match[1].toUpperCase();
      const decoded = decodePdfUnicodeHex(match[2]);
      if (source && decoded) mapping.set(source, decoded);
      if (mapping.size >= 20_000) return mapping;
    }
    for (const range of text.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const start = Number.parseInt(range[1], 16);
      const end = Number.parseInt(range[2], 16);
      const destination = Number.parseInt(range[3], 16);
      const width = range[1].length;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 512) continue;
      for (let value = start; value <= end; value += 1) {
        const source = value.toString(16).toUpperCase().padStart(width, "0");
        const decoded = String.fromCodePoint(destination + value - start);
        mapping.set(source, decoded);
      }
    }
  }
  return mapping;
}

function mapPdfBytes(bytes, mapping) {
  if (mapping.size === 0 || bytes.length === 0) return null;
  const hex = bytes.toString("hex").toUpperCase();
  const widths = [...new Set([...mapping.keys()].map((key) => key.length))].sort((a, b) => b - a);
  let index = 0;
  let matched = 0;
  let result = "";
  while (index < hex.length) {
    let found = false;
    for (const width of widths) {
      const key = hex.slice(index, index + width);
      if (key.length === width && mapping.has(key)) {
        result += mapping.get(key);
        index += width;
        matched += width;
        found = true;
        break;
      }
    }
    if (!found) {
      result += Buffer.from(hex.slice(index, index + 2), "hex").toString("latin1");
      index += 2;
    }
  }
  return matched >= Math.max(2, hex.length / 2) ? result : null;
}

function decodePdfLiteral(value, mapping) {
  const output = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      output.push(character.charCodeAt(0) & 0xff);
      continue;
    }
    const next = value[++index];
    if (next === undefined) break;
    if (next === "\r" && value[index + 1] === "\n") index += 1;
    if (next === "\r" || next === "\n") continue;
    const escapes = { n: 0x0a, r: 0x0d, t: 0x09, b: 0x08, f: 0x0c };
    if (Object.hasOwn(escapes, next)) output.push(escapes[next]);
    else if (/[0-7]/.test(next)) {
      let octal = next;
      while (octal.length < 3 && /[0-7]/.test(value[index + 1] ?? "")) octal += value[++index];
      output.push(Number.parseInt(octal, 8) & 0xff);
    } else output.push(next.charCodeAt(0) & 0xff);
  }
  const bytes = Buffer.from(output);
  return mapPdfBytes(bytes, mapping) || decodePdfUnicodeHex(bytes.toString("hex"));
}

function decodePdfToken(token, mapping) {
  if (token.startsWith("(")) return decodePdfLiteral(token.slice(1, -1), mapping);
  const bytes = Buffer.from(token.slice(1, -1).replace(/\s+/g, ""), "hex");
  return mapPdfBytes(bytes, mapping) || decodePdfUnicodeHex(bytes.toString("hex"));
}

function inflatePdfStream(body, dictionary) {
  const streamMatch = body.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
  if (!streamMatch) return null;
  const raw = Buffer.from(streamMatch[1], "latin1");
  if (!/\/FlateDecode\b/.test(dictionary)) return raw.subarray(0, 2_000_000);
  try {
    return inflateSync(raw, { maxOutputLength: 2_000_000 });
  } catch {
    return null;
  }
}

function textFromPdfContent(stream, mapping, maximumText) {
  const content = stream.toString("latin1");
  const pieces = [];
  const blocks = content.match(/BT[\s\S]*?ET/g) ?? [];
  for (const block of blocks) {
    const tokens = /\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>|T\*|[-+]?\d*\.?\d+\s+[-+]?\d*\.?\d+\s+T[Dd]/g;
    for (const tokenMatch of block.matchAll(tokens)) {
      const token = tokenMatch[0];
      if (token === "T*" || /T[Dd]$/.test(token)) pieces.push("\n");
      else pieces.push(decodePdfToken(token, mapping));
      if (pieces.join("").length >= maximumText) return compactAttachmentText(pieces.join(" "), maximumText);
    }
  }
  return compactAttachmentText(pieces.join(" "), maximumText);
}

export function extractPdfTextBuiltin(bytes, maximumText = 6_000, maximumPages = 5) {
  if (!validMagicBytes(bytes, "application/pdf")) return "";
  const source = bytes.toString("latin1");
  const objects = new Map();
  const streams = [];
  for (const match of source.matchAll(/(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g)) {
    if (objects.size >= 5_000) break;
    const key = `${match[1]} ${match[2]}`;
    const body = match[3];
    objects.set(key, body);
    const dictionary = body.slice(0, Math.max(0, body.indexOf("stream")) || 2_000);
    const stream = inflatePdfStream(body, dictionary);
    if (stream) streams.push(stream);
  }
  const mapping = pdfUnicodeMap(streams);
  const pageObjects = [...objects.values()].filter((body) => /\/Type\s*\/Page\b/.test(body)).slice(0, maximumPages);
  const contentKeys = [];
  for (const page of pageObjects) {
    const direct = page.match(/\/Contents\s+(\d+)\s+(\d+)\s+R/);
    if (direct) contentKeys.push(`${direct[1]} ${direct[2]}`);
    const array = page.match(/\/Contents\s*\[([^\]]+)\]/);
    for (const reference of array?.[1]?.matchAll(/(\d+)\s+(\d+)\s+R/g) ?? []) contentKeys.push(`${reference[1]} ${reference[2]}`);
  }
  const selectedStreams = contentKeys.length > 0
    ? contentKeys.map((key) => {
      const body = objects.get(key) ?? "";
      const dictionary = body.slice(0, Math.max(0, body.indexOf("stream")) || 2_000);
      return inflatePdfStream(body, dictionary);
    }).filter(Boolean)
    : streams;
  let result = "";
  for (const stream of selectedStreams) {
    const remaining = maximumText - result.length;
    if (remaining <= 0) break;
    const text = textFromPdfContent(stream, mapping, remaining);
    if (text) result += `${result ? "\n" : ""}${text}`;
  }
  return compactAttachmentText(result, maximumText);
}

export async function extractAttachmentText({ bytes, mimeType, maximumText = 6_000, maximumPages = 5, timeoutMs = 10_000 }) {
  const normalizedType = lowerMimeType(mimeType);
  if (!ALLOWED_ATTACHMENT_TYPES.has(normalizedType)) return { status: "unsupported_type", text: null };
  if (!validMagicBytes(bytes, normalizedType)) return { status: "invalid_file_signature", text: null };
  const executable = await firstExecutable(EXTRACTOR_PATHS[normalizedType] ?? []);
  const pythonPdf = normalizedType === "application/pdf" && !executable ? await pythonPdfExtractor(Math.min(timeoutMs, 3_000)) : null;
  if (!executable && !pythonPdf) {
    if (normalizedType !== "application/pdf") return { status: "extractor_unavailable", text: null };
    try {
      const pdfJsText = await extractPdfTextPdfJs(bytes, maximumText, maximumPages);
      if (pdfJsText) return { status: "extracted_pdfjs", text: pdfJsText };
    } catch {}
    const builtinText = extractPdfTextBuiltin(bytes, maximumText, maximumPages);
    return { status: builtinText ? "extracted_builtin" : "no_text_found", text: builtinText || null };
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ottawa-email-attachment-"));
  const extension = normalizedType === "application/pdf" ? ".pdf" : normalizedType === "image/png" ? ".png" : ".jpg";
  const temporaryFile = path.join(temporaryDirectory, `source${extension}`);
  try {
    await writeFile(temporaryFile, bytes, { mode: 0o600 });
    const command = executable || pythonPdf.python;
    const args = executable
      ? normalizedType === "application/pdf"
        ? ["-f", "1", "-l", String(maximumPages), "-nopgbrk", "-q", temporaryFile, "-"]
        : [temporaryFile, "stdout", "--dpi", "300"]
      : ["-c", PYTHON_PDF_EXTRACT_SCRIPT, temporaryFile, pythonPdf.module, String(maximumPages)];
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: Math.max(64 * 1024, maximumText * 8),
      windowsHide: true,
      env: { LANG: "C.UTF-8", PATH: "/usr/bin:/usr/local/bin" },
    });
    const text = compactAttachmentText(stdout, maximumText);
    if (text) return { status: "extracted", text };
    const builtinText = normalizedType === "application/pdf" ? extractPdfTextBuiltin(bytes, maximumText, maximumPages) : "";
    return { status: builtinText ? "extracted_builtin" : "no_text_found", text: builtinText || null };
  } catch (error) {
    if (error?.code === "ETIMEDOUT" || error?.killed) return { status: "extraction_timeout", text: null };
    const builtinText = normalizedType === "application/pdf" ? extractPdfTextBuiltin(bytes, maximumText, maximumPages) : "";
    if (builtinText) return { status: "extracted_builtin", text: builtinText };
    return { status: "extraction_failed", text: null };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function headerMap(message) {
  return Object.fromEntries((message.payload?.headers ?? []).map((header) => [String(header.name).toLowerCase(), String(header.value ?? "")]));
}

function headerValues(message, names) {
  const selected = new Set(names.map((name) => String(name).toLowerCase()));
  return (message.payload?.headers ?? [])
    .filter((header) => selected.has(String(header.name).toLowerCase()))
    .map((header) => String(header.value ?? "").trim())
    .filter(Boolean);
}

export function normalizeGmailMessage(message, includeBody = false, maximumBody = 10_000) {
  const headers = headerMap(message);
  const timestamp = Number(message.internalDate);
  const attachments = extractAttachmentMetadata(message.payload);
  return {
    message_id: String(message.id ?? ""),
    thread_id: String(message.threadId ?? ""),
    received_at: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null,
    from: headers.from || null,
    reply_to: headers["reply-to"] || null,
    to: headers.to || null,
    cc: headers.cc || null,
    subject: headers.subject || "(no subject)",
    // Preserve every authentication verdict. Some providers append their own
    // Authentication-Results after Gmail's DMARC verdict; a last-value map can
    // otherwise discard the trustworthy result used for supplier matching.
    authentication_results: headerValues(message, ["authentication-results", "arc-authentication-results"]).join("\n") || null,
    snippet: String(message.snippet ?? ""),
    ...(includeBody ? { body_text: extractMessageBody(message.payload, maximumBody) } : {}),
    label_ids: Array.isArray(message.labelIds) ? message.labelIds.map(String) : [],
    attachment_count: attachments.length,
    attachments,
  };
}

function requestHeaders(token) {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

async function getJson(url, token, fetchImpl, action) {
  const response = await fetchImpl(url, { method: "GET", headers: requestHeaders(token) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(response, body, action);
  return body;
}

async function readAttachmentBytes({ messageId, attachmentId, maximumBytes }, token, fetchImpl) {
  const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  const body = await getJson(url, token, fetchImpl, "Gmail attachment read");
  const declaredSize = Number(body.size);
  if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) return { status: "too_large", bytes: null };
  const bytes = decodeBase64UrlBytes(body.data);
  if (bytes.length === 0) return { status: "empty", bytes: null };
  if (bytes.length > maximumBytes) return { status: "too_large", bytes: null };
  return { status: "downloaded", bytes };
}

/**
 * Read one exact attachment by its bounded, one-based position in the message.
 * The Gmail attachment id never leaves this module, which keeps terminal
 * commands short and prevents arbitrary attachment URL access.
 */
export async function readGmailAttachment(
  { messageId, attachmentIndex, maximumBytes = 5_000_000 },
  env = process.env,
  fetchImpl = fetch,
  accessToken = null,
) {
  const id = validateMessageId(messageId);
  const index = validateAttachmentIndex(attachmentIndex);
  const limit = boundedInteger(maximumBytes, "Maximum attachment bytes", 5_000_000, 64_000, 10_000_000);
  const token = accessToken ?? await googleAccessToken(env, fetchImpl);
  const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(id)}`);
  url.searchParams.set("format", "full");
  const message = await getJson(url, token, fetchImpl, "Gmail message read");
  const parts = attachmentParts(message.payload);
  const selected = parts[index - 1];
  if (!selected) throw new Error("Attachment index does not exist on this message");
  if (!ALLOWED_ATTACHMENT_TYPES.has(selected.mime_type)) throw new Error("Attachment type is not approved for invoice intake");
  if (!selected.attachment_id) throw new Error("Attachment content is unavailable");
  if (selected.size_bytes !== null && selected.size_bytes > limit) throw new Error("Attachment exceeds the configured size limit");
  const downloaded = await readAttachmentBytes({ messageId: id, attachmentId: selected.attachment_id, maximumBytes: limit }, token, fetchImpl);
  if (!downloaded.bytes) throw new Error(`Attachment could not be read: ${downloaded.status}`);
  return {
    message_id: id,
    attachment_index: index,
    filename: selected.filename,
    mime_type: selected.mime_type,
    size_bytes: downloaded.bytes.length,
    bytes: downloaded.bytes,
  };
}

async function attachmentEvidence(message, { messageId, maximumAttachments, maximumBytes, maximumText, maximumPages, timeoutMs, extractor }, token, fetchImpl) {
  const parts = attachmentParts(message.payload);
  const evidence = [];
  let remainingText = maximumText;
  let processedCount = 0;
  for (const part of parts) {
    const base = {
      filename: part.filename,
      mime_type: part.mime_type,
      size_bytes: part.size_bytes,
    };
    if (!ALLOWED_ATTACHMENT_TYPES.has(part.mime_type)) {
      evidence.push({ ...base, content_status: "unsupported_type" });
      continue;
    }
    if (processedCount >= maximumAttachments) {
      evidence.push({ ...base, content_status: "attachment_limit_reached" });
      continue;
    }
    processedCount += 1;
    if (!part.attachment_id) {
      evidence.push({ ...base, content_status: "content_unavailable" });
      continue;
    }
    if (part.size_bytes !== null && part.size_bytes > maximumBytes) {
      evidence.push({ ...base, content_status: "too_large" });
      continue;
    }
    if (remainingText <= 0) {
      evidence.push({ ...base, content_status: "text_limit_reached" });
      continue;
    }
    const downloaded = await readAttachmentBytes({ messageId, attachmentId: part.attachment_id, maximumBytes }, token, fetchImpl);
    if (!downloaded.bytes) {
      evidence.push({ ...base, content_status: downloaded.status });
      continue;
    }
    const extracted = await extractor({
      bytes: downloaded.bytes,
      mimeType: part.mime_type,
      maximumText: remainingText,
      maximumPages,
      timeoutMs,
    });
    const text = extracted.text ? compactAttachmentText(extracted.text, remainingText) : null;
    if (text) remainingText -= text.length;
    evidence.push({
      ...base,
      content_status: extracted.status,
      ...(text ? { content_text: text } : {}),
    });
  }
  return evidence;
}

export async function readGmailMessage({ messageId, includeBody = true, includeAttachments = false, attachmentTextExtractor = extractAttachmentText }, env = process.env, fetchImpl = fetch, accessToken = null) {
  const id = validateMessageId(messageId);
  const token = accessToken ?? await googleAccessToken(env, fetchImpl);
  const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(id)}`);
  url.searchParams.set("format", includeBody || includeAttachments ? "full" : "metadata");
  if (!includeBody && !includeAttachments) for (const name of ["From", "To", "Cc", "Subject", "Date"]) url.searchParams.append("metadataHeaders", name);
  const message = await getJson(url, token, fetchImpl, "Gmail message read");
  const normalized = normalizeGmailMessage(message, includeBody, boundedInteger(env.HERMES_GMAIL_MAX_BODY, "HERMES_GMAIL_MAX_BODY", 10_000, 1_000, 20_000));
  if (!includeAttachments) return normalized;
  normalized.attachments = await attachmentEvidence(message, {
    messageId: id,
    maximumAttachments: boundedInteger(env.HERMES_GMAIL_MAX_ATTACHMENTS, "HERMES_GMAIL_MAX_ATTACHMENTS", 3, 1, 5),
    maximumBytes: boundedInteger(env.HERMES_GMAIL_MAX_ATTACHMENT_BYTES, "HERMES_GMAIL_MAX_ATTACHMENT_BYTES", 5_000_000, 64_000, 10_000_000),
    maximumText: boundedInteger(env.HERMES_GMAIL_MAX_ATTACHMENT_TEXT, "HERMES_GMAIL_MAX_ATTACHMENT_TEXT", 6_000, 500, 10_000),
    maximumPages: boundedInteger(env.HERMES_GMAIL_MAX_ATTACHMENT_PAGES, "HERMES_GMAIL_MAX_ATTACHMENT_PAGES", 5, 1, 10),
    timeoutMs: boundedInteger(env.HERMES_GMAIL_ATTACHMENT_TIMEOUT_MS, "HERMES_GMAIL_ATTACHMENT_TIMEOUT_MS", 10_000, 1_000, 20_000),
    extractor: attachmentTextExtractor,
  }, token, fetchImpl);
  normalized.attachment_count = normalized.attachments.length;
  return normalized;
}

export async function searchGmailMessages({ query = DEFAULT_INBOX_QUERY, limit = 10, includeBody = false }, env = process.env, fetchImpl = fetch, accessToken = null) {
  const boundedLimit = boundedInteger(limit, "Limit", 10, 1, 25);
  const cleanQuery = validateGmailQuery(query);
  const token = accessToken ?? await googleAccessToken(env, fetchImpl);
  const listUrl = new URL(`${GMAIL_API}/messages`);
  listUrl.searchParams.set("q", cleanQuery);
  listUrl.searchParams.set("maxResults", String(boundedLimit));
  const list = await getJson(listUrl, token, fetchImpl, "Gmail search");
  const messages = await Promise.all((list.messages ?? []).slice(0, boundedLimit).map(({ id }) => (
    readGmailMessage({ messageId: id, includeBody }, env, fetchImpl, token)
  )));
  return {
    query: cleanQuery,
    result_count: messages.length,
    messages,
    next_page_available: Boolean(list.nextPageToken),
  };
}

export { DEFAULT_INBOX_QUERY };
