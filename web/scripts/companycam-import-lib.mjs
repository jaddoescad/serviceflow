import { createHash } from 'node:crypto';
import { sanitizeRichText } from '../src/lib/rich-text.ts';

export const ORG = 'fa66dad2-0401-400d-a504-dafba2ebf71b';
export function leadMatchesProject(lead, project) {
  const sourceEmail = project.primary_contact?.email?.trim().toLowerCase();
  const leadEmail = lead.contacts?.email?.trim().toLowerCase();
  if (!sourceEmail) {
    const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
    const street = norm(project.address?.street_address_1), city = norm(project.address?.city);
    const address = norm(lead.address), postal = norm(project.address?.postal_code);
    const sourceName = norm(project.name), leadName = norm(lead.contacts?.name);
    const sameName = sourceName && (sourceName === leadName || sourceName + sourceName === leadName);
    const difference = Math.abs(Date.parse(project.created_at) - Date.parse(lead.created_at));
    return Boolean(street.length >= 8 && address.startsWith(street) && city.length >= 3 && address.includes(city) && (!postal || address.includes(postal) || norm(lead.postal_code) === postal) && sameName && Number.isFinite(difference) && difference <= 6*60*60*1000);
  }
  if (!sourceEmail || sourceEmail !== leadEmail) return false;
  const directDifference = Math.abs(Date.parse(project.created_at) - Date.parse(lead.created_at));
  if (Number.isFinite(directDifference) && directDifference <= 60000) return true;
  const sourcePhone = String(project.primary_contact?.phone_number ?? '').replace(/\D/g,'');
  const leadPhone = String(lead.contacts?.phone ?? '').replace(/\D/g,'');
  if (sourcePhone.length >= 7 && sourcePhone === leadPhone && Number.isFinite(directDifference) && Math.abs(directDifference - 4*60*60*1000) <= 60000) return true;
  const name = String(project.primary_contact?.name ?? '').trim();
  const title = String(project.name ?? '');
  const timestamp = name && title.startsWith(`${name} - `) ? Date.parse(`${title.slice(name.length + 3).replace(/Z$/, '')}Z`) : NaN;
  const difference = Math.abs(Date.parse(lead.created_at) - timestamp);
  if (sourcePhone.length < 7 || sourcePhone !== leadPhone || !Number.isFinite(difference)) return false;
  if (difference < 1000 || Math.abs(difference - 4*60*60*1000) < 1000 || Math.abs(difference - 8*60*60*1000) < 1000) return true;
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(lead.created_at));
  const values = Object.fromEntries(parts.map(part => [part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}` === new Date(timestamp).toISOString().slice(0,10) && values.hour === '00' && values.minute === '00' && values.second === '00';
}
export function sourceUuid(kind, sourceId) {
  const hash = createHash('sha256').update(`serviceflow:${ORG}:companycam:${kind}:${sourceId}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function projectMap(jobs) {
  const result = new Map();
  for (const job of jobs) for (const id of job.companycam_project_ids ?? []) {
    const key = String(id);
    result.set(key, result.has(key) && result.get(key)?.id !== job.id ? null : job);
  }
  return result;
}
export function sourceUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['companycam.com', 'companycam.imgix.net', 'amazonaws.com'].some(base => host === base || host.endsWith(`.${base}`))) {
    throw new Error('Unsupported CompanyCam image host');
  }
  return url.href;
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export function photoUrl(photo) {
  const uri = photo.uris?.find(item => item.type === 'original');
  if (!uri) throw new Error(`Photo ${photo.id} has no original`);
  return sourceUrl(uri.url || uri.uri);
}

/** Convert structured content, never execute or copy upstream HTML. Image
 * callbacks must return an authenticated ServiceFlow document image path. */
export async function renderPage(page, saveImage) {
  const images = new Map();
  async function render(node) {
    if (!node) return '';
    const attrs = node.attrs ?? {};
    if (node.type === 'text') {
      let text = escape(node.text);
      for (const mark of node.marks ?? []) {
        const tag = {bold:'strong', italic:'em', underline:'u', strike:'s'}[mark.type];
        if (tag) text = `<${tag}>${text}</${tag}>`;
        else if (mark.type === 'link') text = `<a href="${escape(mark.attrs?.href)}">${text}</a>`;
        else if (mark.type === 'textStyle') text = `<span style="color:${escape(mark.attrs?.color)}">${text}</span>`;
      }
      return text;
    }
    if (['image','flexPhoto','photo'].includes(node.type) && attrs.src) {
      const src = sourceUrl(attrs.src);
      if (!images.has(src)) images.set(src, await saveImage(src));
      const caption = (await Promise.all((node.content ?? []).map(render))).join('');
      return `<img src="${escape(images.get(src))}" alt="${escape(attrs.alt)}">${caption}`;
    }
    const content = (await Promise.all((node.content ?? []).map(render))).join('');
    const style = /^(left|center|right|justify)$/.test(attrs.textAlign ?? '') ? ` style="text-align:${attrs.textAlign}"` : '';
    const tags = {paragraph:'p', bulletList:'ul', orderedList:'ol', listItem:'li', blockquote:'blockquote', table:'table', tableRow:'tr', tableCell:'td', tableHeader:'th'};
    if (tags[node.type]) {
      const tag = tags[node.type];
      const span = ['td','th'].includes(tag) ? ` colspan="${Number(attrs.colspan) || 1}" rowspan="${Number(attrs.rowspan) || 1}"` : '';
      return `<${tag}${style}${span}>${content}</${tag}>`;
    }
    if (node.type === 'heading') { const level = Math.max(1, Math.min(3, Number(attrs.level) || 2)); return `<h${level}${style}>${content}</h${level}>`; }
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'horizontalRule') return '<hr>';
    if (node.type === 'pageBreak') return '<hr data-page-break="true">';
    if (node.type === 'taskList') return `<ul data-checklist="true">${content}</ul>`;
    if (node.type === 'taskItem') return `<li data-checked="${attrs.checked === true}">${content}</li>`;
    if (node.type === 'photoCaptureDetailsV2' || (node.type === 'photo' && !attrs.src)) return '';
    if (['doc','headerFooterColumn','flexGroup','flexPhoto_textSlot','horizontalLayout','horizontalLayout_photoSlot','horizontalLayout_headingTextSlot','horizontalLayout_textSlot'].includes(node.type)) return content;
    throw new Error(`Unsupported CompanyCam content node: ${node.type}`);
  }
  let html;
  if (page.tiptap_content) {
    html = await render(page.tiptap_content.attrs?.headerContent) + await render(page.tiptap_content) + await render(page.tiptap_content.attrs?.footerContent);
  } else if (page.raw_content) {
    html = `<p>${escape(page.raw_content).replace(/\n/g, '<br>')}</p>`;
  } else throw new Error(`Page ${page.id} has no readable content`);
  html = sanitizeRichText(html);
  if (html.length > 1_000_000) throw new Error('Page exceeds document size limit');
  return { html, images: images.size };
}
