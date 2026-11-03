'use strict';
// Server-rendered career pages, Google for Jobs structured data, and job-board feeds.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cdata = (s) => `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

const TYPE_LABEL = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', PER_DIEM: 'Per diem', CONTRACTOR: 'Contract', TEMPORARY: 'Temporary' };
const UNIT_LABEL = { HOUR: 'hr', DAY: 'day', WEEK: 'wk', MONTH: 'mo', YEAR: 'yr' };

function payText(j) {
  if (j.pay_min == null && j.pay_max == null) return '';
  const f = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const range = j.pay_min != null && j.pay_max != null && j.pay_max !== j.pay_min ? `${f(j.pay_min)} – ${f(j.pay_max)}` : f(j.pay_min ?? j.pay_max);
  return `${range}/${UNIT_LABEL[j.pay_unit] || 'hr'}`;
}

/** Very small text → HTML: blank line = paragraph, lines starting with "- " or "* " = bullet list. */
function textToHtml(text) {
  if (!text) return '';
  return String(text).trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) return '<ul>' + lines.map((l) => `<li>${esc(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('') + '</ul>';
    return `<p>${lines.map(esc).join('<br>')}</p>`;
  }).join('\n');
}

function fullDescriptionHtml(j, agency) {
  let html = '';
  if (j.summary) html += `<p>${esc(j.summary)}</p>`;
  html += textToHtml(j.description);
  if (j.requirements) html += '<h3>Requirements</h3>' + textToHtml(j.requirements);
  if (j.benefits) html += '<h3>Benefits</h3>' + textToHtml(j.benefits);
  if (j.shifts) html += `<h3>Shifts available</h3><p>${esc(j.shifts)}</p>`;
  if (!html) html = `<p>${esc(j.title)} at ${esc(agency.name)}</p>`;
  return html;
}

/** schema.org JobPosting — makes jobs eligible for Google for Jobs. */
function jobPostingJsonLd(j, agency, baseUrl) {
  const ld = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: j.title,
    description: fullDescriptionHtml(j, agency),
    identifier: { '@type': 'PropertyValue', name: agency.name, value: String(j.id) },
    datePosted: String(j.posted_at).slice(0, 10),
    hiringOrganization: { '@type': 'Organization', name: agency.name, ...(agency.website && { sameAs: agency.website }), ...(agency.logo_url && { logo: agency.logo_url }) },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: j.city || agency.city || undefined,
        addressRegion: j.state || agency.state || undefined,
        postalCode: j.zip || agency.zip || undefined,
        addressCountry: 'US',
      },
    },
    directApply: true,
    url: `${baseUrl}/careers/${agency.slug}/${j.slug}`,
  };
  if (j.valid_through) ld.validThrough = j.valid_through;
  if (j.employment_type) ld.employmentType = j.employment_type === 'PER_DIEM' ? 'PER_DIEM' : j.employment_type;
  if (j.pay_min != null || j.pay_max != null) {
    ld.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: {
        '@type': 'QuantitativeValue',
        ...(j.pay_min != null && { minValue: j.pay_min }),
        ...(j.pay_max != null && { maxValue: j.pay_max }),
        unitText: j.pay_unit || 'HOUR',
      },
    };
  }
  return ld;
}

const jsonLdScript = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

function layout({ agency, title, description, canonical, head = '', body }) {
  const color = /^#[0-9a-f]{3,8}$/i.test(agency.brand_color || '') ? agency.brand_color : '#0f6cbd';
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:type" content="website">
${agency.logo_url ? `<meta property="og:image" content="${esc(agency.logo_url)}">` : ''}
<style>
:root{--brand:${color};--ink:#1b1f24;--muted:#5b6470;--line:#e3e7ec;--bg:#f6f8fa;--card:#fff}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--brand)}header.site{background:var(--card);border-bottom:1px solid var(--line)}
.wrap{max-width:880px;margin:0 auto;padding:0 16px}
header.site .wrap{display:flex;align-items:center;gap:12px;min-height:64px}header.site img{max-height:40px}
header.site .name{font-weight:700;font-size:18px;color:var(--ink);text-decoration:none}
.hero{background:var(--brand);color:#fff;padding:40px 0}.hero h1{margin:0 0 8px;font-size:clamp(26px,4vw,36px)}.hero p{margin:0;opacity:.92;max-width:640px}
main{padding:24px 0 48px}footer{color:var(--muted);font-size:14px;padding:24px 0;border-top:1px solid var(--line)}
</style>${head}</head>
<body>
<header class="site"><div class="wrap">${agency.logo_url ? `<img src="${esc(agency.logo_url)}" alt="">` : ''}<a class="name" href="${esc(agency.website || '#')}">${esc(agency.name)}</a></div></header>
${body}
<footer><div class="wrap">© ${new Date().getFullYear()} ${esc(agency.name)}${agency.phone ? ' · ' + esc(agency.phone) : ''}${agency.city ? ' · ' + esc(agency.city) + ', ' + esc(agency.state || '') : ''}</div></footer>
</body></html>`;
}

