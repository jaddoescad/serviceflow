"use client";

import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import {PhotoAnnotationSurface} from './photo-annotation-surface';
import {annotationPoint,annotationDocumentSchema,type AnnotationDocument,type AnnotationShape,type AnnotationPoint} from '@/lib/photo-annotations';
import {changeAnnotations,undoAnnotations,redoAnnotations,moveAnnotation,type AnnotationHistory} from '@/lib/annotation-history';
import {savePhotoAnnotations} from '@/lib/actions/photo-annotations';

type Tool='select'|AnnotationShape['type'];
const tools:{id:Tool;label:string}[]=[{id:'select',label:'Select'},{id:'draw',label:'Draw'},{id:'arrow',label:'Arrow'},{id:'line',label:'Line'},{id:'rectangle',label:'Rectangle'},{id:'ellipse',label:'Circle'},{id:'text',label:'Text'}];
export function PhotoAnnotationEditor({src,alt,projectId,mediaId,initial,revision,onClose,onSaved}:{src:string;alt:string;projectId:string;mediaId:string;initial:AnnotationDocument;revision:string|null;onClose:()=>void;onSaved:(document:AnnotationDocument,revision:string)=>void}) {
  const [history,setHistory]=useState<AnnotationHistory>({past:[],present:initial,future:[]});
  const [tool,setTool]=useState<Tool>('arrow');
  const [color,setColor]=useState('#facc15');
  const [width,setWidth]=useState(.006);
  const [text,setText]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [preview,setPreview]=useState<AnnotationShape|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [discard,setDiscard]=useState(false);
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
  return createPortal(<div ref={dialog} tabIndex={-1} data-photo-editor role="dialog" aria-modal="true" aria-label="Edit photo drawings" className="fixed inset-0 z-[200] flex flex-col bg-slate-100 text-slate-900" onTouchStart={event=>event.stopPropagation()} onTouchEnd={event=>event.stopPropagation()} onKeyDown={event=>{
    event.stopPropagation();
    if(event.key==='Tab'){const scope=event.currentTarget.querySelector('[role=alertdialog]')??event.currentTarget;const elements=[...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')];const first=elements[0],last=elements.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}return;}
    if(event.key==='Escape'){event.preventDefault();if(discard)setDiscard(false);else if(clear)setClear(false);else requestClose();return;}
    if(busy||discard||clear||(event.target as HTMLElement).closest('input,textarea'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();setHistory(event.shiftKey?redoAnnotations:undoAnnotations);}
    if((event.key==='Delete'||event.key==='Backspace')&&selected){event.preventDefault();change({...history.present,shapes:history.present.shapes.filter(shape=>shape.id!==selected)});setSelected(null);}
  }}>
    <header className="flex items-center justify-between gap-3 border-b bg-white px-5 py-3"><div><p className="text-xs font-semibold text-slate-500">ServiceFlow</p><h2 className="font-semibold">Edit photo</h2></div><div className="flex gap-2"><button className={button} disabled={busy} onClick={requestClose}>Cancel</button><button className={`${button} bg-emerald-700 text-white`} disabled={busy||imageFailed||!dirty} onClick={()=>void save()}>{busy?'Saving…':'Save drawing'}</button></div></header>
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row"><nav aria-label="Drawing tools" className="flex gap-1 overflow-auto border-r bg-white p-2 sm:w-32 sm:flex-col">{tools.map(item=><button key={item.id} disabled={busy} aria-pressed={tool===item.id} className={`${button} ${tool===item.id?'border-emerald-600 bg-emerald-50 text-emerald-900':''}`} onClick={()=>{setTool(item.id);setSelected(null);}}>{item.label}</button>)}</nav>
      <div className="relative min-h-40 flex-1 bg-slate-950"><PhotoAnnotationSurface src={src} alt={alt} document={drawing} selected={selected} onError={()=>setImageFailed(true)} handlers={{onPointerDown:down,onPointerMove:move,onPointerUp:up,onPointerCancel:()=>{gesture.current=null;previewRef.current=null;setPreview(null);}}}/>{imageFailed?<p role="alert" className="absolute inset-x-0 top-4 text-center text-white">Photo could not load. Close and reopen the editor.</p>:null}</div>
      <aside className="space-y-3 border-l bg-white p-4 sm:w-56"><p className="text-sm font-semibold">Drawing properties</p><label className="flex items-center justify-between text-sm">Colour<input type="color" aria-label="Drawing colour" value={color} disabled={busy} onChange={event=>setColor(event.target.value)}/></label><label className="block text-sm">Thickness<input className="mt-2 w-full" type="range" min="0.002" max="0.025" step="0.001" value={width} disabled={busy} onChange={event=>setWidth(Number(event.target.value))}/></label>{tool==='text'?<label className="block text-sm">Text<textarea className="mt-2 w-full rounded border p-2" maxLength={1000} value={text} disabled={busy} onChange={event=>setText(event.target.value)} placeholder="Add a note, then click the photo"/></label>:null}{selected?<button disabled={busy} className={button} onClick={()=>{change({...history.present,shapes:history.present.shapes.filter(shape=>shape.id!==selected)});setSelected(null);}}>Delete selected</button>:null}<p className="text-xs text-slate-500">Choose a tool and drag on the photo. Select a drawing to move it. The original photo stays unchanged.</p></aside>
    </div>
    <footer className="flex flex-wrap items-center gap-2 border-t bg-white px-4 py-3"><button className={button} disabled={busy||!history.past.length} onClick={()=>setHistory(undoAnnotations)}>Undo</button><button className={button} disabled={busy||!history.future.length} onClick={()=>setHistory(redoAnnotations)}>Redo</button><button className={button} disabled={busy||!history.present.shapes.length} onClick={()=>setClear(true)}>Clear drawings</button><span className="text-xs text-slate-500">{history.present.shapes.length}/200 shapes</span>{error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}</footer>
    {discard||clear?<div className="absolute inset-0 flex items-center justify-center bg-black/50 p-5"><div role="alertdialog" aria-modal="true" aria-label={discard?'Discard drawing changes?':'Clear all drawings?'} className="max-w-sm rounded-xl bg-white p-5 shadow-xl"><h3 className="font-semibold">{discard?'Discard drawing changes?':'Clear all drawings?'}</h3><p className="my-3 text-sm">{discard?'Your unsaved changes will be lost.':'You can undo this before saving.'}</p><div className="flex gap-2"><button autoFocus className={button} onClick={()=>{setDiscard(false);setClear(false);}}>Keep editing</button><button className={`${button} text-red-700`} onClick={()=>{if(discard)onClose();else{change({version:1,shapes:[]});setClear(false);setSelected(null);}}}>{discard?'Discard':'Clear'}</button></div></div></div>:null}
  </div>,document.body);
}
