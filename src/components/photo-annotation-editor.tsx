"use client";

import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import {PhotoAnnotationSurface} from './photo-annotation-surface';
import {annotationPoint,annotationDocumentSchema,type AnnotationDocument,type AnnotationShape,type AnnotationPoint} from '@/lib/photo-annotations';
import {changeAnnotations,undoAnnotations,redoAnnotations,moveAnnotation,type AnnotationHistory} from '@/lib/annotation-history';
import {savePhotoAnnotations} from '@/lib/actions/photo-annotations';

type Tool='select'|AnnotationShape['type'];
const tools:{id:Tool;label:string}[]=[{id:'select',label:'Select'},{id:'draw',label:'Draw'},{id:'line',label:'Line'},{id:'arrow',label:'Arrow'},{id:'rectangle',label:'Rectangle'},{id:'ellipse',label:'Circle'},{id:'text',label:'Text'}];
export function PhotoAnnotationEditor({src,alt,projectId,mediaId,initial,revision,onClose,onSaved}:{src:string;alt:string;projectId:string;mediaId:string;initial:AnnotationDocument;revision:string|null;onClose:()=>void;onSaved:(document:AnnotationDocument,revision:string)=>void}) {
  const [history,setHistory]=useState<AnnotationHistory>({past:[],present:initial,future:[]});
  const [tool,setTool]=useState<Tool>('select');
  const [color,setColor]=useState('#facc15');
  const [width,setWidth]=useState(.006);
  const [text,setText]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [preview,setPreview]=useState<AnnotationShape|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [discard,setDiscard]=useState(false);
  const [popover,setPopover]=useState<'color'|'width'|null>(null);
  const [clear,setClear]=useState(false);
  const [imageFailed,setImageFailed]=useState(false);
  const dialog=useRef<HTMLDivElement>(null);
  const gesture=useRef<{shape:AnnotationShape;start:AnnotationPoint;moving:boolean}|null>(null);
  const previewRef=useRef<AnnotationShape|null>(null);
  const pending=useRef<{json:string;revision:string}|null>(null);
  const dirty=JSON.stringify(initial)!==JSON.stringify(history.present);
  const requestClose=()=>{if(busy)return;if(dirty)setDiscard(true);else onClose();};
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();return()=>previous?.focus();},[]);
  useEffect(()=>{if(!dirty)return;const guard=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty]);
  function change(document:AnnotationDocument) {const parsed=annotationDocumentSchema.safeParse(document);if(!parsed.success){setError('Drawing limit reached. Remove a shape or shorten the text.');return;}setHistory(state=>changeAnnotations(state,parsed.data));setError(null);}
  function point(event:PointerEvent<SVGSVGElement>) {return annotationPoint(event.clientX,event.clientY,event.currentTarget.getBoundingClientRect());}
  function down(event:PointerEvent<SVGSVGElement>) {
    if(busy||gesture.current||event.button!==0)return;
    const start=point(event);event.currentTarget.setPointerCapture(event.pointerId);
    if(tool==='select') {
      const id=(event.target as Element).closest('[data-shape-id]')?.getAttribute('data-shape-id')??null;setSelected(id);
      const shape=history.present.shapes.find(item=>item.id===id);if(shape)gesture.current={shape,start,moving:true};return;
    }
    if(history.present.shapes.length>=200){setError('Maximum 200 shapes. Remove a shape first.');return;}
    if(tool==='text'&&!text.trim()){setError('Enter text, then click the photo to place it.');return;}
    const shape:AnnotationShape={id:crypto.randomUUID(),type:tool,points:tool==='text'?[start]:[start,start],color,width,...(tool==='text'?{text:text.trim(),fontSize:.04}:{})};
    if(tool==='text'){change({...history.present,shapes:[...history.present.shapes,shape]});setSelected(shape.id);return;}
    gesture.current={shape,start,moving:false};previewRef.current=shape;setPreview(shape);
  }
  function move(event:PointerEvent<SVGSVGElement>) {
    const current=gesture.current;if(!current)return;const end=point(event);
    const shape=current.moving?moveAnnotation(current.shape,end.x-current.start.x,end.y-current.start.y):{...current.shape,points:current.shape.type==='draw'?[...current.shape.points.slice(0,1999),end]:[current.start,end]};
    if(!current.moving)current.shape=shape;previewRef.current=shape;setPreview(shape);
  }
  function up() {const preview=previewRef.current;if(gesture.current&&preview){const moving=gesture.current.moving;change({...history.present,shapes:moving?history.present.shapes.map(shape=>shape.id===preview.id?preview:shape):[...history.present.shapes,preview]});setSelected(preview.id);}gesture.current=null;previewRef.current=null;setPreview(null);}
  async function save() {
    if(busy||gesture.current)return;const json=JSON.stringify(history.present);
    if(pending.current?.json!==json)pending.current={json,revision:crypto.randomUUID()};
    setBusy(true);setError(null);
    try {const result=await savePhotoAnnotations({projectId,mediaId,expectedRevision:revision,revision:pending.current.revision,document:history.present});if(result.ok)onSaved(result.document,result.revision);else setError(result.error);}
    catch {setError('Could not confirm the save. Your drawing is still here; retry safely.');}
    finally {setBusy(false);}
  }
  const drawing=preview?{...history.present,shapes:gesture.current?.moving?history.present.shapes.map(shape=>shape.id===preview.id?preview:shape):[...history.present.shapes,preview]}:history.present;
  const button='rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40';
  return createPortal(<div ref={dialog} tabIndex={-1} data-photo-editor role="dialog" aria-modal="true" aria-label="Edit photo drawings" className="fixed inset-0 z-[200] flex bg-[#222] text-slate-900" onTouchStart={event=>event.stopPropagation()} onTouchEnd={event=>event.stopPropagation()} onKeyDown={event=>{
    event.stopPropagation();
    if(event.key==='Tab'){const scope=event.currentTarget.querySelector('[role=alertdialog]')??event.currentTarget;const elements=[...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];const first=elements[0],last=elements.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}return;}
    if(event.key==='Escape'){event.preventDefault();if(discard)setDiscard(false);else if(clear)setClear(false);else requestClose();return;}
    if(busy||discard||clear||(event.target as HTMLElement).closest('input,textarea'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();setHistory(event.shiftKey?redoAnnotations:undoAnnotations);}
    if((event.key==='Delete'||event.key==='Backspace')&&selected){event.preventDefault();change({...history.present,shapes:history.present.shapes.filter(shape=>shape.id!==selected)});setSelected(null);}
  }}>
    <nav aria-label="Drawing tools" className="relative z-10 flex w-12 shrink-0 flex-col items-center overflow-y-auto border-r border-neutral-200 bg-white py-2">
      {tools.slice(0,3).map(item=><button key={item.id} disabled={busy} title={item.label} aria-label={item.label} aria-pressed={tool===item.id} className={`my-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-30 ${tool===item.id?'bg-slate-900 text-white':'hover:bg-neutral-100'}`} onClick={()=>{setTool(item.id);setSelected(null);setPopover(null);}}><DrawingIcon name={item.id}/></button>)}
      <div className="my-2 w-full border-t border-neutral-100"/>
      <button title="Colour" aria-label="Drawing colour" aria-expanded={popover==='color'} disabled={busy} className="flex h-8 w-8 shrink-0 items-center justify-center" onClick={()=>setPopover(popover==='color'?null:'color')}><span className="h-4 w-4 rounded border border-black/30" style={{background:color}}/></button>
      <button title="Thickness" aria-label="Drawing thickness" aria-expanded={popover==='width'} disabled={busy} className="flex h-8 w-8 shrink-0 items-center justify-center" onClick={()=>setPopover(popover==='width'?null:'width')}><span className="rounded-full bg-black" style={{width:Math.max(5,width*600),height:Math.max(5,width*600)}}/></button>
      <div className="my-2 w-full border-t border-neutral-100"/>
      {tools.slice(3).map(item=><button key={item.id} disabled={busy} title={item.label} aria-label={item.label} aria-pressed={tool===item.id} className={`my-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:opacity-30 ${tool===item.id?'bg-slate-900 text-white':'hover:bg-neutral-100'}`} onClick={()=>{setTool(item.id);setSelected(null);setPopover(null);}}><DrawingIcon name={item.id}/></button>)}
      <div className="my-2 w-full border-t border-neutral-100"/>
      {selected?<button title="Delete selected" aria-label="Delete selected" disabled={busy} className="flex h-8 w-8 shrink-0 items-center justify-center" onClick={()=>{change({...history.present,shapes:history.present.shapes.filter(shape=>shape.id!==selected)});setSelected(null);}}><DrawingIcon name="delete"/></button>:null}
      <div className="min-h-4 flex-1"/>
      <button title="Clear all" aria-label="Clear drawings" className="flex h-8 w-8 shrink-0 items-center justify-center disabled:opacity-30" disabled={busy||!history.present.shapes.length} onClick={()=>setClear(true)}><DrawingIcon name="clear"/></button>
      <button title="Undo" aria-label="Undo" className="flex h-8 w-8 shrink-0 items-center justify-center disabled:opacity-30" disabled={busy||!history.past.length} onClick={()=>setHistory(undoAnnotations)}><DrawingIcon name="undo"/></button>
      <button title="Redo" aria-label="Redo" className="flex h-8 w-8 shrink-0 items-center justify-center disabled:opacity-30" disabled={busy||!history.future.length} onClick={()=>setHistory(redoAnnotations)}><DrawingIcon name="redo"/></button>
    </nav>
    <div className="relative min-w-0 flex-1"><PhotoAnnotationSurface src={src} alt={alt} document={drawing} selected={selected} padding={0} onError={()=>setImageFailed(true)} handlers={{onPointerDown:down,onPointerMove:move,onPointerUp:up,onPointerCancel:()=>{gesture.current=null;previewRef.current=null;setPreview(null);}}}/></div>
    <div className="absolute right-5 top-5 z-20 flex flex-col gap-3">
      <button title="Close" aria-label="Close editor" className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow disabled:opacity-40" disabled={busy} onClick={requestClose}><DrawingIcon name="close"/></button>
      {dirty?<button title="Save" aria-label="Save drawing" className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-white shadow disabled:opacity-40" disabled={busy||imageFailed} onClick={()=>void save()}>{busy?<span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"/>:<DrawingIcon name="check"/>}</button>:null}
    </div>
    {popover?<div className="absolute left-14 top-28 z-20 rounded bg-white p-3 shadow-lg">{popover==='color'?<input autoFocus type="color" aria-label="Choose drawing colour" value={color} disabled={busy} onChange={event=>setColor(event.target.value)}/>:<input autoFocus aria-label="Thickness" type="range" min="0.002" max="0.025" step="0.001" value={width} disabled={busy} onChange={event=>setWidth(Number(event.target.value))}/>}</div>:null}
    {tool==='text'?<div className="absolute left-14 top-64 z-20 rounded bg-white p-2 shadow-lg"><textarea aria-label="Drawing text" className="w-52 rounded border p-2 text-sm" maxLength={1000} value={text} disabled={busy} onChange={event=>setText(event.target.value)} placeholder="Enter text"/></div>:null}
    {error||imageFailed?<p role="alert" className="absolute bottom-4 left-16 right-16 z-20 rounded bg-white px-3 py-2 text-sm text-red-700">{imageFailed?'Photo could not load. Close and reopen the editor.':error}</p>:null}
    {discard||clear?<div className="absolute inset-0 flex items-center justify-center bg-black/50 p-5"><div role="alertdialog" aria-modal="true" aria-label={discard?'Discard drawing changes?':'Clear all drawings?'} className="max-w-sm rounded-xl bg-white p-5 shadow-xl"><h3 className="font-semibold">{discard?'Discard drawing changes?':'Clear all drawings?'}</h3><p className="my-3 text-sm">{discard?'Your unsaved changes will be lost.':'You can undo this before saving.'}</p><div className="flex gap-2"><button autoFocus className={button} onClick={()=>{setDiscard(false);setClear(false);}}>Keep editing</button><button className={`${button} text-red-700`} onClick={()=>{if(discard)onClose();else{change({version:1,shapes:[]});setClear(false);setSelected(null);}}}>{discard?'Discard':'Clear'}</button></div></div></div>:null}
  </div>,document.body);
}

function DrawingIcon({name}:{name:string}) {
  const paths:Record<string,string>={select:'M5 3l14 10-7 1-3 7z',draw:'M4 15C1 9 17 2 15 6S3 19 8 20s15-9 10-8',line:'M4 20L20 4',arrow:'M5 19L19 5M9 5h10v10',rectangle:'M5 5h14v14H5z',text:'M5 5h14M12 5v15M9 20h6',undo:'M8 7L3 12l5 5M3 12h11a6 6 0 010 12',redo:'M16 7l5 5-5 5M21 12H10a6 6 0 000 12',clear:'M4 9a9 9 0 111 10M4 3v6h6',delete:'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',close:'M6 6l12 12M18 6L6 18',check:'M5 12l4 4L19 6'};
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{name==='ellipse'?<circle cx="12" cy="12" r="8"/>:<path d={paths[name]??paths.select}/>}</svg>;
}
