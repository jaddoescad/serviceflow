import type { ProjectMediaItem } from './project-data';

export type PhotoBatchOperation = 'add-tags' | 'remove-tags' | 'trash';
export type PhotoBatchItem = {
  item: ProjectMediaItem;
  revision: string;
  tags: string[];
  done: boolean;
  error?: string;
};

/** Freeze the values and request IDs so uncertain results can be replayed safely. */
export function preparePhotoBatch(items: ProjectMediaItem[], operation: PhotoBatchOperation, text: string): PhotoBatchItem[] {
  const tags = [...new Set(text.split(',').map(tag => tag.trim()).filter(Boolean))];
  if (operation !== 'trash' && !tags.length) throw new Error('Enter at least one tag.');
  if (tags.some(tag => tag.length > 60)) throw new Error('Tags must be 60 characters or fewer.');
  return [...new Map(items.map(item => [item.id, item])).values()].map(item => {
    const nextTags = operation === 'add-tags' ? [...new Set([...item.tags, ...tags])]
      : operation === 'remove-tags' ? item.tags.filter(tag => !tags.includes(tag)) : [...item.tags];
    if (nextTags.length > 30) throw new Error(`${item.originalFilename ?? 'A selected photo'} would have more than 30 tags.`);
    return { item: {...item, tags:[...item.tags]}, tags:nextTags, revision:crypto.randomUUID(), done:false };
  });
}

/** Progress survives a retry; successful items are never submitted again. */
export async function runPhotoBatch(batch: PhotoBatchItem[], apply: (item: PhotoBatchItem) => Promise<{ok:boolean;error?:string}>, progress: () => void) {
  for (const entry of batch) {
    if (entry.done) continue;
    entry.error = undefined;
    try {
      const result = await apply(entry);
      if (result.ok) entry.done = true;
      else entry.error = result.error ?? 'Could not save this photo.';
    } catch { entry.error = 'Could not confirm the change. Retry to check safely.'; }
    progress();
  }
}
