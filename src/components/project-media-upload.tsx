"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectModal } from "@/components/project-profile-panel";
import { UploadPhotoTile } from "./upload-photo-tile";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { uploadFailure, uploadRetryAt } from "@/lib/upload-retry";
import { projectUploadSlots } from "@/lib/upload-slots";
import { appendUploadFiles, mediaMime, retryUploadItem, validateMediaFile, type UploadItem } from "@/lib/media-upload-queue";
import { forgetUploads, loadUploads, storeUploads } from "@/lib/media-upload-storage";

const MEDIA_API_URL = (process.env.NEXT_PUBLIC_PROJECT_MEDIA_API_URL || "https://project-media-worker.jadslim-fai.workers.dev").replace(/\/+$/, "");

export type UploadSummary = {total:number;remaining:number;complete:number;failed:number};
export function ProjectUploadSession({projectId,isLead,open,onOpen,onSummary}: {
  projectId:string;isLead:boolean;open:boolean;onOpen:(open:boolean)=>void;
  onSummary:(projectId:string,isLead:boolean,summary:UploadSummary)=>void;
}) {
  const router=useRouter();
  const input=useRef<HTMLInputElement>(null);
  const requests=useRef(new Map<string,XMLHttpRequest>());
  const waiting=useRef(new Map<string,AbortController>());
  const active=useRef(new Map<string,symbol>());
  const mounted=useRef(true);

  const [drag,setDrag]=useState(false);
  const [items,setItems]=useState<UploadItem[]>([]);
  const [scope,setScope]=useState<string|null>(null);
  const [storageError,setStorageError]=useState<string|null>(null);
  const [preparing,setPreparing]=useState(false);
  const adding=useRef(false);
  const remaining=items.filter(i=>i.status==='queued'||i.status==='uploading').length;
  const complete=items.filter(i=>i.status==='complete').length;
  const failed=items.filter(i=>i.status==='failed').length;

  useEffect(()=>{onSummary(projectId,isLead,{total:items.length,remaining,complete,failed});},[projectId,isLead,items.length,remaining,complete,failed,onSummary]);

  function patch(id:string,changes:Partial<UploadItem>) {
    if (mounted.current) setItems(current=>current.map(i=>i.id===id?{...i,...changes}:i));
  }
  useEffect(()=>{
    mounted.current=true;
    return ()=>{ mounted.current=false; waiting.current.forEach(controller=>controller.abort()); requests.current.forEach(xhr=>xhr.abort()); };
  },[]);
  useEffect(()=>{
    let disposed=false;
    async function recover() {
      try {
        const {data:{session}}=await createClient().auth.getSession();
        if(!session)throw new Error('Sign in to upload photos.');
        const nextScope=`${session.user.id}/${isLead?'leads':'jobs'}/${projectId}`;
        const saved=await loadUploads(nextScope);
        if(disposed)return;
        setItems(saved); setScope(nextScope);
      } catch {if(!disposed)setStorageError('Upload recovery storage is unavailable. Allow this site to store data, then reload.');}
    }
    void recover();
    return()=>{disposed=true;};
  },[projectId,isLead]);
  useEffect(()=>{
    if (!remaining) return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault(); event.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[remaining]);

  useEffect(()=>{
    const delayed=items.filter(item=>item.status==='queued'&&(item.retryAt??0)>Date.now());
    if(!delayed.length)return;
    const next=Math.min(...delayed.map(item=>item.retryAt!));
    const timer=setTimeout(()=>setItems(current=>[...current]),Math.max(1,next-Date.now()));
    return ()=>clearTimeout(timer);
  },[items]);

  useEffect(()=>{
    if(!scope?.endsWith(`/${isLead?'leads':'jobs'}/${projectId}`))return;
    async function send(item:UploadItem) {
      const attempt=Symbol();
      const controller=new AbortController();
      waiting.current.set(item.id,controller);
      active.current.set(item.id,attempt);
      const attempts=(item.attempts??0)+1;
      patch(item.id,{status:'uploading',error:undefined,attempts,retryAt:undefined});
      let release:(()=>void)|undefined;
      try {
        release=await projectUploadSlots.acquire(controller.signal);
        if(!mounted.current||active.current.get(item.id)!==attempt)return;
        const {data:{session},error}=await createClient().auth.getSession();
        if (error||!session) throw new Error('Session expired. Sign in again, then retry.');
        if(!scope!.startsWith(`${session.user.id}/`))throw new Error('The signed-in account changed. Reload before uploading.');
        if (!mounted.current || active.current.get(item.id)!==attempt) return;
        await storeUploads(scope!,[{...item,status:'uploading',attempts,retryAt:undefined}]);
        if (!mounted.current || active.current.get(item.id)!==attempt) return;
        await new Promise<void>((resolve,reject)=>{
          const xhr=new XMLHttpRequest();
          requests.current.set(item.id,xhr);
          xhr.open('PUT',`${MEDIA_API_URL}/v1/${isLead?'leads':'jobs'}/${encodeURIComponent(projectId)}/media`);
          xhr.timeout=180000;
          const mime=mediaMime(item.file)!;
          xhr.setRequestHeader('Authorization',`Bearer ${session.access_token}`);
          xhr.setRequestHeader('Content-Type',mime);
          xhr.setRequestHeader('x-media-type',mime.startsWith('video/')?'video':'image');
          xhr.setRequestHeader('x-upload-id',item.id);
          xhr.setRequestHeader('x-file-size',String(item.file.size));
          // HTTP headers accept Latin-1 only. The original filename is displayed
          // locally; encode non-ASCII names for safe transport.
          xhr.setRequestHeader('x-original-filename',encodeURIComponent(item.file.name));
          xhr.setRequestHeader('x-filename-encoding','uri');
          xhr.setRequestHeader('x-captured-at',new Date(item.file.lastModified||Date.now()).toISOString());
          xhr.upload.onprogress=event=>{if(event.lengthComputable)patch(item.id,{progress:Math.min(99,Math.round(event.loaded/event.total*100))});};
          xhr.onload=()=>{
            if(xhr.status>=200&&xhr.status<300) {
              try {const row=JSON.parse(xhr.responseText);if(row.id!==item.id)throw new Error(); resolve();}
              catch {reject(uploadFailure('Could not confirm this upload. Retrying will check its status.',0));}
            } else {
              let message=`Upload failed (${xhr.status}). Retry this file.`;
              try {message=JSON.parse(xhr.responseText).error||message;}catch{}
              reject(uploadFailure(message,xhr.status,xhr.getAllResponseHeaders().toLowerCase().includes('retry-after:')?xhr.getResponseHeader('Retry-After'):null));
            }
          };
          xhr.onerror=()=>reject(uploadFailure('Connection interrupted.',0));
          xhr.ontimeout=()=>reject(uploadFailure('Upload timed out. Retrying will check its status.',0));
          xhr.onabort=()=>reject(new DOMException('Upload cancelled','AbortError'));
          xhr.send(item.file);
        });
        patch(item.id,{status:'complete',progress:100});
        await forgetUploads(scope!,[item.id]).catch(()=>{setStorageError('Upload saved. Local recovery cleanup will retry when you reopen this page.');});
        router.refresh();
      } catch(error) {
        if(active.current.get(item.id)===attempt) {
          const retryAt=uploadRetryAt(error,attempts);
          const changes:Partial<UploadItem>={attempts,retryAt:retryAt??undefined,progress:0,
            status:error instanceof DOMException&&error.name==='AbortError'?'cancelled':retryAt!==null?'queued':'failed',
            error:retryAt!==null?`Connection unavailable. Retrying automatically (${attempts}/3)…`:error instanceof Error?error.message:'Upload failed.'};
          patch(item.id,changes);
          if(mounted.current)await storeUploads(scope!,[{...item,...changes}]).catch(()=>setStorageError('Could not save the latest queue status. Keep this page open until uploads finish.'));
        }
      } finally {
        release?.();
        if(active.current.get(item.id)===attempt) {
          waiting.current.delete(item.id);
          requests.current.delete(item.id);
          active.current.delete(item.id);
        }
        // Release the next queue slot even when authentication failed.
        if(mounted.current)setItems(current=>[...current]);
      }
    }
    for(const item of items) {
      if(active.current.size>=2)break;
      if(item.status==='queued'&&(item.retryAt??0)<=Date.now()&&!active.current.has(item.id))void send(item);
    }
  },[items,projectId,isLead,router,scope]);

  function cancel(id:string) {
    waiting.current.get(id)?.abort();
    const xhr=requests.current.get(id);
    if(xhr)xhr.abort();
    else {
      waiting.current.delete(id);
      active.current.delete(id);patch(id,{status:'cancelled',error:'Upload cancelled.'});
      const item=items.find(i=>i.id===id);
      if(scope&&item)void storeUploads(scope,[{...item,status:'cancelled'}]).catch(()=>setStorageError('Could not retain cancellation. Clear the queue before leaving.'));
    }
  }
  async function add(files:File[]) {
    if(!scope||adding.current)return;
    adding.current=true;setPreparing(true);setStorageError(null);
    const next=appendUploadFiles(items,files);
    const added=next.filter(item=>!items.some(existing=>existing.id===item.id));
    try {
      await storeUploads(scope,added);
      if(mounted.current)setItems(current=>[...current,...added]);
    } catch {setStorageError('Not enough local storage to prepare these files. Free some space or choose a smaller batch. No new uploads were started.');}
    finally {adding.current=false;if(mounted.current)setPreparing(false);}
  }
  async function retry(item:UploadItem) {
    if(!scope)return;
    const next=retryUploadItem(item);
    try {await storeUploads(scope,[next]);patch(item.id,next);}
    catch {setStorageError('Could not prepare the retry. Check available browser storage.');}
  }
  async function clear() {
    if(!scope)return;
    try {await forgetUploads(scope,items.map(item=>item.id));setItems([]);}
    catch {setStorageError('Could not clear the local queue. Try again.');}
  }

  return <>
    {open?<ProjectModal title="Add Photos" onClose={()=>onOpen(false)}>
      <div className="space-y-4 p-6">
        <input ref={input} aria-label="Choose photos and videos" type="file" multiple className="sr-only" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,.heic,.heif,.mov,.m4v" onChange={event=>{add(Array.from(event.target.files??[]));event.target.value='';}} />
        <button type="button" disabled={!scope||preparing} onClick={()=>input.current?.click()} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);void add(Array.from(e.dataTransfer.files));}} className={`min-h-44 w-full border border-dashed p-9 text-center disabled:opacity-50 ${drag?'border-[var(--color-brand)] bg-[var(--color-brand-soft)]':'border-blue-700'}`}>
          <span className="block text-base text-[var(--color-muted)]">Drag &amp; drop photos here or click to upload to this project.</span>
        </button>
        <p className="text-xs text-[var(--color-muted)]">Photos up to 25 MB · videos up to 95 MB</p>
        {preparing?<p role="status" className="text-sm">Preparing uploads…</p>:null}
        {storageError?<p role="alert" className="text-sm text-red-700">{storageError}</p>:null}
        {items.length?<ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4" aria-label="Upload queue">{items.map(item=><UploadPhotoTile key={item.id} item={item} onCancel={()=>cancel(item.id)} onRetry={()=>void retry(item)}/>)}</ul>:null}
        {items.length>0?<div className="flex items-center justify-between border-t border-[var(--color-border)] pt-4">
          <span className="text-sm text-[var(--color-muted)]" aria-live="polite">{complete} uploaded{failed?` · ${failed} failed`:''}</span>
          <div className="flex gap-2">{!remaining&&!preparing&&items.length?<Button variant="ghost" onClick={()=>void clear()}>Clear list</Button>:null}<Button onClick={()=>onOpen(false)}>Done</Button></div>
        </div>:null}
      </div>
    </ProjectModal>:null}
  </>;
}
