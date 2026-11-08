'use strict';
// CareFunnels "Job" records  →  hub database  →  client WordPress (WP Job Manager)  →  live URL written back to CareFunnels.
//
// Safety rules:
//  • If CareFunnels can't be read, nothing is removed (a failed fetch never looks like "all jobs deleted").
//  • A record with problems (no title, unknown status) is held back as a draft and reported, never published.
//  • WordPress is only called for jobs whose content actually changed (hash of the payload).

const crypto = require('node:crypto');
const { agencies, jobs } = require('./db');
const { decrypt } = require('./secrets');
const cf = require('./carefunnels');
const wp = require('./wordpress');
const render = require('./render');
const { resolveApplyForm } = require('./forms');

const TYPE_LABEL = { FULL_TIME: 'Full Time', PART_TIME: 'Part Time', PER_DIEM: 'Per Diem', CONTRACTOR: 'Contract', TEMPORARY: 'Temporary' };
const today = () => new Date().toISOString().slice(0, 10);

const cfConfig = (a) => (a.cf_token && a.carefunnels_location_id ? { token: decrypt(a.cf_token), locationId: a.carefunnels_location_id, objectKey: a.cf_object_key || 'custom_objects.job_openings' } : null);
const wpConfig = (a) => (a.wp_url && a.wp_user && a.wp_app_password ? { url: a.wp_url, user: a.wp_user, appPassword: decrypt(a.wp_app_password) } : null);

/** What we send to the WordPress plugin for one job. */
function wpPayload(a, j) {
  const expired = j.valid_through && j.valid_through < today();
  const loc = [j.city || a.city, j.state || a.state].filter(Boolean).join(', ');
  const form = resolveApplyForm(a, j);
  const prefill = { job_title: j.title, job_id: j.external_id || String(j.id), job_location: loc, job_category: j.category || '' };
  let applyUrl = null;
  if (form) { const u = new URL(form.src); for (const [k, v] of Object.entries(prefill)) if (v) u.searchParams.set(k, v); applyUrl = u.href; }
  return {
    external_id: j.external_id || `hub-${j.id}`,
    title: j.title,
    status: j.status === 'open' && !expired ? 'publish' : j.status === 'draft' ? 'draft' : 'expired',
    filled: j.status === 'closed',
    content_html: (render.payText(j) ? `<p><strong>Pay:</strong> ${render.esc(render.payText(j))}${j.employment_type && TYPE_LABEL[j.employment_type] ? ' · ' + TYPE_LABEL[j.employment_type] : ''}</p>` : '') + render.fullDescriptionHtml(j, a),
    location: loc,
    company_name: a.name,
    company_website: a.website || '',
    job_type: TYPE_LABEL[j.employment_type] || '',
    category: j.category || '',
    salary_min: j.pay_min, salary_max: j.pay_max, salary_unit: j.pay_unit || 'HOUR',
    expires: j.valid_through || '',
    apply_url: applyUrl || a.website || '',
    form: form ? { src: form.src, attrs: form.iframe_attrs, script_src: form.script_src, height: form.height } : null,
    prefill,
  };
}
const hashOf = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex');

const running = new Set();

