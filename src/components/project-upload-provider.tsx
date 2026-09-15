"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { listUploadScopes } from '@/lib/media-upload-storage';
import { ProjectUploadSession, type UploadSummary } from '@/components/project-media-upload';
import { Button } from '@/components/ui';

type ProjectQueue = {projectId:string;isLead:boolean;label:string;summary?:UploadSummary};
const queueKey=(projectId:string,isLead:boolean)=>`${isLead?'leads':'jobs'}/${projectId}`;
const UploadContext=createContext<{register:(projectId:string,isLead:boolean,label:string)=>void;open:(key:string)=>void;ready:boolean}|null>(null);

/** Root-layout ownership keeps transfers alive when a project page unmounts. */
export function ProjectUploadProvider({children}:{children:React.ReactNode}) {
  const [userId,setUserId]=useState<string|null>(null);
  const owner=useRef<string|null>(null);
  const [queues,setQueues]=useState<Map<string,ProjectQueue>>(()=>new Map());
  const [openKey,setOpenKey]=useState<string|null>(null);
  const [expanded,setExpanded]=useState(false);
  const [recoveryError,setRecoveryError]=useState(false);
  useEffect(()=>{
    let disposed=false;
    async function account(id:string|null) {
      if(disposed||owner.current===id)return;
      owner.current=id;setUserId(id);setQueues(new Map());setOpenKey(null);setRecoveryError(false);
      if(!id)return;
      try {
        const scopes=await listUploadScopes(id);
        if(disposed||owner.current!==id)return;
        setQueues(current=>{
          const next=new Map(current);
          for(const scope of scopes) {
            const [kind,projectId]=scope.slice(id.length+1).split('/');
            if(!['leads','jobs'].includes(kind)||!projectId)continue;
            const key=queueKey(projectId,kind==='leads');
            if(!next.has(key))next.set(key,{projectId,isLead:kind==='leads',label:`Recovered project ${projectId.slice(0,8)}`});
          }
          return next;
        });
      } catch {if(!disposed&&owner.current===id)setRecoveryError(true);}
    }
    const auth=createClient().auth;
    const {data:{subscription}}=auth.onAuthStateChange((_event,session)=>{void account(session?.user.id??null);});
    return ()=>{disposed=true;owner.current=null;subscription.unsubscribe();};
  },[]);
  const register=useCallback((projectId:string,isLead:boolean,label:string)=>{
    if(!userId)return;
    const key=queueKey(projectId,isLead);
    setQueues(current=>{const old=current.get(key);if(old?.label===label)return current;const next=new Map(current);next.set(key,{...old,projectId,isLead,label});return next;});
  },[userId]);
  const summary=useCallback((projectId:string,isLead:boolean,value:UploadSummary)=>{
    const key=queueKey(projectId,isLead);
    setQueues(current=>{const old=current.get(key);if(!old)return current;const next=new Map(current);next.set(key,{...old,summary:value});return next;});
  },[]);
  const active=[...queues.entries()].filter(([,queue])=>queue.summary?.total);
  const remaining=active.reduce((sum,[,queue])=>sum+(queue.summary?.remaining??0),0);
  return <UploadContext.Provider value={{register,open:setOpenKey,ready:!!userId}}>
    {children}
    {userId?[...queues.entries()].map(([key,queue])=><ProjectUploadSession key={`${userId}/${key}`} projectId={queue.projectId} isLead={queue.isLead} open={key===openKey} onOpen={open=>setOpenKey(open?key:null)} onSummary={summary}/>):null}
    {!openKey&&active.length?<div className="fixed bottom-5 right-5 z-40 max-w-xs rounded-xl border border-slate-300 bg-white p-3 shadow-lg">
      <button onClick={()=>setExpanded(value=>!value)} className="px-2 py-1 text-sm font-semibold" aria-expanded={expanded} aria-live="polite">{remaining?`${remaining} uploads in progress`:'Uploads'} · {active.length} {active.length===1?'project':'projects'}</button>
      {expanded?<ul className="mt-2 max-h-56 overflow-auto">{active.map(([key,queue])=><li key={key}><button onClick={()=>setOpenKey(key)} className="block w-full rounded-lg p-2 text-left text-sm hover:bg-slate-100"><span className="block truncate font-medium">{queue.label}</span><span className="text-xs text-slate-500">{queue.summary?.complete}/{queue.summary?.total} uploaded{queue.summary?.failed?` · ${queue.summary.failed} need attention`:''}</span></button></li>)}</ul>:null}
    </div>:null}
    {recoveryError?<p role="alert" className="fixed bottom-2 left-2 z-40 max-w-sm rounded border bg-white p-3 text-sm text-red-700">Could not recover saved uploads. Allow browser storage and reload.</p>:null}
  </UploadContext.Provider>;
}

export function ProjectMediaUpload({projectId,isLead,label='Project photos'}:{projectId:string;isLead:boolean;label?:string}) {
  const context=useContext(UploadContext);
  const register=context?.register;
  useEffect(()=>{register?.(projectId,isLead,label);},[register,projectId,isLead,label]);
  return <Button type="button" disabled={!context?.ready} onClick={()=>context?.open(queueKey(projectId,isLead))}>＋ Upload photos</Button>;
}
