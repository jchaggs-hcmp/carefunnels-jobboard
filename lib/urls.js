'use strict';
// One place that decides every public URL for an agency.
//   • Agency WITH a custom careers domain (e.g. careers.sunrisehomecare.com):
//       https://careers.sunrisehomecare.com/            ← careers home
//       https://careers.sunrisehomecare.com/jobs/<job>  ← job page
//       https://careers.sunrisehomecare.com/sitemap.xml, /feed.xml
//   • Agency WITHOUT one (fallback on the platform host):
//       https://jobs.platform.com/careers/<agency>[/<job>], /sitemaps/<agency>.xml, /feeds/<agency>.xml

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE_HOST = new URL(BASE_URL).hostname.toLowerCase();
// What client DNS should point at (CNAME target). Defaults to the platform host.
const DOMAIN_TARGET = (process.env.DOMAIN_TARGET || BASE_HOST).toLowerCase().replace(/\.$/, '');
// Custom domains are always served over https in production; allow http for local testing.
const CUSTOM_SCHEME = process.env.CUSTOM_DOMAIN_SCHEME || 'https';

// A custom domain is only used in links once it has been verified live (DNS + HTTPS working), so links
// handed to Google / Indeed never point at a domain that doesn't resolve yet.
const live = (a) => !!(a.custom_domain && a.domain_verified_at);
const origin = (a) => (live(a) ? `${CUSTOM_SCHEME}://${a.custom_domain}` : BASE_URL);
const home = (a) => (live(a) ? `${origin(a)}/` : `${BASE_URL}/careers/${a.slug}`);
const job = (a, j) => (live(a) ? `${origin(a)}/jobs/${j.slug}` : `${BASE_URL}/careers/${a.slug}/${j.slug}`);
const sitemap = (a) => (live(a) ? `${origin(a)}/sitemap.xml` : `${BASE_URL}/sitemaps/${a.slug}.xml`);
const feed = (a) => (live(a) ? `${origin(a)}/feed.xml` : `${BASE_URL}/feeds/${a.slug}.xml`);

/** "https://Careers.Example.com/jobs" → "careers.example.com". Throws 400 on anything that isn't a hostname. */
function normalizeDomain(input) {
  let d = String(input || '').trim().toLowerCase();
  if (!d) return null;
  d = d.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d)) throw bad('Enter a domain like careers.agencyname.com');
  if (d === BASE_HOST || d === DOMAIN_TARGET) throw bad('That is the platform’s own domain — use the client’s domain.');
  return d;
}

/** Host header → bare lowercase hostname. */
const hostOf = (req) => String(req.headers.host || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');

module.exports = { PORT, BASE_URL, BASE_HOST, DOMAIN_TARGET, CUSTOM_SCHEME, live, origin, home, job, sitemap, feed, normalizeDomain, hostOf };