/** Runs one full sync for an agency. Returns a summary object (also stored on the agency). */
async function syncAgency(agencyId) {
  if (running.has(agencyId)) return { skipped: 'already running' };
  running.add(agencyId);
  const r = { started_at: new Date().toISOString(), carefunnels: null, wordpress: null, records: 0, created: 0, updated: 0, removed: 0, pushed: 0, unchanged: 0, problems: [], errors: [] };
  try {
    let a = agencies.byId(agencyId); if (!a) return { error: 'agency not found' };
    const cfc = cfConfig(a), wpc = wpConfig(a);
    const removedFromCf = [];

    // 1) CareFunnels → hub
    if (cfc) {
      try {
        const records = await cf.listJobRecords(cfc);
        r.records = records.length; r.carefunnels = 'ok';
        const seen = new Set();
        for (const rec of records) {
          seen.add(String(rec.id));
          const { job, problems } = cf.recordToJob(rec);
          if (problems.length) r.problems.push({ record: rec.id, title: job.title, problems });
          const before = jobs.byExternal(a.id, rec.id);
          jobs.upsertExternal(a.id, rec.id, job);
          before ? r.updated++ : r.created++;
        }
        for (const j of jobs.externals(a.id)) if (!seen.has(String(j.external_id))) removedFromCf.push(j);
      } catch (e) { r.carefunnels = 'error'; r.errors.push(e.message); }
    }

    // 2) hub → WordPress
    if (wpc) {
      r.wordpress = 'ok';
      for (const j of removedFromCf) {
        try { if (j.wp_post_id) await wp.removeJob(wpc, j.external_id); jobs.remove(a.id, j.id); r.removed++; }
        catch (e) { r.errors.push(`Remove "${j.title}": ${e.message}`); }
      }
      for (const j of jobs.list(a.id)) {
        if (j.status === 'draft' && !j.wp_post_id) continue; // never-published drafts stay off the site
        const payload = wpPayload(a, j), h = hashOf(payload);
        if (h === j.sync_hash && j.wp_post_id) { r.unchanged++; continue; }
        try {
          const res = await wp.upsertJob(wpc, payload);
          jobs.setSync(j.id, { wp_post_id: res.post_id, wp_url: res.url || null, sync_hash: h, sync_error: null, synced_at: new Date().toISOString() });
          r.pushed++;
        } catch (e) {
          jobs.setSync(j.id, { sync_error: e.message });
          r.errors.push(`"${j.title}": ${e.message}`);
          if (e instanceof wp.WPError && /refused the login|not active|Could not reach/.test(e.message)) { r.wordpress = 'error'; break; } // site-level problem: stop
        }
      }
    } else {
      for (const j of removedFromCf) { jobs.remove(a.id, j.id); r.removed++; }
    }

    // 3) write the live job URL back onto the CareFunnels record (only when it changed)
    if (cfc && r.carefunnels === 'ok') {
      for (const j of jobs.externals(a.id)) {
        if (!j.wp_url || j.cf_live_url_written === j.wp_url) continue;
        try { await cf.updateRecord(cfc, j.external_id, { [cf.FIELDS.live_url]: j.wp_url }); jobs.setSync(j.id, { cf_live_url_written: j.wp_url }); }
        catch (e) { r.errors.push(`Write-back to CareFunnels for "${j.title}": ${e.message}`); }
      }
    }
    return r;
  } catch (e) {
    r.errors.push(e.message); return r;
  } finally {
    r.finished_at = new Date().toISOString();
    if (agencies.byId(agencyId)) agencies.setSyncResult(agencyId, r);
    running.delete(agencyId);
  }
}

/** Debounced "sync soon" (used after admin edits and by the CareFunnels webhook). */
const timers = new Map();
function scheduleSync(agencyId, delayMs = 3000) {
  clearTimeout(timers.get(agencyId));
  timers.set(agencyId, setTimeout(() => { timers.delete(agencyId); syncAgency(agencyId).catch((e) => console.error('sync', agencyId, e)); }, delayMs).unref());
}

/** Background loop: every SYNC_INTERVAL_MINUTES, sync every agency that has CareFunnels or WordPress connected. */
function startScheduler() {
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES || 5);
  const tick = async () => {
    for (const a of agencies.all()) if (cfConfig(a) || wpConfig(a)) { try { await syncAgency(a.id); } catch (e) { console.error('sync', a.slug, e.message); } }
  };
  setTimeout(tick, 10_000).unref();
  setInterval(tick, minutes * 60_000).unref();
}

/** Connection test for the admin panel. */
async function testConnections(a) {
  const out = { carefunnels: null, wordpress: null };
  const cfc = cfConfig(a), wpc = wpConfig(a);
  if (cfc) {
    try {
      const s = await cf.getSchema(cfc);
      const have = new Set((s.fields || s.object?.fields || []).map((f) => String(f.fieldKey || f.key || '').split('.').pop()));
      const want = Object.values(cf.FIELDS);
      out.carefunnels = { ok: true, object: s.object?.labels?.plural || cfc.objectKey, missing_fields: have.size ? want.filter((k) => !have.has(k)) : null };
    } catch (e) { out.carefunnels = { ok: false, error: e.message }; }
  }
  if (wpc) {
    try { const s = await wp.status(wpc); out.wordpress = { ok: !!s.wpjm_active, ...s, ...(s.wpjm_active ? {} : { error: 'WP Job Manager is not active on this site.' }) }; }
    catch (e) { out.wordpress = { ok: false, error: e.message }; }
  }
  return out;
}

module.exports = { syncAgency, scheduleSync, startScheduler, testConnections, wpPayload, cfConfig, wpConfig };
