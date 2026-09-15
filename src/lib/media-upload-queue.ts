export type UploadStatus = 'queued' | 'uploading' | 'complete' | 'failed' | 'cancelled';
export type UploadItem = { id: string; file: File; status: UploadStatus; progress: number; error?: string };
const MIME_BY_EXTENSION: Record<string,string> = { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', heic:'image/heic', heif:'image/heif', mp4:'video/mp4', m4v:'video/mp4', mov:'video/quicktime', qt:'video/quicktime' };
export function mediaMime(file: Pick<File,'name'|'type'>): string | null {
  const type = file.type.toLowerCase().split(';')[0].trim();
  return Object.values(MIME_BY_EXTENSION).includes(type) ? type : MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}
export function validateMediaFile(file: Pick<File,'name'|'type'|'size'>): string | null {
  const mime = mediaMime(file);
  if (!mime) return 'Unsupported file type.';
  if (file.size <= 0) return 'This file is empty.';
  const limit = mime.startsWith('video/') ? 95 : 25;
  return file.size > limit * 1024 * 1024 ? `File exceeds the ${limit} MB limit.` : null;
}
export function appendUploadFiles(current: UploadItem[], files: File[], createId=()=>crypto.randomUUID()): UploadItem[] {
  const key = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
  const known = new Set(current.map(item=>key(item.file)));
  const added: UploadItem[] = [];
  for (const file of files) {
    if (known.has(key(file))) continue;
    known.add(key(file));
    const error=validateMediaFile(file);
    added.push({id:createId(),file,status:error?'failed':'queued',progress:0,...(error?{error}:{})});
  }
  return [...current,...added];
}
export function retryUploadItem(item: UploadItem): UploadItem {
  if (item.status !== 'failed' && item.status !== 'cancelled') return item;
  const error=validateMediaFile(item.file);
  return error ? {...item,error} : {...item,status:'queued',error:undefined,progress:0};
}
