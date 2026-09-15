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
  const dialog=useRef<HTMLDialogElement>(null);
  const menu=useRef<HTMLDetailsElement>(null);
  const [busy,setBusy]=useState(false);
  const [confirming,setConfirming]=useState(false);
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
      if(operation==='trash') {setConfirming(true);onBusy(true);return;}
    }
    setConfirming(false);
    const batch=pending.current;
    setBusy(true);onBusy(true);setMessage('');
    try {
      await runPhotoBatch(batch,entry=>operation==='trash'
        ?setPhotoTrash({projectId,mediaId:entry.item.id,trashed:true,expectedRevision:entry.item.trashRevision,revision:entry.revision})
        :savePhotoDetails({projectId,mediaId:entry.item.id,expectedRevision:entry.item.revision,revision:entry.revision,
          description:entry.item.description??'',tags:entry.tags}),()=>render(value=>value+1));
      const failed=batch.filter(entry=>!entry.done).length;
      if(failed)setMessage(`${batch.length-failed} saved · ${failed} need attention. Retry safely, or finish and reselect photos with conflicting edits.`);
      else {pending.current=null;dialog.current?.close();onClear();setMessage(`${batch.length} photos/videos updated.`);}
      onSaved();
    } finally {setBusy(false);onBusy(pending.current!==null);}
  }
  const batch=pending.current;
  if(!selected.length&&!batch)return message?<p role="status" className="mb-3 text-sm text-teal-700">{message}</p>:null;
  function dismiss() {
    if(busy)return;
    pending.current=null;setConfirming(false);onBusy(false);setMessage('');
    dialog.current?.close();
  }
  function choose(next:PhotoBatchOperation) {
    setOperation(next);setTags('');setMessage('');setConfirming(next==='trash');
    if(menu.current)menu.current.open=false;
    dialog.current?.showModal();
  }
  return <>
    <div className="sticky bottom-4 z-30 my-4 flex items-center gap-5 rounded-lg bg-[#1c2d41] px-4 py-3 text-white shadow-lg" aria-label="Selected photo actions">
      <button aria-label="Clear selection" disabled={busy||!!batch} onClick={()=>{dismiss();onClear();}} className="rounded p-2 text-xl hover:bg-white/10 disabled:opacity-50">×</button>
      <strong className="border-r border-white/30 pr-5 text-sm">{batch?batch.length:selected.length} Selected</strong>
      <details ref={menu} className="relative" onKeyDown={event=>{if(event.key==='Escape'&&menu.current){menu.current.open=false;menu.current.querySelector('summary')?.focus();}}}>
        <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm font-semibold hover:bg-white/10">Actions <span aria-hidden="true">⌄</span></summary>
        <div className="absolute bottom-full left-0 mb-2 w-56 rounded-lg border border-slate-200 bg-white py-2 text-sm text-slate-800 shadow-xl">
          <button disabled={busy||!!batch} onClick={()=>choose('add-tags')} className="block w-full px-4 py-2 text-left hover:bg-slate-100">Tag</button>
          <button disabled={busy||!!batch} onClick={()=>choose('remove-tags')} className="block w-full px-4 py-2 text-left hover:bg-slate-100">Remove Tags</button>
          <hr className="my-2 border-slate-200"/>
          <button disabled={busy||!!batch} onClick={()=>choose('trash')} className="block w-full px-4 py-2 text-left hover:bg-slate-100">Move to Trash</button>
        </div>
      </details>
    </div>
    <dialog ref={dialog} aria-label={operation==='trash'?'Move to Trash':operation==='add-tags'?'Tag Photos':'Remove Tags'} onCancel={event=>{event.preventDefault();dismiss();}} className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-lg bg-white p-6 text-slate-800 shadow-xl backdrop:bg-black/50">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">{operation==='trash'?'Move to Trash':operation==='add-tags'?'Select Tags':'Remove Tags'}</h2>
        <button aria-label="Close photo action" disabled={busy} onClick={dismiss} className="rounded p-1 text-2xl text-slate-500">×</button>
      </div>
      {operation==='trash'?<p className="mb-5 text-sm">Move {selected.length} selected photos/videos to trash?</p>:<input autoFocus aria-label="Tags for selected photos" value={tags} disabled={busy||!!batch} onChange={event=>setTags(event.target.value)} placeholder="Tags, separated by commas" className="mb-5 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"/>}
      <div className="flex justify-end gap-3">
        <button disabled={busy} onClick={dismiss} className="rounded-md border border-slate-300 px-4 py-2 text-sm">{batch?'Finish':'Cancel'}</button>
        <button disabled={busy} onClick={()=>{if(confirming&&!pending.current){pending.current=preparePhotoBatch(selected,'trash','');}void apply();}} className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?`Saving ${batch?.filter(item=>item.done).length??0}/${batch?.length??0}…`:batch?'Retry unfinished':operation==='trash'?'Move to Trash':operation==='add-tags'?'Tag Photos':'Remove Tags'}</button>
      </div>
      {message?<p role="status" className="mt-3 text-sm">{message}</p>:null}
      {batch?.some(item=>item.error)?<ul className="mt-2 max-h-32 overflow-auto text-sm text-red-700">{batch.filter(item=>item.error).map(item=><li key={item.item.id}>{item.item.originalFilename??'Photo'}: {item.error}</li>)}</ul>:null}
    </dialog>
  </>;
}
