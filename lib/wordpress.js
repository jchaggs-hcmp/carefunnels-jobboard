'use strict';
// Client for the "CareFunnels Job Sync" WordPress plugin (wordpress/hc-jobs) installed on each client site.
// Auth: WordPress Application Password (Users → Profile → Application Passwords) over HTTPS.

class WPError extends Error {}

function base(url) {
  const u = new URL(/^https?:\/\//i.test(url) ? url : 'https://' + url);
  return u.origin + u.pathname.replace(/\/$/, '');
}

async function call(site, method, path, body) {
  const url = `${base(site.url)}/wp-json/hcjobs/v1${path}`;
  let r;
  try {
    r = await fetch(url, {
      method,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${site.user}:${site.appPassword}`).toString('base64'),
        Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) { throw new WPError(`Could not reach ${base(site.url)} (${e.message})`); }
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  if (!r.ok || !data) {
    const msg = data?.message || text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    if (r.status === 404 && (!data || data.code === 'rest_no_route')) throw new WPError('The CareFunnels Job Sync plugin is not active on this WordPress site (or the REST API is blocked).');
    if (r.status === 401 || r.status === 403) throw new WPError(`WordPress refused the login (${r.status}): ${msg}. Check the username and Application Password, and that the user is an Administrator.`);
    throw new WPError(`WordPress error ${r.status}: ${msg}`);
  }
  return data;
}

const status = (site) => call(site, 'GET', '/status');
const upsertJob = (site, payload) => call(site, 'POST', '/jobs', payload);
const removeJob = (site, externalId) => call(site, 'DELETE', `/jobs/${encodeURIComponent(externalId)}`);

module.exports = { status, upsertJob, removeJob, WPError, base };