/** Hosted career site: the widget does all the UI; the server pre-renders the list (for SEO/no-JS) + JSON-LD. */
function careerIndexPage(agency, jobList, baseUrl) {
  const canonical = `${baseUrl}/careers/${agency.slug}`;
  const noscript = jobList.map((j) => `<li><a href="${esc(canonical)}/${esc(j.slug)}">${esc(j.title)}</a> — ${esc([j.city, j.state].filter(Boolean).join(', '))} ${esc(payText(j))}</li>`).join('');
  return layout({
    agency,
    title: `Careers at ${agency.name} — Caregiver & Nursing Jobs`,
    description: `Join ${agency.name}. ${jobList.length} open home care position${jobList.length === 1 ? '' : 's'}${agency.city ? ' in ' + agency.city : ''}. Apply online in minutes.`,
    canonical,
    body: `<section class="hero"><div class="wrap"><h1>Join our care team</h1><p>${esc(agency.about || `Make a difference every day with ${agency.name}. Flexible schedules, weekly pay, and a team that has your back.`)}</p></div></section>
<main><div class="wrap">
<div id="hc-jobs" data-agency="${esc(agency.slug)}" data-api="${esc(baseUrl)}" data-mode="page"><noscript><ul>${noscript}</ul></noscript></div>
</div></main>
<script src="${esc(baseUrl)}/embed.js" defer></script>`,
  });
}

function careerJobPage(agency, j, baseUrl) {
  const canonical = `${baseUrl}/careers/${agency.slug}/${j.slug}`;
  const loc = [j.city || agency.city, j.state || agency.state].filter(Boolean).join(', ');
  return layout({
    agency,
    title: `${j.title}${loc ? ' — ' + loc : ''} | ${agency.name}`,
    description: (j.summary || `${j.title} position with ${agency.name}${loc ? ' in ' + loc : ''}. ${payText(j)}`).slice(0, 300),
    canonical,
    head: jsonLdScript(jobPostingJsonLd(j, agency, baseUrl)),
    body: `<main><div class="wrap">
<div id="hc-jobs" data-agency="${esc(agency.slug)}" data-api="${esc(baseUrl)}" data-mode="page" data-job="${esc(j.slug)}" data-list-url="${esc(baseUrl)}/careers/${esc(agency.slug)}">
<noscript><h1>${esc(j.title)}</h1>${fullDescriptionHtml(j, agency)}</noscript></div>
</div></main>
<script src="${esc(baseUrl)}/embed.js" defer></script>`,
  });
}

/** Indeed-style XML feed (also accepted by ZipRecruiter, Talent.com, Jooble, etc.). */
function xmlFeed(agency, jobList, baseUrl) {
  const items = jobList.map((j) => `  <job>
    <title>${cdata(j.title)}</title>
    <date>${cdata(new Date(String(j.posted_at).replace(' ', 'T') + 'Z').toUTCString())}</date>
    <referencenumber>${cdata(`${agency.slug}-${j.id}`)}</referencenumber>
    <url>${cdata(`${baseUrl}/careers/${agency.slug}/${j.slug}`)}</url>
    <company>${cdata(agency.name)}</company>
    <city>${cdata(j.city || agency.city)}</city>
    <state>${cdata(j.state || agency.state)}</state>
    <country>${cdata('US')}</country>
    <postalcode>${cdata(j.zip || agency.zip)}</postalcode>
    <description>${cdata(fullDescriptionHtml(j, agency))}</description>
    <salary>${cdata(payText(j))}</salary>
    <jobtype>${cdata(TYPE_LABEL[j.employment_type] || '')}</jobtype>
    <category>${cdata(j.category || 'Healthcare')}</category>
  </job>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<source>
  <publisher>${cdata(agency.name)}</publisher>
  <publisherurl>${cdata(agency.website || `${baseUrl}/careers/${agency.slug}`)}</publisherurl>
  <lastBuildDate>${cdata(new Date().toUTCString())}</lastBuildDate>
${items}
</source>`;
}

function sitemap(agency, jobList, baseUrl) {
  const urls = [`${baseUrl}/careers/${agency.slug}`, ...jobList.map((j) => `${baseUrl}/careers/${agency.slug}/${j.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}
</urlset>`;
}

module.exports = { esc, payText, textToHtml, fullDescriptionHtml, jobPostingJsonLd, careerIndexPage, careerJobPage, xmlFeed, sitemap, TYPE_LABEL };
