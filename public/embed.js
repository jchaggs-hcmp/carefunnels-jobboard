/*!
 * Home Care Job Board — embeddable career widget
 * Usage (any website: WordPress, Wix, Squarespace, GoHighLevel, Webflow, plain HTML):
 *   <div id="hc-jobs" data-agency="your-agency-slug"></div>
 *   <script src="https://JOBS-HOST/embed.js" defer></script>
 * Options (data-* on the div):
 *   data-agency   (required) agency slug
 *   data-color    override brand color, e.g. "#7a2e8e"
 *   data-category only show one category, e.g. "Caregiver"
 *   data-limit    show N newest jobs, no filters (homepage "We're hiring" teaser)
 *   data-link     with data-limit: URL of your full careers page (cards link there)
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var DEFAULT_API = script ? new URL(script.src, location.href).origin : '';

  var CERTS = ['CNA', 'HHA', 'PCA', 'CPR / First Aid', 'LPN', 'RN', 'Med Tech / CMA'];
  var AVAIL = ['Weekdays', 'Evenings', 'Overnights', 'Weekends', 'Live-in'];

  var CSS = '\
:host{all:initial;display:block;--brand:#0f6cbd;--ink:#1b1f24;--muted:#5b6470;--line:#e3e7ec;--card:#fff;--soft:#f4f6f8;--ok:#127a3a;--err:#b42318;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink)}\
*{box-sizing:border-box}h2,h3,p{margin:0}button,input,select,textarea{font:inherit;color:inherit}\
a{color:var(--brand)}\
.bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}\
.bar input,.bar select{flex:1 1 180px;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card)}\
.count{color:var(--muted);font-size:14px;margin:0 0 10px}\
.list{display:grid;gap:12px}\
.card{display:block;text-align:left;width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;cursor:pointer;text-decoration:none;color:inherit;transition:border-color .15s,box-shadow .15s}\
.card:hover,.card:focus-visible{border-color:var(--brand);box-shadow:0 2px 10px rgba(0,0,0,.06);outline:none}\
.card h3{font-size:18px;color:var(--brand);margin-bottom:4px}\
.meta{display:flex;flex-wrap:wrap;gap:6px 14px;color:var(--muted);font-size:14px}\
.pay{color:var(--ok);font-weight:600}\
.card p{margin-top:8px;font-size:15px}\
.tag{display:inline-block;background:var(--soft);border-radius:999px;padding:2px 10px;font-size:13px;color:var(--ink)}\
.empty{background:var(--card);border:1px dashed var(--line);border-radius:12px;padding:28px;text-align:center;color:var(--muted)}\
.btn{display:inline-block;background:var(--brand);color:#fff;border:0;border-radius:8px;padding:12px 22px;font-weight:600;cursor:pointer;text-decoration:none}\
.btn:hover{filter:brightness(1.08)}.btn[disabled]{opacity:.6;cursor:wait}\
.link{background:none;border:0;padding:0;color:var(--brand);cursor:pointer;font-size:15px;margin-bottom:12px}\
.detail{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:22px}\
.detail h2{font-size:clamp(22px,3vw,28px);line-height:1.25;margin-bottom:8px}\
.detail .meta{margin-bottom:16px}\
.desc{margin:18px 0}.desc h3{font-size:17px;margin:18px 0 6px}.desc p{margin:0 0 10px}.desc ul{margin:0 0 10px;padding-left:22px}\
.closed{background:#fff4e5;border-radius:8px;padding:10px 14px;margin:12px 0}\
form{display:grid;gap:14px;margin-top:8px}\
.row{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}\
label{display:grid;gap:4px;font-size:14px;font-weight:600}\
label input,label select,label textarea{font-weight:400;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;width:100%}\
input:focus,select:focus,textarea:focus{outline:2px solid var(--brand);outline-offset:1px;border-color:transparent}\
fieldset{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:0}\
legend{font-size:14px;font-weight:600;padding:0 4px}\
.chips{display:flex;flex-wrap:wrap;gap:8px}\
.chips label{display:flex;align-items:center;gap:6px;font-weight:400;background:var(--soft);border-radius:999px;padding:6px 12px;cursor:pointer}\
.chips input{width:auto;margin:0;accent-color:var(--brand)}\
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}\
.msg{border-radius:8px;padding:12px 14px}.msg.err{background:#fdecea;color:var(--err)}\
.done{text-align:center;padding:28px 10px}.done h3{font-size:22px;color:var(--ok);margin-bottom:8px}\
.small{font-size:13px;color:var(--muted)}\
.sk{height:84px;border-radius:12px;background:linear-gradient(90deg,var(--soft),#fff,var(--soft));background-size:200% 100%;animation:sh 1.2s infinite}\
@keyframes sh{to{background-position:-200% 0}}';

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v; // only used with server-escaped HTML
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    [].concat(kids || []).forEach(function (c) { if (c != null && c !== false) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function api(base, path, opts) {
    return fetch(base + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok) throw new Error(b.error || 'Something went wrong. Please try again.'); return b; });
    });
  }
  function ago(d) {
    var days = Math.floor((Date.now() - new Date(String(d).replace(' ', 'T') + 'Z')) / 864e5);
    return days <= 0 ? 'Posted today' : days === 1 ? 'Posted yesterday' : days < 30 ? 'Posted ' + days + ' days ago' : 'Posted 30+ days ago';
  }
  function loc(j) { return [j.city, j.state].filter(Boolean).join(', '); }
  function metaRow(j) {
    return h('div', { class: 'meta' }, [
      loc(j) && h('span', null, '📍 ' + loc(j)),
      j.employment_type_label && h('span', null, j.employment_type_label),
      j.pay_text && h('span', { class: 'pay' }, j.pay_text),
      j.shifts && h('span', null, '🕑 ' + j.shifts),
    ]);
  }
  function injectJsonLd(obj) {
    var old = document.getElementById('hc-jobs-jsonld'); if (old) old.remove();
    if (!obj) return;
    var s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'hc-jobs-jsonld';
    s.textContent = JSON.stringify(obj); document.head.appendChild(s);
  }

  function Widget(host) {
    var cfg = host.dataset;
    this.host = host;
    this.slug = cfg.agency;
    this.base = (cfg.api || DEFAULT_API).replace(/\/$/, '');
    this.mode = cfg.mode || 'embed';                 // 'page' = hosted career site with real URLs
    this.limit = cfg.limit ? parseInt(cfg.limit, 10) : 0;
    this.linkTo = cfg.link || '';
    this.category = cfg.category || '';
    this.colorOverride = cfg.color || '';
    this.listUrl = cfg.listUrl || '';
    this.filters = { q: '', cat: this.category, type: '' };
    this.root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    this.root.innerHTML = '';
    this.root.appendChild(h('style', null, CSS));
    this.view = h('div', { part: 'container', 'aria-live': 'polite' });
    this.root.appendChild(this.view);
    var self = this;
    window.addEventListener('popstate', function () { self.route(); });
    // remove any slotted form left over from a previous init
    this.clearSlot();
    this.load(cfg.job);
  }

  Widget.prototype.setColor = function (c) {
    c = this.colorOverride || c;
    if (/^#[0-9a-f]{3,8}$/i.test(c || '')) this.host.style.setProperty('--brand', c);
  };

  Widget.prototype.load = function (initialJob) {
    var self = this;
    this.view.replaceChildren(h('div', { class: 'list' }, [h('div', { class: 'sk' }), h('div', { class: 'sk' }), h('div', { class: 'sk' })]));
    api(this.base, '/api/public/' + encodeURIComponent(this.slug)).then(function (d) {
      self.agency = d.agency; self.jobs = d.jobs; self.setColor(d.agency.brand_color);
      if (initialJob) self.showJob(initialJob, false); else self.route();
    }).catch(function (e) {
      self.view.replaceChildren(h('div', { class: 'empty' }, 'Job listings are temporarily unavailable. ' + e.message));
    });
  };

  // embed mode keeps state in ?job=slug so job links are shareable and back-button works
  Widget.prototype.route = function () {
    if (this.mode === 'page' || this.limit) return this.showList(); // teasers never open job detail
    var job = new URLSearchParams(location.search).get('job');
    job ? this.showJob(job, false) : this.showList();
  };
  Widget.prototype.jobHref = function (j) {
    if (this.limit && this.linkTo) return this.linkTo + (this.linkTo.indexOf('?') > -1 ? '&' : '?') + 'job=' + encodeURIComponent(j.slug);
    if (this.mode === 'page') return j.url;
    var u = new URL(location.href); u.searchParams.set('job', j.slug); return u.pathname + u.search;
  };
  Widget.prototype.go = function (j) {
    if (this.mode === 'page' || (this.limit && this.linkTo)) { location.href = this.jobHref(j); return; }
    history.pushState({}, '', this.jobHref(j));
    this.showJob(j.slug, true);
  };
  Widget.prototype.back = function () {
    if (this.mode === 'page') { location.href = this.listUrl || '.'; return; }
    var u = new URL(location.href); u.searchParams.delete('job'); history.pushState({}, '', u.pathname + u.search + u.hash);
    injectJsonLd(null); this.showList(); this.host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  Widget.prototype.showList = function () {
    this.clearSlot();
    var self = this, all = this.jobs;
    if (this.category) all = all.filter(function (j) { return j.category === self.category; });
    if (this.limit) return this.view.replaceChildren(this.renderCards(all.slice(0, this.limit), all.length));

    var cats = uniq(all.map(function (j) { return j.category; }));
    var types = uniq(all.map(function (j) { return j.employment_type_label; }));
    var listEl = h('div');
    var draw = function () {
      var q = self.filters.q.toLowerCase();
      var shown = all.filter(function (j) {
        return (!q || [j.title, j.city, j.state, j.zip, j.summary, j.category].join(' ').toLowerCase().indexOf(q) > -1) &&
          (!self.filters.cat || j.category === self.filters.cat) && (!self.filters.type || j.employment_type_label === self.filters.type);
      });
      listEl.replaceChildren(self.renderCards(shown, all.length));
    };
    var bar = h('div', { class: 'bar', role: 'search' }, [
      h('input', { type: 'search', placeholder: 'Search jobs, city or ZIP', 'aria-label': 'Search jobs', value: this.filters.q, oninput: function (e) { self.filters.q = e.target.value; draw(); } }),
      !this.category && cats.length > 1 && select('All positions', cats, this.filters.cat, function (v) { self.filters.cat = v; draw(); }),
      types.length > 1 && select('Any schedule', types, this.filters.type, function (v) { self.filters.type = v; draw(); }),
    ]);
    this.view.replaceChildren(all.length > 3 ? bar : h('span'), listEl);
    draw();
  };

  Widget.prototype.renderCards = function (list, total) {
    var self = this;
    if (!list.length) {
      return h('div', { class: 'empty' }, total
        ? 'No jobs match your search.'
        : [h('p', null, "We don't have any open positions right now, but we're always meeting great caregivers."),
           h('p', { style: 'margin-top:14px' }, h('button', { class: 'btn', onclick: function () { self.showApply(null); } }, 'Submit a general application'))]);
    }
    var wrap = h('div');
    if (!this.limit) wrap.appendChild(h('p', { class: 'count' }, list.length + ' open position' + (list.length === 1 ? '' : 's')));
    wrap.appendChild(h('div', { class: 'list' }, list.map(function (j) {
      return h('a', { class: 'card', href: self.jobHref(j), onclick: function (e) { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); self.go(j); } }, [
        h('h3', null, j.title), metaRow(j), j.summary && h('p', null, j.summary),
      ]);
    })));
    if (this.limit && this.linkTo && total > list.length) wrap.appendChild(h('p', { style: 'margin-top:12px' }, h('a', { href: this.linkTo }, 'See all ' + total + ' openings →')));
    return wrap;
  };

  Widget.prototype.showJob = function (slug, scroll) {
    var self = this;
    api(this.base, '/api/public/' + encodeURIComponent(this.slug) + '/jobs/' + encodeURIComponent(slug)).then(function (d) {
      var j = d.job;
      self.clearSlot();
      if (self.mode !== 'page') injectJsonLd(d.jsonld); // hosted pages get JSON-LD server-side
      if (self.mode !== 'page') document.title = j.title + ' | ' + d.agency.name;
      var applyBox = h('div');
      self.view.replaceChildren(
        h('button', { class: 'link', onclick: function () { self.back(); } }, '← All jobs'),
        h('article', { class: 'detail' }, [
          h('h2', null, j.title), metaRow(j),
          h('div', { class: 'meta' }, [j.category && h('span', { class: 'tag' }, j.category), h('span', null, ago(j.posted_at))]),
          j.is_open
            ? h('button', { class: 'btn', onclick: function () { applyBox.scrollIntoView({ behavior: 'smooth' }); var f = applyBox.querySelector('input[name="first_name"]'); if (f) f.focus({ preventScroll: true }); } }, 'Apply now')
            : h('div', { class: 'closed' }, 'This position has been filled. Browse our other openings below.'),
          h('div', { class: 'desc', html: j.description_html }),
          applyBox,
        ])
      );
      if (j.is_open) applyBox.appendChild(j.apply_form ? self.cfForm(j.apply_form, j) : self.form(j));
      if (scroll) self.host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function () {
      self.view.replaceChildren(h('div', { class: 'empty' }, ['That job is no longer available. ', h('button', { class: 'link', onclick: function () { self.back(); } }, 'See open positions')]));
    });
  };

  Widget.prototype.showApply = function (job) {
    var self = this, cf = this.agency && this.agency.apply_form;
    this.clearSlot();
    this.view.replaceChildren(
      h('button', { class: 'link', onclick: function () { self.showList(); } }, '← Back'),
      h('div', { class: 'detail' }, [h('h2', null, 'General application'), h('p', { class: 'small' }, "Tell us about yourself and we'll reach out when a position fits."), cf ? this.cfForm(cf, null) : this.form(job)])
    );
  };

  // ---- CareFunnels (GoHighLevel) form ----
  // The iframe lives in the host's light DOM and is projected through a <slot>, so CareFunnels' form_embed.js
  // can find it by id (for auto-height, layout and tracking) — it can't see inside a shadow root.
  Widget.prototype.clearSlot = function () {
    var old = this.host.querySelector(':scope > [slot="hc-apply"]'); if (old) old.remove();
  };
  Widget.prototype.cfForm = function (cfg, job) {
    this.clearSlot();
    var src = new URL(cfg.src);
    // Prefill hidden fields: in CareFunnels add Hidden fields with these "Query Key"s to capture them on the contact.
    var pre = { job_title: job ? job.title : 'General application', job_id: job ? job.id : '', job_location: job ? loc(job) : '',
      job_category: job ? job.category || '' : '', job_url: job ? job.url : '', application_source: location.href.split('#')[0] };
    var page = new URLSearchParams(location.search);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(function (k) { if (page.get(k)) pre[k] = page.get(k); });
    for (var k in pre) if (pre[k] !== '' && pre[k] != null && !src.searchParams.has(k)) src.searchParams.set(k, pre[k]);

    var attrs = { src: src.href, title: cfg.iframe_attrs.title || 'Job application', loading: 'lazy',
      style: 'width:100%;border:none;border-radius:4px;display:block;min-height:' + (cfg.height || 900) + 'px;height:' + (cfg.height || 900) + 'px' };
    for (var a in cfg.iframe_attrs) if (a !== 'title') attrs[a] = cfg.iframe_attrs[a];
    var holder = h('div', { slot: 'hc-apply', style: 'margin-top:8px' }, h('iframe', attrs));
    this.host.appendChild(holder);
    if (cfg.script_src && !document.querySelector('script[src="' + cfg.script_src + '"]')) {
      var sc = document.createElement('script'); sc.src = cfg.script_src; sc.async = true; document.body.appendChild(sc);
    }
    return h('div', null, [
      h('h3', { style: 'font-size:20px;margin:8px 0 4px' }, job ? 'Apply for this position' : 'Your information'),
      h('slot', { name: 'hc-apply' }),
    ]);
  };

  Widget.prototype.form = function (job) {
    var self = this, resume = null;
    var err = h('div', { class: 'msg err', role: 'alert', hidden: true });
    var submit = h('button', { class: 'btn', type: 'submit' }, 'Submit application');
    var f = h('form', { novalidate: true }, [
      h('h3', { style: 'font-size:20px;margin-top:8px' }, job ? 'Apply for this position' : 'Your information'),
      h('p', { class: 'small' }, 'Takes about 2 minutes. No resume required.'),
      h('div', { class: 'row' }, [field('First name', 'first_name', 'text', true, 'given-name'), field('Last name', 'last_name', 'text', true, 'family-name')]),
      h('div', { class: 'row' }, [field('Mobile phone', 'phone', 'tel', true, 'tel'), field('Email', 'email', 'email', false, 'email')]),
      h('div', { class: 'row' }, [
        field('ZIP code', 'zip', 'text', false, 'postal-code', { inputmode: 'numeric', maxlength: 10 }),
        h('label', null, ['Years of caregiving experience', h('select', { name: 'experience' }, ['', 'None — ready to learn', 'Less than 1', '1–2', '3–5', '5+'].map(function (o) { return h('option', { value: o }, o || 'Select…'); }))]),
      ]),
      chips('Certifications / licenses', 'certifications', CERTS),
      chips('Availability', 'availability', AVAIL),
      h('fieldset', null, [h('legend', null, 'Do you have reliable transportation?'), h('div', { class: 'chips' }, [radio('has_transport', '1', 'Yes'), radio('has_transport', '0', 'No')])]),
      h('label', null, ['Resume (optional)', h('input', { type: 'file', name: 'resume', accept: '.pdf,.doc,.docx,.txt,image/*', onchange: function (e) {
        var file = e.target.files[0]; resume = null; if (!file) return;
        if (file.size > 5 * 1024 * 1024) { e.target.value = ''; showErr('Resume must be under 5MB.'); return; }
        var r = new FileReader(); r.onload = function () { resume = { name: file.name, type: file.type || 'application/octet-stream', data: r.result }; }; r.readAsDataURL(file);
      } })]),
      h('label', null, ['Anything else we should know?', h('textarea', { name: 'message', rows: 3 })]),
      h('div', { class: 'hp', 'aria-hidden': 'true' }, h('input', { name: 'website_url', tabindex: '-1', autocomplete: 'off' })),
      err,
      h('div', null, submit),
      h('p', { class: 'small' }, 'By applying you agree that ' + (self.agency ? self.agency.name : 'we') + ' may contact you by phone, text or email about employment.'),
    ]);
    function showErr(m) { err.textContent = m; err.hidden = false; }
    f.addEventListener('submit', function (e) {
      e.preventDefault(); err.hidden = true;
      var fd = new FormData(f), body = { job_id: job ? job.id : null, resume: resume, source: location.href };
      ['first_name', 'last_name', 'phone', 'email', 'zip', 'experience', 'message', 'website_url'].forEach(function (k) { body[k] = fd.get(k); });
      body.certifications = fd.getAll('certifications'); body.availability = fd.getAll('availability');
      body.has_transport = fd.get('has_transport') == null ? null : fd.get('has_transport') === '1';
      if (!body.first_name || !body.last_name || !body.phone) return showErr('Please enter your first name, last name and phone number.');
      submit.disabled = true; submit.textContent = 'Sending…';
      api(self.base, '/api/public/' + encodeURIComponent(self.slug) + '/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function () {
          f.replaceWith(h('div', { class: 'done', role: 'status' }, [
            h('h3', null, '✓ Application received'),
            h('p', null, 'Thank you, ' + body.first_name + '! Our recruiting team will contact you shortly' + (self.agency && self.agency.phone ? '. Questions? Call ' + self.agency.phone + '.' : '.')),
          ]));
          try { (window.dataLayer = window.dataLayer || []).push({ event: 'hc_job_application', job_title: job ? job.title : 'General' }); } catch (_) {}
          if (typeof window.fbq === 'function') window.fbq('track', 'SubmitApplication');
        })
        .catch(function (ex) { showErr(ex.message); submit.disabled = false; submit.textContent = 'Submit application'; });
    });
    return f;
  };

  function field(label, name, type, req, ac, extra) {
    var attrs = { name: name, type: type, required: req, autocomplete: ac };
    for (var k in extra || {}) attrs[k] = extra[k];
    return h('label', null, [label + (req ? ' *' : ''), h('input', attrs)]);
  }
  function chips(legend, name, opts) {
    return h('fieldset', null, [h('legend', null, legend), h('div', { class: 'chips' }, opts.map(function (o) { return h('label', null, [h('input', { type: 'checkbox', name: name, value: o }), o]); }))]);
  }
  function radio(name, value, label) { return h('label', null, [h('input', { type: 'radio', name: name, value: value }), label]); }
  function select(placeholder, opts, val, cb) {
    return h('select', { 'aria-label': placeholder, onchange: function (e) { cb(e.target.value); } },
      [h('option', { value: '' }, placeholder)].concat(opts.map(function (o) { return h('option', { value: o, selected: o === val }, o); })));
  }
  function uniq(a) { return a.filter(function (v, i) { return v && a.indexOf(v) === i; }).sort(); }

  function boot() {
    document.querySelectorAll('#hc-jobs, .hc-jobs, [data-hc-jobs]').forEach(function (el) {
      if (el.__hcJobs || !el.dataset.agency) return;
      el.__hcJobs = new Widget(el);
    });
  }
  window.HCJobs = { init: boot };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
