"use client";

import { useEffect, useRef, useState } from 'react';
import type { ProjectMediaItem } from '@/lib/project-data';
import { preparePhotoBatch, runPhotoBatch, type PhotoBatchItem, type PhotoBatchOperation } from '@/lib/photo-batch';
import { savePhotoDetails, setPhotoTrash } from '@/lib/actions/photo-details';

export function ProjectPhotoBatch({projectId, selected, onClear, onBusy, onSaved}: {
  projectId:string; selected:ProjectMediaItem[]; onClear:()=>void;
  onBusy:(busy:boolean)=>void; onSaved:()=>void;
}) {
  const [operation,setOperation]=useState<PhotoBatchOperation>('add-tags');
  const [tags,setTags]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [,render]=useState(0);
  const pending=useRef<PhotoBatchItem[]|null>(null);
  useEffect(()=>{
    if(!busy)return;
    const warn=(event:BeforeUnloadEvent)=>event.preventDefault();
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[busy]);
  async function apply() {
    if(busy)return;
    if(!pending.current) {
      try {pending.current=preparePhotoBatch(selected,operation,tags);}
      catch(error){setMessage(error instanceof Error?error.message:'Check your tags.');return;}
      if(operation==='trash'&&!window.confirm(`Move ${pending.current.length} selected photos/videos to trash? Their originals can be restored.`)) {pending.current=null;return;}
    }
    const batch=pending.current;
    setBusy(true);onBusy(true);setMessage('');
    try {
      await runPhotoBatch(batch,entry=>operation==='trash'
        ?setPhotoTrash({projectId,mediaId:entry.item.id,trashed:true,expectedRevision:entry.item.trashRevision,revision:entry.revision})
        :savePhotoDetails({projectId,mediaId:entry.item.id,expectedRevision:entry.item.revision,revision:entry.revision,
          description:entry.item.description??'',tags:entry.tags}),()=>render(value=>value+1));
      const failed=batch.filter(entry=>!entry.done).length;
      if(failed)setMessage(`${batch.length-failed} saved · ${failed} need attention. Retry safely, or finish and reselect photos with conflicting edits.`);
      else {pending.current=null;onClear();setMessage(`${batch.length} photos/videos updated.`);}
      onSaved();
    } finally {setBusy(false);onBusy(pending.current!==null);}
  }
  const batch=pending.current;
  if(!selected.length&&!batch)return message?<p role="status" className="mb-3 text-sm text-teal-700">{message}</p>:null;
  return <div className="sticky bottom-4 z-30 my-4 rounded-xl border border-slate-300 bg-white p-4 shadow-lg" aria-label="Selected photo actions">
    <div className="flex flex-wrap items-center gap-3">
      <strong className="text-sm">{batch?batch.length:selected.length} selected</strong>
      <select aria-label="Selected photo action" disabled={busy||!!batch} value={operation} onChange={event=>{setOperation(event.target.value as PhotoBatchOperation);setMessage('');}} className="rounded-lg border p-2 text-sm">
        <option value="add-tags">Add tags</option><option value="remove-tags">Remove tags</option><option value="trash">Move to trash</option>
      </select>
      {operation!=='trash'?<input aria-label="Tags for selected photos" value={tags} disabled={busy||!!batch} onChange={event=>setTags(event.target.value)} placeholder="Kitchen, Before" className="min-w-0 flex-1 rounded-lg border p-2 text-sm"/>:null}
      <button disabled={busy} onClick={()=>void apply()} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?`Saving ${batch?.filter(item=>item.done).length??0}/${batch?.length??0}…`:batch?'Retry unfinished':'Apply'}</button>
      <button disabled={busy} onClick={()=>{pending.current=null;onBusy(false);onClear();setMessage('');onSaved();}} className="px-2 py-2 text-sm underline">{batch?'Finish':'Clear selection'}</button>
    </div>
    {message?<p role="status" className="mt-3 text-sm">{message}</p>:null}
    {batch?.some(item=>item.error)?<ul className="mt-2 max-h-32 overflow-auto text-sm text-red-700">{batch.filter(item=>item.error).map(item=><li key={item.item.id}>{item.item.originalFilename??'Photo'}: {item.error}</li>)}</ul>:null}
  </div>;
}
