import { createHash } from 'node:crypto';
import { sanitizeRichText } from '../src/lib/rich-text.ts';

export const ORG = 'fa66dad2-0401-400d-a504-dafba2ebf71b';
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
