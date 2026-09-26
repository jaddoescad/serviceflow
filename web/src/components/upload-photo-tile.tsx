"use client";

import { useEffect, useState } from "react";
import { mediaMime, validateMediaFile, type UploadItem } from "@/lib/media-upload-queue";

export function UploadPhotoTile({item,onCancel,onRetry}:{item:UploadItem;onCancel:()=>void;onRetry:()=>void}) {
  const [url,setUrl]=useState<string|null>(null);
  const [unavailable,setUnavailable]=useState(false);
  const video=mediaMime(item.file)?.startsWith('video/');
  useEffect(()=>{
    const preview=URL.createObjectURL(item.file);
    setUrl(preview);setUnavailable(false);
    return ()=>URL.revokeObjectURL(preview);
  },[item.file]);
  const pending=item.status==='queued'||item.status==='uploading';
  const retryable=item.status==='failed'||item.status==='cancelled';
  const status=item.status==='uploading'?(item.progress>=99?'Finishing…':`${item.progress}%`)
    :item.status==='complete'?'Uploaded':item.status==='queued'?(item.retryAt?'Retrying…':'Waiting')
    :item.status==='cancelled'?'Cancelled':'Failed';
  return <li className="min-w-0" aria-label={item.file.name} title={item.file.name}>
    <div className="relative aspect-square overflow-hidden rounded bg-slate-100">
      {url&&!unavailable?(video?<video src={url} muted playsInline preload="metadata" aria-label={item.file.name} onLoadedMetadata={event=>{const video=event.currentTarget;if(Number.isFinite(video.duration)&&video.duration>0)video.currentTime=Math.min(0.1,video.duration/2);}} onError={()=>setUnavailable(true)} className="h-full w-full object-cover"/>:<img src={url} alt={item.file.name} loading="lazy" decoding="async" onError={()=>setUnavailable(true)} className="h-full w-full object-cover"/>):<div className="flex h-full items-center justify-center text-xs text-slate-500">{unavailable?'Preview unavailable':video?'Video':'Photo'}</div>}
      {pending?<button type="button" aria-label={`Cancel upload ${item.file.name}`} onClick={onCancel} className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-xl text-white">×</button>:null}
      <div className="absolute inset-x-0 bottom-0 bg-black/65 px-2 py-1.5 text-xs text-white">
        <span role="status">{status}</span>
        {item.status==='uploading'?<progress aria-label={`Uploading ${item.file.name}`} value={item.progress} max={100} className="mt-1 block h-1 w-full accent-blue-500"/>:null}
      </div>
    </div>
    {retryable?<button type="button" disabled={!!validateMediaFile(item.file)} onClick={onRetry} className="mt-1 w-full rounded border border-slate-300 py-1 text-xs disabled:opacity-40">Retry</button>:null}
    {item.error&&item.status==='failed'?<p className="mt-1 text-xs text-red-700" role="alert">{item.error}</p>:null}
  </li>;
}
