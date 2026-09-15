import type { UploadItem } from "./media-upload-queue";

type StoredUpload = UploadItem & { key: string; scope: string; fileName: string; fileLastModified: number };
const STORE = "files";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("serviceflow-photo-uploads", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: "key" });
      store.createIndex("scope", "scope");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close older ServiceFlow tabs to enable upload recovery."));
  });
}

/** Store the bytes before starting a request so a reload keeps the same ID. */
export async function storeUploads(scope: string, items: UploadItem[]): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const item of items) store.put({ ...item, scope, key: `${scope}/${item.id}`,
        fileName: item.file.name, fileLastModified: item.file.lastModified } satisfies StoredUpload);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Upload recovery storage failed."));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function loadUploads(scope: string): Promise<UploadItem[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).index("scope").getAll(scope);
      request.onsuccess = () => resolve((request.result as StoredUpload[]).map(({ key: _key, scope: _scope, fileName, fileLastModified, ...item }) => ({
        ...item,
        file: new File([item.file], fileName, { type: item.file.type, lastModified: fileLastModified }),
        // An interrupted network request may have committed. The stable ID
        // makes the retry an existence check before any additional upload.
        status: item.status === "uploading" ? "queued" : item.status,
        progress: 0,
      })));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function forgetUploads(scope: string, ids: string[]): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      for (const id of ids) transaction.objectStore(STORE).delete(`${scope}/${id}`);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

/** Discover this account's pending projects without loading file bytes. */
export async function listUploadScopes(userId: string): Promise<string[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const scopes: string[] = [];
      const transaction = db.transaction(STORE, "readonly");
      const prefix = `${userId}/`;
      const request = transaction.objectStore(STORE).index("scope").openKeyCursor(
        IDBKeyRange.bound(prefix, `${prefix}\uffff`), "nextunique",
      );
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(scopes); return; }
        scopes.push(String(cursor.key)); cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
