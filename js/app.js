(function () {
  'use strict';

  const D = window.DATA;
  const RULES = window.RULES;
  const CATS = window.RULE_CATEGORIES;
  const TAGS = window.RULE_TAGS;
  const BODIES = window.BODIES;
  const BODY_LEVELS = window.BODY_LEVELS;
  const WC = window.WORLD_CHAMPIONSHIP;
  const SOURCE = 'https://www.indiancarrom.co.in/laws-of-carrom/';

  // ---------- utilities ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byId = (arr, id) => arr.find((x) => x.id === id);
  const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
  const fdate = (s) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const today = () => new Date().toISOString().slice(0, 10);
  const daysUntil = (s) => Math.ceil((new Date(s + 'T23:59:59') - Date.now()) / 86400000);
  const initials = (n) => n.split(' ').map((w) => w[0]).slice(0, 2).join('');
  const player = (id) => byId(D.players, id);
  const club = (id) => byId(D.clubs, id);
  const tourn = (id) => byId(D.tournaments, id);
  const dealer = (id) => byId(D.dealers, id);
  const ruleById = (id) => byId(RULES, id);
  const ruleAnchor = (id) => 'rule-' + id.replace(/\./g, '-');
  const uniq = (a) => [...new Set(a)];
  const winPct = (p) => Math.round((p.stats.wins / p.stats.matches) * 100);
  const ic = (n, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  const hue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
  const starIc = ic('star', 'sm star-ic');
  const pageUrl = (hash) => location.href.split('#')[0] + hash;

  async function share(title, url = location.href, text) {
    try {
      if (navigator.share) { await navigator.share(text ? { title, text, url } : { title, url }); return; }
      if (!navigator.clipboard) throw new Error('no-clipboard');
      await navigator.clipboard.writeText(text ? `${text}\n${url}` : url);
      toast(text ? 'Invite copied — paste it in WhatsApp or SMS' : 'Link copied', 'link');
    } catch (e) {
      if (e.name !== 'AbortError') shareSheet(title, url, text);
    }
  }
  // Fallback when Web Share / Clipboard are unavailable (e.g. plain-HTTP on a LAN): manual copy + app links.
  function shareSheet(title, url, text) {
    $$('.share-sheet').forEach((s) => s.remove());
    const full = text ? `${text}\n${url}` : url;
    const el = document.createElement('div');
    el.className = 'share-sheet';
    el.innerHTML = `<div class="share-box card" role="dialog" aria-label="Share">
      <div class="row between"><b>${esc(title)}</b><button class="btn sm icon ghost" data-close aria-label="Close">${ic('x', 'sm')}</button></div>
      <textarea class="input" rows="4" readonly style="width:100%;margin:.6rem 0;font-size:.85rem">${esc(full)}</textarea>
      <div class="row wrap">
        <button class="btn sm primary" data-copy>${ic('link', 'sm')} Copy</button>
        <a class="btn sm" href="https://wa.me/?text=${encodeURIComponent(full)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <a class="btn sm" href="sms:?body=${encodeURIComponent(full)}">SMS</a>
        <a class="btn sm" href="mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(full)}">Email</a>
      </div></div>`;
    document.body.appendChild(el);
    const ta = $('textarea', el);
    ta.focus(); ta.select();
    $('[data-copy]', el).addEventListener('click', () => { ta.select(); const ok = document.execCommand && document.execCommand('copy'); toast(ok ? 'Copied' : 'Select the text and copy it', ok ? 'check' : 'info'); });
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) el.remove(); });
  }
  const shareBtn = (title, url) => `<button class="btn sm" data-act="share" data-title="${esc(title)}" ${url ? `data-url="${esc(url)}"` : ''}>${ic('share', 'sm')} Share</button>`;

  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem('ch.' + k)); return v ?? d; } catch { return d; } },
    set(k, v) { localStorage.setItem('ch.' + k, JSON.stringify(v)); }
  };
  const S = {
    cart: store.get('cart', {}),
    saved: new Set(store.get('saved', [])),
    follows: new Set(store.get('follows', [])),
    reminders: new Set(store.get('reminders', [])),
    done: new Set(store.get('done', [])),
    regs: store.get('regs', []),
    orders: store.get('orders', []),
    myClubs: store.get('myclubs', [])
  };
  let SUG = null; // search suggestion index; rebuilt lazily after state changes
  function persist() {
    store.set('cart', S.cart);
    store.set('saved', [...S.saved]);
    store.set('follows', [...S.follows]);
    store.set('reminders', [...S.reminders]);
    store.set('done', [...S.done]);
    store.set('regs', S.regs);
    store.set('orders', S.orders);
    store.set('myclubs', S.myClubs);
    SUG = null;
    updateCartBadge();
  }
  function toggleIn(set, id) { set.has(id) ? set.delete(id) : set.add(id); persist(); return set.has(id); }

  let toastTimer;
  function toast(msg, icon = 'check') {
    const t = $('#toast');
    t.innerHTML = ic(icon) + '<span></span>';
    t.lastChild.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
  }

  function updateCartBadge() {
    const n = Object.values(S.cart).reduce((a, b) => a + b, 0);
    const b = $('#cart-count');
    b.textContent = n;
    b.hidden = n === 0;
  }

  // Highlights search terms in already-escaped text without breaking HTML entities.
  function hl(text, q) {
    const safe = esc(text);
    const terms = (q || '').trim().split(/\s+/).filter((t) => t.length > 1)
      .map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!terms.length) return safe;
    const re = new RegExp('(&[a-z#0-9]+;)|(' + terms.join('|') + ')', 'gi');
    return safe.replace(re, (m, ent, t) => (ent ? ent : '<mark>' + t + '</mark>'));
  }

  const SYN = {
    red: ['queen'], queen: ['red'], penalty: ['due', 'foul'], due: ['penalty'], fine: ['penalty', 'foul'],
    time: ['second', 'minute'], coin: ['carromman', 'coins'], points: ['point', 'score'], score: ['point'],
    late: ['minute', 'report'], size: ['cm', 'diameter'], weight: ['g ', 'gram']
  };
  function matchesQuery(hay, q) {
    const terms = (q || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    const h = hay.toLowerCase();
    return terms.every((t) => h.includes(t) || (SYN[t] || []).some((s) => h.includes(s)));
  }

  // ---------- shared components ----------
  function avatar(p, cls = '') {
    const h = hue(p.name);
    return `<span class="avatar ${p.star ? 'star' : ''} ${cls}" style="--av1:hsl(${h} 55% 48%);--av2:hsl(${(h + 40) % 360} 60% 30%)" aria-hidden="true">${esc(initials(p.name))}</span>`;
  }
  function cmp(label, a, b, fmt = (v) => v) {
    const tot = a + b || 1;
    return `<div style="margin:.55rem 0"><div class="row between small"><b>${fmt(a)}</b><span class="muted">${esc(label)}</span><b>${fmt(b)}</b></div>
      <div class="cmp-bar"><i class="a" style="flex:${a / tot}"></i><i class="b" style="flex:${b / tot}"></i></div></div>`;
  }
  function countdown(dateStr) {
    const ms = new Date(dateStr + 'T09:00:00') - Date.now();
    if (ms <= 0) return '';
    const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000), mi = Math.floor((ms % 3600000) / 60000);
    return `<div class="countdown" aria-label="Starts in ${d} days ${h} hours"><div><b>${d}</b><span>days</span></div><div><b>${h}</b><span>hrs</span></div><div><b>${mi}</b><span>min</span></div></div>`;
  }
  function icsLink(t) {
    const d = (s) => s.replace(/-/g, '');
    const end = new Date(t.end + 'T00:00:00'); end.setDate(end.getDate() + 1);
    const txt = (s) => s.replace(/[,;\\]/g, (c) => '\\' + c);
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CarromHub//EN', 'BEGIN:VEVENT', `UID:${t.id}@carromhub`, `DTSTART;VALUE=DATE:${d(t.start)}`, `DTEND;VALUE=DATE:${d(end.toISOString().slice(0, 10))}`, `SUMMARY:${txt(t.name)}`, `LOCATION:${txt(t.venue + ', ' + t.city)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
  }
  const ext = (url, label, cls = 'btn sm') => `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label} ${ic('ext', 'sm')}</a>`;
  // World Championship banner (Italy 2026). compact = single-row strip for secondary pages.
  function wcBanner(compact = false) {
    const over = new Date(WC.end + 'T23:59:59') < Date.now();
    const live = !over && new Date(WC.start + 'T00:00:00') <= Date.now();
    const status = over ? '<span class="pill">Completed</span>' : live ? '<span class="pill live">Live now</span>' : `<span class="pill warn">${ic('clock', 'sm')} In ${daysUntil(WC.start)} days</span>`;
    if (compact) {
      return `<a class="wc-strip" href="#/bodies?wc=1"><span class="tricolore" aria-hidden="true"></span><span class="row wrap" style="gap:.3rem .6rem;min-width:0"><b>${WC.flag} ${WC.edition} ${esc(WC.name)}</b><span class="small muted">${esc(WC.city)}, ${esc(WC.country)} · ${fdate(WC.start)} – ${fdate(WC.end)}</span></span>${status}${ic('right', 'sm')}</a>`;
    }
    return `
      <section class="wc-banner" id="wc">
        <span class="tricolore" aria-hidden="true"></span>
        <div class="wc-body">
          <div class="row wrap" style="gap:.4rem"><span class="pill" style="background:rgba(255,255,255,.14);color:#fff">${WC.edition} edition</span>${status}</div>
          <h2>${esc(WC.name)} <span class="small" style="opacity:.8;font-family:var(--font);font-weight:600">${esc(WC.country)}</span></h2>
          <p class="row wrap" style="gap:.3rem 1rem;margin:.2rem 0 .5rem"><span class="row" style="gap:.3rem">${ic('calendar', 'sm')} ${fdate(WC.start)} – ${fdate(WC.end)}</span><span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${esc(WC.venue)}, ${esc(WC.city)}, ${esc(WC.country)}</span></p>
          <div class="row wrap" style="gap:.3rem">${WC.events.map((e) => `<span class="pill" style="background:rgba(0,0,0,.25);color:#fff">${esc(e)}</span>`).join('')}</div>
          <p class="small" style="opacity:.85;margin:.6rem 0">Hosted by ${esc(WC.host)} under the aegis of the ${esc(WC.sanction)}. Open to all ICF member nations.</p>
          <div class="row wrap">${ext(WC.url, 'Official site', 'btn sm wc-btn')}<a class="btn sm wc-btn" href="${icsLink({ id: WC.id, start: WC.start, end: WC.end, name: WC.name, venue: WC.venue, city: WC.city + ', ' + WC.country })}" download="carrom-world-championship-2026.ics">${ic('download', 'sm')} Add to calendar</a><a class="btn sm wc-btn" href="#/bodies?wc=1">${ic('calendar', 'sm')} Day-by-day</a></div>
        </div>
        <div class="wc-count">${countdown(WC.start) || `<div class="num" style="font-size:1.6rem">${live ? 'Playing now' : 'Done'}</div>`}</div>
      </section>`;
  }
  function gamesWon(m) {
    let a = 0, b = 0;
    m.games.forEach(([x, y]) => (x > y ? a++ : b++));
    return [a, b];
  }
  function statusPill(s) {
    if (s === 'live') return '<span class="pill live">Live</span>';
    if (s === 'upcoming' || s === 'scheduled') return '<span class="pill warn">' + (s === 'scheduled' ? 'Scheduled' : 'Upcoming') + '</span>';
    return '<span class="pill">Completed</span>';
  }
  function matchCard(m) {
    const p1 = player(m.p1), p2 = player(m.p2), t = tourn(m.t);
    const [g1, g2] = gamesWon(m);
    const live = m.status === 'live';
    const c = m.cur || [0, 0];
    const lead = live ? (c[0] === c[1] ? -1 : c[0] > c[1] ? 0 : 1) : (g1 > g2 ? 0 : 1);
    const team = (p, i, g) => `
      <div class="team ${lead === i ? 'lead' : ''}">
        <span class="row" style="min-width:0">${avatar(p)}<span class="nm">${esc(p.name)}${p.star ? ' ' + starIc : ''}</span></span>
        <span class="score"><span class="g">${g}</span>${live ? `<span class="c">${c[i]}</span>` : ''}</span>
      </div>`;
    return `
      <a class="card link match ${live ? 'is-live' : ''} ${m.flash ? 'flash' : ''}" href="#/match/${esc(m.id)}">
        <div class="row between"><span class="small muted">${esc(t.name)} · ${esc(m.round)}</span>${statusPill(m.status)}</div>
        <div class="teams">${team(p1, 0, g1)}${team(p2, 1, g2)}</div>
        ${live ? `<div class="small muted row">${ic('target', 'sm')} Game ${m.games.length + 1} · Board ${m.board} of 8 · ${esc(m.court)}${m.stream ? ` · ${ic('play', 'sm')} Streaming` : ''}</div>
          <div class="progress" style="margin-top:.4rem"><i style="width:${Math.min(100, (Math.max(...c) / 25) * 100)}%"></i></div>`
        : m.status === 'scheduled' ? `<div class="small muted row">${ic('clock', 'sm')} Starts ${esc(m.time)} · ${esc(m.court)}</div>`
        : `<div class="small muted">Final · ${m.games.map((g) => g.join('–')).join(', ')}</div>`}
      </a>`;
  }
  function regOpen(t) { return t.status === 'upcoming' && t.regDeadline >= today() && t.filled < t.slots; }
  function isRegistered(tid) { return S.regs.some((r) => r.t === tid); }
  function eventCard(t) {
    const open = regOpen(t);
    const left = t.regDeadline ? daysUntil(t.regDeadline) : null;
    const pct = Math.round((t.filled / t.slots) * 100);
    return `
      <a class="card link stack" href="#/event/${esc(t.id)}">
        <div class="row between">${statusPill(t.status)}<span class="pill">${esc(t.level)}</span></div>
        <h3>${esc(t.name)}</h3>
        <div class="small muted">${ic('calendar', 'sm')} ${fdate(t.start)} – ${fdate(t.end)}<br>${ic('pin', 'sm')} ${esc(t.venue)}, ${esc(t.city)}</div>
        <div class="row wrap">${t.cats.map((c) => `<span class="pill">${esc(c)}</span>`).join('')}</div>
        <div class="row between small"><span>Prize pool <b>${inr(t.prize)}</b></span><span>Entry ${inr(t.fee)}</span></div>
        ${t.status === 'upcoming' ? `
          <div class="progress"><i style="width:${pct}%"></i></div>
          <div class="row between small"><span class="muted">${t.filled}/${t.slots} slots filled</span>
          ${isRegistered(t.id) ? '<span class="pill ok">Registered</span>' : open ? `<span class="pill ${left <= 3 ? 'live' : 'ok'}">Reg. closes in ${left}d</span>` : '<span class="pill">Reg. closed</span>'}</div>` : ''}
      </a>`;
  }
  function playerCard(p) {
    const c = club(p.club);
    return `
      <a class="card link row" href="#/player/${esc(p.id)}">
        ${avatar(p)}
        <div style="min-width:0"><b>${esc(p.name)}${p.star ? ' ' + starIc : ''}</b>
        <div class="small muted">#${p.rank} ${esc(p.cat)} · ${esc(c ? c.city : '')}</div></div>
      </a>`;
  }
  function ruleCard(r, q = '') {
    const cat = byId(CATS, r.cat);
    const lvl = { basic: 'Must-know', advanced: 'Competitive', official: 'Umpire' }[r.level];
    const saved = S.saved.has(r.id);
    return `
      <article class="card rule ${saved ? 'saved' : ''}" id="${ruleAnchor(r.id)}">
        <div class="row between wrap">
          <h3><span class="id">${esc(r.id)}</span>${hl(r.title, q)}</h3>
          <div class="row" style="gap:.35rem"><span class="pill lvl-${r.level}">${lvl}</span>
          <button class="btn sm icon" data-act="copy-rule" data-id="${esc(r.id)}" title="Copy link to this law" aria-label="Copy link">${ic('link', 'sm')}</button>
          <button class="btn sm icon ${saved ? 'on' : ''}" data-act="save-rule" data-id="${esc(r.id)}" aria-pressed="${saved}" title="Save law" aria-label="Save law">${ic('star', 'sm')}</button></div>
        </div>
        <p>${hl(r.text, q)}</p>
        <div class="row wrap small muted"><span>${cat.icon} ${esc(cat.name)}</span>
        ${r.tags.map((t) => `<span class="pill">${esc(byId(TAGS, t).label)}</span>`).join('')}</div>
      </article>`;
  }

  // ---------- views ----------
  function home(view) {
    const live = D.matches.filter((m) => m.status === 'live');
    const upcoming = D.tournaments.filter((t) => t.status === 'upcoming').sort((a, b) => a.start.localeCompare(b.start)).slice(0, 4);
    const openRegs = D.tournaments.filter(regOpen).length;
    const mine = uniq([...S.regs.map((r) => r.t), ...S.reminders]).map(tourn).filter((t) => t && t.status === 'upcoming').sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
    const followLive = live.filter((m) => S.follows.has(m.p1) || S.follows.has(m.p2));
    const nextLesson = D.lessons.find((l) => !S.done.has(l.id));
    const quick = [['#/live', 'live', 'Live scores'], ['#/events', 'trophy', 'Register'], ['#/rules', 'book', 'Laws'], ['#/scorer', 'calc', 'Score a game'], ['#/players', 'crown', 'Champions'], ['#/clubs', 'club', 'Clubs'], ['#/bodies', 'globe', 'Federations'], ['#/shop', 'shop', 'Shop']];
    const featuredBodies = BODIES.filter((b) => b.featured || ['icf', 'aicf', 'fic'].includes(b.id));
    view.innerHTML = `
      <section class="hero">
        <div class="row wrap" style="gap:.5rem">${live.length ? `<span class="pill live">${live.length} live now</span>` : ''}<span class="pill">${openRegs} registrations open</span></div>
        <h1 style="margin-top:.7rem">Every break. Every board. Live.</h1>
        <p class="muted lead">Scores, tournaments, rankings, the Laws of Carrom and gear — the complete carrom companion.</p>
        <div class="quick">${quick.map(([h, i, t]) => `<a href="${h}">${ic(i)}${t}</a>`).join('')}</div>
        <div class="hero-stats">
          <div><b>${D.players.length}</b><span>Ranked players</span></div>
          <div><b>${D.tournaments.length}</b><span>Tournaments</span></div>
          <div><b>${D.clubs.length}</b><span>Clubs</span></div>
          <div><b>${RULES.length}</b><span>Laws</span></div>
        </div>
      </section>

      ${announcementBar()}
      ${wcBanner()}

      ${mine.length || followLive.length || nextLesson ? `
      <section class="section">
        <div class="section-h"><h2>For you</h2><a href="#/me">My CarromHub ${ic('right', 'sm')}</a></div>
        <div class="grid">
          ${followLive.map(matchCard).join('')}
          ${mine.map((t) => `<a class="card link" href="#/event/${esc(t.id)}"><div class="row between"><span class="pill ${isRegistered(t.id) ? 'ok' : 'warn'}">${isRegistered(t.id) ? 'Registered' : 'Reminder'}</span><span class="small muted">${fdate(t.start)}</span></div><h3 style="margin-top:.5rem">${esc(t.name)}</h3><div class="small muted row">${ic('pin', 'sm')} ${esc(t.city)}</div><div style="margin-top:.6rem">${countdown(t.start)}</div></a>`).join('')}
          ${nextLesson ? `<a class="card link" href="#/lesson/${esc(nextLesson.id)}"><span class="pill info">Continue learning</span><h3 style="margin-top:.5rem">${esc(nextLesson.title)}</h3><div class="small muted">${esc(byId(D.tracks, nextLesson.track).name)} · ${esc(nextLesson.type)} · ${nextLesson.mins} min</div><div class="progress" style="margin-top:.7rem"><i style="width:${(S.done.size / D.lessons.length) * 100}%"></i></div><div class="small muted" style="margin-top:.3rem">${S.done.size}/${D.lessons.length} lessons complete</div></a>` : ''}
        </div>
      </section>` : ''}

      <section class="section">
        <div class="section-h"><h2>Live now</h2><a href="#/live">All matches ${ic('right', 'sm')}</a></div>
        ${live.length ? `<div class="hscroll">${live.map(matchCard).join('')}</div>` : `<div class="card empty">${ic('live')}<br>No live matches right now.</div>`}
      </section>

      <section class="section">
        <div class="section-h"><h2>Upcoming tournaments</h2><a href="#/events">View all ${ic('right', 'sm')}</a></div>
        <div class="grid">${upcoming.map(eventCard).join('')}</div>
      </section>

      <section class="section">
        <div class="section-h"><h2>World champions</h2><a href="#/players?tab=champions">All editions ${ic('right', 'sm')}</a></div>
        <div class="grid">${championsData().filter((e) => e.events && e.events.ms && e.events.ws).sort((a, b) => b.year - a.year).slice(0, 3).map((e) => { const s = byId(window.CHAMPION_SERIES, e.series); return `<a class="card link" href="#/players?tab=champions"><div class="row between"><span class="pill warn">${esc(s.short)} ${e.year}</span><span class="small muted">${esc(e.host)}</span></div><div class="row" style="margin-top:.6rem">${avatar({ name: e.events.ms[0].name, star: true })}<div><b>${esc(e.events.ms[0].name)}</b><div class="small muted">Men's singles · ${esc(e.events.ms[0].country)}</div></div></div><div class="row" style="margin-top:.5rem">${avatar({ name: e.events.ws[0].name, star: true })}<div><b>${esc(e.events.ws[0].name)}</b><div class="small muted">Women's singles · ${esc(e.events.ws[0].country)}</div></div></div></a>`; }).join('')}</div>
      </section>

      <section class="section">
        <div class="section-h"><h2>Rule of the day</h2><a href="#/rules">All laws ${ic('right', 'sm')}</a></div>
        ${ruleCard(RULES[new Date().getDate() % RULES.length])}
      </section>

      <section class="section">
        <div class="section-h"><h2>Governing bodies</h2><a href="#/bodies">All federations ${ic('right', 'sm')}</a></div>
        <div class="grid">${featuredBodies.map(bodyCard).join('')}</div>
      </section>

      <section class="section">
        <div class="section-h"><h2>Headlines</h2></div>
        <div class="grid">${D.news.map((n) => `<div class="card"><span class="pill">${esc(n.tag)}</span><h3 style="margin-top:.5rem">${esc(n.title)}</h3><span class="small muted row">${ic('clock', 'sm')} ${n.mins} min read</span></div>`).join('')}</div>
      </section>`;
  }

  const LV = { tab: 'live', mine: false };
  function live(view) {
    const groups = { live: 'Live', scheduled: 'Scheduled', finished: 'Results' };
    const list = D.matches.filter((m) => m.status === LV.tab && (!LV.mine || S.follows.has(m.p1) || S.follows.has(m.p2)));
    view.innerHTML = `
      <div class="row between wrap"><h1>Matches</h1>${shareBtn('CarromHub live matches')}</div>
      <div class="row between wrap">
        <div class="tabs" role="tablist" style="margin-bottom:.6rem">${Object.entries(groups).map(([k, v]) => `<button class="tab ${LV.tab === k ? 'on' : ''}" data-tab="${k}">${v} (${D.matches.filter((m) => m.status === k).length})</button>`).join('')}</div>
        <label class="toggle" style="margin-bottom:.6rem"><input type="checkbox" id="lv-mine" ${LV.mine ? 'checked' : ''}> Players I follow</label>
      </div>
      ${list.length ? `<div class="grid">${list.map(matchCard).join('')}</div>` : `<div class="card empty">${ic('live')}<br>${LV.mine && !S.follows.size ? 'Follow players from the rankings to filter matches here.' : 'Nothing here yet.'}</div>`}
      <div class="card row between wrap" style="margin-top:1.2rem"><div class="row">${ic('calc', 'lg')}<div><b>Playing a friendly?</b><div class="small muted">Use the official-format score keeper.</div></div></div><a class="btn primary" href="#/scorer">Score a game</a></div>`;
    $$('[data-tab]', view).forEach((b) => b.addEventListener('click', () => { LV.tab = b.dataset.tab; live(view); }));
    $('#lv-mine', view).addEventListener('change', (e) => { LV.mine = e.target.checked; live(view); });
  }

  function matchView(view, id) {
    const m = byId(D.matches, id);
    if (!m) return notFound(view);
    const p1 = player(m.p1), p2 = player(m.p2), t = tourn(m.t);
    const [g1, g2] = gamesWon(m);
    const c = m.cur || [0, 0];
    view.innerHTML = `
      <div class="row between"><a class="back" href="#/live">${ic('back')} Matches</a>${shareBtn(`${p1.name} vs ${p2.name} — ${t.name}`)}</div>
      <section class="card scoreboard">
        <div class="small muted">${esc(t.name)} · ${esc(m.cat)} · ${esc(m.round)}</div>
        <div style="margin-top:.4rem">${statusPill(m.status)}</div>
        <div class="big">
          <a href="#/player/${esc(p1.id)}">${avatar(p1, 'lg')}<div style="margin-top:.4rem"><b>${esc(p1.name)}</b></div><div class="small muted">#${p1.rank} ${esc(p1.cat)}</div></a>
          <div><div class="num">${g1} – ${g2}</div><div class="small muted">games</div>
          ${m.status === 'live' ? `<div class="num cur">${c[0]} – ${c[1]}</div><div class="small muted">Game ${m.games.length + 1} · Board ${m.board}/8</div>` : ''}</div>
          <a href="#/player/${esc(p2.id)}">${avatar(p2, 'lg')}<div style="margin-top:.4rem"><b>${esc(p2.name)}</b></div><div class="small muted">#${p2.rank} ${esc(p2.cat)}</div></a>
        </div>
        <div class="row center wrap">${m.stream ? `<span class="pill live">${ic('play', 'sm')} Streaming on CarromHub TV</span>` : ''}<a class="btn sm" href="#/compare?a=${esc(p1.id)}&b=${esc(p2.id)}">${ic('swap', 'sm')} Head to head</a></div>
      </section>

      <div class="grid fit" style="margin-top:1rem">
        <section class="card">
          <h2>Games</h2>
          <table><thead><tr><th>Game</th><th class="num-c">${esc(p1.name.split(' ')[0])}</th><th class="num-c">${esc(p2.name.split(' ')[0])}</th></tr></thead><tbody>
          ${m.games.map((g, i) => `<tr><td>Game ${i + 1}</td><td class="num-c">${g[0]}</td><td class="num-c">${g[1]}</td></tr>`).join('')}
          ${m.status === 'live' ? `<tr><td>Game ${m.games.length + 1} <span class="pill live">now</span></td><td class="num-c">${c[0]}</td><td class="num-c">${c[1]}</td></tr>` : ''}
          </tbody></table>
          <p class="small muted">Best of 3 games · 25 points or 8 boards per game (Law IX).</p>
        </section>
        <section class="card">
          <h2>Season comparison</h2>
          ${cmp('Win %', winPct(p1), winPct(p2), (v) => v + '%')}
          ${cmp('White slams', p1.stats.whiteSlams, p2.stats.whiteSlams)}
          ${cmp('Black slams', p1.stats.blackSlams, p2.stats.blackSlams)}
          ${cmp('Queen cover %', p1.stats.queenRate, p2.stats.queenRate, (v) => v + '%')}
        </section>
        <section class="card">
          <h2>Board feed</h2>
          ${(m.log || []).length ? `<ul class="small" style="padding-left:1rem;margin:0">${m.log.slice().reverse().map((l, i) => `<li style="padding:.2rem 0;${i === 0 ? 'color:var(--accent2);font-weight:600' : ''}">${esc(l)}</li>`).join('')}</ul>` : '<p class="muted small">Updates appear here as each board finishes.</p>'}
          <p class="small"><a href="#/rules?cat=scoring" style="color:var(--accent2)">How is this scored? ${ic('right', 'sm')}</a></p>
        </section>
      </div>`;
  }

  const EV = { status: 'upcoming', level: 'All', cat: 'All', state: 'All', open: false, q: '', tab: 'community' };
  function communityEventCard(e, detail) {
    const my = e.my;
    const full = e.approved >= e.slots;
    const st = e.status !== 'open' ? `<span class="pill">${esc(e.status)}</span>` : full ? '<span class="pill">Full</span>' : '<span class="pill ok">Open</span>';
    const action = !API.ok ? '' : e.owner ? `<a class="btn sm" href="#/organiser">${ic('edit', 'sm')} Manage${e.pending ? ` · ${e.pending} pending` : ''}</a>`
      : my && my.status === 'approved' ? `<span class="pill ok">${ic('check', 'sm')} You’re in</span> <button class="btn sm ghost" data-withdraw="${esc(e.id)}" data-jid="${esc(my.id)}">Withdraw</button>`
      : my && my.status === 'pending' ? `<span class="pill warn">${ic('clock', 'sm')} Request pending</span> <button class="btn sm ghost" data-withdraw="${esc(e.id)}" data-jid="${esc(my.id)}">Withdraw</button>`
      : my && my.status === 'declined' ? '<span class="pill">Declined</span>'
      : e.status === 'open' && !full ? `<button class="btn sm primary" data-join="${esc(e.id)}">${ic('login', 'sm')} Request to join</button>` : '';
    return `<article class="card cevent" id="ev-${esc(e.id)}">
      <div class="row between wrap" style="align-items:flex-start"><div><span class="pill info">${esc(e.type)}</span> <span class="pill">${esc(e.format)}</span><h3 style="margin:.4rem 0 0">${esc(e.name)}</h3><div class="small muted">by ${esc(e.organiser)}${e.organiser_org ? ' · ' + esc(e.organiser_org) : ''}</div></div>${st}</div>
      <div class="small muted row wrap" style="gap:.3rem 1rem;margin:.5rem 0"><span class="row" style="gap:.3rem">${ic('calendar', 'sm')} ${fdate(e.start_date)}${e.end_date !== e.start_date ? ' – ' + fdate(e.end_date) : ''}</span><span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${e.venue ? esc(e.venue) + ', ' : ''}${esc(e.city)}, ${esc(e.state)}</span><span>${e.fee ? 'Entry ' + inr(e.fee) : 'Free entry'}</span></div>
      ${e.description ? `<p class="small" style="margin:0 0 .5rem">${esc(e.description)}</p>` : ''}
      <div class="progress"><i style="width:${Math.min(100, (e.approved / e.slots) * 100)}%"></i></div>
      <div class="row between wrap" style="margin-top:.5rem"><span class="small muted">${e.approved}/${e.slots} players confirmed</span><span class="row wrap" style="gap:.4rem">${action}${detail ? '' : `<a class="btn sm ghost" href="#/cevent/${esc(e.id)}">Details ${ic('right', 'sm')}</a>`}</span></div>
    </article>`;
  }
  function joinSheet(eventId, onDone) {
    $$('.share-sheet').forEach((s) => s.remove());
    const el = document.createElement('div');
    el.className = 'share-sheet';
    el.innerHTML = `<form class="share-box card form" id="join-form" novalidate style="max-width:none" role="dialog" aria-label="Request to join">
      <div class="row between"><b class="row">${ic('login')} Request to join</b><button class="btn sm icon ghost" type="button" data-close aria-label="Close">${ic('x', 'sm')}</button></div>
      <p class="small muted" style="margin:0">The organiser sees your name and this note, then approves or declines within the available slots.</p>
      <label>Category <span class="muted" style="font-weight:400">(optional)</span><input class="input" name="category" maxlength="40" placeholder="e.g. Men's singles, Doubles with Rakesh"></label>
      <label>Note to organiser <span class="muted" style="font-weight:400">(optional)</span><textarea class="input" name="note" rows="2" maxlength="300" placeholder="Availability, club, skill level…"></textarea></label>
      <span class="err"></span>
      <button class="btn primary block" type="submit">${ic('check', 'sm')} Send request</button>
    </form>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) el.remove(); });
    $('#join-form', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { await api(`/api/events/${eventId}/joins`, 'POST', f); el.remove(); toast('Request sent — the organiser will confirm', 'check'); onDone(); }
      catch (ex) { $('.err', e.target).textContent = ex.message; }
    });
  }
  function bindJoinActions(view, refresh) {
    $$('[data-join]', view).forEach((b) => b.addEventListener('click', () => {
      if (!API.user) return requireLogin(location.hash);
      joinSheet(b.dataset.join, refresh);
    }));
    $$('[data-withdraw]', view).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Withdraw your request for this event?')) return;
      try { await api(`/api/events/${b.dataset.withdraw}/joins/${b.dataset.jid}`, 'PATCH', { status: 'withdrawn' }); toast('Request withdrawn'); refresh(); } catch (ex) { toast(ex.message, 'info'); }
    }));
  }
  async function communityEventsTab(view) {
    const box = $('#ev-community', view);
    if (!API.ok) { box.innerHTML = `<div class="card empty">${ic('users')}<br>Community events need the server (npm start).</div>`; return; }
    const h = location.hash;
    try {
      const { events } = await api('/api/events');
      if (stale(h)) return;
      const list = events.filter((e) => !EV.q || matchesQuery(`${e.name} ${e.city} ${e.state} ${e.type} ${e.format} ${e.organiser}`, EV.q));
      box.innerHTML = `
        <div class="card row between wrap" style="margin-bottom:1rem"><div class="row">${ic('users', 'lg')}<div><b>Matches & tournaments run by organisers on CarromHub</b><div class="small muted">Players send a join request; the organiser approves within the available slots.</div></div></div>${API.user && (API.user.role === 'organiser' || API.user.role === 'admin') ? `<a class="btn primary" href="#/organiser">${ic('trophy', 'sm')} Create an event</a>` : API.user ? '<span class="small muted">Organiser accounts can host events</span>' : `<a class="btn" href="#/login?next=${encodeURIComponent('#/events')}">${ic('login', 'sm')} Sign in to request</a>`}</div>
        ${list.length ? `<div class="grid two">${list.map((e) => communityEventCard(e, false)).join('')}</div>` : `<div class="card empty">${ic('trophy')}<br>No community events yet${EV.q ? ' match your search' : ''}.</div>`}`;
      bindJoinActions(view, () => communityEventsTab(view));
    } catch (ex) { if (!stale(h)) box.innerHTML = `<div class="card empty">${ic('info')}<br>${esc(ex.message)}</div>`; }
  }
  async function communityEventView(view, id) {
    view.innerHTML = `<a class="back" href="#/events">${ic('back')} Events</a><div class="skeleton" style="height:160px"></div>`;
    const h = location.hash;
    try {
      const e = await api('/api/events/' + encodeURIComponent(id));
      if (stale(h)) return;
      view.innerHTML = `
        <div class="row between"><a class="back" href="#/events">${ic('back')} Events</a>${shareBtn(e.name + ' — CarromHub')}</div>
        ${communityEventCard(e, true)}
        <section class="card section"><h2>${e.owner ? 'Join requests' : 'Confirmed players'} (${e.joins.length})</h2>
          ${e.joins.length ? `<div class="stack" style="--gap:.3rem">${e.joins.map((j) => `<div class="list-row" style="padding:.45rem 0"><span class="row">${avatar({ name: j.player })}<span><b>${esc(j.player)}</b>${j.player_city ? ` <span class="small muted">· ${esc(j.player_city)}</span>` : ''}${j.note ? `<br><span class="small muted">“${esc(j.note)}”</span>` : ''}</span></span>
            ${e.owner && j.status === 'pending' ? `<span class="row" style="gap:.3rem"><button class="btn sm primary" data-decide="approved" data-jid="${esc(j.id)}">${ic('check', 'sm')} Approve</button><button class="btn sm ghost" data-decide="declined" data-jid="${esc(j.id)}">Decline</button></span>` : `<span class="pill ${j.status === 'approved' ? 'ok' : j.status === 'pending' ? 'warn' : ''}">${esc(j.status)}</span>`}</div>`).join('')}</div>` : '<p class="small muted">Nobody yet.</p>'}
        </section>`;
      bindJoinActions(view, () => communityEventView(view, id));
      $$('[data-decide]', view).forEach((b) => b.addEventListener('click', async () => { try { await api(`/api/events/${id}/joins/${b.dataset.jid}`, 'PATCH', { status: b.dataset.decide }); toast(b.dataset.decide === 'approved' ? 'Player approved' : 'Request declined'); communityEventView(view, id); } catch (ex) { toast(ex.message, 'info'); } }));
    } catch (ex) { if (!stale(h)) view.innerHTML = `<a class="back" href="#/events">${ic('back')} Events</a><div class="card empty">${ic('info')}<br>${esc(ex.message)}</div>`; }
  }
  function events(view) {
    const levels = ['All', ...uniq(D.tournaments.map((t) => t.level))];
    const cats = ['All', ...uniq(D.tournaments.flatMap((t) => t.cats))];
    const states = ['All', ...uniq(D.tournaments.map((t) => t.state)).sort()];
    const community = EV.tab === 'community';
    view.innerHTML = `
      <h1>Tournaments</h1>
      ${wcBanner(true)}
      <div class="tabs">${[['community', 'Community events', 'users'], ['federation', 'Federation calendar (demo)', 'trophy']].map(([k, v, i]) => `<button class="tab ${EV.tab === k ? 'on' : ''}" data-evtab="${k}">${ic(i, 'sm')} ${v}</button>`).join('')}</div>
      ${community ? `<div class="filters"><input class="input grow" id="ev-q" type="search" placeholder="Search event, organiser, city…" value="${esc(EV.q)}" maxlength="60"></div><div id="ev-community"><div class="skeleton" style="height:120px"></div></div>` : `
      <div class="tabs">${['upcoming', 'live', 'completed', 'all'].map((s) => `<button class="tab ${EV.status === s ? 'on' : ''}" data-st="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <div class="chips">${levels.map((l) => `<button class="chip ${EV.level === l ? 'on' : ''}" data-lv="${esc(l)}">${esc(l)}</button>`).join('')}</div>
      <div class="filters">
        <input class="input grow" id="ev-q" type="search" placeholder="Search name, city, venue…" value="${esc(EV.q)}" maxlength="60">
        <select class="input" id="ev-cat" aria-label="Category">${cats.map((c) => `<option ${EV.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select class="input" id="ev-state" aria-label="State">${states.map((c) => `<option ${EV.state === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <label class="toggle"><input type="checkbox" id="ev-open" ${EV.open ? 'checked' : ''}> Registration open</label>
      </div>
      <div id="ev-list"></div>`}`;
    $$('[data-evtab]', view).forEach((b) => b.addEventListener('click', () => { EV.tab = b.dataset.evtab; EV.q = ''; events(view); }));
    if (community) {
      $('#ev-q', view).addEventListener('input', (e) => { EV.q = e.target.value; communityEventsTab(view); });
      communityEventsTab(view);
      return;
    }
    const draw = () => {
      const list = D.tournaments.filter((t) =>
        (EV.status === 'all' || t.status === EV.status) &&
        (EV.level === 'All' || t.level === EV.level) &&
        (EV.cat === 'All' || t.cats.includes(EV.cat)) &&
        (EV.state === 'All' || t.state === EV.state) &&
        (!EV.open || regOpen(t)) &&
        (!EV.q || matchesQuery(`${t.name} ${t.city} ${t.venue} ${t.state}`, EV.q))
      ).sort((a, b) => (EV.status === 'completed' ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
      $('#ev-list', view).innerHTML = list.length ? `<p class="small muted">${list.length} tournament(s)</p><div class="grid">${list.map(eventCard).join('')}</div>` : '<div class="card empty">No tournaments match these filters.</div>';
    };
    $$('[data-st]', view).forEach((b) => b.addEventListener('click', () => { EV.status = b.dataset.st; events(view); }));
    $$('[data-lv]', view).forEach((b) => b.addEventListener('click', () => { EV.level = b.dataset.lv; events(view); }));
    $('#ev-q', view).addEventListener('input', (e) => { EV.q = e.target.value; draw(); });
    $('#ev-cat', view).addEventListener('change', (e) => { EV.cat = e.target.value; draw(); });
    $('#ev-state', view).addEventListener('change', (e) => { EV.state = e.target.value; draw(); });
    $('#ev-open', view).addEventListener('change', (e) => { EV.open = e.target.checked; draw(); });
    draw();
  }

  function eventView(view, id) {
    const t = tourn(id);
    if (!t) return notFound(view);
    const matches = D.matches.filter((m) => m.t === id);
    const open = regOpen(t);
    const myRegs = S.regs.filter((r) => r.t === id);
    const reminded = S.reminders.has(id);
    view.innerHTML = `
      <div class="row between"><a class="back" href="#/events">${ic('back')} Tournaments</a>${shareBtn(t.name)}</div>
      <section class="hero">
        <div class="row wrap">${statusPill(t.status)}<span class="pill">${esc(t.level)}</span></div>
        <h1 style="margin-top:.6rem">${esc(t.name)}</h1>
        <p class="row wrap" style="gap:.3rem 1rem"><span class="row" style="gap:.3rem">${ic('calendar', 'sm')} ${fdate(t.start)} – ${fdate(t.end)}</span><span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${esc(t.venue)}, ${esc(t.city)}, ${esc(t.state)}</span></p>
        <p class="small muted">Organised by ${esc(t.organizer)}</p>
        ${t.status === 'upcoming' ? `<div style="margin:.6rem 0">${countdown(t.start)}</div>` : ''}
        <div class="row wrap" style="margin-top:.8rem">
          ${open && !myRegs.length ? `<a class="btn primary" href="#/register/${esc(t.id)}">Register · ${inr(t.fee)}</a>` : ''}
          ${myRegs.length ? `<span class="pill ok">${ic('check', 'sm')} You are registered</span>` : ''}
          ${t.status === 'upcoming' ? `<button class="btn ${reminded ? 'on' : ''}" id="remind">${ic('bell', 'sm')} ${reminded ? 'Reminder on' : 'Remind me'}</button>
          <a class="btn" href="${icsLink(t)}" download="${esc(t.name.replace(/[^\w]+/g, '-'))}.ics">${ic('download', 'sm')} Add to calendar</a>` : ''}
          ${t.status === 'live' ? `<a class="btn primary" href="#/live">${ic('live', 'sm')} Watch live scores</a>` : ''}
        </div>
      </section>
      <div class="grid fit" style="margin-top:1rem">
        <section class="card">
          <h2>Key facts</h2>
          <div class="kpi">
            <div><b>${inr(t.prize)}</b><span class="small muted">Prize pool</span></div>
            <div><b>${inr(t.fee)}</b><span class="small muted">Entry fee</span></div>
            <div><b>${t.filled}/${t.slots}</b><span class="small muted">Players</span></div>
            ${t.regDeadline ? `<div><b>${fdate(t.regDeadline)}</b><span class="small muted">Reg. deadline</span></div>` : ''}
          </div>
          <h3 style="margin-top:1rem">Categories</h3>
          <div class="row wrap">${t.cats.map((c) => `<span class="pill">${esc(c)}</span>`).join('')}</div>
        </section>
        <section class="card">
          <h2>Format & rules</h2>
          <ul class="small">
            <li>Best of 3 games; each game is 25 points or 8 boards.</li>
            <li>Up to pre-quarters, a tie after 8 boards goes to an extra board.</li>
            <li>10 seconds per stroke; report within 15 minutes of your match call.</li>
            <li>Bring a certified striker (max 15 g, 4.13 cm).</li>
          </ul>
          <a class="btn sm" href="#/rules?cat=scoring">Read the laws</a>
        </section>
        ${t.winners ? `<section class="card"><h2>Champions</h2>${Object.entries(t.winners).map(([c, pid]) => `<a class="list-row" href="#/player/${esc(pid)}"><span class="muted">${esc(c)}</span><span class="row" style="gap:.4rem">${ic('crown', 'sm star-ic')}<b>${esc(player(pid).name)}</b></span></a>`).join('')}</section>` : ''}
      </div>
      ${matches.length ? `<section class="section"><h2>Matches</h2><div class="grid">${matches.map(matchCard).join('')}</div></section>` : ''}`;
    const r = $('#remind', view);
    if (r) r.addEventListener('click', () => { toast(toggleIn(S.reminders, id) ? 'Reminder set' : 'Reminder removed', 'bell'); eventView(view, id); });
  }

  function registerView(view, id) {
    const t = tourn(id);
    if (!t) return notFound(view);
    if (!regOpen(t)) {
      view.innerHTML = `<a class="back" href="#/event/${esc(id)}">${ic('back')} Back</a><div class="card empty">${ic('clock')}<br>Registration is closed for this tournament.</div>`;
      return;
    }
    view.innerHTML = `
      <a class="back" href="#/event/${esc(id)}">${ic('back')} ${esc(t.name)}</a>
      <h1>Register</h1>
      <p class="muted">${esc(t.name)} · ${fdate(t.start)} · Entry ${inr(t.fee)}</p>
      <form class="form card" id="reg-form" novalidate>
        <label>Full name<input class="input" name="name" autocomplete="name" maxlength="60" required><span class="err"></span></label>
        <label>Mobile number<input class="input" name="phone" inputmode="numeric" autocomplete="tel" maxlength="10" placeholder="10-digit mobile" required><span class="err"></span></label>
        <label>Email<input class="input" name="email" type="email" autocomplete="email" maxlength="80" required><span class="err"></span></label>
        <label>Date of birth<input class="input" name="dob" type="date" required><span class="err"></span></label>
        <label>Category<select class="input" name="cat" required><option value="">Select…</option>${t.cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select><span class="err"></span></label>
        <label>Club (optional)<select class="input" name="club"><option value="">Independent</option>${D.clubs.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select><span class="err"></span></label>
        <label class="toggle"><input type="checkbox" name="agree" required> I agree to follow the Laws of Carrom and the tournament code of conduct.</label>
        <span class="err" data-for="agree"></span>
        <button class="btn primary block" type="submit">Continue to payment · ${inr(t.fee)}</button>
      </form>`;
    const form = $('#reg-form', view);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const errs = {};
      const name = (f.name || '').trim();
      if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name)) errs.name = 'Enter a valid name (letters only).';
      if (!/^[6-9]\d{9}$/.test(f.phone || '')) errs.phone = 'Enter a valid 10-digit Indian mobile number.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email || '')) errs.email = 'Enter a valid email.';
      if (!f.cat) errs.cat = 'Choose a category.';
      if (!f.dob) errs.dob = 'Enter your date of birth.';
      else {
        const age = (new Date(t.start) - new Date(f.dob)) / (365.25 * 86400000);
        if (age < 8 || age > 100) errs.dob = 'Please check the date of birth.';
        else if (f.cat === 'Junior' && age >= 18) errs.dob = 'Junior category is for players under 18.';
        else if (f.cat === 'Veterans' && age < 50) errs.dob = 'Veterans category is for players aged 50+.';
      }
      if (!f.agree) errs.agree = 'Please accept to continue.';
      if (!errs.phone && S.regs.some((r) => r.t === id && r.phone === f.phone && r.cat === f.cat)) errs.phone = 'This number is already registered in this category.';

      $$('.err', form).forEach((el) => { el.textContent = ''; });
      Object.entries(errs).forEach(([k, msg]) => {
        const field = form.elements[k];
        const errEl = k === 'agree' ? $('[data-for="agree"]', form) : field.parentElement.querySelector('.err');
        errEl.textContent = msg;
      });
      if (Object.keys(errs).length) return;

      const reg = { id: 'REG-' + Math.random().toString(36).slice(2, 8).toUpperCase(), t: id, name, phone: f.phone, email: f.email, cat: f.cat, club: f.club, at: new Date().toISOString() };
      S.regs.push(reg);
      persist();
      view.innerHTML = `
        <div class="card" style="text-align:center;max-width:520px;margin:2rem auto">
          <div style="width:72px;height:72px;border-radius:50%;background:rgba(52,211,153,.15);color:var(--green);display:grid;place-items:center;margin:0 auto .8rem">${ic('check', 'lg')}</div>
          <h1>You're in!</h1>
          <p>${esc(reg.name)} · ${esc(reg.cat)}</p>
          <p class="muted">${esc(t.name)} · ${fdate(t.start)}</p>
          <p>Registration ID <b>${esc(reg.id)}</b></p>
          <p class="small muted">Demo: payment gateway (UPI/card) plugs in here. A confirmation SMS/email is sent in production.</p>
          <div class="row" style="justify-content:center"><a class="btn" href="#/event/${esc(id)}">Back to event</a><a class="btn primary" href="#/me">My registrations</a></div>
        </div>`;
    });
  }

  const PL = { cat: 'All', state: 'All', star: false, q: '', tab: 'champions', series: 'all' };
  const MEDAL = ['🥇', '🥈', '🥉'];
  // Champions data = bundled ICF transcription, overridable/extendable via the admin content key "champions".
  const championsData = () => {
    const extra = API.content.champions;
    const base = window.CHAMPIONS || [];
    if (!extra || !Array.isArray(extra.editions)) return base;
    const merged = base.filter((b) => !extra.editions.some((e) => e.series === b.series && e.edition === b.edition));
    return [...merged, ...extra.editions];
  };
  function editionCard(e) {
    const s = byId(window.CHAMPION_SERIES, e.series);
    const ev = Object.entries(e.events || {}).filter(([, list]) => list && list.length);
    const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : (n % 10 < 4 ? n % 10 : 0)]);
    return `<article class="card edition ${ev.length ? '' : 'pending'}">
      <div class="row between wrap" style="align-items:flex-start">
        <div class="row"><span class="body-flag">${ic(s.icon)}</span><div><h3 style="margin:0">${ord(e.edition)} ${esc(s.name)}${e.year ? ` <span class="muted" style="font-weight:500">· ${e.year}</span>` : ''}</h3><div class="small muted">${e.host ? `${ic('pin', 'sm')} ${esc(e.host)}, ${esc(e.country)}` : ''}${e.dates ? ' · ' + esc(e.dates) : ''}</div></div></div>
        ${e.status ? `<span class="pill ${e.status === 'Upcoming' ? 'warn' : ''}">${esc(e.status)}</span>` : `<span class="pill ok">${ev.length} events</span>`}
      </div>
      ${e.note ? `<p class="small muted" style="margin:.5rem 0 0">${esc(e.note)}</p>` : ''}
      ${ev.length ? `<div class="medals">${ev.map(([k, list]) => `<div class="medal-row"><div class="small" style="font-weight:700;min-width:120px">${esc((window.CHAMPION_EVENTS.find((x) => x[0] === k) || [k, k])[1])}</div><ol>${list.slice(0, 3).map((w, i) => `<li><span class="m">${MEDAL[i]}</span><span>${esc(w.name)}</span><span class="small muted">${esc(w.country)}</span></li>`).join('')}</ol></div>`).join('')}</div>` : ''}
      <div class="row wrap" style="gap:.4rem;margin-top:.6rem">${ext(e.url, 'ICF results page')}${e.pdf ? ext(e.pdf, 'Results PDF') : ''}</div>
    </article>`;
  }
  function championsTab() {
    const all = championsData().sort((a, b) => ((a.year ? 0 : 1) - (b.year ? 0 : 1)) || ((b.year || 0) - (a.year || 0)) || b.edition - a.edition);
    const list = PL.series === 'all' ? all : all.filter((e) => e.series === PL.series);
    const q = PL.q.trim();
    const hit = (e) => !q || matchesQuery(`${e.host || ''} ${e.country || ''} ${e.year || ''} ${Object.values(e.events || {}).flat().map((w) => w.name + ' ' + w.country).join(' ')}`, q);
    const shown = list.filter(hit);
    // Hall of fame: singles titles per player; medal table: golds per country across all events.
    const titles = {}, golds = {};
    all.forEach((e) => Object.entries(e.events || {}).forEach(([k, ws]) => {
      if (ws[0]) golds[ws[0].country] = (golds[ws[0].country] || 0) + 1;
      if ((k === 'ms' || k === 'ws') && ws[0]) { const key = ws[0].name; titles[key] = titles[key] || { name: key, country: ws[0].country, n: 0, years: [] }; titles[key].n++; titles[key].years.push(e.year); }
    }));
    const hof = Object.values(titles).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 8);
    const medal = Object.entries(golds).sort((a, b) => b[1] - a[1]);
    return `
      <p class="muted small">Winners of the ICF World Championship, World Cup and ICF Cup, transcribed from the <a href="${window.CHAMPIONS_SOURCE}" target="_blank" rel="noopener noreferrer" style="color:var(--accent2)">International Carrom Federation</a> results pages (checked ${fdate(window.CHAMPIONS_UPDATED)}). Editions the ICF hasn’t published are marked and will be filled in as results appear.</p>
      <div class="grid two" style="margin-bottom:1rem;align-items:start">
        <section class="card"><h2 class="row">${ic('crown', 'star-ic')} Hall of fame · singles titles</h2><div class="stack" style="--gap:.3rem">${hof.map((h, i) => `<div class="list-row" style="padding:.4rem 0"><span class="row"><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span>${avatar({ name: h.name, star: i < 3 })}<span><b>${esc(h.name)}</b><br><span class="small muted">${esc(h.country)} · ${h.years.filter(Boolean).sort().join(', ')}</span></span></span><b class="price">${h.n}</b></div>`).join('')}</div></section>
        <section class="card"><h2 class="row">${ic('globe')} Gold medals by nation</h2><table><tbody>${medal.map(([c, n], i) => `<tr><td><span class="rank ${i < 3 ? 'r' + (i + 1) : ''}">${i + 1}</span></td><td><b>${esc(c)}</b></td><td class="num-c">${MEDAL[0]} ${n}</td><td style="width:40%"><div class="progress"><i style="width:${(n / medal[0][1]) * 100}%"></i></div></td></tr>`).join('')}</tbody></table><p class="small muted" style="margin:.6rem 0 0">Counts every event winner (singles, doubles, team, Swiss league) across published editions.</p></section>
      </div>
      <div class="row between wrap">
        <div class="chips"><button class="chip ${PL.series === 'all' ? 'on' : ''}" data-series="all">All (${all.length})</button>${window.CHAMPION_SERIES.map((s) => `<button class="chip ${PL.series === s.id ? 'on' : ''}" data-series="${s.id}">${esc(s.name)} (${all.filter((e) => e.series === s.id).length})</button>`).join('')}</div>
        <input class="input" id="ch-q" type="search" placeholder="Search player, nation, year…" value="${esc(PL.q)}" maxlength="60" style="min-width:220px">
      </div>
      <div class="stack section">${shown.length ? shown.map(editionCard).join('') : `<div class="card empty">${ic('trophy')}<br>No editions match.</div>`}</div>
      <p class="small muted">Spotted an error or have a newer result sheet? Admins can add or correct editions under <b>Admin → Content → champions</b>; the ICF’s own pages are linked on every card.</p>`;
  }
  function rankingsLocked() {
    const mca = byId(BODIES, 'mca'), aicf = byId(BODIES, 'aicf');
    return `
      <section class="card locked">
        <div class="row" style="align-items:flex-start"><span class="body-flag" style="background:rgba(var(--accent2-rgb),.15);color:var(--accent2)">${ic('shield')}</span>
        <div style="flex:1"><h2 style="margin:0">Live rankings are locked for now</h2>
        <p class="muted">A trustworthy ranking needs verified results from every sanctioned tournament — we don’t have that data feed yet, so we’d rather show nothing than a made-up table. Rankings unlock once organisers publish results through CarromHub or federations share their points tables.</p>
        <ol class="steps" style="max-width:520px;margin:.4rem 0 .8rem"><li class="done"><span></span>Scorer & clubs</li><li class="now"><span></span>Organiser results</li><li><span></span>Federation feeds</li><li><span></span>Rankings live</li></ol>
        <div class="row wrap">${ext(mca.links.rankings, 'Maharashtra state points table', 'btn sm primary')}${ext(aicf.url, 'AICF national ranking', 'btn sm')}<a class="btn sm" href="#/bodies">${ic('globe', 'sm')} All federations</a><a class="btn sm" href="#/organise">${ic('briefcase', 'sm')} Publish results with us</a></div></div></div>
      </section>
      <section class="section"><div class="section-h"><h2>Meanwhile</h2></div><div class="grid">
        <a class="card link" href="#/players?tab=champions">${ic('trophy', 'lg star-ic')}<b style="display:block;margin-top:.4rem">World champions</b><span class="small muted">Every ICF world title since 1991</span></a>
        <a class="card link" href="#/clubs">${ic('users', 'lg')}<b style="display:block;margin-top:.4rem">Your club roster</b><span class="small muted">Create a club and track your own members</span></a>
        <a class="card link" href="#/scorer">${ic('calc', 'lg')}<b style="display:block;margin-top:.4rem">Score keeper</b><span class="small muted">Official-format scoring, singles & doubles</span></a>
      </div></section>`;
  }
  function players(view, _a, qs) {
    if (qs && qs.get('tab')) PL.tab = qs.get('tab') === 'rankings' ? 'rankings' : 'champions';
    view.innerHTML = `
      <div class="row between wrap"><h1>${PL.tab === 'champions' ? 'World champions' : 'Players & rankings'}</h1>${PL.tab === 'champions' ? shareBtn('Carrom world champions — CarromHub', pageUrl('#/players?tab=champions')) : ''}</div>
      <div class="tabs">${[['champions', 'World champions', 'trophy'], ['rankings', 'Rankings', 'chart']].map(([k, v, i]) => `<button class="tab ${PL.tab === k ? 'on' : ''}" data-pt="${k}">${ic(i, 'sm')} ${v}${k === 'rankings' ? ' <span class="pill" style="margin-left:.3rem">locked</span>' : ''}</button>`).join('')}</div>
      <div id="pl-body-wrap">${PL.tab === 'champions' ? championsTab() : rankingsLocked()}</div>`;
    $$('[data-pt]', view).forEach((b) => b.addEventListener('click', () => { PL.tab = b.dataset.pt; players(view); }));
    $$('[data-series]', view).forEach((b) => b.addEventListener('click', () => { PL.series = b.dataset.series; players(view); }));
    const q = $('#ch-q', view);
    if (q) q.addEventListener('input', (e) => { PL.q = e.target.value; players(view); const el = $('#ch-q', view); el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  }

  // Demo ranking table kept for reference until real feeds exist (not routed).
  function playersDemoTable(view) {
    const cats = ['All', 'Men', 'Women', 'Junior', 'Veteran'];
    const states = ['All', ...uniq(D.players.map((p) => p.state)).sort()];
    view.innerHTML = `
      <h1>Players & rankings</h1>
      <div class="tabs">${cats.map((c) => `<button class="tab ${PL.cat === c ? 'on' : ''}" data-c="${c}">${c}</button>`).join('')}</div>
      <div class="filters">
        <input class="input grow" id="pl-q" type="search" placeholder="Search player or club…" value="${esc(PL.q)}" maxlength="60">
        <select class="input" id="pl-state" aria-label="State">${states.map((s) => `<option ${PL.state === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <label class="toggle"><input type="checkbox" id="pl-star" ${PL.star ? 'checked' : ''}> ${starIc} Star players</label>
      </div>
      <div class="card" style="padding:.4rem;overflow-x:auto"><table><thead><tr><th>#</th><th>Player</th><th>Club</th><th class="num-c">Pts</th><th class="num-c">Win %</th><th></th></tr></thead><tbody id="pl-body"></tbody></table></div>`;
    const draw = () => {
      const list = D.players.filter((p) =>
        (PL.cat === 'All' || p.cat === PL.cat) &&
        (PL.state === 'All' || p.state === PL.state) &&
        (!PL.star || p.star) &&
        (!PL.q || matchesQuery(`${p.name} ${club(p.club).name} ${p.state}`, PL.q))
      ).sort((a, b) => b.points - a.points);
      $('#pl-body', view).innerHTML = list.length ? list.map((p, i) => {
        const n = PL.cat === 'All' ? i + 1 : p.rank;
        return `
        <tr class="click" data-href="#/player/${esc(p.id)}">
          <td><span class="rank ${n <= 3 ? 'r' + n : ''}">${n}</span></td>
          <td><span class="row">${avatar(p)}<span><b>${esc(p.name)}</b>${p.star ? ' ' + starIc : ''}<br><span class="small muted">${esc(p.cat)} · ${esc(p.state)}</span></span></span></td>
          <td class="small">${esc(club(p.club).name)}</td>
          <td class="num-c"><b>${p.points}</b></td>
          <td class="num-c">${winPct(p)}%</td>
          <td><button class="btn sm ${S.follows.has(p.id) ? 'on' : ''}" data-act="follow" data-id="${esc(p.id)}">${S.follows.has(p.id) ? 'Following' : 'Follow'}</button></td>
        </tr>`;
      }).join('') : '<tr><td colspan="6" class="empty">No players found.</td></tr>';
    };
    $$('[data-c]', view).forEach((b) => b.addEventListener('click', () => { PL.cat = b.dataset.c; playersDemoTable(view); }));
    $('#pl-q', view).addEventListener('input', (e) => { PL.q = e.target.value; draw(); });
    $('#pl-state', view).addEventListener('change', (e) => { PL.state = e.target.value; draw(); });
    $('#pl-star', view).addEventListener('change', (e) => { PL.star = e.target.checked; draw(); });
    draw();
  }

  function playerView(view, id) {
    const p = player(id);
    if (!p) return notFound(view);
    const c = club(p.club);
    const ms = D.matches.filter((m) => m.p1 === id || m.p2 === id);
    const others = D.players.filter((x) => x.id !== id).sort((a, b) => (a.cat === p.cat ? -1 : 1) - (b.cat === p.cat ? -1 : 1) || b.points - a.points);
    view.innerHTML = `
      <div class="row between"><a class="back" href="#/players">${ic('back')} Players</a>${shareBtn(p.name + ' on CarromHub')}</div>
      <section class="hero row wrap">
        ${avatar(p, 'xl')}
        <div style="flex:1;min-width:200px">
          <h1>${esc(p.name)} ${p.star ? `<span class="pill warn">${ic('star', 'sm')} Star player</span>` : ''}</h1>
          <p><span class="rank ${p.rank <= 3 ? 'r' + p.rank : ''}">#${p.rank}</span> ${esc(p.cat)} · ${p.points} ranking pts</p>
          <p class="small muted row wrap" style="gap:.3rem 1rem"><a class="row" style="gap:.3rem" href="#/club/${esc(c.id)}">${ic('club', 'sm')} ${esc(c.name)}</a><span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${esc(p.state)}</span><span class="row" style="gap:.3rem">${ic('zap', 'sm')} ${esc(p.style)}</span></p>
        </div>
        <div class="row wrap">
          <button class="btn ${S.follows.has(p.id) ? 'on' : 'primary'}" data-act="follow" data-id="${esc(p.id)}">${S.follows.has(p.id) ? 'Following' : 'Follow'}</button>
          <select class="input" id="cmp-with" aria-label="Compare with"><option value="">Compare with…</option>${others.map((x) => `<option value="${esc(x.id)}">${esc(x.name)} (${esc(x.cat)})</option>`).join('')}</select>
        </div>
      </section>
      <section class="section card">
        <h2>Career stats</h2>
        <div class="kpi">
          <div><b>${p.stats.matches}</b><span class="small muted">Matches</span></div>
          <div><b>${winPct(p)}%</b><span class="small muted">Win rate</span></div>
          <div><b>${p.stats.whiteSlams}</b><span class="small muted">White slams</span></div>
          <div><b>${p.stats.blackSlams}</b><span class="small muted">Black slams</span></div>
          <div><b>${p.stats.queenRate}%</b><span class="small muted">Queen cover</span></div>
        </div>
        <div style="margin-top:1rem"><div class="row between small muted"><span>Wins ${p.stats.wins}</span><span>Losses ${p.stats.matches - p.stats.wins}</span></div><div class="progress" style="margin-top:.3rem;height:8px"><i style="width:${winPct(p)}%"></i></div></div>
      </section>
      ${p.titles.length ? `<section class="section card"><h2>Titles</h2>${p.titles.map((x) => `<div class="row" style="padding:.3rem 0">${ic('trophy', 'sm star-ic')} ${esc(x)}</div>`).join('')}</section>` : ''}
      ${ms.length ? `<section class="section"><h2>Matches</h2><div class="grid">${ms.map(matchCard).join('')}</div></section>` : ''}`;
    $('#cmp-with', view).addEventListener('change', (e) => { if (e.target.value) location.hash = `#/compare?a=${id}&b=${e.target.value}`; });
  }

  function compareView(view, _a, qs) {
    const a = player(qs.get('a')), b = player(qs.get('b'));
    if (!a || !b || a === b) return notFound(view);
    const h2h = D.matches.filter((m) => m.status === 'finished' && ((m.p1 === a.id && m.p2 === b.id) || (m.p1 === b.id && m.p2 === a.id)));
    const wins = h2h.reduce((acc, m) => { const [g1, g2] = gamesWon(m); acc[(g1 > g2 ? m.p1 : m.p2) === a.id ? 0 : 1]++; return acc; }, [0, 0]);
    const side = (p) => `<a href="#/player/${esc(p.id)}">${avatar(p, 'lg')}<div style="margin-top:.4rem"><b>${esc(p.name)}</b></div><div class="small muted">#${p.rank} ${esc(p.cat)} · ${p.points} pts</div></a>`;
    view.innerHTML = `
      <a class="back" href="#/player/${esc(a.id)}">${ic('back')} ${esc(a.name)}</a>
      <div class="row between wrap"><h1>Head to head</h1>${shareBtn(`${a.name} vs ${b.name}`)}</div>
      <section class="card scoreboard">
        <div class="h2h">${side(a)}<div class="vs"><div class="num">${wins[0]} – ${wins[1]}</div><div class="small muted">${h2h.length ? 'meetings won' : 'no meetings yet'}</div></div>${side(b)}</div>
      </section>
      <div class="grid two" style="margin-top:1rem">
        <section class="card">
          <h2>Season comparison</h2>
          <div class="row between small muted"><span class="row" style="gap:.3rem"><i class="cmp-bar" style="width:10px;height:10px;border-radius:3px;background:var(--accent);display:inline-block"></i>${esc(a.name.split(' ')[0])}</span><span class="row" style="gap:.3rem">${esc(b.name.split(' ')[0])}<i style="width:10px;height:10px;border-radius:3px;background:var(--blue);display:inline-block"></i></span></div>
          ${cmp('Ranking points', a.points, b.points)}
          ${cmp('Win %', winPct(a), winPct(b), (v) => v + '%')}
          ${cmp('Matches played', a.stats.matches, b.stats.matches)}
          ${cmp('White slams', a.stats.whiteSlams, b.stats.whiteSlams)}
          ${cmp('Black slams', a.stats.blackSlams, b.stats.blackSlams)}
          ${cmp('Queen cover %', a.stats.queenRate, b.stats.queenRate, (v) => v + '%')}
          ${cmp('Titles', a.titles.length, b.titles.length)}
        </section>
        <section class="card">
          <h2>Change opponent</h2>
          <label class="toggle" style="display:grid;gap:.3rem">Compare ${esc(a.name)} with
          <select class="input" id="cmp-b">${D.players.filter((x) => x.id !== a.id).map((x) => `<option value="${esc(x.id)}" ${x.id === b.id ? 'selected' : ''}>${esc(x.name)} (${esc(x.cat)})</option>`).join('')}</select></label>
          <p class="small muted" style="margin-top:.8rem">Playing styles: <b>${esc(a.style)}</b> vs <b>${esc(b.style)}</b>.</p>
        </section>
      </div>
      ${h2h.length ? `<section class="section"><h2>Meetings</h2><div class="grid">${h2h.map(matchCard).join('')}</div></section>` : ''}`;
    $('#cmp-b', view).addEventListener('change', (e) => { location.hash = `#/compare?a=${a.id}&b=${e.target.value}`; });
  }

  const CL = { state: 'All', q: '', sort: 'rating', kind: 'all' };
  const CLUB_TYPES = ['Local club', 'Office / corporate team', 'Academy team', 'College / school team', 'Housing society', 'Friends group'];
  const MEMBER_ROLES = ['Player', 'Captain', 'Vice-captain', 'Coach', 'Manager'];
  const MEMBER_CATS = ['Men', 'Women', 'Junior', 'Veteran'];
  const myClub = (id) => byId(S.myClubs, id);
  function communityCard(c) {
    return `<a class="card link stack community" href="#/club/${esc(c.id)}">
      <div class="row between"><h3>${esc(c.name)}</h3><span class="pill info">${ic('users', 'sm')} Community</span></div>
      <div class="small muted">${esc(c.type)}${c.venue ? ' · ' + esc(c.venue) : ''}</div>
      <div class="small muted row">${ic('pin', 'sm')} ${esc(c.city)}, ${esc(c.state)} · Est. ${c.founded}</div>
      <div class="row wrap small muted"><span class="row" style="gap:.3rem">${ic('users', 'sm')} ${c.members.length} member${c.members.length === 1 ? '' : 's'}</span>${c.members.some((m) => m.role === 'Captain') ? `<span class="row" style="gap:.3rem">${ic('crown', 'sm')} ${esc(c.members.find((m) => m.role === 'Captain').name)}</span>` : ''}<span class="pill ok">Yours</span></div>
    </a>`;
  }
  function clubs(view) {
    const states = ['All', ...uniq([...D.clubs.map((c) => c.state), ...S.myClubs.map((c) => c.state)]).sort()];
    view.innerHTML = `
      <div class="row between wrap"><h1>Clubs</h1><a class="btn primary" href="#/club/new">${ic('users', 'sm')} Create a club</a></div>
      ${S.myClubs.length ? '' : `<section class="card row between wrap" style="margin-bottom:1rem"><div class="row">${ic('users', 'lg')}<div><b>Run a team at work, in your academy or society?</b><div class="small muted">Create a club, add members and keep official scores — e.g. “CEA Carrom Team” or “Inter-Academy XI”.</div></div></div><a class="btn" href="#/club/new">Get started ${ic('right', 'sm')}</a></section>`}
      <div class="tabs">${[['all', 'All'], ['official', 'Affiliated clubs'], ['community', `My clubs (${S.myClubs.length})`]].map(([k, v]) => `<button class="tab ${CL.kind === k ? 'on' : ''}" data-kind="${k}">${v}</button>`).join('')}</div>
      <div class="filters">
        <input class="input grow" id="cl-q" type="search" placeholder="Search club, team or city…" value="${esc(CL.q)}" maxlength="60">
        <select class="input" id="cl-state" aria-label="State">${states.map((s) => `<option ${CL.state === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
        <select class="input" id="cl-sort" aria-label="Sort"><option value="rating" ${CL.sort === 'rating' ? 'selected' : ''}>Top rated</option><option value="members" ${CL.sort === 'members' ? 'selected' : ''}>Most members</option><option value="founded" ${CL.sort === 'founded' ? 'selected' : ''}>Oldest</option></select>
      </div>
      <div class="grid" id="cl-list"></div>`;
    const draw = () => {
      const match = (c) => (CL.state === 'All' || c.state === CL.state) && (!CL.q || matchesQuery(`${c.name} ${c.city} ${c.type || ''}`, CL.q));
      const official = CL.kind === 'community' ? [] : D.clubs.filter(match).sort((a, b) => (CL.sort === 'founded' ? a.founded - b.founded : b[CL.sort] - a[CL.sort]));
      const mine = CL.kind === 'official' ? [] : S.myClubs.filter(match).sort((a, b) => (CL.sort === 'founded' ? a.founded - b.founded : CL.sort === 'members' ? b.members.length - a.members.length : b.createdAt.localeCompare(a.createdAt)));
      const html = mine.map(communityCard).join('') + official.map((c) => {
        const roster = D.players.filter((p) => p.club === c.id);
        return `<a class="card link stack" href="#/club/${esc(c.id)}">
          <div class="row between"><h3>${esc(c.name)}</h3><span class="pill warn">${ic('star', 'sm')} ${c.rating}</span></div>
          <div class="small muted row">${ic('pin', 'sm')} ${esc(c.city)}, ${esc(c.state)} · Est. ${c.founded}</div>
          <div class="row wrap small muted"><span class="row" style="gap:.3rem">${ic('users', 'sm')} ${c.members} members</span><span class="row" style="gap:.3rem">${ic('target', 'sm')} ${c.boards} boards</span><span class="row" style="gap:.3rem">${starIc} ${roster.filter((p) => p.star).length} stars</span></div>
        </a>`;
      }).join('');
      $('#cl-list', view).innerHTML = html || `<div class="card empty">${ic('users')}<br>${CL.kind === 'community' && !S.myClubs.length ? 'You haven\u2019t created a club yet.<br><br><a class="btn primary" href="#/club/new">Create a club</a>' : 'No clubs found.'}</div>`;
    };
    $$('[data-kind]', view).forEach((b) => b.addEventListener('click', () => { CL.kind = b.dataset.kind; clubs(view); }));
    $('#cl-q', view).addEventListener('input', (e) => { CL.q = e.target.value; draw(); });
    $('#cl-state', view).addEventListener('change', (e) => { CL.state = e.target.value; draw(); });
    $('#cl-sort', view).addEventListener('change', (e) => { CL.sort = e.target.value; draw(); });
    draw();
  }

  function clubForm(view, existing) {
    const c = existing || { name: '', type: CLUB_TYPES[1], city: '', state: '', venue: '', desc: '', founded: new Date().getFullYear() };
    const states = uniq([...D.clubs.map((x) => x.state), ...D.players.map((x) => x.state)]).sort();
    view.innerHTML = `
      <a class="back" href="${existing ? '#/club/' + esc(c.id) : '#/clubs'}">${ic('back')} ${existing ? esc(c.name) : 'Clubs'}</a>
      <h1>${existing ? 'Edit club' : 'Create a club'}</h1>
      <p class="muted">${existing ? 'Update your club details.' : 'Set up a team for your office, academy, college, society or friends. You can add members right after.'}</p>
      <form class="form card" id="club-form" novalidate>
        <label>Club / team name<input class="input" name="name" maxlength="60" placeholder="e.g. CEA Carrom Team" value="${esc(c.name)}" required><span class="err"></span></label>
        <label>Type<select class="input" name="type">${CLUB_TYPES.map((t) => `<option ${c.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><span class="err"></span></label>
        <div class="row wrap" style="align-items:start">
          <label style="flex:1;min-width:160px">City<input class="input" name="city" maxlength="40" value="${esc(c.city)}" required><span class="err"></span></label>
          <label style="flex:1;min-width:160px">State<input class="input" name="state" list="state-list" maxlength="40" value="${esc(c.state)}" required><datalist id="state-list">${states.map((s) => `<option value="${esc(s)}">`).join('')}</datalist><span class="err"></span></label>
        </div>
        <label>Home venue <span class="muted" style="font-weight:400">(optional)</span><input class="input" name="venue" maxlength="80" placeholder="e.g. Sewa Bhawan recreation hall" value="${esc(c.venue)}"><span class="err"></span></label>
        <label>Founded (year)<input class="input" name="founded" inputmode="numeric" maxlength="4" value="${esc(c.founded)}"><span class="err"></span></label>
        <label>About <span class="muted" style="font-weight:400">(optional)</span><textarea class="input" name="desc" rows="3" maxlength="300" placeholder="Practice days, who can join, contact…">${esc(c.desc)}</textarea><span class="err"></span></label>
        <button class="btn primary block" type="submit">${existing ? 'Save changes' : 'Create club'}</button>
      </form>`;
    const form = $('#club-form', view);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const errs = {};
      const name = (f.name || '').trim();
      const year = Number(f.founded);
      if (name.length < 3) errs.name = 'Enter a club name (at least 3 characters).';
      else if (!existing && [...D.clubs, ...S.myClubs].some((x) => x.name.toLowerCase() === name.toLowerCase())) errs.name = 'A club with this name already exists.';
      if ((f.city || '').trim().length < 2) errs.city = 'Enter a city.';
      if ((f.state || '').trim().length < 2) errs.state = 'Enter a state.';
      if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) errs.founded = 'Enter a valid year.';
      $$('.err', form).forEach((el) => { el.textContent = ''; });
      Object.entries(errs).forEach(([k, m]) => { form.elements[k].parentElement.querySelector('.err').textContent = m; });
      if (Object.keys(errs).length) return;
      const data = { name, type: f.type, city: f.city.trim(), state: f.state.trim(), venue: (f.venue || '').trim(), desc: (f.desc || '').trim(), founded: year };
      if (existing) { Object.assign(existing, data); persist(); toast('Club updated'); location.hash = '#/club/' + existing.id; return; }
      const nc = { id: 'uc' + Math.random().toString(36).slice(2, 8), ...data, members: [], createdAt: new Date().toISOString() };
      S.myClubs.push(nc);
      persist();
      toast('Club created — now add members', 'users');
      location.hash = '#/club/' + nc.id;
    });
  }

  function myClubView(view, c) {
    const captains = c.members.filter((m) => m.role === 'Captain' || m.role === 'Vice-captain');
    const ranked = c.members.filter((m) => m.playerId);
    const roleOrder = (r) => ['Captain', 'Vice-captain', 'Player', 'Coach', 'Manager'].indexOf(r);
    const members = c.members.slice().sort((a, b) => (roleOrder(a.role) - roleOrder(b.role)) || a.name.localeCompare(b.name));
    view.innerHTML = `
      <div class="row between"><a class="back" href="#/clubs">${ic('back')} Clubs</a><div class="row">${shareBtn(c.name + ' — CarromHub club')}<a class="btn sm" href="#/club/${esc(c.id)}/edit">${ic('edit', 'sm')} Edit</a></div></div>
      <section class="hero">
        <div class="row wrap"><span class="pill info">${ic('users', 'sm')} Community club</span><span class="pill">${esc(c.type)}</span></div>
        <h1 style="margin-top:.5rem">${esc(c.name)}</h1>
        <p class="row wrap" style="gap:.3rem 1rem"><span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${esc(c.city)}, ${esc(c.state)}</span><span>Est. ${c.founded}</span>${c.venue ? `<span class="row" style="gap:.3rem">${ic('club', 'sm')} ${esc(c.venue)}</span>` : ''}</p>
        ${c.desc ? `<p class="muted">${esc(c.desc)}</p>` : ''}
        <div class="row wrap" style="margin-top:.6rem"><a class="btn primary" href="#/scorer">${ic('calc', 'sm')} Score a club match</a><button class="btn" id="invite">${ic('link', 'sm')} Invite link</button></div>
      </section>
      <div class="kpi section"><div><b>${c.members.length}</b><span class="small muted">Members</span></div><div><b>${c.members.filter((m) => m.role === 'Player' || m.role.includes('aptain')).length}</b><span class="small muted">Playing squad</span></div><div><b>${captains.length}</b><span class="small muted">Captains</span></div><div><b>${ranked.length}</b><span class="small muted">Ranked players</span></div></div>
      <div class="grid two">
        <section class="card">
          <h2>Members</h2>
          ${members.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Name</th><th>Role</th><th>Category</th><th></th></tr></thead><tbody>${members.map((m) => `<tr><td><span class="row">${avatar({ name: m.name, star: false })}<span>${m.playerId ? `<a href="#/player/${esc(m.playerId)}"><b>${esc(m.name)}</b></a> ${starIc}` : `<b>${esc(m.name)}</b>`}</span></span></td><td>${m.role === 'Captain' ? ic('crown', 'sm star-ic') + ' ' : ''}${esc(m.role)}</td><td class="small muted">${esc(m.cat)}</td><td class="num-c"><button class="btn sm icon ghost" data-rm="${esc(m.id)}" aria-label="Remove ${esc(m.name)}" title="Remove">${ic('x', 'sm')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="card empty" style="padding:1.2rem">${ic('users')}<br>No members yet. Add your first player on the right.</div>`}
          ${ranked.length ? `<p class="small muted" style="margin-top:.6rem">${starIc} Members matching a ranked player are linked to their profile.</p>` : ''}
        </section>
        <section class="card">
          <h2>Add member</h2>
          <form class="form" id="mem-form" novalidate style="max-width:none">
            <label>Name<input class="input" name="name" list="player-list" maxlength="60" placeholder="Type a name or pick a ranked player" autocomplete="off" required><datalist id="player-list">${D.players.map((p) => `<option value="${esc(p.name)}">#${p.rank} ${esc(p.cat)} · ${esc(p.state)}</option>`).join('')}</datalist><span class="err"></span></label>
            <div class="row wrap" style="align-items:start">
              <label style="flex:1;min-width:140px">Role<select class="input" name="role">${MEMBER_ROLES.map((r) => `<option>${r}</option>`).join('')}</select><span class="err"></span></label>
              <label style="flex:1;min-width:140px">Category<select class="input" name="cat">${MEMBER_CATS.map((r) => `<option>${r}</option>`).join('')}</select><span class="err"></span></label>
            </div>
            <button class="btn primary" type="submit">${ic('check', 'sm')} Add to ${esc(c.name.split(' ')[0])}</button>
          </form>
          <details style="margin-top:1rem"><summary class="small muted" style="cursor:pointer">Danger zone</summary><button class="btn sm" id="del-club" style="margin-top:.6rem;color:var(--accent);border-color:rgba(var(--accent-rgb),.4)">${ic('x', 'sm')} Delete this club</button></details>
        </section>
      </div>`;
    $('#invite', view).addEventListener('click', () => share(`Join ${c.name} on CarromHub`, pageUrl('#/club/' + c.id)));
    $('#del-club', view).addEventListener('click', () => {
      if (!confirm(`Delete "${c.name}" and its ${c.members.length} member(s)?`)) return;
      S.myClubs = S.myClubs.filter((x) => x.id !== c.id);
      persist();
      toast('Club deleted');
      location.hash = '#/clubs';
    });
    $$('[data-rm]', view).forEach((b) => b.addEventListener('click', () => {
      c.members = c.members.filter((m) => m.id !== b.dataset.rm);
      persist();
      toast('Member removed');
      myClubView(view, c);
    }));
    const form = $('#mem-form', view);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const name = (f.name || '').trim().replace(/\s+/g, ' ');
      const err = $('.err', form);
      err.textContent = '';
      if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name)) { err.textContent = 'Enter a valid name (letters only).'; return; }
      if (c.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) { err.textContent = `${name} is already a member.`; return; }
      if (f.role === 'Captain' && c.members.some((m) => m.role === 'Captain')) { err.textContent = 'This club already has a captain — change their role first.'; return; }
      const ranked = D.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
      c.members.push({ id: 'm' + Math.random().toString(36).slice(2, 8), name, role: f.role, cat: ranked ? ranked.cat : f.cat, playerId: ranked ? ranked.id : null, at: new Date().toISOString() });
      persist();
      toast(`${name} added${ranked ? ' — linked to ranked profile' : ''}`, 'users');
      myClubView(view, c);
      $('#mem-form input[name=name]', view).focus();
    });
  }

  function clubView(view, id) {
    if (id === 'new') return clubForm(view);
    const mine = myClub(id);
    if (mine) return myClubView(view, mine);
    const c = club(id);
    if (!c) return notFound(view);
    const roster = D.players.filter((p) => p.club === id).sort((a, b) => b.points - a.points);
    const stars = roster.filter((p) => p.star);
    view.innerHTML = `
      <div class="row between"><a class="back" href="#/clubs">${ic('back')} Clubs</a>${shareBtn(c.name)}</div>
      <section class="hero">
        <span class="pill warn">${ic('star', 'sm')} ${c.rating}</span>
        <h1 style="margin-top:.5rem">${esc(c.name)}</h1>
        <p class="row wrap" style="gap:.3rem 1rem"><span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${esc(c.city)}, ${esc(c.state)}</span><span>Est. ${c.founded}</span><span class="row" style="gap:.3rem">${ic('user', 'sm')} Head coach ${esc(c.coach)}</span></p>
        <div class="row wrap">${c.facilities.map((f) => `<span class="pill">${esc(f)}</span>`).join('')}</div>
        <button class="btn primary" style="margin-top:.8rem" id="join">Request membership</button>
      </section>
      <div class="kpi section"><div><b>${c.members}</b><span class="small muted">Members</span></div><div><b>${c.boards}</b><span class="small muted">Boards</span></div><div><b>${roster.length}</b><span class="small muted">Ranked players</span></div><div><b>${stars.length}</b><span class="small muted">Star players</span></div></div>
      ${stars.length ? `<section class="section"><h2>${starIc} Star players</h2><div class="grid sm">${stars.map(playerCard).join('')}</div></section>` : ''}
      <section class="section"><h2>Ranked players</h2><div class="grid sm">${roster.length ? roster.map(playerCard).join('') : '<div class="card empty">No ranked players yet.</div>'}</div></section>`;
    $('#join', view).addEventListener('click', () => toast('Membership request sent (demo)', 'users'));
  }

  const RF = { q: '', cats: new Set(), level: 'all', tags: new Set(), saved: false };
  function rules(view, _a, qs) {
    if (qs.get('cat')) { RF.cats = new Set([qs.get('cat')]); RF.q = ''; RF.tags.clear(); RF.level = 'all'; RF.saved = false; }
    const focus = qs.get('id');
    if (focus) { RF.cats.clear(); RF.q = ''; RF.tags.clear(); RF.level = 'all'; RF.saved = false; }
    const levels = [['all', 'All'], ['basic', 'Must-know'], ['advanced', 'Competitive'], ['official', 'Umpire']];
    view.innerHTML = `
      <div class="row between wrap"><h1>Laws of Carrom</h1>${shareBtn('Laws of Carrom — CarromHub', pageUrl('#/rules'))}</div>
      <p class="muted small">${RULES.length} laws in plain language · <a href="${SOURCE}" target="_blank" rel="noopener noreferrer" style="color:var(--accent2)">Official AICF text ↗</a></p>
      <div class="sticky-filters">
        <div class="filters" style="margin:.3rem 0">
          <input class="input grow" id="r-q" type="search" placeholder='Try "striker queen", "10 seconds", "last coin"…' value="${esc(RF.q)}" maxlength="60">
          <label class="toggle"><input type="checkbox" id="r-saved" ${RF.saved ? 'checked' : ''}> ${starIc} Saved${S.saved.size ? ` (${S.saved.size})` : ''}</label>
          <button class="btn sm ghost" id="r-clear">${ic('x', 'sm')} Clear</button>
        </div>
        <div class="chips">${levels.map(([k, v]) => `<button class="chip ${RF.level === k ? 'on' : ''}" data-lvl="${k}">${v}</button>`).join('')}</div>
      </div>
      <details class="card section" ${RF.tags.size ? 'open' : ''}>
        <summary style="cursor:pointer"><b>What happens if…?</b> <span class="small muted">Pick what happened in the stroke</span></summary>
        <div class="chips wrap" style="flex-wrap:wrap;margin-top:.6rem">${TAGS.map((t) => `<button class="chip ${RF.tags.has(t.id) ? 'on' : ''}" data-tag="${t.id}">${esc(t.label)}</button>`).join('')}</div>
      </details>
      <div class="cat-grid section">${CATS.map((c) => `<button class="cat-tile ${RF.cats.has(c.id) ? 'on' : ''}" data-cat="${c.id}"><span class="i">${c.icon}</span><b>${esc(c.name)}</b><small>${RULES.filter((r) => r.cat === c.id).length} laws</small></button>`).join('')}</div>
      <div id="r-list"></div>`;

    const draw = () => {
      const list = RULES.filter((r) => {
        const cat = byId(CATS, r.cat);
        return (!RF.cats.size || RF.cats.has(r.cat)) &&
          (RF.level === 'all' || r.level === RF.level) &&
          [...RF.tags].every((t) => r.tags.includes(t)) &&
          (!RF.saved || S.saved.has(r.id)) &&
          (!RF.q || matchesQuery(`${r.id} ${r.title} ${r.text} ${cat.name}`, RF.q));
      });
      const groups = CATS.map((c) => [c, list.filter((r) => r.cat === c.id)]).filter(([, rs]) => rs.length);
      $('#r-list', view).innerHTML = list.length
        ? `<p class="small muted">${list.length} law(s) found</p>` + groups.map(([c, rs]) => `<section class="section"><h2>${c.icon} ${esc(c.name)}</h2><div class="stack">${rs.map((r) => ruleCard(r, RF.q)).join('')}</div></section>`).join('')
        : '<div class="card empty">No laws match. Try fewer filters or different words.</div>';
    };
    const redraw = () => rules(view, null, new URLSearchParams());
    $('#r-q', view).addEventListener('input', (e) => { RF.q = e.target.value; draw(); });
    $('#r-saved', view).addEventListener('change', (e) => { RF.saved = e.target.checked; draw(); });
    $('#r-clear', view).addEventListener('click', () => { RF.q = ''; RF.cats.clear(); RF.tags.clear(); RF.level = 'all'; RF.saved = false; redraw(); });
    $$('[data-lvl]', view).forEach((b) => b.addEventListener('click', () => { RF.level = b.dataset.lvl; redraw(); }));
    $$('[data-tag]', view).forEach((b) => b.addEventListener('click', () => { RF.tags.has(b.dataset.tag) ? RF.tags.delete(b.dataset.tag) : RF.tags.add(b.dataset.tag); redraw(); }));
    $$('[data-cat]', view).forEach((b) => b.addEventListener('click', () => { RF.cats.has(b.dataset.cat) ? RF.cats.delete(b.dataset.cat) : RF.cats.add(b.dataset.cat); redraw(); }));
    draw();
    if (focus && ruleById(focus)) {
      const el = document.getElementById(ruleAnchor(focus));
      el.classList.add('flash');
      el.scrollIntoView({ block: 'center' });
    }
  }

  function boardSvg() {
    const side = (rot) => `
      <g transform="rotate(${rot} 370 370)">
        <line class="part-base" x1="151" y1="606.7" x2="589" y2="606.7" stroke="#111" stroke-width="2"/>
        <line class="part-base" x1="151" y1="638.5" x2="589" y2="638.5" stroke="#111" stroke-width="6"/>
        <circle class="part-base" cx="151" cy="622.6" r="15.9" fill="none" stroke="#111" stroke-width="2"/><circle cx="151" cy="622.6" r="12.7" fill="#c81e1e"/>
        <circle class="part-base" cx="589" cy="622.6" r="15.9" fill="none" stroke="#111" stroke-width="2"/><circle cx="589" cy="622.6" r="12.7" fill="#c81e1e"/>
        <line class="part-arrow" x1="230" y1="510" x2="88" y2="652" stroke="#111" stroke-width="2"/>
        <polygon class="part-arrow" points="88,652 92,636 104,648" fill="#111"/>
        <circle class="part-pocket" cx="24" cy="716" r="22.25" fill="#0b0b0b"/>
      </g>`;
    let coins = '';
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 * Math.PI) / 180;
      coins += `<circle cx="${370 + 31.8 * Math.cos(a)}" cy="${370 + 31.8 * Math.sin(a)}" r="15.5" fill="${i % 2 ? '#222' : '#f2e6cf'}" stroke="#555"/>`;
    }
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 * Math.PI) / 180;
      coins += `<circle cx="${370 + 63 * Math.cos(a)}" cy="${370 + 63 * Math.sin(a)}" r="15.5" fill="${i % 2 ? '#222' : '#f2e6cf'}" stroke="#555"/>`;
    }
    return `
      <svg class="board-svg" viewBox="-40 -40 820 820" role="img" aria-label="Carrom board diagram">
        <rect x="-40" y="-40" width="820" height="820" rx="18" fill="#5a3416"/>
        <rect class="part-surface" x="0" y="0" width="740" height="740" fill="#e9c999"/>
        ${[0, 90, 180, 270].map(side).join('')}
        <circle class="part-outer" cx="370" cy="370" r="85" fill="none" stroke="#111" stroke-width="2"/>
        <g class="part-coins">${coins}</g>
        <circle class="part-centre part-queen" cx="370" cy="370" r="15.9" fill="#c81e1e" stroke="#111" stroke-width="2"/>
      </svg>`;
  }
  const PARTS = [
    { k: 'surface', name: 'Playing surface', info: '73.5–74 cm square, min 8 mm thick.', rule: 'I.A1' },
    { k: 'pocket', name: 'Pockets', info: '4.45 cm diameter, one at each corner.', rule: 'I.A3' },
    { k: 'base', name: 'Base lines & circles', info: '47 cm lines, 3.18 cm apart; strike from here.', rule: 'I.A4' },
    { k: 'arrow', name: 'Arrows', info: '45° lines your elbow must stay behind.', rule: 'I.A5' },
    { k: 'outer', name: 'Outer circle', info: '17 cm — penalty and due coins are placed inside.', rule: 'I.A6' },
    { k: 'centre', name: 'Centre circle & Queen', info: '3.18 cm red circle; the Queen starts and is replaced here.', rule: 'XV.1' },
    { k: 'coins', name: 'Break arrangement', info: 'Alternating rings around the Queen, compact inside the outer circle.', rule: 'VII.1' }
  ];

  function learn(view) {
    const glossary = RULES.filter((r) => r.cat === 'terms');
    view.innerHTML = `
      <h1>Learn carrom</h1>
      <p class="muted">Structured tracks from first flick to umpire certification.</p>
      <div class="grid section">${D.tracks.map((tr) => {
        const ls = D.lessons.filter((l) => l.track === tr.id);
        const done = ls.filter((l) => S.done.has(l.id)).length;
        return `<section class="card stack">
          <div class="row between"><h2 style="color:${tr.color}">${esc(tr.name)}</h2><span class="small muted">${done}/${ls.length}</span></div>
          <div class="progress"><i style="width:${(done / ls.length) * 100}%;background:${tr.color}"></i></div>
          <p class="small muted">${esc(tr.desc)}</p>
          ${ls.map((l) => `<a class="list-row" href="#/lesson/${esc(l.id)}"><span class="row" style="gap:.4rem">${S.done.has(l.id) ? ic('check', 'sm') : ic('play', 'sm')} ${esc(l.title)}</span><span class="small muted">${esc(l.type)} · ${l.mins}m</span></a>`).join('')}
        </section>`;
      }).join('')}</div>

      <section class="section card">
        <h2>Board anatomy</h2>
        <p class="small muted">Tap a part to see its official specification.</p>
        <div class="grid">
          <div id="svg-wrap">${boardSvg()}</div>
          <div><ul class="legend" style="list-style:none;padding:0">${PARTS.map((p) => `<li data-part="${p.k}">● <b>${esc(p.name)}</b></li>`).join('')}</ul>
          <div class="card" id="part-info" style="background:var(--card2)"><span class="muted small">Select a part.</span></div></div>
        </div>
      </section>

      <div class="grid section">
        <a class="card link" href="#/quiz"><h2 class="row">${ic('zap')} Rules quiz</h2><p class="muted small">${D.quiz.length} questions — test yourself before match day.${store.get('quizBest', 0) ? ` Best: ${store.get('quizBest', 0)}/${D.quiz.length}.` : ''}</p></a>
        <a class="card link" href="#/scorer"><h2 class="row">${ic('calc')} Practice scorer</h2><p class="muted small">Keep score of friendly matches with official scoring.</p></a>
        <a class="card link" href="#/rules"><h2 class="row">${ic('book')} Full laws</h2><p class="muted small">Searchable, filterable rulebook.</p></a>
      </div>

      <section class="section"><h2>Glossary</h2><div class="stack">${glossary.map((r) => ruleCard(r)).join('')}</div></section>`;
    $$('[data-part]', view).forEach((li) => li.addEventListener('click', () => {
      const p = PARTS.find((x) => x.k === li.dataset.part);
      $$('.legend li', view).forEach((x) => x.classList.toggle('on', x === li));
      $$('#svg-wrap [class^="part-"], #svg-wrap [class*=" part-"]', view).forEach((el) => {
        el.style.filter = el.classList.contains('part-' + p.k) ? 'drop-shadow(0 0 6px #f59e0b)' : '';
        if (el.tagName !== 'g') el.style.stroke = el.classList.contains('part-' + p.k) ? '#f59e0b' : '';
      });
      $('#part-info', view).innerHTML = `<b>${esc(p.name)}</b><p>${esc(p.info)}</p><a class="small" style="color:var(--accent2)" href="#/rules?id=${esc(p.rule)}">Law ${esc(p.rule)} ${ic('right', 'sm')}</a>`;
    }));
  }

  function lessonView(view, id) {
    const l = byId(D.lessons, id);
    if (!l) return notFound(view);
    const tr = byId(D.tracks, l.track);
    const ls = D.lessons.filter((x) => x.track === l.track);
    const next = ls[ls.indexOf(l) + 1];
    view.innerHTML = `
      <a class="back" href="#/learn">${ic('back')} Learn</a>
      <span class="pill" style="color:${tr.color}">${esc(tr.name)} · ${esc(l.type)} · ${l.mins} min</span>
      <h1 style="margin-top:.6rem">${esc(l.title)}</h1>
      <article class="card stack">${l.body.map((p) => `<p>${esc(p)}</p>`).join('')}</article>
      <section class="section"><h2>Laws covered</h2><div class="stack">${l.rules.map((rid) => ruleCard(ruleById(rid))).join('')}</div></section>
      <div class="row wrap">
        <button class="btn ${S.done.has(id) ? 'on' : 'primary'}" id="done">${ic('check', 'sm')} ${S.done.has(id) ? 'Completed' : 'Mark as complete'}</button>
        ${next ? `<a class="btn" href="#/lesson/${esc(next.id)}">Next: ${esc(next.title)} ${ic('right', 'sm')}</a>` : ''}
      </div>`;
    $('#done', view).addEventListener('click', () => { toast(toggleIn(S.done, id) ? 'Lesson completed' : 'Marked incomplete', 'learn'); lessonView(view, id); });
  }

  const QZ = { i: 0, score: 0, picked: null, streak: 0 };
  function quiz(view) {
    const best = store.get('quizBest', 0);
    if (QZ.i >= D.quiz.length) {
      if (QZ.score > best) store.set('quizBest', QZ.score);
      view.innerHTML = `<a class="back" href="#/learn">${ic('back')} Learn</a>
        <div class="card scoreboard" style="max-width:520px;margin:1rem auto"><div style="color:var(--accent2)">${ic(QZ.score >= 6 ? 'trophy' : 'book', 'lg')}</div>
        <div class="num">${QZ.score} / ${D.quiz.length}</div><p class="muted">${QZ.score >= 6 ? 'Umpire-ready!' : 'Review the laws and try again.'}${QZ.score > best ? ' New personal best!' : best ? ` Best: ${best}.` : ''}</p>
        <div class="row center wrap"><button class="btn primary" id="again">Try again</button>${shareBtn(`I scored ${QZ.score}/${D.quiz.length} on the CarromHub rules quiz`, pageUrl('#/quiz'))}</div></div>`;
      $('#again', view).addEventListener('click', () => { Object.assign(QZ, { i: 0, score: 0, picked: null, streak: 0 }); quiz(view); });
      return;
    }
    const q = D.quiz[QZ.i];
    const ans = QZ.picked !== null;
    view.innerHTML = `
      <a class="back" href="#/learn">${ic('back')} Learn</a>
      <div class="card" style="max-width:620px;margin:0 auto">
        <div class="row between small muted"><span>Question ${QZ.i + 1} of ${D.quiz.length}</span><span class="row">${QZ.streak >= 2 ? `<span class="streak">${ic('zap', 'sm')} ${QZ.streak} streak</span>` : ''}<span>Score ${QZ.score}</span></span></div>
        <div class="progress" style="margin:.5rem 0 1rem"><i style="width:${(QZ.i / D.quiz.length) * 100}%"></i></div>
        <h2>${esc(q.q)}</h2>
        ${q.a.map((a, i) => `<button class="btn quiz-opt ${ans && i === q.c ? 'right' : ''} ${ans && i === QZ.picked && i !== q.c ? 'wrong' : ''}" data-i="${i}" ${ans ? 'disabled' : ''}>${esc(a)}</button>`).join('')}
        ${ans ? `<div class="card" style="margin-top:1rem;background:var(--card2)"><b>Law ${esc(q.rule)}</b><p class="small">${esc(ruleById(q.rule).text)}</p></div>
          <button class="btn primary block" id="next" style="margin-top:.8rem">${QZ.i + 1 === D.quiz.length ? 'See result' : 'Next question'}</button>` : ''}
      </div>`;
    $$('[data-i]', view).forEach((b) => b.addEventListener('click', () => {
      QZ.picked = Number(b.dataset.i);
      if (QZ.picked === q.c) { QZ.score++; QZ.streak++; } else QZ.streak = 0;
      quiz(view);
    }));
    const n = $('#next', view);
    if (n) n.addEventListener('click', () => { QZ.i++; QZ.picked = null; quiz(view); });
  }

  const SH = { cat: 'All', dealer: 'All', approved: false, max: 0, sort: 'popular', q: '' };
  function productCard(p) {
    const d = dealer(p.dealer);
    const off = Math.round((1 - p.price / p.mrp) * 100);
    return `
      <div class="card product" data-cat="${esc(p.cat)}">
        <a href="#/product/${esc(p.id)}"><div class="thumb"><span class="off">−${off}%</span>${p.emoji}</div><h3>${esc(p.name)}</h3></a>
        <div class="small muted row wrap" style="gap:.3rem">${esc(d.name)} ${d.verified ? `<span class="pill ok">${ic('check', 'sm')} Verified</span>` : ''}</div>
        <div class="row wrap small" style="margin:.3rem 0;gap:.4rem"><span class="stars">${'★'.repeat(Math.round(p.rating))}${'☆'.repeat(5 - Math.round(p.rating))}</span><span class="muted">${p.rating}</span>${p.approved ? '<span class="pill warn">Tournament spec</span>' : ''}</div>
        <div class="row between"><div><span class="price">${inr(p.price)}</span><span class="mrp">${inr(p.mrp)}</span></div>
        <button class="btn sm primary" data-act="add-cart" data-id="${esc(p.id)}">${ic('cart', 'sm')} Add</button></div>
      </div>`;
  }
  // Shop stays locked until an admin sets content key shop_lock = {"locked": false}.
  const shopLocked = () => !(API.content.shop_lock && API.content.shop_lock.locked === false);
  const shopPreview = () => !!API.user && ['merchant', 'admin'].includes(API.user.role);
  function applyShopLock() {
    const c = $('a.icon-btn[href="#/cart"]');
    if (c) c.hidden = shopLocked() && !shopPreview();
  }
  function shopLockedView(view) {
    const u = API.user;
    const merchant = u && ['merchant', 'admin'].includes(u.role);
    view.innerHTML = `
      <h1>Shop</h1>
      <section class="card locked">
        <div class="row" style="align-items:flex-start"><span class="body-flag" style="background:rgba(var(--accent2-rgb),.15);color:var(--accent2)">${ic('shield')}</span>
        <div style="flex:1"><h2 style="margin:0">The shop is locked for now</h2>
        <p class="muted">We’re onboarding and verifying merchants and connecting a secure payment gateway before anyone can buy. Until then nothing can be ordered here, so you won’t pay for items from unverified sellers.</p>
        <ol class="steps" style="max-width:520px;margin:.4rem 0 .8rem"><li class="now"><span></span>Merchant onboarding</li><li><span></span>Verification</li><li><span></span>Payments</li><li><span></span>Shop live</li></ol>
        <div class="row wrap">${merchant ? `<a class="btn sm primary" href="#/merchant">${ic('shop', 'sm')} Merchant console</a>` : `<a class="btn sm primary" href="#/login?next=${encodeURIComponent('#/merchant')}">${ic('shop', 'sm')} Sell on CarromHub</a>`}<a class="btn sm" href="#/partners">${ic('handshake', 'sm')} Hire boards & equipment for events</a><a class="btn sm" href="#/rules?cat=equipment">${ic('book', 'sm')} Official equipment specs</a></div></div></div>
      </section>
      <section class="section"><div class="section-h"><h2>Meanwhile</h2></div><div class="grid">
        <a class="card link" href="#/organise">${ic('briefcase', 'lg')}<b style="display:block;margin-top:.4rem">Organising a tournament?</b><span class="small muted">We arrange boards, umpires and scoring</span></a>
        <a class="card link" href="#/learn">${ic('learn', 'lg')}<b style="display:block;margin-top:.4rem">Choosing a striker</b><span class="small muted">Learn what the Laws allow before you buy</span></a>
        <a class="card link" href="#/bodies">${ic('globe', 'lg')}<b style="display:block;margin-top:.4rem">Federations</b><span class="small muted">Find approved equipment through your association</span></a>
      </div></section>`;
  }
  function shop(view) {
    if (shopLocked() && !shopPreview()) return shopLockedView(view);
    const cats = ['All', ...uniq(D.products.map((p) => p.cat))];
    view.innerHTML = `
      <h1>Shop</h1>
      ${shopLocked() ? `<div class="card locked row" style="margin-bottom:.8rem">${ic('shield', 'sm')}<span class="small"><b>Locked — preview only.</b> Shoppers see a “coming soon” page. ${API.user.role === 'admin' ? 'Unlock under Admin → Content → <code>shop_lock</code> = <code>{"locked": false}</code>.' : 'An admin will open the shop once merchants are verified.'}</span></div>` : ''}
      <p class="muted small">Buy directly from verified carrom dealers.</p>
      ${API.content.shop_notice && API.content.shop_notice.active ? `<div class="card flat row" style="margin-bottom:.8rem;border-left:3px solid var(--accent2)">${ic('info', 'sm')}<span class="small">${esc(API.content.shop_notice.text)} <a href="#/partners" style="color:var(--accent2)">Partners ${ic('right', 'sm')}</a></span></div>` : ''}
      <div class="chips">${cats.map((c) => `<button class="chip ${SH.cat === c ? 'on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="filters">
        <input class="input grow" id="sh-q" type="search" placeholder="Search gear…" value="${esc(SH.q)}" maxlength="60">
        <select class="input" id="sh-dealer" aria-label="Dealer"><option value="All">All dealers</option>${D.dealers.map((d) => `<option value="${esc(d.id)}" ${SH.dealer === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
        <select class="input" id="sh-max" aria-label="Max price"><option value="0">Any price</option>${[500, 1000, 5000, 10000].map((v) => `<option value="${v}" ${SH.max === v ? 'selected' : ''}>Under ${inr(v)}</option>`).join('')}</select>
        <select class="input" id="sh-sort" aria-label="Sort">${[['popular', 'Top rated'], ['low', 'Price: low to high'], ['high', 'Price: high to low'], ['off', 'Biggest discount']].map(([k, v]) => `<option value="${k}" ${SH.sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <label class="toggle"><input type="checkbox" id="sh-appr" ${SH.approved ? 'checked' : ''}> Tournament spec only</label>
      </div>
      <div class="grid" id="sh-list"></div>
      <section class="section" id="marketplace">${API.ok ? '<div class="skeleton" style="height:100px"></div>' : ''}</section>
      <section class="section"><h2>Dealers</h2><div class="grid">${D.dealers.map((d) => `
        <div class="card"><div class="row between"><h3>${esc(d.name)}</h3>${d.verified ? `<span class="pill ok">${ic('check', 'sm')} Verified</span>` : '<span class="pill">Unverified</span>'}</div>
        <div class="small muted row wrap" style="gap:.3rem 1rem"><span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${esc(d.city)}, ${esc(d.state)}</span><span>Since ${d.since}</span><span class="row" style="gap:.3rem">${ic('star', 'sm')} ${d.rating}</span><span class="row" style="gap:.3rem">${ic('truck', 'sm')} ${esc(d.delivery)}</span></div>
        <button class="btn sm" data-dealer="${esc(d.id)}" style="margin-top:.6rem">View products</button></div>`).join('')}</div></section>`;
    const draw = () => {
      const sorters = { popular: (a, b) => b.rating - a.rating, low: (a, b) => a.price - b.price, high: (a, b) => b.price - a.price, off: (a, b) => (b.mrp - b.price) / b.mrp - (a.mrp - a.price) / a.mrp };
      const list = D.products.filter((p) =>
        (SH.cat === 'All' || p.cat === SH.cat) && (SH.dealer === 'All' || p.dealer === SH.dealer) &&
        (!SH.approved || p.approved) && (!SH.max || p.price <= SH.max) &&
        (!SH.q || matchesQuery(`${p.name} ${p.cat} ${p.specs.join(' ')}`, SH.q))
      ).sort(sorters[SH.sort]);
      $('#sh-list', view).innerHTML = list.length ? list.map(productCard).join('') : '<div class="card empty">No products match.</div>';
    };
    $$('[data-c]', view).forEach((b) => b.addEventListener('click', () => { SH.cat = b.dataset.c; shop(view); }));
    $$('[data-dealer]', view).forEach((b) => b.addEventListener('click', () => { SH.dealer = b.dataset.dealer; shop(view); window.scrollTo(0, 0); }));
    marketplaceSection(view);
    $('#sh-q', view).addEventListener('input', (e) => { SH.q = e.target.value; draw(); });
    $('#sh-dealer', view).addEventListener('change', (e) => { SH.dealer = e.target.value; draw(); });
    $('#sh-max', view).addEventListener('change', (e) => { SH.max = Number(e.target.value); draw(); });
    $('#sh-sort', view).addEventListener('change', (e) => { SH.sort = e.target.value; draw(); });
    $('#sh-appr', view).addEventListener('change', (e) => { SH.approved = e.target.checked; draw(); });
    draw();
  }

  function productView(view, id) {
    if (shopLocked() && !shopPreview()) return shopLockedView(view);
    const p = byId(D.products, id);
    if (!p) return notFound(view);
    const d = dealer(p.dealer);
    const ruleLink = { Strikers: 'I.C', Coins: 'I.B', Boards: 'I.A1', Powder: 'XVI.3', Accessories: 'I.D' }[p.cat];
    view.innerHTML = `
      <div class="row between"><a class="back" href="#/shop">${ic('back')} Shop</a>${shareBtn(p.name)}</div>
      <div class="grid two">
        <div class="card product" data-cat="${esc(p.cat)}"><div class="thumb" style="height:280px;font-size:6.5rem;margin:0"><span class="off">−${Math.round((1 - p.price / p.mrp) * 100)}%</span>${p.emoji}</div></div>
        <div class="card stack">
          <span class="pill">${esc(p.cat)}</span>
          <h1>${esc(p.name)}</h1>
          <div class="row wrap" style="gap:.4rem"><span class="stars">${'★'.repeat(Math.round(p.rating))}${'☆'.repeat(5 - Math.round(p.rating))}</span><span class="muted small">${p.rating}</span>${p.approved ? '<span class="pill warn">Tournament spec</span>' : ''}</div>
          <div><span class="price" style="font-size:1.7rem">${inr(p.price)}</span><span class="mrp">${inr(p.mrp)}</span></div>
          <div class="small ${p.stock < 15 ? '' : 'muted'}" style="${p.stock < 15 ? 'color:var(--accent2)' : ''}">${p.stock < 15 ? `Only ${p.stock} left` : 'In stock'}</div>
          <ul style="margin:0;padding-left:1.1rem">${p.specs.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
          ${ruleLink ? `<a class="small row" style="color:var(--accent2)" href="#/rules?id=${ruleLink}">${ic('book', 'sm')} Check official spec (Law ${ruleLink}) ${ic('right', 'sm')}</a>` : ''}
          <div class="row wrap"><button class="btn primary" data-act="add-cart" data-id="${esc(p.id)}">${ic('cart', 'sm')} Add to cart</button><button class="btn" id="buy">Buy now</button></div>
          <div class="card flat"><b>Sold by ${esc(d.name)}</b> ${d.verified ? `<span class="pill ok">${ic('check', 'sm')} Verified</span>` : ''}
            <div class="small muted row wrap" style="gap:.3rem 1rem"><span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${esc(d.city)}</span><span class="row" style="gap:.3rem">${ic('truck', 'sm')} ${esc(d.delivery)}</span><span class="row" style="gap:.3rem">${ic('star', 'sm')} ${d.rating}</span></div></div>
        </div>
      </div>`;
    $('#buy', view).addEventListener('click', () => { addToCart(p.id); location.hash = '#/cart'; });
  }

  function addToCart(id) {
    if (shopLocked() && !shopPreview()) return toast('The shop is locked for now', 'info');
    const p = byId(D.products, id);
    const cur = S.cart[id] || 0;
    if (cur >= p.stock) return toast('No more stock available', 'info');
    S.cart[id] = cur + 1;
    persist();
    toast('Added to cart', 'cart');
  }

  function cart(view) {
    if (shopLocked() && !shopPreview()) return shopLockedView(view);
    const items = Object.entries(S.cart).map(([id, qty]) => ({ p: byId(D.products, id), qty })).filter((x) => x.p);
    if (!items.length) {
      view.innerHTML = `<h1>Cart</h1><div class="card empty">${ic('cart')}<br>Your cart is empty.<br><br><a class="btn primary" href="#/shop">Browse gear</a></div>`;
      return;
    }
    const byDealer = uniq(items.map((x) => x.p.dealer));
    const subtotal = items.reduce((a, x) => a + x.p.price * x.qty, 0);
    const shipping = byDealer.reduce((a, did) => {
      const s = items.filter((x) => x.p.dealer === did).reduce((b, x) => b + x.p.price * x.qty, 0);
      return a + (s >= 999 ? 0 : 79);
    }, 0);
    view.innerHTML = `
      <h1>Cart</h1>
      <div class="grid">
        <div class="stack">${byDealer.map((did) => {
          const d = dealer(did);
          return `<section class="card"><h3 class="row">${ic('truck', 'sm')} ${esc(d.name)} <span class="small muted">· ${esc(d.delivery)}</span></h3>
            ${items.filter((x) => x.p.dealer === did).map(({ p, qty }) => `
              <div class="row between" style="padding:.5rem 0;border-top:1px solid var(--line)">
                <span>${p.emoji} ${esc(p.name)}<br><span class="small muted">${inr(p.price)}</span></span>
                <span class="qty"><button data-q="-1" data-id="${esc(p.id)}" aria-label="Decrease">−</button><b>${qty}</b><button data-q="1" data-id="${esc(p.id)}" aria-label="Increase">+</button></span>
              </div>`).join('')}</section>`;
        }).join('')}</div>
        <form class="card form" id="co" novalidate>
          <h2>Checkout</h2>
          <div class="row between"><span>Subtotal</span><b>${inr(subtotal)}</b></div>
          <div class="row between"><span>Delivery <span class="small muted">(free over ₹999 per dealer)</span></span><b>${shipping ? inr(shipping) : 'Free'}</b></div>
          <div class="row between" style="font-size:1.2rem"><span>Total</span><b>${inr(subtotal + shipping)}</b></div>
          <label>Name<input class="input" name="name" autocomplete="name" maxlength="60"><span class="err"></span></label>
          <label>Mobile<input class="input" name="phone" inputmode="numeric" maxlength="10" autocomplete="tel"><span class="err"></span></label>
          <label>Address<input class="input" name="addr" autocomplete="street-address" maxlength="200"><span class="err"></span></label>
          <label>PIN code<input class="input" name="pin" inputmode="numeric" maxlength="6" autocomplete="postal-code"><span class="err"></span></label>
          <label>Payment<select class="input" name="pay"><option>UPI</option><option>Card</option><option>Cash on delivery</option></select><span class="err"></span></label>
          <button class="btn primary block" type="submit">Place order · ${inr(subtotal + shipping)}</button>
        </form>
      </div>`;
    $$('[data-q]', view).forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.id;
      const p = byId(D.products, id);
      const n = (S.cart[id] || 0) + Number(b.dataset.q);
      if (n <= 0) delete S.cart[id];
      else S.cart[id] = Math.min(n, p.stock);
      persist();
      cart(view);
    }));
    $('#co', view).addEventListener('submit', (e) => {
      e.preventDefault();
      const form = e.target;
      const f = Object.fromEntries(new FormData(form));
      const errs = {};
      if ((f.name || '').trim().length < 2) errs.name = 'Enter your name.';
      if (!/^[6-9]\d{9}$/.test(f.phone || '')) errs.phone = 'Enter a valid 10-digit mobile number.';
      if ((f.addr || '').trim().length < 8) errs.addr = 'Enter a complete address.';
      if (!/^[1-9]\d{5}$/.test(f.pin || '')) errs.pin = 'Enter a valid 6-digit PIN code.';
      $$('.err', form).forEach((el) => { el.textContent = ''; });
      Object.entries(errs).forEach(([k, m]) => { form.elements[k].parentElement.querySelector('.err').textContent = m; });
      if (Object.keys(errs).length) return;
      const order = { id: 'ORD-' + Math.random().toString(36).slice(2, 8).toUpperCase(), items: items.map((x) => ({ id: x.p.id, qty: x.qty })), total: subtotal + shipping, pay: f.pay, at: new Date().toISOString(), dealers: byDealer };
      S.orders.push(order);
      S.cart = {};
      persist();
      view.innerHTML = `<div class="card" style="text-align:center;max-width:520px;margin:2rem auto"><div style="width:72px;height:72px;border-radius:50%;background:rgba(52,211,153,.15);color:var(--green);display:grid;place-items:center;margin:0 auto .8rem">${ic('check', 'lg')}</div><h1>Order placed</h1>
        <p>Order <b>${esc(order.id)}</b> · ${inr(order.total)} · ${esc(order.pay)}</p>
        <p class="small muted">${byDealer.length} dealer(s) notified. Demo: payment gateway and dealer dispatch integrate here.</p>
        <a class="btn primary" href="#/me">View orders</a></div>`;
    });
  }

  // Score keeper implementing Law IX (25 points or 8/6 boards per game, Queen = 3 up to 21, best of 3 games).
  const newScorer = (maxBoards = 8, mode = 'singles') => ({ names: ['Player A', 'Player B'], team: [['Player 1', 'Player 2'], ['Player 3', 'Player 4']], mode, games: [], boards: [], winner: null, maxBoards, invited: [], venue: '', when: '' });
  let SC = store.get('scorer', null) || newScorer();
  SC.maxBoards = SC.maxBoards || 8; SC.invited = SC.invited || []; SC.venue = SC.venue || ''; SC.when = SC.when || ''; SC.mode = SC.mode || 'singles'; SC.team = SC.team || [['Player 1', 'Player 2'], ['Player 3', 'Player 4']];
  S.myClubs.forEach((c) => { if (c.type === 'Ministry / department team') c.type = 'Academy team'; });
  const SCV = { tab: 'score', q: '' };
  // Display name of side i: the player (singles) or "X & Y" (doubles).
  const nm = (st, i) => (st.mode === 'doubles' ? `${st.team[i][0]} & ${st.team[i][1]}` : st.names[i]);
  const curOf = (st) => st.boards.reduce((s, b) => { s[b.w] += b.pts; return s; }, [0, 0]);
  const scCur = () => curOf(SC);
  // Compact URL-safe snapshot so an invitee can open a read-only board (or take over scoring) without a server.
  const encState = (st) => btoa(unescape(encodeURIComponent(JSON.stringify({ n: st.names, tm: st.team, md: st.mode, g: st.games, b: st.boards, w: st.winner, m: st.maxBoards, v: st.venue, t: st.when, at: Date.now() })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decState = (s) => {
    try {
      const o = JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
      if (!Array.isArray(o.n) || !Array.isArray(o.g) || !Array.isArray(o.b)) return null;
      const team = Array.isArray(o.tm) && o.tm.length === 2 ? o.tm.map((t) => [String(t[0] || '').slice(0, 24), String(t[1] || '').slice(0, 24)]) : [['Player 1', 'Player 2'], ['Player 3', 'Player 4']];
      return { names: o.n.map((x) => String(x).slice(0, 24)), team, mode: o.md === 'doubles' ? 'doubles' : 'singles', games: o.g, boards: o.b, winner: o.w ?? null, maxBoards: o.m === 6 ? 6 : 8, venue: String(o.v || '').slice(0, 80), when: String(o.t || '').slice(0, 30), invited: [], at: o.at };
    } catch { return null; }
  };
  const watchLink = () => pageUrl('#/scorer?watch=' + encState(SC));
  function scoreboardHtml(st, ro) {
    const cur = curOf(st);
    const won = st.games.reduce((a, g) => { a[g.s[0] > g.s[1] ? 0 : 1]++; return a; }, [0, 0]);
    const gameNo = st.games.length + 1, maxB = st.maxBoards;
    const sideChange = gameNo === 3 && (st.boards.length >= Math.ceil(maxB / 2) || Math.max(...cur) >= 13);
    const setDot = (i) => { const g = st.games[i]; return `<span class="set-dot ${g ? (g.s[0] > g.s[1] ? 'a' : 'b') : i === st.games.length && st.winner === null ? 'now' : ''}" title="Set ${i + 1}${g ? `: ${g.s[0]}–${g.s[1]}` : ''}">${g ? `${g.s[0]}–${g.s[1]}` : 'Set ' + (i + 1)}</span>`; };
    const nameCell = (i) => {
      if (ro) return `<div><b style="font-size:1.05rem">${esc(nm(st, i))}</b>${st.mode === 'doubles' ? '<div class="small muted">Team ' + (i ? 'B' : 'A') + '</div>' : ''}</div>`;
      if (st.mode === 'doubles') return `<div class="stack" style="--gap:.3rem"><div class="small muted" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">Team ${i ? 'B' : 'A'}</div><input class="input" data-team="${i}-0" value="${esc(st.team[i][0])}" maxlength="24" style="text-align:center;width:100%" aria-label="Team ${i ? 'B' : 'A'} player 1"><input class="input" data-team="${i}-1" value="${esc(st.team[i][1])}" maxlength="24" style="text-align:center;width:100%;margin-top:.3rem" aria-label="Team ${i ? 'B' : 'A'} player 2"></div>`;
      return `<input class="input" data-name="${i}" value="${esc(st.names[i])}" maxlength="24" style="text-align:center;width:100%" aria-label="Player ${i ? 'B' : 'A'} name">`;
    };
    return `<section class="card scoreboard">
        <div class="small muted" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">${st.mode === 'doubles' ? 'Doubles · ' : ''}Sets</div>
        <div class="set-row">${[0, 1, 2].map(setDot).join('')}</div>
        <div class="big">
          <div>${nameCell(0)}<div class="small" style="margin-top:.3rem"><span class="pill ${won[0] ? 'ok' : ''}">${won[0]} set${won[0] === 1 ? '' : 's'}</span></div></div>
          <div><div class="num">${cur[0]} – ${cur[1]}</div><div class="small muted">${st.winner !== null ? 'Match over' : `Set ${gameNo} · Board ${st.boards.length + 1}${st.boards.length >= maxB ? ' (extra)' : ' of ' + maxB}`}</div></div>
          <div>${nameCell(1)}<div class="small" style="margin-top:.3rem"><span class="pill ${won[1] ? 'ok' : ''}">${won[1]} set${won[1] === 1 ? '' : 's'}</span></div></div>
        </div>
        ${st.winner === null ? `<div class="row" style="max-width:420px;margin:0 auto .5rem;gap:4px"><div class="progress" style="flex:1;direction:rtl"><i style="width:${(cur[0] / 25) * 100}%"></i></div><span class="small muted" style="min-width:2.4rem">to 25</span><div class="progress" style="flex:1"><i style="width:${(cur[1] / 25) * 100}%;background:var(--blue)"></i></div></div>` : ''}
        ${st.boards.length ? `<div class="timeline" style="max-width:420px;margin:0 auto .6rem" aria-label="Boards this set">${st.boards.map((b) => `<i class="${b.w ? 'b' : 'a'}" title="${esc(nm(st, b.w))} +${b.pts}"></i>`).join('')}${Array.from({ length: Math.max(0, maxB - st.boards.length) }, () => '<i></i>').join('')}</div>` : ''}
        ${st.winner !== null ? `<h2 class="row center">${ic('trophy', 'star-ic')} ${esc(nm(st, st.winner))} win${st.mode === 'doubles' ? '' : 's'} the match ${won[st.winner]}–${won[1 - st.winner]}</h2>` : ''}
        ${sideChange && st.winner === null ? `<div class="pill warn">${ic('swap', 'sm')} Set 3: change sides now (Law X)</div>` : ''}
        ${st.mode === 'doubles' && st.winner === null ? `<div class="small muted" style="margin-top:.5rem">${ic('users', 'sm')} Doubles: partners sit opposite each other; after a turn, play passes to the player on the right (Law VIII.2).</div>` : ''}
        ${st.venue || st.when ? `<div class="small muted row center wrap" style="gap:.3rem 1rem;margin-top:.5rem">${st.venue ? `<span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${esc(st.venue)}</span>` : ''}${st.when ? `<span class="row" style="gap:.3rem">${ic('clock', 'sm')} ${esc(new Date(st.when).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</span>` : ''}</div>` : ''}
      </section>`;
  }
  // Scoresheet for one set: each board row shows points won and the running (cumulative) score.
  function sheetHtml(st, boards, title, final, open) {
    let a = 0, b = 0;
    const rows = boards.map((x, i) => {
      if (x.w === 0) a += x.pts; else b += x.pts;
      return `<tr><td>Board ${i + 1}${i >= st.maxBoards ? ' <span class="pill">extra</span>' : ''}</td><td>${esc(nm(st, x.w))}</td><td class="num-c">+${x.pts}${x.q ? ' <span class="pill warn" title="Queen covered">Q</span>' : ''}</td><td class="num-c"><b style="color:${x.w === 0 ? 'var(--accent)' : 'inherit'}">${a}</b></td><td class="num-c"><b style="color:${x.w === 1 ? 'var(--blue)' : 'inherit'}">${b}</b></td></tr>`;
    }).join('');
    return `<details class="card sheet" ${open ? 'open' : ''}>
      <summary class="row between"><span class="row"><b>${title}</b>${final ? `<span class="pill ok">${esc(nm(st, final[0] > final[1] ? 0 : 1))} ${final[0]}–${final[1]}</span>` : '<span class="pill live">In play</span>'}</span><span class="small muted">${boards.length} board${boards.length === 1 ? '' : 's'}</span></summary>
      <div style="overflow-x:auto;margin-top:.6rem"><table><thead><tr><th>Board</th><th>Won by</th><th class="num-c">Pts</th><th class="num-c">${esc(nm(st, 0))}</th><th class="num-c">${esc(nm(st, 1))}</th></tr></thead><tbody>${rows}</tbody></table></div>
    </details>`;
  }
  const sheetsHtml = (st) => (st.boards.length || st.games.length) ? `<section class="section"><h2>Scoresheet</h2><div class="stack">${st.games.map((g, i) => sheetHtml(st, g.boards, `Set ${i + 1}`, g.s, false)).join('')}${st.boards.length ? sheetHtml(st, st.boards, `Set ${st.games.length + 1}`, null, true) : ''}</div></section>` : '';

  function watchBoard(view, code) {
    const st = decState(code);
    if (!st) return notFound(view);
    view.innerHTML = `
      <a class="back" href="#/scorer">${ic('back')} Score keeper</a>
      <div class="row between wrap"><h1>${esc(nm(st, 0))} vs ${esc(nm(st, 1))}</h1><span class="pill info">${ic('play', 'sm')} Shared board${st.mode === 'doubles' ? ' · Doubles' : ''}</span></div>
      <p class="muted small">Snapshot shared ${st.at ? new Date(st.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''} by the score keeper. Ask them to re-share for the latest, or take over scoring below.</p>
      ${scoreboardHtml(st, true)}
      ${sheetsHtml(st)}
      <div class="row wrap" style="margin-top:1rem"><button class="btn primary" id="take-over">${ic('calc', 'sm')} Continue scoring this match</button><a class="btn" href="#/scorer">Start my own match</a></div>`;
    $('#take-over', view).addEventListener('click', () => {
      if (SC.boards.length || SC.games.length) { if (!confirm('Replace your current match in the score keeper with this one?')) return; }
      SC = { ...st, invited: [] }; delete SC.at; store.set('scorer', SC); SCV.tab = 'score';
      toast('Match loaded — you are now the keeper', 'calc');
      location.hash = '#/scorer';
    });
  }

  function inviteTab(view) {
    const myStates = uniq(S.myClubs.map((c) => c.state));
    const q = SCV.q.trim();
    const members = S.myClubs.flatMap((c) => c.members.map((m) => ({ key: 'm:' + m.id, name: m.name, meta: `${c.name} · ${m.role}`, playerId: m.playerId, star: !!m.playerId })));
    const ranked = D.players.map((p) => ({ key: 'p:' + p.id, name: p.name, meta: `#${p.rank} ${p.cat} · ${club(p.club).city}, ${p.state}`, playerId: p.id, star: p.star, local: myStates.includes(p.state) }))
      .sort((a, b) => (b.local - a.local));
    const hit = (x) => !q || matchesQuery(`${x.name} ${x.meta}`, q);
    const seated = (name) => (SC.mode === 'doubles' ? SC.team.flat().includes(name) : SC.names.includes(name));
    const seatBtns = (name) => SC.mode === 'doubles'
      ? [['0-0', 'A1'], ['0-1', 'A2'], ['1-0', 'B1'], ['1-1', 'B2']].map(([k, l]) => { const [i, j] = k.split('-').map(Number); return `<button class="btn sm ${SC.team[i][j] === name ? 'on' : ''}" data-tseat="${k}" data-nm="${esc(name)}" title="Team ${i ? 'B' : 'A'} player ${j + 1}">${l}</button>`; }).join('')
      : [0, 1].map((i) => `<button class="btn sm ${SC.names[i] === name ? 'on' : ''}" data-seat="${i}" data-nm="${esc(name)}" title="Set as Player ${i ? 'B' : 'A'}">${i ? 'B' : 'A'}</button>`).join('');
    const row = (x) => `<div class="list-row invite-row" style="gap:.5rem">
        <span class="row" style="min-width:0">${avatar({ name: x.name, star: x.star })}<span style="min-width:0"><b>${esc(x.name)}</b>${SC.invited.includes(x.name) ? ' <span class="pill ok">Invited</span>' : ''}${seated(x.name) ? ' <span class="pill warn">Playing</span>' : ''}${x.local ? ' <span class="pill info">Local</span>' : ''}<br><span class="small muted">${esc(x.meta)}</span></span></span>
        <span class="row" style="gap:.3rem;flex:none">${seatBtns(x.name)}<button class="btn sm primary" data-invite="${esc(x.name)}">${ic('share', 'sm')} Invite</button></span>
      </div>`;
    const mem = members.filter(hit), rk = ranked.filter(hit);
    return `
      <section class="card" style="margin-bottom:1rem">
        <h2>Match details</h2>
        <div class="row wrap" style="align-items:end">
          <label class="small" style="flex:2;min-width:200px;font-weight:600">Venue<input class="input" id="inv-venue" value="${esc(SC.venue)}" maxlength="80" placeholder="e.g. CEA recreation hall, 3rd floor" style="width:100%;margin-top:.3rem"></label>
          <label class="small" style="flex:1;min-width:180px;font-weight:600">When<input class="input" id="inv-when" type="datetime-local" value="${esc(SC.when)}" style="width:100%;margin-top:.3rem"></label>
          <button class="btn" id="inv-link">${ic('link', 'sm')} Share live board link</button>
        </div>
        <p class="small muted" style="margin:.6rem 0 0">${SC.mode === 'doubles' ? 'Doubles: seat four players (A1, A2 vs B1, B2). ' : ''}Invitees get the match details and a link to this board. They can watch, or tap “Continue scoring” to take over as keeper on their phone.</p>
      </section>
      <div class="filters"><input class="input grow" id="inv-q" type="search" placeholder="Search club members or ranked players…" value="${esc(SCV.q)}" maxlength="60">
        <form class="row" id="inv-guest" style="gap:.4rem"><input class="input" name="name" placeholder="Guest name" maxlength="40" required><button class="btn sm primary" type="submit">${ic('users', 'sm')} Add & invite</button></form></div>
      <div class="grid two" style="align-items:start">
        <section class="card"><div class="row between"><h2 class="row">${ic('users')} My club members</h2><a class="small" style="color:var(--accent2)" href="#/clubs">Manage</a></div>
          ${mem.length ? mem.map(row).join('') : `<p class="small muted">${S.myClubs.length ? 'No members match.' : 'Create a club and add members to invite them in one tap.'} <a href="#/club/new" style="color:var(--accent2)">Create a club</a></p>`}</section>
        <section class="card"><h2 class="row">${ic('chart')} Ranked players${myStates.length ? ` <span class="small muted" style="font-weight:400">· ${esc(myStates.join(', '))} first</span>` : ''}</h2>
          ${rk.length ? rk.slice(0, 12).map(row).join('') + (rk.length > 12 ? `<p class="small muted">+${rk.length - 12} more — refine your search.</p>` : '') : '<p class="small muted">No players match.</p>'}</section>
      </div>
      ${SC.invited.length ? `<section class="card section"><div class="row between"><h2>Invited (${SC.invited.length})</h2><button class="btn sm ghost" id="inv-clear">Clear</button></div><div class="row wrap" style="gap:.3rem">${SC.invited.map((n) => `<span class="pill ok">${esc(n)}</span>`).join('')}</div></section>` : ''}`;
  }

  function scorer(view, _a, qs) {
    const watch = qs && qs.get('watch');
    if (watch) return watchBoard(view, watch);
    const cur = scCur();
    const won = SC.games.reduce((a, g) => { a[g.s[0] > g.s[1] ? 0 : 1]++; return a; }, [0, 0]);
    const maxB = SC.maxBoards;
    const started = SC.boards.length > 0 || SC.games.length > 0;
    const A = nm(SC, 0), B = nm(SC, 1);
    view.innerHTML = `
      <div class="row between wrap"><h1>Score keeper</h1><div class="row wrap">${SC.winner !== null ? shareBtn(`${nm(SC, SC.winner)} beat ${nm(SC, 1 - SC.winner)} ${won[SC.winner]}–${won[1 - SC.winner]} (CarromHub score keeper)`, watchLink()) : `<button class="btn sm" id="sc-share">${ic('share', 'sm')} Share live board</button>`}</div></div>
      <div class="tabs">${[['score', 'Score', 'calc'], ['invite', `Invite players${SC.invited.length ? ` (${SC.invited.length})` : ''}`, 'users']].map(([k, v, i]) => `<button class="tab ${SCV.tab === k ? 'on' : ''}" data-sct="${k}">${ic(i, 'sm')} ${v}</button>`).join('')}</div>
      ${SCV.tab === 'invite' ? inviteTab(view) : `
      <p class="muted small">Match = best of 3 sets (first to 2). A set is won at <b>25 points</b> or by the leader after <b>${maxB} boards</b> (tie → extra board). Board winner scores the opponent's remaining coins; Queen = 3 pts only while the winner is on 21 or less.${SC.mode === 'doubles' ? ' In doubles the pair scores together.' : ''}</p>
      <div class="row wrap" style="margin-bottom:.5rem;gap:.5rem 1rem">
        <div class="tabs" role="radiogroup" aria-label="Match type" style="margin:0">${[['singles', 'Singles · 1v1', 'user'], ['doubles', 'Doubles · 2v2', 'users']].map(([k, v, i]) => `<button class="tab ${SC.mode === k ? 'on' : ''}" data-mode="${k}" ${started ? 'disabled' : ''}>${ic(i, 'sm')} ${v}</button>`).join('')}</div>
      </div>
      <div class="row wrap between" style="margin-bottom:.8rem">
        <div class="tabs" role="radiogroup" aria-label="Boards per set" style="margin:0">${[8, 6].map((n) => `<button class="tab ${maxB === n ? 'on' : ''}" data-mb="${n}" ${started ? 'disabled' : ''}>${n} boards / set</button>`).join('')}</div>
        ${started && SC.winner === null ? '<span class="small muted">Format locks once play starts · use New match to change</span>' : ''}
      </div>
      ${scoreboardHtml(SC, false)}
      ${SC.winner === null ? `
      <form class="card form section" id="sc-form" style="max-width:none">
        <h2>Record board</h2>
        <div class="row wrap">
          <label style="flex:1">Board won by<select class="input" name="w"><option value="0">${esc(A)}</option><option value="1">${esc(B)}</option></select></label>
          <label style="flex:1">Opponent coins left<select class="input" name="coins">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<option>${n}</option>`).join('')}</select></label>
          <label class="toggle" style="align-self:end;padding-bottom:.7rem;white-space:nowrap"><input type="checkbox" name="queen"> Winner covered the Queen</label>
        </div>
        <p class="small muted" id="sc-hint"></p>
        <div class="row"><button class="btn primary" type="submit">Add board</button><button class="btn" type="button" id="sc-undo" ${!SC.boards.length && !SC.games.length ? 'disabled' : ''}>${ic('undo', 'sm')} Undo</button></div>
      </form>` : ''}
      ${sheetsHtml(SC)}
      <button class="btn" id="sc-reset">New match</button>`}`;

    const save = () => store.set('scorer', SC);
    $$('[data-sct]', view).forEach((b) => b.addEventListener('click', () => { SCV.tab = b.dataset.sct; scorer(view); }));
    const sh = $('#sc-share', view);
    if (sh) sh.addEventListener('click', () => share(`${A} vs ${B} — live carrom board`, watchLink(), `Follow ${A} vs ${B} live on CarromHub`));
    if (SCV.tab === 'invite') {
      const inviteText = (name) => {
        const side = SC.mode === 'doubles' ? SC.team.findIndex((t) => t.includes(name)) : SC.names.indexOf(name);
        const dflt = /^Player [AB1-4]$/;
        let vs = '';
        if (side >= 0) {
          const opp = nm(SC, 1 - side);
          const partner = SC.mode === 'doubles' ? SC.team[side].find((p) => p !== name) : null;
          if (partner && !dflt.test(partner)) vs += ` with ${partner}`;
          if (!dflt.test(opp.replace(/ & .*$/, '')) || (SC.mode === 'doubles' && !dflt.test(opp.replace(/^.* & /, '')))) vs += ` vs ${opp}`;
        }
        const when = SC.when ? ' on ' + new Date(SC.when).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
        return `${name}, you're invited to a carrom ${SC.mode === 'doubles' ? 'doubles ' : ''}match${vs}${SC.venue ? ' at ' + SC.venue : ''}${when}. Follow the live board here:`;
      };
      $('#inv-q', view).addEventListener('input', (e) => { SCV.q = e.target.value; scorer(view); $('#inv-q', view).focus(); const el = $('#inv-q', view); el.setSelectionRange(el.value.length, el.value.length); });
      $('#inv-venue', view).addEventListener('change', (e) => { SC.venue = e.target.value.trim().slice(0, 80); save(); });
      $('#inv-when', view).addEventListener('change', (e) => { SC.when = e.target.value; save(); });
      $('#inv-link', view).addEventListener('click', () => share(`${A} vs ${B} — live carrom board`, watchLink(), `Follow ${A} vs ${B} live on CarromHub${SC.venue ? ' · ' + SC.venue : ''}`));
      $$('[data-seat]', view).forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.seat); if (SC.names[1 - i] === b.dataset.nm) SC.names[1 - i] = SC.names[i]; SC.names[i] = b.dataset.nm; save(); toast(`${b.dataset.nm} is Player ${i ? 'B' : 'A'}`, 'users'); scorer(view); }));
      $$('[data-tseat]', view).forEach((b) => b.addEventListener('click', () => {
        const [i, j] = b.dataset.tseat.split('-').map(Number);
        const prev = SC.team[i][j];
        SC.team.forEach((t, ti) => t.forEach((p, pj) => { if (p === b.dataset.nm && !(ti === i && pj === j)) SC.team[ti][pj] = prev; }));
        SC.team[i][j] = b.dataset.nm; save();
        toast(`${b.dataset.nm} → Team ${i ? 'B' : 'A'}, player ${j + 1}`, 'users'); scorer(view);
      }));
      $$('[data-invite]', view).forEach((b) => b.addEventListener('click', async () => {
        const name = b.dataset.invite;
        if (!SC.invited.includes(name)) { SC.invited.push(name); save(); }
        await share(`Carrom match invite — ${name}`, watchLink(), inviteText(name));
        scorer(view);
      }));
      $('#inv-guest', view).addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = e.target.elements.name.value.trim().replace(/\s+/g, ' ');
        if (!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(name)) return toast('Enter a valid guest name', 'info');
        if (!SC.invited.includes(name)) { SC.invited.push(name); save(); }
        if (SC.mode === 'doubles') { outer: for (const t of SC.team) for (let j = 0; j < 2; j++) if (/^Player [1-4]$/.test(t[j])) { t[j] = name; break outer; } }
        else if (SC.names[0] === 'Player A') SC.names[0] = name; else if (SC.names[1] === 'Player B') SC.names[1] = name;
        save();
        await share(`Carrom match invite — ${name}`, watchLink(), inviteText(name));
        scorer(view);
      });
      const cl = $('#inv-clear', view);
      if (cl) cl.addEventListener('click', () => { SC.invited = []; save(); scorer(view); });
      return;
    }
    $$('[data-mode]', view).forEach((b) => b.addEventListener('click', () => { SC.mode = b.dataset.mode; save(); scorer(view); }));
    $$('[data-mb]', view).forEach((b) => b.addEventListener('click', () => { SC.maxBoards = Number(b.dataset.mb); save(); scorer(view); }));
    $$('[data-name]', view).forEach((inp) => inp.addEventListener('change', () => {
      SC.names[inp.dataset.name] = inp.value.trim().slice(0, 24) || SC.names[inp.dataset.name];
      save(); scorer(view);
    }));
    $$('[data-team]', view).forEach((inp) => inp.addEventListener('change', () => {
      const [i, j] = inp.dataset.team.split('-').map(Number);
      SC.team[i][j] = inp.value.trim().slice(0, 24) || SC.team[i][j];
      save(); scorer(view);
    }));
    $('#sc-reset', view).addEventListener('click', () => { SC = newScorer(SC.maxBoards, SC.mode); save(); scorer(view); });
    const form = $('#sc-form', view);
    if (!form) return;
    const hint = () => {
      const w = Number(form.elements.w.value);
      $('#sc-hint', view).textContent = cur[w] >= 22 ? `${nm(SC, w)} ${SC.mode === 'doubles' ? 'are' : 'is'} on ${cur[w]} — the Queen no longer adds points.` : '';
    };
    form.elements.w.addEventListener('change', hint);
    hint();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const w = Number(form.elements.w.value);
      const coins = Number(form.elements.coins.value);
      const q = form.elements.queen.checked;
      const pts = coins + (q && cur[w] <= 21 ? 3 : 0);
      SC.boards.push({ w, pts: Math.min(pts, 25 - cur[w]), q });
      const s = scCur();
      if (s[w] >= 25 || (SC.boards.length >= SC.maxBoards && s[0] !== s[1])) {
        SC.games.push({ s, boards: SC.boards });
        SC.boards = [];
        const g = SC.games.reduce((a, x) => { a[x.s[0] > x.s[1] ? 0 : 1]++; return a; }, [0, 0]);
        if (g[0] === 2 || g[1] === 2) SC.winner = g[0] === 2 ? 0 : 1;
        toast(SC.winner !== null ? `${nm(SC, SC.winner)} win${SC.mode === 'doubles' ? '' : 's'} the match!` : `Set ${SC.games.length} to ${nm(SC, s[0] > s[1] ? 0 : 1)}`, 'trophy');
      }
      save(); scorer(view);
    });
    $('#sc-undo', view).addEventListener('click', () => {
      if (!SC.boards.length && SC.games.length) SC.boards = SC.games.pop().boards;
      SC.boards.pop();
      SC.winner = null;
      save(); scorer(view);
    });
  }

  function more(view) {
    const u = API.user;
    const links = [
      ['#/organise', 'briefcase', 'Organise a tournament', 'Boards, umpires & scoring for your event'], ['#/partners', 'handshake', 'Partners', 'Board hire, umpire panels, venues'],
      ...(u && ['organiser', 'admin'].includes(u.role) ? [['#/organiser', 'trophy', 'Organiser console', 'Host events, approve players']] : []),
      ...(u && ['merchant', 'admin'].includes(u.role) ? [['#/merchant', 'shop', 'Merchant console', 'Products, stock & orders']] : []),
      ['#/players', 'chart', 'Players & rankings', 'Points tables by category'], ['#/clubs', 'club', 'Clubs', 'Find or create a club'], ['#/bodies', 'globe', 'Federations', 'ICF, AICF, states & boards'], ['#/scorer', 'calc', 'Score keeper', 'Official-format scoring'],
      ['#/quiz', 'zap', 'Rules quiz', 'Test your law knowledge'], ['#/me', 'user', u ? 'My account' : 'Sign in', u ? esc(u.name) : 'Phone + OTP'], ['#/cart', 'cart', 'Cart', 'Checkout your gear'],
      ...(u && u.role === 'admin' ? [['#/admin', 'shield', 'Admin console', 'Requests, partners, content, users']] : [])
    ];
    const theme = document.documentElement.dataset.theme;
    view.innerHTML = `<h1>More</h1>
      <div class="grid sm">${links.map(([h, i, t, d]) => `<a class="card link" href="${h}"><div style="color:var(--accent2)">${ic(i, 'lg')}</div><b style="display:block;margin-top:.4rem">${t}</b><span class="small muted">${d}</span></a>`).join('')}</div>
      ${installCard()}
      <section class="card section row between wrap"><div class="row">${ic(theme === 'dark' ? 'moon' : 'sun', 'lg')}<div><b>Appearance</b><div class="small muted">Currently ${theme} mode</div></div></div><button class="btn" id="more-theme">${ic('swap', 'sm')} Switch to ${theme === 'dark' ? 'light' : 'dark'}</button></section>
      <p class="small muted section">Rules summarised from the <a href="${SOURCE}" target="_blank" rel="noopener noreferrer" style="color:var(--accent2)">AICF Laws of Carrom</a>. Players, matches, tournaments and the shop catalogue are demo data; federation links and the World Championship details are verified. Tip: press <kbd class="kbd" style="position:static;display:inline">/</kbd> to search.</p>`;
    $('#more-theme', view).addEventListener('click', () => { toggleTheme(); more(view); });
  }

  function me(view) {
    const follows = D.players.filter((p) => S.follows.has(p.id));
    const saved = RULES.filter((r) => S.saved.has(r.id));
    const reminders = D.tournaments.filter((t) => S.reminders.has(t.id) && t.status === 'upcoming').sort((a, b) => a.start.localeCompare(b.start));
    const u = API.user;
    view.innerHTML = `
      <div class="row between wrap"><h1>My CarromHub</h1>${u ? `<button class="btn sm ghost" id="logout">${ic('logout', 'sm')} Sign out</button>` : ''}</div>
      ${u ? `<section class="card row between wrap" style="margin-bottom:1rem"><div class="row">${avatar({ name: u.name, star: u.role === 'admin' }, 'lg')}<div><b style="font-size:1.1rem">${esc(u.name)}</b><div class="small muted">${esc(u.phone)} · <span class="pill ${u.role === 'admin' ? 'live' : 'info'}">${esc(u.role)}</span>${u.org ? ' · ' + esc(u.org) : ''}${u.city ? ' · ' + esc(u.city) : ''}</div></div></div><div class="row wrap"><a class="btn sm" href="#/organise">${ic('briefcase', 'sm')} My requests</a>${['organiser', 'admin'].includes(u.role) ? `<a class="btn sm primary" href="#/organiser">${ic('trophy', 'sm')} Organiser console</a>` : ''}${['merchant', 'admin'].includes(u.role) ? `<a class="btn sm primary" href="#/merchant">${ic('shop', 'sm')} Merchant console</a>` : ''}${u.role === 'player' ? `<a class="btn sm primary" href="#/events">${ic('trophy', 'sm')} Find events to join</a>` : ''}${u.role === 'admin' ? `<a class="btn sm primary" href="#/admin">${ic('shield', 'sm')} Admin console</a>` : ''}<button class="btn sm" id="edit-acct">${ic('edit', 'sm')} Edit</button></div></section>
        <form class="card form" id="acct-form" hidden style="margin-bottom:1rem;max-width:none"><div class="row wrap" style="align-items:start"><label style="flex:1;min-width:160px">Name<input class="input" name="name" value="${esc(u.name)}" maxlength="60"></label><label style="flex:1;min-width:160px">Organisation<input class="input" name="org" value="${esc(u.org)}" maxlength="80"></label><label style="flex:1;min-width:160px">City<input class="input" name="city" value="${esc(u.city)}" maxlength="40"></label></div><span class="err"></span><div class="row"><button class="btn primary sm" type="submit">Save</button></div></form>`
      : `<section class="card row between wrap" style="margin-bottom:1rem"><div class="row">${ic('login', 'lg')}<div><b>Sign in to CarromHub</b><div class="small muted">${API.ok ? 'Phone + OTP. Needed for organiser requests, partner listings and syncing.' : 'Start the server (npm start) to enable accounts.'}</div></div></div><a class="btn primary" href="#/login?next=${encodeURIComponent('#/me')}">${ic('login', 'sm')} Sign in</a></section>`}
      <div class="kpi">
        <div><b>${S.regs.length}</b><span class="small muted">Registrations</span></div>
        <div><b>${S.myClubs.length}</b><span class="small muted">My clubs</span></div>
        <div><b>${follows.length}</b><span class="small muted">Following</span></div>
        <div><b>${saved.length}</b><span class="small muted">Saved laws</span></div>
        <div><b>${S.done.size}/${D.lessons.length}</b><span class="small muted">Lessons</span></div>
        <div><b>${S.orders.length}</b><span class="small muted">Orders</span></div>
      </div>
      ${installCard()}
      ${u ? '<div id="plat-activity"><div class="skeleton section" style="height:80px"></div></div>' : ''}
      <section class="section"><div class="section-h"><h2>My clubs</h2><a href="#/club/new">Create a club ${ic('right', 'sm')}</a></div>${S.myClubs.length ? `<div class="grid">${S.myClubs.map(communityCard).join('')}</div>` : `<div class="card empty">${ic('users')}<br>Create a club for your office, academy or society and add members.</div>`}</section>
      <section class="section"><h2>Registrations</h2>${S.regs.length ? `<div class="grid">${S.regs.map((r) => { const t = tourn(r.t); return `<a class="card link" href="#/event/${esc(r.t)}"><div class="row between"><b>${esc(t ? t.name : r.t)}</b>${t && t.status === 'upcoming' ? '<span class="pill ok">Upcoming</span>' : ''}</div><div class="small muted">${esc(r.cat)} · ${esc(r.id)}${t ? ' · ' + fdate(t.start) : ''}</div>${t && t.status === 'upcoming' ? `<div style="margin-top:.6rem">${countdown(t.start)}</div>` : ''}</a>`; }).join('')}</div>` : `<div class="card empty">${ic('trophy')}<br>No registrations yet. <a href="#/events" style="color:var(--accent2)">Find a tournament</a></div>`}</section>
      ${reminders.length ? `<section class="section"><h2>Reminders</h2><div class="grid">${reminders.map((t) => `<a class="card link" href="#/event/${esc(t.id)}"><div class="row between"><b>${esc(t.name)}</b>${ic('bell', 'sm star-ic')}</div><div class="small muted">${fdate(t.start)} · ${esc(t.city)}</div><div style="margin-top:.6rem">${countdown(t.start)}</div></a>`).join('')}</div></section>` : ''}
      <section class="section"><h2>Orders</h2>${S.orders.length ? `<div class="grid">${S.orders.map((o) => `<div class="card"><div class="row between"><b>${esc(o.id)}</b><span class="price">${inr(o.total)}</span></div><div class="small muted">${o.items.length} item(s) · ${esc(o.pay)} · ${new Date(o.at).toLocaleDateString('en-IN')}</div><div class="small" style="margin-top:.4rem">${o.items.map((i) => { const p = byId(D.products, i.id); return p ? `${p.emoji} ${esc(p.name)} ×${i.qty}` : ''; }).join('<br>')}</div></div>`).join('')}</div>` : `<div class="card empty">${ic('shop')}<br>No orders yet.</div>`}</section>
      <section class="section"><h2>Following</h2>${follows.length ? `<div class="grid sm">${follows.map(playerCard).join('')}</div>` : `<div class="card empty">${ic('users')}<br>Follow players to get live alerts.</div>`}</section>
      <section class="section"><h2>Saved laws</h2>${saved.length ? `<div class="stack">${saved.map((r) => ruleCard(r)).join('')}</div>` : `<div class="card empty">${ic('star')}<br>Tap the star on any law to save it.</div>`}</section>
      <section class="section card"><div class="row between"><h2>Learning</h2><span class="small muted">${S.done.size} of ${D.lessons.length} lessons</span></div><div class="progress" style="height:8px"><i style="width:${(S.done.size / D.lessons.length) * 100}%"></i></div><a class="btn sm" style="margin-top:.8rem" href="#/learn">Continue learning ${ic('right', 'sm')}</a></section>
      <button class="btn ghost" id="wipe">${ic('x', 'sm')} Clear my demo data</button>`;
    const lo = $('#logout', view);
    if (lo) lo.addEventListener('click', async () => { try { await api('/api/auth/logout', 'POST', {}); } catch { /* already signed out */ } API.user = null; updateAuthUi(); toast('Signed out', 'logout'); me(view); });
    if (u) platformActivity(view);
    const ea = $('#edit-acct', view), af = $('#acct-form', view);
    if (ea) ea.addEventListener('click', () => { af.hidden = !af.hidden; });
    if (af) af.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { API.user = (await api('/api/me', 'PATCH', Object.fromEntries(new FormData(af)))).user; updateAuthUi(); toast('Profile updated'); me(view); }
      catch (err) { $('.err', af).textContent = err.message; }
    });
    $('#wipe', view).addEventListener('click', () => {
      if (!confirm('Clear registrations, orders, saved items and progress on this device?')) return;
      Object.keys(localStorage).filter((k) => k.startsWith('ch.')).forEach((k) => localStorage.removeItem(k));
      location.reload();
    });
  }

  function searchView(view, _a, qs) {
    const q = (qs.get('q') || '').slice(0, 60);
    $('#gsearch-q').value = q;
    const ps = D.players.filter((p) => matchesQuery(`${p.name} ${p.state}`, q));
    const cs = [...D.clubs, ...S.myClubs].filter((c) => matchesQuery(`${c.name} ${c.city} ${c.type || ''}`, q));
    const ts = D.tournaments.filter((t) => matchesQuery(`${t.name} ${t.city} ${t.venue}`, q));
    const rs = RULES.filter((r) => matchesQuery(`${r.title} ${r.text}`, q));
    const pr = shopLocked() && !shopPreview() ? [] : D.products.filter((p) => matchesQuery(`${p.name} ${p.cat}`, q));
    const bd = BODIES.filter((b) => matchesQuery(`${b.name} ${b.short} ${b.place} federation association`, q));
    const total = ps.length + cs.length + ts.length + rs.length + pr.length + bd.length;
    view.innerHTML = `
      <h1>Results for "${esc(q)}"</h1><p class="muted small">${total} result(s)</p>
      ${ts.length ? `<section class="section"><h2>Tournaments</h2><div class="grid">${ts.map(eventCard).join('')}</div></section>` : ''}
      ${bd.length ? `<section class="section"><h2>Federations</h2><div class="grid two">${bd.map(bodyCard).join('')}</div></section>` : ''}
      ${ps.length ? `<section class="section"><h2>Players</h2><div class="grid sm">${ps.map(playerCard).join('')}</div></section>` : ''}
      ${cs.length ? `<section class="section"><h2>Clubs</h2><div class="grid sm">${cs.map((c) => `<a class="card link" href="#/club/${esc(c.id)}"><b>${esc(c.name)}</b><div class="small muted">${esc(c.city)}</div></a>`).join('')}</div></section>` : ''}
      ${rs.length ? `<section class="section"><h2>Laws</h2><div class="stack">${rs.slice(0, 10).map((r) => ruleCard(r, q)).join('')}</div></section>` : ''}
      ${pr.length ? `<section class="section"><h2>Shop</h2><div class="grid">${pr.map(productCard).join('')}</div></section>` : ''}
      ${!total ? '<div class="card empty">Nothing found. Try another word.</div>' : ''}`;
  }

  function notFound(view) {
    view.innerHTML = `<div class="card empty">${ic('info')}<h2>Not found</h2><p class="muted small">That page doesn't exist or has moved.</p><a class="btn" href="#/">Go home</a></div>`;
  }

  // ---------- governing bodies directory ----------
  const LINK_LABELS = { rankings: 'Rankings', tournaments: 'Tournaments', news: 'News', register: 'Player registration', app: 'Android app', scoreboard: 'Scoreboard app', youtube: 'YouTube', facebook: 'Facebook', members: 'Member federations', worldChampionship: 'World Championship', worldCup: 'World Cup', calendar: 'Calendar', laws: 'Laws of Carrom', regulations: 'Tournament regulations', cwc2026: 'World Championship 2026', districts: 'District associations', membership: 'Membership' };
  function bodyCard(b) {
    const lvl = byId(BODY_LEVELS, b.level);
    const links = Object.entries(b.links || {});
    return `
      <article class="card body-card ${b.featured ? 'featured' : ''}" id="body-${esc(b.id)}">
        <div class="row between" style="align-items:flex-start">
          <div class="row" style="min-width:0"><span class="body-flag">${b.flag}</span><div style="min-width:0"><h3 style="margin:0">${esc(b.name)}</h3><div class="small muted">${esc(b.short)} · ${esc(b.place)}${b.founded ? ' · Est. ' + b.founded : ''}</div></div></div>
          <span class="pill ${b.level === 'world' ? 'live' : b.level === 'state' ? 'info' : b.level === 'national' ? 'warn' : ''}" style="flex:none">${esc(lvl.name)}</span>
        </div>
        ${b.note ? `<p class="small muted" style="margin:.6rem 0 .3rem">${esc(b.note)}</p>` : ''}
        <div class="row wrap" style="gap:.3rem;margin:.5rem 0">${(b.offers || []).map((o) => `<span class="pill">${esc(o)}</span>`).join('')}</div>
        <div class="row wrap" style="gap:.4rem">
          ${b.url ? ext(b.url, 'Website', 'btn sm primary') : '<span class="small muted">No official website found</span>'}
          ${links.map(([k, u]) => ext(u, LINK_LABELS[k] || k, 'btn sm')).join('')}
        </div>
      </article>`;
  }
  const BD = { level: 'all', q: '' };
  function bodies(view, _a, qs) {
    const showWc = qs.get('wc');
    view.innerHTML = `
      <div class="row between wrap"><h1>Federations & associations</h1>${shareBtn('Carrom federations directory — CarromHub', pageUrl('#/bodies'))}</div>
      <p class="muted small">Who runs carrom at every level — world, continental, national, Indian states and institutional boards — with links to their rankings, calendars and registration. Links verified against the ICF members list and each body's own site.</p>
      ${wcBanner()}
      ${showWc ? `<section class="card section" id="wc-schedule"><h2>Championship week</h2><table><tbody>${WC.schedule.map(([d, w]) => `<tr><td style="white-space:nowrap"><b>${esc(d)}</b></td><td>${esc(w)}</td></tr>`).join('')}</tbody></table><p class="small muted" style="margin-top:.6rem">Each nation enters one men's and one women's team of four; the same players contest singles and doubles. Schedule subject to change — see the official site.</p></section>` : ''}
      <div class="filters" style="margin-top:1rem">
        <input class="input grow" id="bd-q" type="search" placeholder="Search federation, country, state…" value="${esc(BD.q)}" maxlength="60">
      </div>
      <div class="chips" style="margin-bottom:1rem"><button class="chip ${BD.level === 'all' ? 'on' : ''}" data-bl="all">All (${BODIES.length})</button>${BODY_LEVELS.map((l) => `<button class="chip ${BD.level === l.id ? 'on' : ''}" data-bl="${l.id}">${esc(l.name)} (${BODIES.filter((b) => b.level === l.id).length})</button>`).join('')}</div>
      <div id="bd-list"></div>`;
    const draw = () => {
      const list = BODIES.filter((b) => (BD.level === 'all' || b.level === BD.level) && (!BD.q || matchesQuery(`${b.name} ${b.short} ${b.place} ${b.region || ''} ${(b.offers || []).join(' ')}`, BD.q)));
      const groups = BODY_LEVELS.map((l) => [l, list.filter((b) => b.level === l.id)]).filter(([, bs]) => bs.length);
      $('#bd-list', view).innerHTML = list.length
        ? groups.map(([l, bs]) => `<section class="section"><div class="section-h"><h2 class="row">${ic(l.icon)} ${esc(l.name)}</h2><span class="small muted">${bs.length}</span></div><div class="grid two">${bs.map(bodyCard).join('')}</div></section>`).join('')
        : `<div class="card empty">${ic('globe')}<br>No federations match.</div>`;
    };
    $('#bd-q', view).addEventListener('input', (e) => { BD.q = e.target.value; draw(); });
    $$('[data-bl]', view).forEach((b) => b.addEventListener('click', () => { BD.level = b.dataset.bl; bodies(view, null, new URLSearchParams()); }));
    draw();
    if (showWc) { const el = $('#wc-schedule', view); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }

  // ---------- platform: API client & session ----------
  const API = { ok: /^https?:$/.test(location.protocol), user: null, content: {}, otpDev: false, features: {} };
  async function api(path, method = 'GET', data) {
    if (!API.ok) throw new Error('Accounts and organiser services need the server running (npm start).');
    const res = await fetch(path, { method, headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined, credentials: 'same-origin' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(out.error || 'Request failed.'), { status: res.status });
    return out;
  }
  async function loadSession() {
    if (!API.ok) { applyShopLock(); return; }
    try {
      const [me, content] = await Promise.all([api('/api/me'), api('/api/content')]);
      API.user = me.user && me.user.id !== 'admin-key' ? me.user : null;
      API.otpDev = !!me.otpDev;
      API.features = me.features || {};
      API.content = Object.fromEntries(Object.entries(content).map(([k, v]) => [k, v.value]));
    } catch { API.ok = false; }
    updateAuthUi();
  }
  function updateAuthUi() {
    SUG = null;
    applyShopLock();
    const btn = $('#auth-btn');
    if (!btn) return;
    if (API.user) {
      const h = hue(API.user.name);
      btn.innerHTML = `<span class="avatar" style="width:28px;height:28px;font-size:.68rem;border-width:1.5px;--av1:hsl(${h} 55% 48%);--av2:hsl(${(h + 40) % 360} 60% 30%)">${esc(initials(API.user.name))}</span>`;
      btn.title = API.user.name;
    } else { btn.innerHTML = ic('user'); btn.title = 'Sign in'; }
  }
  const requireLogin = (next) => { location.hash = '#/login?next=' + encodeURIComponent(next); };
  const stale = (h) => location.hash !== h;
  const announcementBar = () => {
    const a = API.content.announcement;
    return a && a.active && a.text ? `<a class="announce" href="${esc(a.link || '#/organise')}">${ic('zap', 'sm')}<span>${esc(a.text)}</span><b>${esc(a.label || 'Learn more')} ${ic('right', 'sm')}</b></a>` : '';
  };

  // ---------- platform: PWA install ----------
  let installPrompt = null;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function installCard() {
    if (isStandalone()) return '';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return `<section class="card section row between wrap install-card"><div class="row">${ic('download', 'lg')}<div><b>Install the CarromHub app</b><div class="small muted">${installPrompt ? 'Adds CarromHub to your home screen with offline access.' : ios ? 'In Safari tap Share → “Add to Home Screen”.' : API.ok ? 'Open in Chrome / Edge and use “Install app” from the browser menu, or the button when it appears.' : 'Serve the app over http(s) (npm start) to enable installation.'}</div></div></div><button class="btn primary" data-install ${installPrompt ? '' : 'hidden'}>${ic('download', 'sm')} Install app</button></section>`;
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $$('[data-install]').forEach((b) => { b.hidden = false; }); });
  window.addEventListener('appinstalled', () => { installPrompt = null; toast('CarromHub installed', 'check'); $$('.install-card').forEach((c) => c.remove()); });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-install]');
    if (!b || !installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $$('[data-install]').forEach((x) => { x.hidden = true; });
  });
  if ('serviceWorker' in navigator && API.ok) navigator.serviceWorker.register('/sw.js').catch(() => {});

  // ---------- platform: login (phone + OTP) ----------
  const LG = { phone: '', sent: null };
  function loginView(view, _a, qs) {
    const next = qs.get('next') || '#/me';
    if (API.user) { location.hash = next; return; }
    if (!API.ok) {
      view.innerHTML = `<div class="card empty" style="max-width:520px;margin:2rem auto">${ic('login')}<h2>Accounts need the server</h2><p class="muted small">Run <code>npm start</code> and open <b>http://localhost:3000</b>. Sign-in uses your mobile number and a one-time code.</p><a class="btn" href="#/">Go home</a></div>`;
      return;
    }
    const sent = LG.sent;
    view.innerHTML = `
      <div class="card" style="max-width:460px;margin:1rem auto">
        <div class="row" style="margin-bottom:.6rem"><span class="logo" aria-hidden="true"></span><h1 style="margin:0">${sent ? 'Enter the code' : 'Sign in'}</h1></div>
        <p class="muted small">${sent ? `We sent a 6-digit code to <b>+91 ${esc(sent.phone)}</b>. ${sent.known ? 'Welcome back!' : 'New here? Tell us your name to create an account.'}` : 'Use your mobile number. We’ll send a one-time code — no password needed.'}</p>
        ${sent && sent.devCode ? `<div class="card flat small" style="margin-bottom:.8rem;border-left:3px solid var(--accent2)">${ic('info', 'sm')} <b>Dev mode:</b> no SMS gateway is configured, so your code is <b style="letter-spacing:.15em">${esc(sent.devCode)}</b>. Set <code>OTP_DELIVERY=sms</code> once a gateway is wired in.</div>` : ''}
        <form class="form" id="login-form" novalidate style="max-width:none">
          ${sent ? `
            <label>One-time code<input class="input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6 digits" required autofocus style="letter-spacing:.3em;font-size:1.3rem;text-align:center"><span class="err"></span></label>
            ${sent.known ? '' : `
            <label>Your name<input class="input" name="name" maxlength="60" autocomplete="name" required><span class="err"></span></label>
            <label>I am a<select class="input" name="role">${[['player', 'Individual player'], ['organiser', 'Organiser (office, institute, club)'], ['merchant', 'Merchant (sell carrom goods)']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select><span class="small muted">Players request to join events · organisers host events & approve players · merchants list products & manage stock. Admins are assigned.</span></label>
            <div class="row wrap" style="align-items:start"><label style="flex:1;min-width:150px">Organisation <span class="muted" style="font-weight:400">(optional)</span><input class="input" name="org" maxlength="80"></label><label style="flex:1;min-width:150px">City <span class="muted" style="font-weight:400">(optional)</span><input class="input" name="city" maxlength="40"></label></div>`}
            <button class="btn primary block" type="submit">${ic('check', 'sm')} ${sent.known ? 'Sign in' : 'Create account & sign in'}</button>
            <button class="btn ghost block" type="button" id="login-back">Use a different number</button>`
          : `
            <label>Mobile number<div class="row"><span class="input" style="flex:none">+91</span><input class="input grow" name="phone" inputmode="numeric" maxlength="10" autocomplete="tel-national" placeholder="10-digit mobile" value="${esc(LG.phone)}" required autofocus></div><span class="err"></span></label>
            <button class="btn primary block" type="submit">Send code ${ic('right', 'sm')}</button>`}
        </form>
        <p class="small muted" style="margin-top:1rem">By continuing you agree to the Laws of Carrom code of conduct. The first account created on a fresh install becomes the admin.</p>
      </div>`;
    const form = $('#login-form', view);
    const back = $('#login-back', view);
    if (back) back.addEventListener('click', () => { LG.sent = null; loginView(view, null, qs); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const err = $('.err', form);
      err.textContent = '';
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try {
        if (!sent) {
          if (!/^[6-9]\d{9}$/.test(f.phone || '')) throw new Error('Enter a valid 10-digit Indian mobile number.');
          LG.phone = f.phone;
          LG.sent = await api('/api/auth/request-otp', 'POST', { phone: f.phone });
          loginView(view, null, qs);
        } else {
          const out = await api('/api/auth/verify', 'POST', { phone: sent.phone, code: (f.code || '').trim(), name: f.name, role: f.role, org: f.org, city: f.city });
          API.user = out.user; LG.sent = null;
          updateAuthUi();
          toast(`Welcome, ${out.user.name.split(' ')[0]}${out.user.role === 'admin' ? ' — you are the admin' : ''}`, 'check');
          location.hash = next;
        }
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    });
  }

  // ---------- platform: organise a tournament ----------
  const SERVICE_META = { boards: ['Boards & stands', 'target'], umpires: ['Umpires & referees', 'flag'], scoring: ['Draws & live scoring', 'calc'], venue: ['Venue', 'club'], equipment: ['Coins, strikers, prizes', 'shop'], streaming: ['Live streaming', 'play'] };
  const REQ_STEPS = ['received', 'matching', 'quoted', 'confirmed', 'completed'];
  const DEFAULT_PACKAGES = [
    { id: 'basic', name: 'Office Day', players: '16–32 players', boards: 4, umpires: 1, includes: ['4 tournament boards + stands', '1 certified umpire', 'Draw & fixtures', 'Result sheet'], from: 12000 },
    { id: 'standard', name: 'Inter-Department Cup', players: '32–64 players', boards: 8, umpires: 3, includes: ['8 boards with lights', '3 umpires + chief referee', 'Live scores on CarromHub', 'Trophies & coins kit'], from: 32000 },
    { id: 'premium', name: 'Inter-Academy / Open', players: '64–128 players', boards: 16, umpires: 6, includes: ['16 boards, venue support', '6 umpires + protest committee', 'Live streaming of finals', 'Event microsite & registration'], from: 85000 }
  ];
  const OG = { pkg: null, done: null };
  function requestCard(r, admin) {
    const idx = REQ_STEPS.indexOf(r.status);
    const cancelled = r.status === 'cancelled';
    return `<article class="card req" data-req="${esc(r.id)}">
      <div class="row between wrap"><div><b>${esc(r.org_name)}</b> <span class="small muted">· ${esc(r.org_type)}${admin && r.requester ? ' · by ' + esc(r.requester) : ''}</span></div><span class="pill ${cancelled ? '' : r.status === 'confirmed' || r.status === 'completed' ? 'ok' : 'warn'}">${esc(r.status)}</span></div>
      <div class="small muted row wrap" style="gap:.3rem 1rem;margin:.3rem 0"><span class="row" style="gap:.3rem">${ic('calendar', 'sm')} ${fdate(r.start_date)}${r.end_date !== r.start_date ? ' – ' + fdate(r.end_date) : ''}</span><span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${esc(r.city)}, ${esc(r.state)}</span><span>${r.players} players · ${r.boards} boards · ${r.umpires} umpires</span>${r.budget ? `<span>Budget ${inr(r.budget)}</span>` : ''}</div>
      <div class="row wrap" style="gap:.3rem">${r.services.map((s) => `<span class="pill">${esc(SERVICE_META[s] ? SERVICE_META[s][0] : s)}</span>`).join('')}</div>
      ${cancelled ? '' : `<ol class="steps" aria-label="Progress">${REQ_STEPS.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}"><span></span>${s}</li>`).join('')}</ol>`}
      ${r.admin_note ? `<p class="small" style="margin:.5rem 0 0"><b>CarromHub:</b> ${esc(r.admin_note)}</p>` : ''}
      ${r.notes && admin ? `<p class="small muted" style="margin:.3rem 0 0">Notes: ${esc(r.notes)}</p>` : ''}
      <div class="small muted" style="margin-top:.4rem">${esc(r.id)} · requested ${new Date(r.created_at).toLocaleDateString('en-IN')}</div>
    </article>`;
  }
  async function organiseView(view) {
    const pk = (API.content.organise && API.content.organise.packages) || DEFAULT_PACKAGES;
    const u = API.user;
    const sel = OG.pkg ? pk.find((p) => p.id === OG.pkg) : null;
    view.innerHTML = `
      <section class="hero">
        <span class="pill warn">${ic('briefcase', 'sm')} For offices · academies · institutes · societies</span>
        <h1 style="margin-top:.6rem">Organise a carrom tournament.<br>We bring the boards, umpires and scoring.</h1>
        <p class="muted lead">Tell us about your event. CarromHub matches you with verified board-hire vendors, certified umpire panels, scoring crews and venues — one request, one point of contact.</p>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:1rem">
          ${[['1', 'Tell us', 'Dates, city, players and what you need'], ['2', 'We match', 'Vendors & umpires near you quote within 48 h'], ['3', 'Play', 'Draws, live scores and result sheets on CarromHub']].map(([n, t, d]) => `<div class="card flat"><span class="rank r1" style="margin-bottom:.4rem">${n}</span><b style="display:block">${t}</b><span class="small muted">${d}</span></div>`).join('')}
        </div>
      </section>
      ${OG.done ? `<section class="card section" style="border-color:rgba(52,211,153,.4)">
        <div class="row"><div style="width:48px;height:48px;border-radius:50%;background:rgba(52,211,153,.15);color:var(--green);display:grid;place-items:center">${ic('check', 'lg')}</div><div><h2 style="margin:0">Request received — ${esc(OG.done.id)}</h2><div class="small muted">We’ll match partners and get back within 48 hours. Track it below.</div></div></div>
        ${OG.done.suggestions.length ? `<h3 style="margin-top:1rem">Suggested partners for your request</h3><div class="grid">${OG.done.suggestions.slice(0, 6).map(vendorCard).join('')}</div>` : ''}
      </section>` : ''}
      <section class="section">
        <div class="section-h"><h2>Packages</h2><span class="small muted">Indicative, excl. venue & travel</span></div>
        <div class="grid">${pk.map((p) => `<article class="card pkg ${sel && sel.id === p.id ? 'on' : ''}"><div class="row between"><h3>${esc(p.name)}</h3>${sel && sel.id === p.id ? '<span class="pill ok">Selected</span>' : ''}</div><div class="small muted">${esc(p.players)} · ${p.boards} boards · ${p.umpires} umpire${p.umpires === 1 ? '' : 's'}</div><ul class="small" style="padding-left:1.1rem;margin:.6rem 0">${p.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="row between"><span class="price">from ${inr(p.from)}</span><button class="btn sm ${sel && sel.id === p.id ? '' : 'primary'}" data-pkg="${esc(p.id)}">${sel && sel.id === p.id ? 'Change' : 'Request this'}</button></div></article>`).join('')}</div>
      </section>
      <section class="section grid two" style="align-items:start">
        <form class="card form" id="org-form" novalidate style="max-width:none">
          <h2>Request a quote</h2>
          ${u ? '' : `<div class="card flat small row">${ic('login', 'sm')} <span>You can fill this in now — <a href="#/login?next=${encodeURIComponent('#/organise')}" style="color:var(--accent2)">sign in</a> to send it.</span></div>`}
          <div class="row wrap" style="align-items:start">
            <label style="flex:2;min-width:200px">Organisation / institute<input class="input" name="org_name" maxlength="80" placeholder="e.g. Central Electricity Authority" value="${esc(u && u.org || '')}" required><span class="err"></span></label>
            <label style="flex:1;min-width:160px">Type<select class="input" name="org_type">${['Office / corporate', 'Academy', 'PSU / board', 'Institute / college', 'School', 'Housing society', 'Club / association', 'Other'].map((t) => `<option>${t}</option>`).join('')}</select></label>
          </div>
          <div class="row wrap" style="align-items:start">
            <label style="flex:1;min-width:160px">Contact name<input class="input" name="contact_name" maxlength="60" value="${esc(u ? u.name : '')}" required><span class="err"></span></label>
            <label style="flex:1;min-width:160px">Contact mobile<input class="input" name="phone" inputmode="numeric" maxlength="10" required><span class="err"></span></label>
          </div>
          <div class="row wrap" style="align-items:start">
            <label style="flex:1;min-width:140px">City<input class="input" name="city" maxlength="40" value="${esc(u && u.city || '')}" required><span class="err"></span></label>
            <label style="flex:1;min-width:140px">State<input class="input" name="state" list="state-list" maxlength="40" required><datalist id="state-list">${uniq(D.clubs.map((c) => c.state)).sort().map((s) => `<option value="${esc(s)}">`).join('')}</datalist><span class="err"></span></label>
          </div>
          <div class="row wrap" style="align-items:start">
            <label style="flex:1;min-width:140px">Start date<input class="input" name="start_date" type="date" required><span class="err"></span></label>
            <label style="flex:1;min-width:140px">End date<input class="input" name="end_date" type="date"><span class="err"></span></label>
          </div>
          <div class="row wrap" style="align-items:start">
            <label style="flex:1;min-width:110px">Players<input class="input" name="players" inputmode="numeric" value="${sel ? sel.players.replace(/\D.*$/, '') : 32}" required><span class="err"></span></label>
            <label style="flex:1;min-width:110px">Boards needed<input class="input" name="boards" inputmode="numeric" value="${sel ? sel.boards : 8}"><span class="err"></span></label>
            <label style="flex:1;min-width:110px">Umpires needed<input class="input" name="umpires" inputmode="numeric" value="${sel ? sel.umpires : 2}"><span class="err"></span></label>
          </div>
          <fieldset style="border:none;padding:0;margin:0"><legend class="small" style="font-weight:600;margin-bottom:.4rem">What do you need?</legend><div class="row wrap" style="gap:.4rem">${Object.entries(SERVICE_META).map(([k, [l, i]]) => `<label class="chip" style="display:inline-flex;gap:.35rem;align-items:center"><input type="checkbox" name="services" value="${k}" ${['boards', 'umpires', 'scoring'].includes(k) ? 'checked' : ''} style="accent-color:var(--accent)">${ic(i, 'sm')} ${l}</label>`).join('')}</div><span class="err" data-for="services"></span></fieldset>
          <label>Budget (₹, optional)<input class="input" name="budget" inputmode="numeric" value="${sel ? sel.from : ''}"><span class="err"></span></label>
          <label>Notes <span class="muted" style="font-weight:400">(categories, timings, venue details)</span><textarea class="input" name="notes" rows="3" maxlength="1000"></textarea></label>
          <span class="err" data-for="form"></span>
          <button class="btn primary block" type="submit">${u ? ic('check', 'sm') + ' Send request' : ic('login', 'sm') + ' Sign in & send request'}</button>
          <p class="small muted" style="margin:0">No payment now. You’ll receive quotes from matched partners; CarromHub coordinates boards, officials and scoring on the day.</p>
        </form>
        <div class="stack">
          <section class="card"><h2>What we provide</h2><div class="stack">${Object.entries(SERVICE_META).map(([k, [l, i]]) => `<div class="row"><span class="body-flag">${ic(i)}</span><div><b>${l}</b><div class="small muted">${{ boards: 'Tournament-spec 16–20 mm boards with stands, lights and powder, delivered & set up.', umpires: 'State/national-panel umpires, chief referee and protest committee as needed.', scoring: 'Draws, fixtures, board allocation and live scores on CarromHub for players to follow.', venue: 'Indoor halls and club venues sized to your board count.', equipment: 'Coins, strikers, powder, trophies and medals in bulk.', streaming: 'Finals streamed with scoreboard overlay.' }[k]}</div></div></div>`).join('')}</div></section>
          <section class="card"><div class="row between"><h2>My requests</h2>${u ? '' : `<a class="small" style="color:var(--accent2)" href="#/login?next=${encodeURIComponent('#/organise')}">Sign in</a>`}</div><div id="my-reqs">${u ? '<div class="skeleton" style="height:60px"></div>' : '<p class="small muted">Sign in to see and track your requests.</p>'}</div></section>
          <a class="card link row between" href="#/partners"><div class="row">${ic('handshake', 'lg')}<div><b>Browse partners</b><div class="small muted">Board hire, umpire panels, scoring crews & venues</div></div></div>${ic('right')}</a>
        </div>
      </section>`;
    $$('[data-pkg]', view).forEach((b) => b.addEventListener('click', () => { OG.pkg = OG.pkg === b.dataset.pkg ? null : b.dataset.pkg; organiseView(view); if (OG.pkg) $('#org-form', view).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    const form = $('#org-form', view);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!API.user) { store.set('orgDraft', Object.fromEntries(new FormData(form))); return requireLogin('#/organise'); }
      const fd = new FormData(form);
      const f = Object.fromEntries(fd);
      f.services = fd.getAll('services');
      ['players', 'boards', 'umpires', 'budget'].forEach((k) => { f[k] = f[k] === '' ? 0 : Number(f[k]); });
      if (!f.end_date) f.end_date = f.start_date;
      $$('.err', form).forEach((el) => { el.textContent = ''; });
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try {
        OG.done = await api('/api/requests', 'POST', f);
        OG.pkg = null;
        toast('Request sent — we’ll match partners shortly', 'check');
        organiseView(view);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (ex) { $('[data-for="form"]', form).textContent = ex.message; btn.disabled = false; }
    });
    const draft = store.get('orgDraft', null);
    if (draft && API.user) { Object.entries(draft).forEach(([k, v]) => { const el = form.elements[k]; if (el && el.type !== 'checkbox' && !(el instanceof RadioNodeList)) el.value = v; }); localStorage.removeItem('ch.orgDraft'); }
    if (u) {
      const h = location.hash;
      try {
        const { requests } = await api('/api/requests');
        if (stale(h)) return;
        $('#my-reqs', view).innerHTML = requests.length ? `<div class="stack">${requests.map((r) => requestCard(r, false) + (REQ_STEPS.indexOf(r.status) >= 0 && r.status !== 'completed' ? `<button class="btn sm ghost" data-cancel="${esc(r.id)}">${ic('x', 'sm')} Cancel request</button>` : '')).join('')}</div>` : '<p class="small muted">No requests yet — send one with the form.</p>';
        $$('[data-cancel]', view).forEach((b) => b.addEventListener('click', async () => {
          if (!confirm('Cancel this request?')) return;
          try { await api('/api/requests/' + b.dataset.cancel, 'PATCH', { status: 'cancelled' }); toast('Request cancelled'); organiseView(view); } catch (ex) { toast(ex.message, 'info'); }
        }));
      } catch (ex) { if (!stale(h)) $('#my-reqs', view).innerHTML = `<p class="small muted">${esc(ex.message)}</p>`; }
    }
  }

  // ---------- platform: partners directory ----------
  function vendorCard(v, admin) {
    const [label, icon] = SERVICE_META[v.type] || [v.type, 'info'];
    return `<article class="card vendor ${v.verified ? 'verified' : ''}" data-vendor="${esc(v.id)}">
      <div class="row between" style="align-items:flex-start"><div class="row" style="min-width:0"><span class="body-flag">${ic(icon)}</span><div style="min-width:0"><h3 style="margin:0">${esc(v.name)}</h3><div class="small muted">${esc(label)} · ${esc(v.city)}, ${esc(v.state)}</div></div></div>${v.verified ? `<span class="pill ok">${ic('check', 'sm')} Verified</span>` : v.demo ? '<span class="pill">Demo listing</span>' : '<span class="pill warn">Pending verification</span>'}</div>
      <p class="small" style="margin:.6rem 0 .3rem">${esc(v.services)}</p>
      <div class="small muted row wrap" style="gap:.3rem 1rem">${v.rate_card ? `<span class="row" style="gap:.3rem">${ic('shop', 'sm')} ${esc(v.rate_card)}</span>` : ''}${v.coverage ? `<span class="row" style="gap:.3rem">${ic('pin', 'sm')} ${esc(v.coverage)}</span>` : ''}${v.local ? '<span class="pill info">Near you</span>' : ''}</div>
      <div class="row wrap" style="gap:.4rem;margin-top:.6rem">${v.url ? ext(v.url, 'Website') : ''}<span class="small muted">${v.verified ? 'Contact: ' + esc(v.contact) : 'Contact via CarromHub — ' }${v.verified ? '' : `<a href="#/organise" style="color:var(--accent2)">send a request</a>`}</span></div>
      ${admin ? `<div class="row wrap" style="margin-top:.6rem;gap:.4rem"><button class="btn sm ${v.verified ? '' : 'primary'}" data-verify="${esc(v.id)}" data-to="${v.verified ? 0 : 1}">${v.verified ? 'Unverify' : ic('check', 'sm') + ' Verify'}</button><button class="btn sm ghost" data-vdel="${esc(v.id)}" style="color:var(--accent)">${ic('x', 'sm')} Remove</button>${v.contact ? `<span class="small muted">Contact: ${esc(v.contact)}</span>` : ''}</div>` : ''}
    </article>`;
  }
  const PT = { type: 'all', q: '' };
  async function partnersView(view) {
    const u = API.user;
    view.innerHTML = `
      <div class="row between wrap"><h1>Partners</h1>${shareBtn('CarromHub partners', pageUrl('#/partners'))}</div>
      <p class="muted small">Board-hire vendors, umpire panels, scoring crews, venues and equipment suppliers who work with CarromHub events. <b>Verified</b> partners have been checked by our team; demo listings are placeholders until real partners onboard.</p>
      <div class="chips" style="margin-bottom:.6rem"><button class="chip ${PT.type === 'all' ? 'on' : ''}" data-pt="all">All</button>${Object.entries(SERVICE_META).map(([k, [l]]) => `<button class="chip ${PT.type === k ? 'on' : ''}" data-pt="${k}">${l}</button>`).join('')}</div>
      <div class="filters"><input class="input grow" id="pt-q" type="search" placeholder="Search partner, city, service…" value="${esc(PT.q)}" maxlength="60"></div>
      <div id="pt-list"><div class="skeleton" style="height:120px"></div></div>
      <section class="section grid two" style="align-items:start">
        <form class="card form" id="pt-form" novalidate style="max-width:none">
          <h2>Become a partner</h2>
          <p class="small muted" style="margin:0">List your board hire, umpire panel, venue or equipment business. Listings go live after verification.</p>
          ${u ? '' : `<div class="card flat small row">${ic('login', 'sm')} <a href="#/login?next=${encodeURIComponent('#/partners')}" style="color:var(--accent2)">Sign in</a> to submit a listing.</div>`}
          <label>Business / panel name<input class="input" name="name" maxlength="80" required><span class="err"></span></label>
          <label>Type<select class="input" name="type">${Object.entries(SERVICE_META).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
          <div class="row wrap" style="align-items:start"><label style="flex:1;min-width:140px">City<input class="input" name="city" maxlength="40" required></label><label style="flex:1;min-width:140px">State<input class="input" name="state" maxlength="40" required></label></div>
          <label>Contact (phone or email)<input class="input" name="contact" maxlength="120" required><span class="err"></span></label>
          <label>Website <span class="muted" style="font-weight:400">(https://, optional)</span><input class="input" name="url" type="url" maxlength="300"></label>
          <label>Services<textarea class="input" name="services" rows="2" maxlength="300" placeholder="e.g. 12 tournament boards with stands & lights, delivery within Delhi NCR" required></textarea></label>
          <div class="row wrap" style="align-items:start"><label style="flex:1;min-width:140px">Rate card<input class="input" name="rate_card" maxlength="120" placeholder="₹600/board/day"></label><label style="flex:1;min-width:140px">Coverage<input class="input" name="coverage" maxlength="120" placeholder="Delhi NCR, Haryana"></label></div>
          <span class="err" data-for="form"></span>
          <button class="btn primary block" type="submit">${ic('handshake', 'sm')} Submit for verification</button>
        </form>
        <section class="card"><h2>How verification works</h2><ol class="small" style="padding-left:1.1rem;margin:0"><li>You submit a listing (GST / ID and references requested by email).</li><li>CarromHub checks equipment specs against the Laws (Law I) and umpire certifications with the state association.</li><li>Verified partners appear with a badge and receive organiser requests in their coverage area.</li></ol><p class="small muted" style="margin-top:.8rem">Admins verify from the console or via <code>node tools/admin.js vendors verify &lt;id&gt;</code>.</p></section>
      </section>`;
    $$('[data-pt]', view).forEach((b) => b.addEventListener('click', () => { PT.type = b.dataset.pt; partnersView(view); }));
    $('#pt-q', view).addEventListener('input', (e) => { PT.q = e.target.value; drawList(); });
    let vendors = [];
    const drawList = () => {
      const list = vendors.filter((v) => (PT.type === 'all' || v.type === PT.type) && (!PT.q || matchesQuery(`${v.name} ${v.city} ${v.state} ${v.services} ${v.coverage}`, PT.q)));
      $('#pt-list', view).innerHTML = list.length ? `<div class="grid two">${list.map((v) => vendorCard(v, false)).join('')}</div>` : `<div class="card empty">${ic('handshake')}<br>No partners match.</div>`;
    };
    const h = location.hash;
    try { vendors = (await api('/api/vendors')).vendors; } catch (ex) { if (!stale(h)) $('#pt-list', view).innerHTML = `<div class="card empty">${ic('info')}<br>${esc(ex.message)}</div>`; return; }
    if (stale(h)) return;
    drawList();
    const form = $('#pt-form', view);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!API.user) return requireLogin('#/partners');
      $$('.err', form).forEach((el) => { el.textContent = ''; });
      try {
        await api('/api/vendors', 'POST', Object.fromEntries(new FormData(form)));
        toast('Listing submitted for verification', 'check');
        partnersView(view);
      } catch (ex) { $('[data-for="form"]', form).textContent = ex.message; }
    });
  }

  // ---------- platform: organiser console (events + join approvals) ----------
  async function organiserView(view) {
    if (!API.user) return requireLogin('#/organiser');
    const u = API.user;
    if (!['organiser', 'admin'].includes(u.role)) { view.innerHTML = `<div class="card empty">${ic('trophy')}<h2>Organiser accounts only</h2><p class="muted small">Your account is a <b>${esc(u.role)}</b>. Ask an admin to switch your role to organiser to host events.</p><a class="btn" href="#/events">Browse events</a></div>`; return; }
    view.innerHTML = `
      <div class="row between wrap"><h1 class="row">${ic('trophy')} Organiser console</h1><a class="btn sm" href="#/organise">${ic('briefcase', 'sm')} Boards, umpires & quotes</a></div>
      <p class="muted small">Host matches and tournaments for your office, institute or club. Players send join requests; you approve them within the slots you set.</p>
      <section class="grid two" style="align-items:start">
        <form class="card form" id="ev-form" novalidate style="max-width:none">
          <h2>Create an event</h2>
          <label>Event name<input class="input" name="name" maxlength="80" placeholder="e.g. CEA Inter-Division Cup" required><span class="err"></span></label>
          <div class="row wrap" style="align-items:start"><label style="flex:1;min-width:150px">Type<select class="input" name="type">${['Tournament', 'League', 'Friendly match', 'Practice session'].map((t) => `<option>${t}</option>`).join('')}</select></label><label style="flex:1;min-width:150px">Format<select class="input" name="format">${['Singles', 'Doubles', 'Singles & Doubles', 'Team'].map((t) => `<option>${t}</option>`).join('')}</select></label></div>
          <label>Venue<input class="input" name="venue" maxlength="120" placeholder="Hall / club / office"></label>
          <div class="row wrap" style="align-items:start"><label style="flex:1;min-width:140px">City<input class="input" name="city" maxlength="40" value="${esc(u.city || '')}" required></label><label style="flex:1;min-width:140px">State<input class="input" name="state" maxlength="40" required></label></div>
          <div class="row wrap" style="align-items:start"><label style="flex:1;min-width:140px">Start<input class="input" name="start_date" type="date" required></label><label style="flex:1;min-width:140px">End<input class="input" name="end_date" type="date"></label></div>
          <div class="row wrap" style="align-items:start"><label style="flex:1;min-width:120px">Slots<input class="input" name="slots" inputmode="numeric" value="16" required></label><label style="flex:1;min-width:120px">Entry fee (₹)<input class="input" name="fee" inputmode="numeric" value="0"></label></div>
          <label>Description<textarea class="input" name="description" rows="3" maxlength="600" placeholder="Categories, timings, who can join, prizes…"></textarea></label>
          <span class="err" data-for="form"></span>
          <button class="btn primary block" type="submit">${ic('check', 'sm')} Publish event</button>
        </form>
        <div class="stack" id="org-events"><div class="skeleton" style="height:140px"></div></div>
      </section>`;
    const form = $('#ev-form', view);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      $$('.err', form).forEach((el) => { el.textContent = ''; });
      try { await api('/api/events', 'POST', { ...f, slots: Number(f.slots), fee: Number(f.fee || 0) }); toast('Event published — players can now request to join', 'trophy'); organiserView(view); }
      catch (ex) { $('[data-for="form"]', form).textContent = ex.message; }
    });
    const h = location.hash;
    try {
      const { events } = await api('/api/events?scope=mine');
      if (stale(h)) return;
      const box = $('#org-events', view);
      box.innerHTML = `<h2 style="margin:0">My events (${events.length})</h2>` + (events.length ? events.map((e) => `${communityEventCard(e, true)}
        <div class="card flat row between wrap" style="margin-top:-.4rem"><span class="small muted">${e.pending ? `<b style="color:var(--accent2)">${e.pending} pending request${e.pending === 1 ? '' : 's'}</b> · ` : ''}${e.approved}/${e.slots} confirmed</span><span class="row wrap" style="gap:.4rem"><a class="btn sm primary" href="#/cevent/${esc(e.id)}">${ic('users', 'sm')} Review requests</a><select class="input" data-evstatus="${esc(e.id)}" aria-label="Status">${['open', 'closed', 'completed', 'cancelled'].map((s) => `<option ${e.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></span></div>`).join('') : `<div class="card empty">${ic('trophy')}<br>No events yet — publish your first one.</div>`);
      $$('[data-evstatus]', box).forEach((s) => s.addEventListener('change', async () => { try { await api('/api/events/' + s.dataset.evstatus, 'PATCH', { status: s.value }); toast('Event ' + s.value); organiserView(view); } catch (ex) { toast(ex.message, 'info'); organiserView(view); } }));
    } catch (ex) { if (!stale(h)) $('#org-events', view).innerHTML = `<div class="card empty">${esc(ex.message)}</div>`; }
  }

  // ---------- platform: merchant console (listings, stock, orders) ----------
  const LISTING_CATS = ['Boards', 'Strikers', 'Coins', 'Powder', 'Accessories', 'Apparel', 'Other'];
  const ORDER_FLOW = ['placed', 'packed', 'shipped', 'delivered'];
  function orderCard(o, selling) {
    const idx = ORDER_FLOW.indexOf(o.status);
    const next = ORDER_FLOW[idx + 1];
    return `<article class="card" data-order="${esc(o.id)}">
      <div class="row between wrap"><span class="row"><span class="body-flag">${o.emoji}</span><div><b>${esc(o.product)}</b> × ${o.qty}<div class="small muted">${esc(o.id)} · ${new Date(o.created_at).toLocaleDateString('en-IN')} · ${esc(o.payment)}</div></div></span><span class="price">${inr(o.total)}</span></div>
      <div class="small muted" style="margin:.4rem 0">${selling ? `Buyer: <b>${esc(o.buyer)}</b> · ${esc(o.phone)}<br>${esc(o.address)}` : `Sold by <b>${esc(o.merchant)}</b> · delivering to ${esc(o.address)}`}</div>
      ${o.status === 'cancelled' ? '<span class="pill">Cancelled</span>' : `<ol class="steps">${ORDER_FLOW.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}"><span></span>${s}</li>`).join('')}</ol>`}
      <div class="row wrap" style="gap:.4rem;margin-top:.6rem">${selling && next ? `<button class="btn sm primary" data-ostatus="${next}" data-oid="${esc(o.id)}">Mark ${next}</button>` : ''}${(o.status === 'placed' || (selling && o.status === 'packed')) ? `<button class="btn sm ghost" data-ostatus="cancelled" data-oid="${esc(o.id)}" style="color:var(--accent)">Cancel order</button>` : ''}</div>
    </article>`;
  }
  function bindOrderActions(view, refresh) {
    $$('[data-ostatus]', view).forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.ostatus === 'cancelled' && !confirm('Cancel this order? Stock will be returned to the listing.')) return;
      try { await api('/api/orders/' + b.dataset.oid, 'PATCH', { status: b.dataset.ostatus }); toast('Order ' + b.dataset.ostatus); refresh(); } catch (ex) { toast(ex.message, 'info'); }
    }));
  }
  const MC = { tab: 'listings', edit: null };
  async function merchantView(view) {
    if (!API.user) return requireLogin('#/merchant');
    const u = API.user;
    if (!['merchant', 'admin'].includes(u.role)) { view.innerHTML = `<div class="card empty">${ic('shop')}<h2>Merchant accounts only</h2><p class="muted small">Your account is a <b>${esc(u.role)}</b>. Ask an admin to switch your role to merchant to sell on CarromHub.</p><a class="btn" href="#/shop">Go to shop</a></div>`; return; }
    view.innerHTML = `
      <div class="row between wrap"><h1 class="row">${ic('shop')} Merchant console</h1><a class="btn sm" href="#/shop">View marketplace ${ic('right', 'sm')}</a></div>
      <div class="tabs">${[['listings', 'Products & stock', 'shop'], ['orders', 'Orders', 'truck']].map(([k, v, i]) => `<button class="tab ${MC.tab === k ? 'on' : ''}" data-mct="${k}">${ic(i, 'sm')} ${v}</button>`).join('')}</div>
      <div id="mc-body"><div class="skeleton" style="height:140px"></div></div>`;
    $$('[data-mct]', view).forEach((b) => b.addEventListener('click', () => { MC.tab = b.dataset.mct; MC.edit = null; merchantView(view); }));
    const body = $('#mc-body', view);
    const h = location.hash;
    try {
      if (MC.tab === 'listings') {
        const { listings } = await api('/api/listings?scope=mine');
        if (stale(h)) return;
        const ed = MC.edit ? listings.find((l) => l.id === MC.edit) : null;
        body.innerHTML = `<section class="grid two" style="align-items:start">
          <form class="card form" id="lst-form" novalidate style="max-width:none">
            <h2>${ed ? 'Edit product' : 'Add a product'}</h2>
            <label>Product name<input class="input" name="name" maxlength="80" value="${esc(ed ? ed.name : '')}" required><span class="err"></span></label>
            <div class="row wrap" style="align-items:start"><label style="flex:1;min-width:140px">Category<select class="input" name="category" ${ed ? 'disabled' : ''}>${LISTING_CATS.map((c) => `<option ${ed && ed.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label style="flex:1;min-width:120px">Stock<input class="input" name="stock" inputmode="numeric" value="${ed ? ed.stock : 10}" required></label></div>
            <div class="row wrap" style="align-items:start"><label style="flex:1;min-width:120px">Price (₹)<input class="input" name="price" inputmode="numeric" value="${ed ? ed.price : ''}" required></label><label style="flex:1;min-width:120px">MRP (₹)<input class="input" name="mrp" inputmode="numeric" value="${ed ? ed.mrp : ''}" placeholder="optional"></label></div>
            <label>Specs <span class="muted" style="font-weight:400">(comma-separated)</span><input class="input" name="specs" maxlength="300" value="${esc(ed ? ed.specs : '')}" placeholder="4.13 cm, 15 g, polymer"></label>
            <label>Description<textarea class="input" name="description" rows="3" maxlength="600">${esc(ed ? ed.description : '')}</textarea></label>
            <span class="err" data-for="form"></span>
            <div class="row"><button class="btn primary" type="submit">${ic('check', 'sm')} ${ed ? 'Save changes' : 'Publish listing'}</button>${ed ? '<button class="btn ghost" type="button" id="lst-cancel">Cancel</button>' : ''}</div>
          </form>
          <div class="stack"><h2 style="margin:0">My products (${listings.length})</h2>${listings.length ? listings.map((l) => `<article class="card ${l.active ? '' : 'pending'}" style="${l.active ? '' : 'opacity:.7'}">
            <div class="row between wrap"><span class="row"><span class="body-flag">${l.emoji}</span><div><b>${esc(l.name)}</b><div class="small muted">${esc(l.category)} · ${esc(l.id)}</div></div></span><span><span class="price">${inr(l.price)}</span>${l.mrp > l.price ? `<span class="mrp">${inr(l.mrp)}</span>` : ''}</span></div>
            <div class="row between wrap" style="margin-top:.6rem;gap:.4rem">
              <span class="row" style="gap:.3rem"><span class="small muted">Stock</span><span class="qty"><button data-stock="-1" data-lid="${esc(l.id)}" aria-label="Decrease stock">−</button><b style="color:${l.stock === 0 ? 'var(--accent)' : l.stock < 5 ? 'var(--accent2)' : 'inherit'}">${l.stock}</b><button data-stock="1" data-lid="${esc(l.id)}" aria-label="Increase stock">+</button></span><button class="btn sm ghost" data-stock="10" data-lid="${esc(l.id)}">+10</button></span>
              <span class="row" style="gap:.4rem"><button class="btn sm" data-ledit="${esc(l.id)}">${ic('edit', 'sm')} Edit</button><button class="btn sm ${l.active ? 'ghost' : 'primary'}" data-lactive="${l.active ? 0 : 1}" data-lid="${esc(l.id)}">${l.active ? 'Unlist' : 'Relist'}</button></span>
            </div></article>`).join('') : `<div class="card empty">${ic('shop')}<br>No products yet — add your first listing.</div>`}</div>
        </section>`;
        const form = $('#lst-form', body);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = Object.fromEntries(new FormData(form));
          const payload = { ...f, price: Number(f.price), mrp: f.mrp ? Number(f.mrp) : undefined, stock: Number(f.stock) };
          if (payload.mrp === undefined) delete payload.mrp;
          try { if (ed) { delete payload.category; await api('/api/listings/' + ed.id, 'PATCH', payload); toast('Listing updated'); } else { await api('/api/listings', 'POST', payload); toast('Listing published', 'shop'); } MC.edit = null; merchantView(view); }
          catch (ex) { $('[data-for="form"]', form).textContent = ex.message; }
        });
        const cancel = $('#lst-cancel', body); if (cancel) cancel.addEventListener('click', () => { MC.edit = null; merchantView(view); });
        $$('[data-ledit]', body).forEach((b) => b.addEventListener('click', () => { MC.edit = b.dataset.ledit; merchantView(view); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
        $$('[data-stock]', body).forEach((b) => b.addEventListener('click', async () => { try { await api('/api/listings/' + b.dataset.lid, 'PATCH', { stock_delta: Number(b.dataset.stock) }); merchantView(view); } catch (ex) { toast(ex.message, 'info'); } }));
        $$('[data-lactive]', body).forEach((b) => b.addEventListener('click', async () => { try { await api('/api/listings/' + b.dataset.lid, 'PATCH', { active: b.dataset.lactive === '1' }); toast(b.dataset.lactive === '1' ? 'Listing is live' : 'Listing hidden from the shop'); merchantView(view); } catch (ex) { toast(ex.message, 'info'); } }));
      } else {
        const { orders } = await api('/api/orders');
        if (stale(h)) return;
        const mine = orders.filter((o) => o.selling || u.role === 'admin');
        body.innerHTML = mine.length ? `<div class="kpi" style="margin-bottom:1rem">${ORDER_FLOW.concat('cancelled').map((s) => `<div><b>${mine.filter((o) => o.status === s).length}</b><span class="small muted">${s}</span></div>`).join('')}<div><b>${inr(mine.filter((o) => o.status !== 'cancelled').reduce((a, o) => a + o.total, 0))}</b><span class="small muted">Sales</span></div></div><div class="grid two">${mine.map((o) => orderCard(o, true)).join('')}</div>` : `<div class="card empty">${ic('truck')}<br>No orders yet. Orders appear here as soon as a buyer checks out one of your listings.</div>`;
        bindOrderActions(body, () => merchantView(view));
      }
    } catch (ex) { if (!stale(h)) body.innerHTML = `<div class="card empty">${esc(ex.message)}</div>`; }
  }

  // ---------- platform: marketplace (merchant listings in the shop) ----------
  function listingCard(l) {
    const off = l.mrp > l.price ? Math.round((1 - l.price / l.mrp) * 100) : 0;
    return `<div class="card product" data-cat="${esc(l.category)}">
      <div class="thumb">${off ? `<span class="off">−${off}%</span>` : ''}${l.emoji}</div><h3>${esc(l.name)}</h3>
      <div class="small muted">${esc(l.merchant_org || l.merchant)} <span class="pill info">Merchant</span></div>
      ${l.specs ? `<div class="small muted" style="margin:.3rem 0">${esc(l.specs)}</div>` : ''}
      <div class="row between" style="margin-top:.4rem"><div><span class="price">${inr(l.price)}</span>${off ? `<span class="mrp">${inr(l.mrp)}</span>` : ''}<div class="small ${l.stock < 5 ? '' : 'muted'}" style="${l.stock < 5 ? 'color:var(--accent2)' : ''}">${l.stock ? (l.stock < 5 ? `Only ${l.stock} left` : 'In stock') : 'Out of stock'}</div></div>
      <button class="btn sm primary" data-buy="${esc(l.id)}" ${l.stock ? '' : 'disabled'}>${ic('cart', 'sm')} Buy</button></div>
    </div>`;
  }
  function buySheet(l, onDone) {
    $$('.share-sheet').forEach((s) => s.remove());
    const el = document.createElement('div');
    el.className = 'share-sheet';
    const u = API.user;
    el.innerHTML = `<form class="share-box card form" id="buy-form" novalidate style="max-width:none" role="dialog" aria-label="Buy">
      <div class="row between"><b class="row"><span class="body-flag">${l.emoji}</span>${esc(l.name)}</b><button class="btn sm icon ghost" type="button" data-close aria-label="Close">${ic('x', 'sm')}</button></div>
      <div class="small muted">Sold by ${esc(l.merchant_org || l.merchant)} · ${inr(l.price)} each · ${l.stock} in stock</div>
      <div class="row wrap" style="align-items:start"><label style="flex:1;min-width:100px">Quantity<input class="input" name="qty" inputmode="numeric" value="1" min="1" max="${Math.min(20, l.stock)}" required></label><label style="flex:2;min-width:160px">Name<input class="input" name="name" value="${esc(u.name)}" maxlength="60" required></label></div>
      <label>Mobile<input class="input" name="phone" inputmode="numeric" maxlength="10" required></label>
      <label>Delivery address<textarea class="input" name="address" rows="2" maxlength="300" required></textarea></label>
      <label>Payment<select class="input" name="payment"><option>UPI</option><option>Card</option><option>Cash on delivery</option></select></label>
      <span class="err"></span>
      <button class="btn primary block" type="submit" id="buy-submit">Place order · ${inr(l.price)}</button>
      <p class="small muted" style="margin:0">Demo: payment gateway plugs in here — the order is recorded and stock reserved immediately.</p>
    </form>`;
    document.body.appendChild(el);
    const form = $('#buy-form', el);
    form.elements.qty.addEventListener('input', () => { $('#buy-submit', el).textContent = `Place order · ${inr(l.price * Math.max(1, Number(form.elements.qty.value) || 1))}`; });
    el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) el.remove(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      try { const o = await api('/api/orders', 'POST', { listing_id: l.id, qty: Number(f.qty), name: f.name, phone: f.phone, address: f.address, payment: f.payment }); el.remove(); toast(`Order ${o.id} placed`, 'check'); onDone(); }
      catch (ex) { $('.err', form).textContent = ex.message; }
    });
  }
  async function marketplaceSection(view) {
    const box = $('#marketplace', view);
    if (!box || !API.ok) return;
    const h = location.hash;
    try {
      const { listings } = await api('/api/listings');
      if (stale(h)) return;
      box.innerHTML = `<div class="section-h"><h2 class="row">${ic('shop')} Marketplace <span class="pill info">live</span></h2>${API.user && ['merchant', 'admin'].includes(API.user.role) ? `<a href="#/merchant">Merchant console ${ic('right', 'sm')}</a>` : `<span class="small muted">Sold by registered merchants</span>`}</div>
        ${listings.length ? `<div class="grid">${listings.map(listingCard).join('')}</div>` : `<div class="card empty">${ic('shop')}<br>No merchant listings yet. <a href="#/login?next=${encodeURIComponent('#/merchant')}" style="color:var(--accent2)">Sign up as a merchant</a> to sell boards, strikers and accessories here.</div>`}`;
      $$('[data-buy]', box).forEach((b) => b.addEventListener('click', () => {
        if (!API.user) return requireLogin('#/shop');
        const l = listings.find((x) => x.id === b.dataset.buy);
        buySheet(l, () => marketplaceSection(view));
      }));
    } catch (ex) { if (!stale(h)) box.innerHTML = `<div class="card empty">${esc(ex.message)}</div>`; }
  }

  // Signed-in activity on My account: join requests and marketplace orders (buying or selling).
  async function platformActivity(view) {
    const box = $('#plat-activity', view);
    if (!box) return;
    const h = location.hash;
    try {
      const [{ joins }, { orders }] = await Promise.all([api('/api/joins'), api('/api/orders')]);
      if (stale(h)) return;
      const selling = orders.filter((o) => o.selling), buying = orders.filter((o) => !o.selling);
      box.innerHTML = `
        <section class="section"><div class="section-h"><h2>My join requests</h2><a href="#/events">Find events ${ic('right', 'sm')}</a></div>
          ${joins.length ? `<div class="grid">${joins.map((j) => `<a class="card link" href="#/cevent/${esc(j.event_id)}"><div class="row between"><b>${esc(j.event_name)}</b><span class="pill ${j.status === 'approved' ? 'ok' : j.status === 'pending' ? 'warn' : ''}">${esc(j.status)}</span></div><div class="small muted">${fdate(j.start_date)} · ${esc(j.city)} · ${esc(j.format)} · by ${esc(j.organiser)}</div></a>`).join('')}</div>` : `<div class="card empty">${ic('trophy')}<br>No join requests yet. Browse <a href="#/events" style="color:var(--accent2)">community events</a> and ask to join.</div>`}</section>
        ${buying.length ? `<section class="section"><h2>Marketplace orders</h2><div class="grid two">${buying.map((o) => orderCard(o, false)).join('')}</div></section>` : ''}
        ${selling.length ? `<section class="section"><div class="section-h"><h2>Orders to fulfil</h2><a href="#/merchant">Merchant console ${ic('right', 'sm')}</a></div><div class="grid two">${selling.slice(0, 4).map((o) => orderCard(o, true)).join('')}</div></section>` : ''}`;
      bindOrderActions(box, () => platformActivity(view));
    } catch (ex) { if (!stale(h)) box.innerHTML = `<p class="small muted">${esc(ex.message)}</p>`; }
  }

  // ---------- platform: admin console ----------
  const AD = { tab: 'requests' };
  async function adminView(view) {
    if (!API.user) return requireLogin('#/admin');
    if (API.user.role !== 'admin') { view.innerHTML = `<div class="card empty">${ic('shield')}<h2>Admin only</h2><p class="muted small">Your account (${esc(API.user.role)}) can’t open the console. The first account on a fresh install is the admin; admins can promote others.</p><a class="btn" href="#/">Go home</a></div>`; return; }
    const tabs = [['requests', 'Requests'], ['vendors', 'Partners'], ['content', 'Content'], ['users', 'Users']];
    view.innerHTML = `
      <div class="row between wrap"><h1 class="row">${ic('shield')} Admin console</h1><span class="small muted">Signed in as ${esc(API.user.name)}</span></div>
      <div class="tabs">${tabs.map(([k, v]) => `<button class="tab ${AD.tab === k ? 'on' : ''}" data-at="${k}">${v}</button>`).join('')}</div>
      <div id="ad-body"><div class="skeleton" style="height:140px"></div></div>`;
    $$('[data-at]', view).forEach((b) => b.addEventListener('click', () => { AD.tab = b.dataset.at; adminView(view); }));
    const body = $('#ad-body', view);
    const h = location.hash;
    try {
      if (AD.tab === 'requests') {
        const [{ requests }, { vendors }] = await Promise.all([api('/api/requests'), api('/api/vendors')]);
        if (stale(h)) return;
        body.innerHTML = requests.length ? `<div class="kpi" style="margin-bottom:1rem">${['received', 'matching', 'quoted', 'confirmed', 'completed', 'cancelled'].map((s) => `<div><b>${requests.filter((r) => r.status === s).length}</b><span class="small muted">${s}</span></div>`).join('')}</div><div class="stack">${requests.map((r) => `${requestCard(r, true)}
          <form class="card flat form" data-rid="${esc(r.id)}" style="max-width:none;margin-top:-.3rem">
            <div class="row wrap" style="align-items:start">
              <label style="flex:1;min-width:150px">Status<select class="input" name="status">${['received', 'matching', 'quoted', 'confirmed', 'completed', 'cancelled'].map((s) => `<option ${r.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
              <label style="flex:2;min-width:200px">Note to organiser<input class="input" name="admin_note" maxlength="500" value="${esc(r.admin_note)}" placeholder="e.g. Matched 2 umpire panels; quotes by Friday"></label>
            </div>
            <div class="small" style="font-weight:600">Assign partners</div>
            <div class="row wrap" style="gap:.4rem">${vendors.filter((v) => r.services.includes(v.type)).map((v) => `<label class="chip" style="display:inline-flex;gap:.35rem;align-items:center"><input type="checkbox" name="vendor_ids" value="${esc(v.id)}" ${r.vendor_ids.includes(v.id) ? 'checked' : ''} style="accent-color:var(--accent)">${esc(v.name)} <span class="muted">· ${esc(v.city)}</span></label>`).join('') || '<span class="small muted">No partners offer these services yet.</span>'}</div>
            <div class="row"><button class="btn sm primary" type="submit">Save</button><span class="err"></span></div>
          </form>`).join('')}</div>` : `<div class="card empty">${ic('briefcase')}<br>No organiser requests yet.</div>`;
        $$('form[data-rid]', body).forEach((f) => f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(f);
          try { await api('/api/requests/' + f.dataset.rid, 'PATCH', { status: fd.get('status'), admin_note: fd.get('admin_note'), vendor_ids: fd.getAll('vendor_ids') }); toast('Request updated'); adminView(view); } catch (ex) { $('.err', f).textContent = ex.message; }
        }));
      } else if (AD.tab === 'vendors') {
        const { vendors } = await api('/api/vendors');
        if (stale(h)) return;
        body.innerHTML = `<p class="small muted">${vendors.filter((v) => v.verified).length} verified · ${vendors.filter((v) => !v.verified && !v.demo).length} pending · ${vendors.filter((v) => v.demo).length} demo</p><div class="grid two">${vendors.map((v) => vendorCard(v, true)).join('')}</div>`;
        $$('[data-verify]', body).forEach((b) => b.addEventListener('click', async () => { try { await api('/api/vendors/' + b.dataset.verify, 'PATCH', { verified: Number(b.dataset.to) }); toast(b.dataset.to === '1' ? 'Partner verified' : 'Verification removed'); adminView(view); } catch (ex) { toast(ex.message, 'info'); } }));
        $$('[data-vdel]', body).forEach((b) => b.addEventListener('click', async () => { if (!confirm('Remove this partner listing?')) return; try { await api('/api/vendors/' + b.dataset.vdel, 'PATCH', { delete: true }); toast('Listing removed'); adminView(view); } catch (ex) { toast(ex.message, 'info'); } }));
      } else if (AD.tab === 'content') {
        const content = await api('/api/content');
        if (stale(h)) return;
        body.innerHTML = `
          <section class="card" style="margin-bottom:1rem"><h2>AI / scripted updates</h2><p class="small muted">Everything here is plain JSON, so an assistant can draft it and push it three ways: edit below · <code>node tools/admin.js content import file.json</code> · <code>PUT /api/content/&lt;key&gt;</code> with header <code>X-Admin-Key</code> (${API.features.adminKey ? 'configured' : 'set <code>ADMIN_KEY</code> in the environment to enable'}).</p><div class="row wrap"><button class="btn sm" id="ct-export">${ic('download', 'sm')} Export JSON</button><label class="btn sm">${ic('up', 'sm')} Import JSON<input type="file" id="ct-import" accept="application/json" hidden></label></div></section>
          <div class="stack">${Object.entries(content).map(([k, v]) => `<form class="card form" data-key="${esc(k)}" style="max-width:none"><div class="row between wrap"><h3 style="margin:0"><code>${esc(k)}</code></h3><span class="small muted">updated ${new Date(v.updated_at).toLocaleString('en-IN')} by ${esc(v.updated_by)}</span></div><textarea class="input" name="value" rows="6" style="font-family:ui-monospace,monospace;font-size:.8rem">${esc(JSON.stringify(v.value, null, 2))}</textarea><div class="row"><button class="btn sm primary" type="submit">Save</button><button class="btn sm ghost" type="button" data-ctdel="${esc(k)}" style="color:var(--accent)">Delete</button><span class="err"></span></div></form>`).join('')}
          <form class="card form" id="ct-new" style="max-width:none"><h3 style="margin:0">Add content key</h3><div class="row wrap" style="align-items:start"><label style="flex:1;min-width:160px">Key<input class="input" name="key" placeholder="e.g. home_notice" pattern="[a-z][a-z0-9_]{1,40}" required></label><label style="flex:2;min-width:200px">JSON value<input class="input" name="value" placeholder='{"text":"…"}' required></label></div><div class="row"><button class="btn sm" type="submit">Add</button><span class="err"></span></div></form></div>`;
        const save = async (key, raw, errEl) => { try { await api('/api/content/' + encodeURIComponent(key), 'PUT', { value: JSON.parse(raw) }); toast('Saved ' + key); await loadSession(); adminView(view); } catch (ex) { errEl.textContent = ex instanceof SyntaxError ? 'Invalid JSON: ' + ex.message : ex.message; } };
        $$('form[data-key]', body).forEach((f) => f.addEventListener('submit', (e) => { e.preventDefault(); save(f.dataset.key, f.elements.value.value, $('.err', f)); }));
        $$('[data-ctdel]', body).forEach((b) => b.addEventListener('click', async () => { if (!confirm(`Delete content "${b.dataset.ctdel}"?`)) return; await api('/api/content/' + encodeURIComponent(b.dataset.ctdel), 'DELETE'); toast('Deleted'); await loadSession(); adminView(view); }));
        $('#ct-new', body).addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; save(f.elements.key.value.trim(), f.elements.value.value, $('.err', f)); });
        $('#ct-export', body).addEventListener('click', () => { const blob = new Blob([JSON.stringify(Object.fromEntries(Object.entries(content).map(([k, v]) => [k, v.value])), null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'carromhub-content.json'; a.click(); URL.revokeObjectURL(a.href); });
        $('#ct-import', body).addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; try { const data = JSON.parse(await file.text()); for (const [k, v] of Object.entries(data)) await api('/api/content/' + encodeURIComponent(k), 'PUT', { value: v }); toast(`Imported ${Object.keys(data).length} key(s)`); await loadSession(); adminView(view); } catch (ex) { toast('Import failed: ' + ex.message, 'info'); } });
      } else {
        const { users } = await api('/api/users');
        if (stale(h)) return;
        body.innerHTML = `<div class="card" style="padding:.4rem;overflow-x:auto"><table><thead><tr><th>User</th><th>Phone</th><th>Org · City</th><th>Joined</th><th>Role</th></tr></thead><tbody>${users.map((x) => `<tr><td><span class="row">${avatar({ name: x.name, star: x.role === 'admin' })}<b>${esc(x.name)}</b></span></td><td class="small">${esc(x.phone)}</td><td class="small muted">${esc(x.org || '—')}${x.city ? ' · ' + esc(x.city) : ''}</td><td class="small muted">${new Date(x.since).toLocaleDateString('en-IN')}</td><td><select class="input" data-role="${esc(x.id)}" ${x.id === API.user.id ? 'disabled' : ''}>${['player', 'organiser', 'merchant', 'admin'].map((r) => `<option ${x.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>`;
        $$('[data-role]', body).forEach((s) => s.addEventListener('change', async () => { try { await api('/api/users/' + s.dataset.role, 'PATCH', { role: s.value }); toast('Role updated'); } catch (ex) { toast(ex.message, 'info'); adminView(view); } }));
      }
    } catch (ex) { if (!stale(h)) body.innerHTML = `<div class="card empty">${ic('info')}<br>${esc(ex.message)}</div>`; }
  }

  // ---------- router ----------
  const routes = [
    [/^$/, home, 'home'], [/^live$/, live, 'live'], [/^match\/(\w+)$/, matchView, 'live'],
    [/^events$/, events, 'events'], [/^event\/(\w+)$/, eventView, 'events'], [/^register\/(\w+)$/, registerView, 'events'],
    [/^players$/, players, 'players'], [/^player\/(\w+)$/, playerView, 'players'], [/^compare$/, compareView, 'players'],
    [/^clubs$/, clubs, 'clubs'], [/^club\/(\w+)\/edit$/, (v, id) => (myClub(id) ? clubForm(v, myClub(id)) : notFound(v)), 'clubs'], [/^club\/(\w+)$/, clubView, 'clubs'], [/^bodies$/, bodies, 'bodies'],
    [/^rules$/, rules, 'rules'], [/^learn$/, learn, 'learn'], [/^lesson\/(\w+)$/, lessonView, 'learn'], [/^quiz$/, quiz, 'learn'],
    [/^shop$/, shop, 'shop'], [/^product\/(\w+)$/, productView, 'shop'], [/^cart$/, cart, 'shop'],
    [/^scorer$/, scorer, 'more'], [/^more$/, more, 'more'], [/^me$/, me, 'more'], [/^search$/, searchView, 'more'],
    [/^login$/, loginView, 'more'], [/^organise$/, organiseView, 'organise'], [/^partners$/, partnersView, 'organise'], [/^admin$/, adminView, 'more'],
    [/^organiser$/, organiserView, 'events'], [/^merchant$/, merchantView, 'shop'], [/^cevent\/([\w-]+)$/, communityEventView, 'events']
  ];
  let current = null;
  function render(keepScroll) {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    const view = $('#view');
    view.classList.toggle('enter', !keepScroll);
    hideSug();
    current = null;
    for (const [re, fn, nav] of routes) {
      const m = path.match(re);
      if (m) { current = { fn, path, nav }; fn(view, m[1], new URLSearchParams(qs || '')); break; }
    }
    if (!current) notFound(view);
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', current && a.dataset.nav === current.nav));
    if (!keepScroll && !(new URLSearchParams(qs || '').get('id'))) window.scrollTo(0, 0);
  }

  // ---------- global events ----------
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) {
      e.preventDefault();
      const id = act.dataset.id;
      if (act.dataset.act === 'save-rule') {
        const on = toggleIn(S.saved, id);
        act.classList.toggle('on', on);
        act.setAttribute('aria-pressed', on);
        act.closest('.rule').classList.toggle('saved', on);
        toast(on ? 'Law saved' : 'Removed from saved', 'star');
      } else if (act.dataset.act === 'copy-rule') {
        share(`Law ${id} — ${ruleById(id).title}`, pageUrl('#/rules?id=' + id));
      } else if (act.dataset.act === 'share') {
        share(act.dataset.title, act.dataset.url || location.href);
      } else if (act.dataset.act === 'follow') {
        const on = toggleIn(S.follows, id);
        act.textContent = on ? 'Following' : 'Follow';
        act.classList.toggle('on', on);
        act.classList.toggle('primary', !on && act.classList.contains('btn') && !act.classList.contains('sm'));
        toast(on ? 'You will get live alerts for this player' : 'Unfollowed', 'bell');
      } else if (act.dataset.act === 'add-cart') {
        addToCart(id);
      }
      return;
    }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('button')) location.hash = row.dataset.href;
    if (!e.target.closest('#gsearch')) hideSug();
  });

  // ---------- theme ----------
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('#theme-btn use').setAttribute('href', t === 'dark' ? '#i-moon' : '#i-sun');
    $('meta[name="theme-color"]').content = t === 'dark' ? '#0c0e13' : '#fbf9f5';
  }
  function toggleTheme() {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    store.set('theme', t);
    applyTheme(t);
  }
  applyTheme(store.get('theme', null) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  $('#theme-btn').addEventListener('click', toggleTheme);

  // ---------- global search with suggestions ----------
  let sugSel = -1;
  const sugBox = $('#gsearch-sug'), sugInput = $('#gsearch-q');
  const sugIndex = () => [
    ...D.players.map((p) => ({ g: 'Players', t: p.name, s: `#${p.rank} ${p.cat}`, h: '#/player/' + p.id, i: 'user', k: `${p.name} ${p.state} ${club(p.club).name}` })),
    ...D.tournaments.map((t) => ({ g: 'Tournaments', t: t.name, s: t.city, h: '#/event/' + t.id, i: 'trophy', k: `${t.name} ${t.city} ${t.venue} ${t.level}` })),
    ...D.clubs.map((c) => ({ g: 'Clubs', t: c.name, s: c.city, h: '#/club/' + c.id, i: 'club', k: `${c.name} ${c.city}` })),
    ...S.myClubs.map((c) => ({ g: 'My clubs', t: c.name, s: c.type, h: '#/club/' + c.id, i: 'users', k: `${c.name} ${c.city} ${c.type} ${c.members.map((m) => m.name).join(' ')}` })),
    ...BODIES.map((b) => ({ g: 'Federations', t: b.name, s: b.place, h: '#/bodies', i: 'globe', k: `${b.name} ${b.short} ${b.place} federation association` })),
    ...uniq(championsData().flatMap((e) => Object.entries(e.events || {}).filter(([k]) => k === 'ms' || k === 'ws').map(([, ws]) => ws[0] && ws[0].name)).filter(Boolean)).map((n) => ({ g: 'World champions', t: n, s: 'World title', h: '#/players?tab=champions', i: 'crown', k: `${n} champion winner world` })),
    ...RULES.map((r) => ({ g: 'Laws', t: r.title, s: r.id, h: '#/rules?id=' + r.id, i: 'book', k: `${r.id} ${r.title} ${r.text}` })),
    ...(shopLocked() && !shopPreview() ? [] : D.products.map((p) => ({ g: 'Shop', t: p.name, s: inr(p.price), h: '#/product/' + p.id, i: 'shop', k: `${p.name} ${p.cat}` })))
  ];
  function hideSug() { sugBox.hidden = true; sugInput.setAttribute('aria-expanded', 'false'); sugSel = -1; }
  function showSug(q) {
    if (q.length < 2) return hideSug();
    SUG = SUG || sugIndex();
    const groups = {};
    SUG.filter((x) => matchesQuery(x.k, q)).forEach((x) => { (groups[x.g] = groups[x.g] || []).length < 3 && groups[x.g].push(x); });
    const any = Object.keys(groups).length;
    sugSel = -1;
    sugBox.innerHTML = Object.entries(groups).map(([g, xs]) => `<div class="grp">${g}</div>` + xs.map((x) => `<a href="${esc(x.h)}" role="option">${ic(x.i)}<span>${hl(x.t, q)}</span><small>${esc(x.s)}</small></a>`).join('')).join('')
      + `<a class="all" href="#/search?q=${encodeURIComponent(q)}" role="option">${any ? `All results for “${esc(q)}”` : `No quick matches — search “${esc(q)}”`}</a>`;
    sugBox.hidden = false;
    sugInput.setAttribute('aria-expanded', 'true');
  }
  let sugTimer;
  sugInput.addEventListener('input', () => { clearTimeout(sugTimer); sugTimer = setTimeout(() => showSug(sugInput.value.trim()), 120); });
  sugInput.addEventListener('focus', () => { if (sugInput.value.trim().length >= 2) showSug(sugInput.value.trim()); });
  sugInput.addEventListener('keydown', (e) => {
    const opts = $$('a', sugBox);
    if (sugBox.hidden || !opts.length) { if (e.key === 'Escape') sugInput.blur(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sugSel = (sugSel + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => o.classList.toggle('on', i === sugSel));
      opts[sugSel].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && sugSel >= 0) {
      e.preventDefault();
      location.hash = opts[sugSel].getAttribute('href');
      sugInput.blur();
    } else if (e.key === 'Escape') {
      hideSug();
    }
  });
  $('#gsearch').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = sugInput.value.trim();
    hideSug();
    if (q) location.hash = '#/search?q=' + encodeURIComponent(q);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); sugInput.focus(); sugInput.select(); }
  });

  // ---------- back to top ----------
  const totop = $('#totop');
  window.addEventListener('scroll', () => { totop.hidden = window.scrollY < 600; }, { passive: true });
  totop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  // ---------- live score simulation (stands in for the WebSocket feed) ----------
  function updateTicker() {
    const live = D.matches.filter((m) => m.status === 'live');
    const items = live.map((m) => {
      const [g1, g2] = gamesWon(m);
      return `<a href="#/match/${esc(m.id)}"><span class="live-dot"></span>${esc(player(m.p1).name)} <b>${m.cur[0]}–${m.cur[1]}</b> ${esc(player(m.p2).name)} <span class="muted">(G ${g1}-${g2}, B${m.board})</span></a>`;
    });
    $('#ticker').innerHTML = items.length ? `<div class="ticker-inner">${items.join('')}</div>` : '';
    $$('[data-live-dot]').forEach((d) => { d.hidden = !live.length; });
  }
  function tick() {
    D.matches.forEach((m) => { m.flash = false; });
    const live = D.matches.filter((m) => m.status === 'live');
    if (!live.length) return;
    const m = live[Math.floor(Math.random() * live.length)];
    const w = Math.random() < 0.5 ? 0 : 1;
    const coins = 1 + Math.floor(Math.random() * 6);
    const queen = m.cur[w] <= 21 && Math.random() < 0.4;
    const pts = Math.min(coins + (queen ? 3 : 0), 25 - m.cur[w]);
    m.cur[w] += pts;
    m.log = m.log || [];
    m.log.push(`G${m.games.length + 1} B${m.board}: ${player(w ? m.p2 : m.p1).name} wins board +${pts}${queen ? ' (Queen covered)' : ''}`);
    m.board++;
    m.flash = true;
    if (m.cur[w] >= 25 || (m.board > 8 && m.cur[0] !== m.cur[1])) {
      m.games.push([...m.cur]);
      const gw = player(m.cur[0] > m.cur[1] ? m.p1 : m.p2);
      m.log.push(`Game ${m.games.length} to ${gw.name} ${m.cur[0]}–${m.cur[1]}`);
      m.cur = [0, 0];
      m.board = 1;
      const [a, b] = gamesWon(m);
      if (a === 2 || b === 2) {
        m.status = 'finished';
        const winner = player(a === 2 ? m.p1 : m.p2);
        if (S.follows.has(winner.id)) toast(`${winner.name} won the match!`, 'trophy');
      } else if (S.follows.has(gw.id)) {
        toast(`${gw.name} takes game ${m.games.length}`, 'zap');
      }
    }
    updateTicker();
    const active = document.activeElement;
    const typing = active && /INPUT|SELECT|TEXTAREA/.test(active.tagName) && $('#view').contains(active);
    const watching = current && (['home', 'live'].includes(current.nav) || current.path === 'match/' + m.id);
    if (watching && !typing) render(true);
  }

  window.addEventListener('hashchange', () => render(false));
  updateCartBadge();
  updateTicker();
  loadSession().finally(() => render(false));
  setInterval(tick, 6000);
})();
