"use client";

import {PhotoToolIcon} from './photo-tool-icon';
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectModal } from "@/components/project-profile-panel";
import { loadPhotoTrash, setPhotoTrash } from "@/lib/actions/photo-details";
import type { ProjectMediaItem } from "@/lib/project-data";

export function PhotoTrashAction({projectId,item,restore=false,onSuccess,beforeAction,compact=false}: {
  compact?:boolean;projectId:string;item:ProjectMediaItem;restore?:boolean;onSuccess:()=>void;beforeAction?:()=>boolean;
}) {
  const [busy,setBusy]=useState(false);
  const [confirming,setConfirming]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const requestId=useRef<string|null>(null);
  async function act() {
    if(beforeAction&&!beforeAction())return;
    setBusy(true);setError(null);
    requestId.current??=crypto.randomUUID();
    try {
      const result=await setPhotoTrash({projectId,mediaId:item.id,trashed:!restore,
        expectedRevision:item.trashRevision,revision:requestId.current});
      if(result.ok){setConfirming(false);onSuccess();}else setError(result.error??'Could not update photo.');
    }catch{setError('Could not confirm the change. Retry to check safely.');}
    finally{setBusy(false);}
  }
  return <div className="relative">
    <button type="button" disabled={busy} onClick={()=>restore?void act():setConfirming(true)} aria-label={restore?'Restore photo':'Move to trash'} title={restore?'Restore photo':'Move to trash'} className={compact?"p-2 text-white disabled:opacity-50":"rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"}>
      {compact?<PhotoToolIcon name="trash"/>:busy?'Saving…':restore?'Restore photo':'Move to trash'}
    </button>
    {confirming?<div role="group" aria-label="Confirm photo trash" className={`${compact?"absolute bottom-12 right-0 w-64 bg-white text-slate-900 shadow-lg":"mt-3"} space-y-3 rounded-lg border border-slate-300 p-3`}>
      <p className="text-sm">Move this photo to trash? Its original file is retained and can be restored.</p>
      <div className="flex gap-3"><button disabled={busy} onClick={()=>void act()} className="rounded-lg bg-red-700 px-3 py-2 text-sm text-white">{busy?'Moving…':'Confirm move to trash'}</button><button disabled={busy} onClick={()=>setConfirming(false)} className="text-sm underline">Cancel</button></div>
    </div>:null}
    {error?<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>:null}
  </div>;
}

export function ProjectPhotoTrash({projectId}:{projectId:string}) {
  const router=useRouter();
  const [open,setOpen]=useState(false);
  const [items,setItems]=useState<ProjectMediaItem[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  async function load() {
    setLoading(true);setError(null);
    try {const result=await loadPhotoTrash(projectId);setItems(result.items);setError(result.error??null);}
    catch{setError('Could not load trash. Try again.');}
    finally{setLoading(false);}
  }
  return <>
    <button type="button" onClick={()=>{setOpen(true);void load();}} className="rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]">Trash</button>
    {open?<ProjectModal title="Photo trash" subtitle="Original files are retained. Restore a photo to return it to this project's gallery." onClose={()=>setOpen(false)} wide>
      <div className="max-h-[70vh] overflow-y-auto p-5">
        {loading?<p role="status">Loading trash…</p>:error?<div role="alert">{error} <button onClick={()=>void load()} className="underline">Retry</button></div>:
        items.length===0?<p className="py-12 text-center text-slate-500">No photos in trash.</p>:
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">{items.map(item=><article key={item.id} className="space-y-2">
          {item.mediaType==='image'?<img src={`/api/jobs/${projectId}/media/${item.id}?view=trash`} alt={item.originalFilename??'Trashed photo'} loading="lazy" className="aspect-square w-full rounded-lg bg-slate-100 object-cover"/>:
          <video controls preload="none" src={`/api/jobs/${projectId}/media/${item.id}?view=trash`} className="aspect-square w-full rounded-lg bg-slate-900"/>}
          <p className="truncate text-sm">{item.originalFilename??'Photo'}</p>
          <PhotoTrashAction projectId={projectId} item={item} restore onSuccess={()=>{setItems(current=>current.filter(row=>row.id!==item.id));router.refresh();}}/>
        </article>)}</div>}
      </div>
    </ProjectModal>:null}
  </>;
}
