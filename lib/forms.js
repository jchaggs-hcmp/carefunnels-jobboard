'use strict';
// Parses a CareFunnels (GoHighLevel / LeadConnector) form embed into a safe, structured description.
// We never echo the pasted HTML back to visitors — we rebuild the iframe ourselves from validated parts.
//
// Accepts either:
//   • the full "Embed" code copied from CareFunnels → Sites → Forms → Integrate → Embed, e.g.
//       <iframe src="https://api.leadconnectorhq.com/widget/form/AbC123" style="width:100%;height:100%;border:none"
//         id="inline-AbC123" data-layout="{'id':'INLINE'}" data-form-id="AbC123" data-height="812" ...></iframe>
//       <script src="https://link.msgsndr.com/js/form_embed.js"></script>
//   • or just the form's share link, e.g. https://link.carefunnels.com/widget/form/AbC123

const DEFAULT_SCRIPT = 'https://link.msgsndr.com/js/form_embed.js';

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? '';
  return out;
}
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function httpsUrl(u) {
  try { const x = new URL(decode(u).trim()); return x.protocol === 'https:' ? x : null; } catch { return null; }
}

/** @returns {null | {src, form_id, kind, height, iframe_attrs, script_src}} */
function parseFormEmbed(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let src, a = {}, scriptSrc = null;

  const iframe = raw.match(/<iframe\b[^>]*>/i);
  if (iframe) {
    a = attrs(iframe[0]);
    src = httpsUrl(a.src || '');
    const sc = [...raw.matchAll(/<script\b[^>]*>/gi)].map((m) => attrs(m[0]).src).find((s) => s && /\/form_embed\.js(\?|$)/.test(s));
    const scUrl = sc && httpsUrl(sc);
    if (scUrl) scriptSrc = scUrl.href;
  } else {
    src = httpsUrl(raw);
  }
  if (!src) throw Object.assign(new Error('Application form must be a CareFunnels form embed code or an https:// form link.'), { status: 400 });

  const m = src.pathname.match(/\/widget\/(form|survey|quiz)\/([\w-]+)/);
  const kind = m ? m[1] : 'form';
  const formId = a['data-form-id'] || (m && m[2]) || null;

  // keep only attributes GHL's form_embed.js uses for auto-height / layout / tracking
  const keep = {};
  for (const [k, v] of Object.entries(a)) if (/^data-[\w-]+$/.test(k) || k === 'title') keep[k] = decode(v).slice(0, 500);
  keep.id = formId ? `inline-${formId}` : 'inline-hc-form';
  if (formId) keep['data-form-id'] = formId;

  const height = parseInt(a['data-height'], 10) || null;
  return { src: src.href, form_id: formId, kind, height, iframe_attrs: keep, script_src: scriptSrc || DEFAULT_SCRIPT };
}

/** The form that applies to a job: job override → agency default → none (use built-in form). */
function resolveApplyForm(agency, job) {
  try { return parseFormEmbed(job?.apply_form_embed) || parseFormEmbed(agency.apply_form_embed); } catch { return null; }
}

module.exports = { parseFormEmbed, resolveApplyForm };
