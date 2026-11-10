const { DatabaseSync } = require('node:sqlite');
const { readFileSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { randomUUID } = require('node:crypto');

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function createDatabase(filename = join(process.env.DATA_DIR || join(__dirname, 'data'), 'carrom.sqlite')) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      state TEXT NOT NULL, city TEXT NOT NULL, club_id TEXT NOT NULL,
      style TEXT NOT NULL, accepting INTEGER NOT NULL DEFAULT 1 CHECK(accepting IN (0,1)),
      details TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('player','organizer')),
      player_id TEXT REFERENCES players(id)
    );
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, categories TEXT NOT NULL,
      prize INTEGER NOT NULL, organizer_id TEXT NOT NULL REFERENCES accounts(id), end_date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
      tournament_id TEXT NOT NULL REFERENCES tournaments(id), category TEXT NOT NULL,
      placement INTEGER NOT NULL CHECK(placement BETWEEN 1 AND 256),
      winnings INTEGER NOT NULL CHECK(winnings >= 0), evidence TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','verified','rejected')),
      submitted_by TEXT NOT NULL REFERENCES accounts(id), reviewed_by TEXT REFERENCES accounts(id),
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, reviewed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS result_verified ON results(player_id,tournament_id,category) WHERE status='verified';
    CREATE UNIQUE INDEX IF NOT EXISTS result_pending ON results(player_id,tournament_id,category) WHERE status='pending';
    CREATE TABLE IF NOT EXISTS radar (
      owner_id TEXT NOT NULL REFERENCES players(id), target_id TEXT NOT NULL REFERENCES players(id),
      PRIMARY KEY(owner_id,target_id), CHECK(owner_id != target_id)
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY, sender_id TEXT NOT NULL REFERENCES players(id),
      recipient_id TEXT NOT NULL REFERENCES players(id), pair TEXT NOT NULL,
      venue_id TEXT NOT NULL, scheduled_at TEXT NOT NULL, format TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','cancelled','expired')),
      created_at TEXT NOT NULL, CHECK(sender_id != recipient_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS active_challenge ON challenges(pair) WHERE status IN ('pending','accepted');
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, entity_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      action TEXT NOT NULL, at TEXT NOT NULL
    );
    -- Platform accounts (phone + OTP), separate from the seeded demo personas above.
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('player','organiser','merchant','admin')),
      org TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS otps (
      phone TEXT PRIMARY KEY, code TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS service_requests (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      org_name TEXT NOT NULL, org_type TEXT NOT NULL, contact_name TEXT NOT NULL, phone TEXT NOT NULL,
      city TEXT NOT NULL, state TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
      players INTEGER NOT NULL, boards INTEGER NOT NULL, umpires INTEGER NOT NULL,
      services TEXT NOT NULL, budget INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('received','matching','quoted','confirmed','completed','cancelled')),
      vendor_ids TEXT NOT NULL DEFAULT '[]', admin_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('boards','umpires','scoring','venue','equipment','streaming')),
      city TEXT NOT NULL, state TEXT NOT NULL, contact TEXT NOT NULL, url TEXT NOT NULL DEFAULT '',
      services TEXT NOT NULL, rate_card TEXT NOT NULL DEFAULT '', coverage TEXT NOT NULL DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)), demo INTEGER NOT NULL DEFAULT 0 CHECK(demo IN (0,1)),
      owner_id TEXT REFERENCES users(id), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content (
      key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    -- Organiser-run events that players ask to join.
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, organiser_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, type TEXT NOT NULL, format TEXT NOT NULL, venue TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL, state TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
      slots INTEGER NOT NULL, fee INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('open','closed','completed','cancelled')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS event_joins (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), user_id TEXT NOT NULL REFERENCES users(id),
      category TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('pending','approved','declined','withdrawn')),
      created_at TEXT NOT NULL, decided_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS join_active ON event_joins(event_id,user_id) WHERE status IN ('pending','approved');
    -- Merchant marketplace: listings with stock, and orders placed by signed-in users.
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL, category TEXT NOT NULL, price INTEGER NOT NULL CHECK(price > 0), mrp INTEGER NOT NULL CHECK(mrp >= price),
      stock INTEGER NOT NULL CHECK(stock >= 0), description TEXT NOT NULL DEFAULT '', specs TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id), merchant_id TEXT NOT NULL REFERENCES users(id),
      buyer_id TEXT NOT NULL REFERENCES users(id), qty INTEGER NOT NULL CHECK(qty > 0), unit_price INTEGER NOT NULL, total INTEGER NOT NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, payment TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('placed','packed','shipped','delivered','cancelled')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  // Migrate pre-0.4 databases: vendor -> merchant, umpire -> player (umpire panels live under Partners).
  const usersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get()?.sql || '';
  if (!usersSql.includes("'merchant'")) {
    db.exec(`PRAGMA foreign_keys = OFF;
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('player','organiser','merchant','admin')),
        org TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_login TEXT
      );
      INSERT INTO users_new SELECT id, phone, name, CASE role WHEN 'vendor' THEN 'merchant' WHEN 'umpire' THEN 'player' ELSE role END, org, city, created_at, last_login FROM users;
      DROP TABLE users; ALTER TABLE users_new RENAME TO users;
      PRAGMA foreign_keys = ON;`);
  }
  const sandbox = {};
  sandbox.window = sandbox;
  runInNewContext(readFileSync(join(__dirname, 'js/data/mock.js'), 'utf8'), sandbox);
  const seed = sandbox.DATA;
  const account = (id) => db.prepare('SELECT * FROM accounts WHERE id=?').get(id) || fail('Choose a demo account.', 401);
  const player = (id) => db.prepare('SELECT * FROM players WHERE id=?').get(id) || fail('Player not found.', 404);
  const tournament = (id) => db.prepare('SELECT * FROM tournaments WHERE id=?').get(id) || fail('Tournament not found.', 404);
  const log = (entity, actor, action) => db.prepare('INSERT INTO audit(entity_id,actor_id,action,at) VALUES(?,?,?,?)').run(entity, actor, action, new Date().toISOString());
  const transaction = (work) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const output = work();
      db.exec('COMMIT');
      return output;
    } catch (error) {
      db.exec('ROLLBACK');
      if (error.code?.startsWith('ERR_SQLITE') && /UNIQUE/.test(error.message)) fail('An active record already exists. Review it before submitting another.', 409);
      throw error;
    }
  };
  if (!db.prepare('SELECT count(*) AS count FROM players').get().count) transaction(() => {
    for (const entry of seed.players) {
      const club = seed.clubs.find((item) => item.id === entry.club);
      db.prepare('INSERT INTO players(id,name,category,state,city,club_id,style,details) VALUES(?,?,?,?,?,?,?,?)')
        .run(entry.id, entry.name, entry.cat, entry.state, club.city, entry.club, entry.style, JSON.stringify(entry));
      db.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(entry.id, entry.name, 'player', entry.id);
    }
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run('o1', 'Federation events desk', 'organizer', null);
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run('o2', 'Regional events desk', 'organizer', null);
    for (const entry of seed.tournaments) {
      db.prepare('INSERT INTO tournaments VALUES(?,?,?,?,?,?,?)').run(entry.id, entry.name, entry.status, JSON.stringify(entry.cats), entry.prize, ['t1','t8'].includes(entry.id) ? 'o1' : 'o2', entry.end);
    }
    const examples = [['p1','t8',"Men's Singles",500000],['p3','t8',"Women's Singles",400000],['p4','t9',"Men's Singles",100000],['p12','t9',"Women's Singles",80000],['p13','t10',"Men's Singles",20000],['p8','t10','Junior',10000]];
    for (const [playerId,eventId,category,amount] of examples) {
      const organizer = tournament(eventId).organizer_id;
      db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), playerId, eventId, category, 1, amount, 'https://example.com/sample-results', 'verified', organizer, organizer, 'Seeded demo result; not a real sporting record.', new Date().toISOString(), new Date().toISOString());
    }
  });
  // Demo partner listings so the Organise flow has something to match against. Flagged demo=1 and unverified.
  if (!db.prepare('SELECT count(*) AS count FROM vendors').get().count) transaction(() => {
    const demoVendors = [
      ['Precise Board Hire (demo)', 'boards', 'Meerut', 'Uttar Pradesh', 'Via CarromHub', 'Tournament-spec 20 mm boards with stands and lights; delivery & setup', '₹600/board/day · min 4 boards', 'North & West India'],
      ['Mumbai Carrom Umpires Panel (demo)', 'umpires', 'Mumbai', 'Maharashtra', 'Via CarromHub', 'Certified umpires & referees for ranking and corporate events', '₹1,500/umpire/day', 'Maharashtra, Gujarat, Goa'],
      ['Chennai Match Officials (demo)', 'umpires', 'Chennai', 'Tamil Nadu', 'Via CarromHub', 'State-panel umpires, chief referee, protest committee', '₹1,200/umpire/day', 'South India'],
      ['ScoreDesk Live (demo)', 'scoring', 'Pune', 'Maharashtra', 'Via CarromHub', 'Draws, fixtures, live scoreboards on CarromHub, result sheets', '₹8,000/event + ₹500/board', 'Pan-India (remote) + on-site in MH'],
      ['Deccan Indoor Hall (demo)', 'venue', 'Hyderabad', 'Telangana', 'Via CarromHub', '20-board air-conditioned hall, seating for 150', '₹15,000/day', 'Hyderabad'],
      ['Synco Dealer Network (demo)', 'equipment', 'Mumbai', 'Maharashtra', 'Via CarromHub', 'Coins, strikers, powder and prizes in bulk for events', 'Quote on request', 'Pan-India']
    ];
    for (const [name, type, city, state, contact, services, rate, coverage] of demoVendors) {
      db.prepare('INSERT INTO vendors(id,name,type,city,state,contact,url,services,rate_card,coverage,verified,demo,owner_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), name, type, city, state, contact, '', services, rate, coverage, 0, 1, null, new Date().toISOString());
    }
  });
  if (!db.prepare('SELECT count(*) AS count FROM content').get().count) {
    const seedContent = {
      announcement: { active: true, text: 'Organising a tournament at your office, academy or institute? We arrange boards, umpires and live scoring.', link: '#/organise', label: 'Organise with us' },
      organise: { packages: [
        { id: 'basic', name: 'Office Day', players: '16–32 players', boards: 4, umpires: 1, includes: ['4 tournament boards + stands', '1 certified umpire', 'Draw & fixtures', 'Result sheet'], from: 12000 },
        { id: 'standard', name: 'Inter-Department Cup', players: '32–64 players', boards: 8, umpires: 3, includes: ['8 boards with lights', '3 umpires + chief referee', 'Live scores on CarromHub', 'Trophies & coins kit'], from: 32000 },
        { id: 'premium', name: 'Inter-Academy / Open', players: '64–128 players', boards: 16, umpires: 6, includes: ['16 boards, venue support', '6 umpires + protest committee', 'Live streaming of finals', 'Event microsite & registration'], from: 85000 }
      ] },
      shop_notice: { active: true, text: 'The shop catalogue is demo data. Dealer links are placeholders until partners are verified — see Partners for verified listings.' }
    };
    for (const [key, value] of Object.entries(seedContent)) db.prepare('INSERT INTO content VALUES(?,?,?,?)').run(key, JSON.stringify(value), 'seed', new Date().toISOString());
  }
  db.prepare('INSERT OR IGNORE INTO content VALUES(?,?,?,?)').run('shop_lock', JSON.stringify({ locked: true, note: 'Set locked to false to open the shop to all users.' }), 'seed', new Date().toISOString());

  // ---------- platform: auth ----------
  const now = () => new Date().toISOString();
  const validPhone = (p) => /^[6-9]\d{9}$/.test(String(p || ''));
  function requestOtp(phone) {
    if (!validPhone(phone)) fail('Enter a valid 10-digit Indian mobile number.');
    const recent = db.prepare('SELECT * FROM otps WHERE phone=?').get(phone);
    if (recent && new Date(recent.expires_at) - Date.now() > 4 * 60000) fail('An OTP was just sent. Wait a minute before requesting another.', 429);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.prepare('INSERT INTO otps(phone,code,expires_at,attempts) VALUES(?,?,?,0) ON CONFLICT(phone) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, attempts=0')
      .run(phone, code, new Date(Date.now() + 5 * 60000).toISOString());
    return { phone, code, expiresInSec: 300, known: !!db.prepare('SELECT 1 FROM users WHERE phone=?').get(phone) };
  }
  function verifyOtp(phone, code, profile = {}) {
    if (!validPhone(phone)) fail('Enter a valid mobile number.');
    const otp = db.prepare('SELECT * FROM otps WHERE phone=?').get(phone) || fail('Request an OTP first.', 400);
    if (new Date(otp.expires_at) < Date.now()) fail('OTP expired. Request a new one.', 400);
    if (otp.attempts >= 5) fail('Too many attempts. Request a new OTP.', 429);
    if (String(code) !== otp.code) { db.prepare('UPDATE otps SET attempts=attempts+1 WHERE phone=?').run(phone); fail('Incorrect OTP.', 401); }
    let user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
    const name = String(profile.name || '').trim();
    // Validate the sign-up profile before consuming the OTP so a missing name doesn't force a resend.
    if (!user && !/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name)) fail('Enter your name to create an account.');
    db.prepare('DELETE FROM otps WHERE phone=?').run(phone);
    if (!user) {
      const role = ['player', 'organiser', 'merchant'].includes(profile.role) ? profile.role : 'player';
      const isFirst = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
      db.prepare('INSERT INTO users(id,phone,name,role,org,city,created_at,last_login) VALUES(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), phone, name, isFirst ? 'admin' : role, String(profile.org || '').slice(0, 80), String(profile.city || '').slice(0, 40), now(), now());
      user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
      log(user.id, user.id, isFirst ? 'first user registered as admin' : 'registered');
    } else db.prepare('UPDATE users SET last_login=? WHERE id=?').run(now(), user.id);
    const token = randomUUID() + randomUUID().replace(/-/g, '');
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(token, user.id, now(), new Date(Date.now() + 30 * 86400000).toISOString());
    return { token, user: publicUser(user) };
  }
  const publicUser = (u) => u && { id: u.id, name: u.name, phone: u.phone.replace(/^(\d{2})\d{5}(\d{3})$/, '$1*****$2'), role: u.role, org: u.org, city: u.city, since: u.created_at };
  function sessionUser(token) {
    if (!token) return null;
    const row = db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires_at>?').get(token, now());
    return row || null;
  }
  function logout(token) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); }
  function updateUser(user, input) {
    const name = String(input.name || user.name).trim();
    if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name)) fail('Enter a valid name.');
    db.prepare('UPDATE users SET name=?,org=?,city=? WHERE id=?').run(name, String(input.org || '').slice(0, 80), String(input.city || '').slice(0, 40), user.id);
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
  }
  const requireUser = (user) => user || fail('Sign in to continue.', 401);
  const requireAdmin = (user) => (requireUser(user).role === 'admin' ? user : fail('Admin access required.', 403));

  // ---------- platform: organiser requests ----------
  const SERVICES = ['boards', 'umpires', 'scoring', 'venue', 'equipment', 'streaming'];
  const ORG_TYPES = ['Office / corporate', 'Academy', 'PSU / board', 'Institute / college', 'School', 'Housing society', 'Club / association', 'Other'];
  function createRequest(user, input) {
    requireUser(user);
    const text = (v, min, max, label) => { const s = String(v || '').trim(); if (s.length < min || s.length > max) fail(`${label} must be ${min}–${max} characters.`); return s; };
    const int = (v, min, max, label) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) fail(`${label} must be between ${min} and ${max}.`); return n; };
    const orgName = text(input.org_name, 2, 80, 'Organisation name');
    if (!ORG_TYPES.includes(input.org_type)) fail('Choose an organisation type.');
    const contact = text(input.contact_name, 2, 60, 'Contact name');
    if (!validPhone(input.phone)) fail('Enter a valid 10-digit contact number.');
    const city = text(input.city, 2, 40, 'City'), state = text(input.state, 2, 40, 'State');
    const start = new Date(input.start_date), end = new Date(input.end_date || input.start_date);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) fail('Enter valid dates.');
    if (start < new Date(Date.now() - 86400000)) fail('Start date must be in the future.');
    if (end < start || end - start > 30 * 86400000) fail('End date must be within 30 days of the start.');
    const players = int(input.players, 4, 1024, 'Expected players');
    const boards = int(input.boards, 0, 64, 'Boards needed');
    const umpires = int(input.umpires, 0, 32, 'Umpires needed');
    const services = Array.isArray(input.services) ? input.services.filter((s) => SERVICES.includes(s)) : [];
    if (!services.length) fail('Pick at least one service you need.');
    const budget = input.budget ? int(input.budget, 0, 10000000, 'Budget') : 0;
    const notes = String(input.notes || '').trim().slice(0, 1000);
    const id = 'REQ-' + randomUUID().slice(0, 6).toUpperCase();
    db.prepare(`INSERT INTO service_requests(id,user_id,org_name,org_type,contact_name,phone,city,state,start_date,end_date,players,boards,umpires,services,budget,notes,status,vendor_ids,admin_note,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'received','[]','',?,?)`)
      .run(id, user.id, orgName, input.org_type, contact, input.phone, city, state, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), players, boards, umpires, JSON.stringify(services), budget, notes, now(), now());
    log(id, user.id, 'request created');
    return { id, suggestions: matchVendors({ services, state }) };
  }
  const parseRequest = (r) => r && { ...r, services: JSON.parse(r.services), vendor_ids: JSON.parse(r.vendor_ids) };
  function matchVendors({ services, state }) {
    return db.prepare('SELECT * FROM vendors ORDER BY verified DESC, demo ASC, name').all()
      .filter((v) => services.includes(v.type))
      .map((v) => ({ ...publicVendor(v), local: v.state === state || /pan-india/i.test(v.coverage) }))
      .sort((a, b) => (b.local - a.local) || (b.verified - a.verified));
  }
  function listRequests(user) {
    requireUser(user);
    const rows = user.role === 'admin'
      ? db.prepare('SELECT service_requests.*, users.name AS requester FROM service_requests JOIN users ON users.id=service_requests.user_id ORDER BY created_at DESC').all()
      : db.prepare('SELECT * FROM service_requests WHERE user_id=? ORDER BY created_at DESC').all(user.id);
    return rows.map(parseRequest);
  }
  function updateRequest(user, id, input) {
    requireUser(user);
    const r = db.prepare('SELECT * FROM service_requests WHERE id=?').get(id) || fail('Request not found.', 404);
    const own = r.user_id === user.id;
    if (!own && user.role !== 'admin') fail('Not your request.', 403);
    if (own && user.role !== 'admin') {
      if (input.status !== 'cancelled') fail('You can only cancel your own request.', 403);
      if (['completed', 'cancelled'].includes(r.status)) fail('This request is already closed.', 409);
      db.prepare('UPDATE service_requests SET status=?,updated_at=? WHERE id=?').run('cancelled', now(), id);
    } else {
      const status = input.status || r.status;
      if (!['received', 'matching', 'quoted', 'confirmed', 'completed', 'cancelled'].includes(status)) fail('Invalid status.');
      const vendorIds = Array.isArray(input.vendor_ids) ? input.vendor_ids.filter((v) => db.prepare('SELECT 1 FROM vendors WHERE id=?').get(v)) : JSON.parse(r.vendor_ids);
      db.prepare('UPDATE service_requests SET status=?,vendor_ids=?,admin_note=?,updated_at=? WHERE id=?').run(status, JSON.stringify(vendorIds), String(input.admin_note ?? r.admin_note).slice(0, 500), now(), id);
    }
    log(id, user.id, `request ${input.status || 'updated'}`);
    return parseRequest(db.prepare('SELECT * FROM service_requests WHERE id=?').get(id));
  }

  // ---------- platform: partners (vendors, umpire panels, venues) ----------
  const publicVendor = (v) => ({ id: v.id, name: v.name, type: v.type, city: v.city, state: v.state, url: v.url, services: v.services, rate_card: v.rate_card, coverage: v.coverage, verified: !!v.verified, demo: !!v.demo, contact: v.verified ? v.contact : 'Via CarromHub' });
  function listVendors(user) {
    const rows = db.prepare('SELECT * FROM vendors ORDER BY verified DESC, demo ASC, name').all();
    return rows.map((v) => (user && (user.role === 'admin' || user.id === v.owner_id) ? { ...publicVendor(v), contact: v.contact, owner_id: v.owner_id } : publicVendor(v)));
  }
  function addVendor(user, input) {
    requireUser(user);
    const name = String(input.name || '').trim();
    if (name.length < 2 || name.length > 80) fail('Enter the business / panel name.');
    if (!SERVICES.includes(input.type)) fail('Choose a service type.');
    const city = String(input.city || '').trim(), state = String(input.state || '').trim();
    if (city.length < 2 || state.length < 2) fail('Enter city and state.');
    const contact = String(input.contact || '').trim();
    if (contact.length < 5 || contact.length > 120) fail('Enter a contact (phone or email).');
    let url = String(input.url || '').trim();
    if (url) { try { const u = new URL(url); if (u.protocol !== 'https:') throw 0; url = u.href; } catch { fail('Website must be a valid https:// URL.'); } }
    const services = String(input.services || '').trim();
    if (services.length < 5 || services.length > 300) fail('Describe your services (5–300 characters).');
    const id = randomUUID();
    db.prepare('INSERT INTO vendors(id,name,type,city,state,contact,url,services,rate_card,coverage,verified,demo,owner_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,?,?)')
      .run(id, name, input.type, city, state, contact, url, services, String(input.rate_card || '').slice(0, 120), String(input.coverage || '').slice(0, 120), user.id, now());
    log(id, user.id, 'partner listed (pending verification)');
    return { id };
  }
  function updateVendor(user, id, input) {
    requireAdmin(user);
    const v = db.prepare('SELECT * FROM vendors WHERE id=?').get(id) || fail('Partner not found.', 404);
    if (input.delete) { db.prepare('DELETE FROM vendors WHERE id=?').run(id); log(id, user.id, 'partner removed'); return { deleted: true }; }
    db.prepare('UPDATE vendors SET verified=?,name=?,services=?,rate_card=?,coverage=?,url=? WHERE id=?')
      .run(Number(input.verified ?? v.verified) ? 1 : 0, String(input.name ?? v.name).slice(0, 80), String(input.services ?? v.services).slice(0, 300), String(input.rate_card ?? v.rate_card).slice(0, 120), String(input.coverage ?? v.coverage).slice(0, 120), String(input.url ?? v.url).slice(0, 300), id);
    log(id, user.id, input.verified ? 'partner verified' : 'partner updated');
    return publicVendor(db.prepare('SELECT * FROM vendors WHERE id=?').get(id));
  }

  // ---------- platform: AI/admin-editable content ----------
  function getContent() {
    const out = {};
    for (const row of db.prepare('SELECT * FROM content').all()) out[row.key] = { value: JSON.parse(row.value), updated_at: row.updated_at, updated_by: row.updated_by };
    return out;
  }
  function setContent(user, key, value, actorLabel) {
    requireAdmin(user);
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) fail('Content key must be lowercase letters, digits or underscores.');
    const json = JSON.stringify(value);
    if (json.length > 50000) fail('Content too large (50 KB max).');
    db.prepare('INSERT INTO content VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at').run(key, json, actorLabel || user.id, now());
    log(key, user.id, 'content updated');
    return getContent()[key];
  }
  function deleteContent(user, key) { requireAdmin(user); db.prepare('DELETE FROM content WHERE key=?').run(key); log(key, user.id, 'content deleted'); }
  function listUsers(user) { requireAdmin(user); return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(publicUser); }
  function setRole(user, id, role) {
    requireAdmin(user);
    if (!['player', 'organiser', 'merchant', 'admin'].includes(role)) fail('Invalid role.');
    if (id === user.id && role !== 'admin') fail('You cannot remove your own admin role.');
    db.prepare('UPDATE users SET role=? WHERE id=?').run(role, id);
    log(id, user.id, 'role ' + role);
  }

  // ---------- platform: organiser events & join requests ----------
  const EVENT_TYPES = ['Tournament', 'League', 'Friendly match', 'Practice session'];
  const EVENT_FORMATS = ['Singles', 'Doubles', 'Singles & Doubles', 'Team'];
  const txt = (v, min, max, label) => { const s = String(v ?? '').trim(); if (s.length < min || s.length > max) fail(`${label} must be ${min}–${max} characters.`); return s; };
  const int = (v, min, max, label) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) fail(`${label} must be a whole number between ${min} and ${max}.`); return n; };
  const dateStr = (v, label) => { const d = new Date(v); if (!v || Number.isNaN(d.getTime())) fail(`Enter a valid ${label}.`); return d.toISOString().slice(0, 10); };
  const requireRole = (user, roles, msg) => { requireUser(user); if (!roles.includes(user.role)) fail(msg, 403); return user; };
  const eventRow = (e, user) => {
    const counts = db.prepare("SELECT sum(status='approved') AS approved, sum(status='pending') AS pending FROM event_joins WHERE event_id=?").get(e.id);
    const mine = user ? db.prepare("SELECT id,status FROM event_joins WHERE event_id=? AND user_id=? AND status IN ('pending','approved') ORDER BY created_at DESC").get(e.id, user.id) || db.prepare('SELECT id,status FROM event_joins WHERE event_id=? AND user_id=? ORDER BY created_at DESC').get(e.id, user.id) : null;
    const owner = !!user && (user.id === e.organiser_id || user.role === 'admin');
    return { ...e, approved: counts.approved || 0, pending: owner ? (counts.pending || 0) : undefined, my: mine || null, owner };
  };
  function createEvent(user, input) {
    requireRole(user, ['organiser', 'admin'], 'Only organiser accounts can create events. Ask an admin to change your role.');
    const name = txt(input.name, 3, 80, 'Event name');
    if (!EVENT_TYPES.includes(input.type)) fail('Choose an event type.');
    if (!EVENT_FORMATS.includes(input.format)) fail('Choose a format.');
    const city = txt(input.city, 2, 40, 'City'), state = txt(input.state, 2, 40, 'State');
    const start = dateStr(input.start_date, 'start date'), end = dateStr(input.end_date || input.start_date, 'end date');
    if (start < new Date().toISOString().slice(0, 10)) fail('Start date must be today or later.');
    if (end < start) fail('End date cannot be before the start date.');
    const slots = int(input.slots, 2, 512, 'Slots'), fee = input.fee ? int(input.fee, 0, 100000, 'Entry fee') : 0;
    const id = 'EV-' + randomUUID().slice(0, 6).toUpperCase();
    db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, user.id, name, input.type, input.format, String(input.venue || '').trim().slice(0, 120), city, state, start, end, slots, fee, String(input.description || '').trim().slice(0, 600), 'open', now(), now());
    log(id, user.id, 'event created');
    return eventRow(db.prepare('SELECT * FROM events WHERE id=?').get(id), user);
  }
  function listEvents(user, scope) {
    const rows = scope === 'mine' && user
      ? db.prepare('SELECT events.*, users.name AS organiser FROM events JOIN users ON users.id=events.organiser_id WHERE organiser_id=? ORDER BY start_date').all(user.id)
      : db.prepare("SELECT events.*, users.name AS organiser FROM events JOIN users ON users.id=events.organiser_id WHERE status!='cancelled' ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'closed' THEN 1 ELSE 2 END, start_date").all();
    return rows.map((e) => eventRow(e, user));
  }
  function getEvent(user, id) {
    const e = db.prepare('SELECT events.*, users.name AS organiser, users.org AS organiser_org FROM events JOIN users ON users.id=events.organiser_id WHERE events.id=?').get(id) || fail('Event not found.', 404);
    const row = eventRow(e, user);
    const joins = db.prepare('SELECT event_joins.*, users.name AS player, users.city AS player_city FROM event_joins JOIN users ON users.id=event_joins.user_id WHERE event_id=? ORDER BY created_at').all(id);
    row.joins = row.owner ? joins : joins.filter((j) => j.status === 'approved').map((j) => ({ id: j.id, player: j.player, category: j.category, status: j.status }));
    return row;
  }
  function updateEvent(user, id, input) {
    requireUser(user);
    const e = db.prepare('SELECT * FROM events WHERE id=?').get(id) || fail('Event not found.', 404);
    if (e.organiser_id !== user.id && user.role !== 'admin') fail('Only the organiser can edit this event.', 403);
    const status = input.status || e.status;
    if (!['open', 'closed', 'completed', 'cancelled'].includes(status)) fail('Invalid status.');
    const name = input.name !== undefined ? txt(input.name, 3, 80, 'Event name') : e.name;
    const slots = input.slots !== undefined ? int(input.slots, 2, 512, 'Slots') : e.slots;
    db.prepare('UPDATE events SET name=?,venue=?,description=?,slots=?,fee=?,status=?,updated_at=? WHERE id=?')
      .run(name, String(input.venue ?? e.venue).trim().slice(0, 120), String(input.description ?? e.description).trim().slice(0, 600), slots, input.fee !== undefined ? int(input.fee, 0, 100000, 'Entry fee') : e.fee, status, now(), id);
    log(id, user.id, 'event ' + (input.status ? status : 'updated'));
    return getEvent(user, id);
  }
  function joinEvent(user, id, input = {}) {
    requireUser(user);
    return transaction(() => {
      const e = db.prepare('SELECT * FROM events WHERE id=?').get(id) || fail('Event not found.', 404);
      if (e.organiser_id === user.id) fail('You are the organiser of this event.');
      if (e.status !== 'open') fail('This event is not accepting requests.');
      if (e.end_date < new Date().toISOString().slice(0, 10)) fail('This event has already finished.');
      const approved = db.prepare("SELECT count(*) AS n FROM event_joins WHERE event_id=? AND status='approved'").get(id).n;
      if (approved >= e.slots) fail('All slots are filled. Ask the organiser about a waitlist.', 409);
      if (db.prepare("SELECT 1 FROM event_joins WHERE event_id=? AND user_id=? AND status IN ('pending','approved')").get(id, user.id)) fail('You already have a request for this event.', 409);
      const jid = randomUUID();
      db.prepare('INSERT INTO event_joins(id,event_id,user_id,category,note,status,created_at) VALUES(?,?,?,?,?,?,?)').run(jid, id, user.id, String(input.category || '').trim().slice(0, 40), String(input.note || '').trim().slice(0, 300), 'pending', now());
      log(jid, user.id, 'join requested ' + id);
      return db.prepare('SELECT * FROM event_joins WHERE id=?').get(jid);
    });
  }
  function decideJoin(user, eventId, joinId, status) {
    requireUser(user);
    return transaction(() => {
      const e = db.prepare('SELECT * FROM events WHERE id=?').get(eventId) || fail('Event not found.', 404);
      const j = db.prepare('SELECT * FROM event_joins WHERE id=? AND event_id=?').get(joinId, eventId) || fail('Request not found.', 404);
      const organiser = e.organiser_id === user.id || user.role === 'admin';
      if (status === 'withdrawn') {
        if (j.user_id !== user.id) fail('Only the player can withdraw.', 403);
        if (!['pending', 'approved'].includes(j.status)) fail('This request is already closed.', 409);
      } else {
        if (!organiser) fail('Only the organiser can approve or decline.', 403);
        if (!['approved', 'declined'].includes(status)) fail('Invalid decision.');
        if (j.status !== 'pending') fail('This request has already been decided.', 409);
        if (status === 'approved' && db.prepare("SELECT count(*) AS n FROM event_joins WHERE event_id=? AND status='approved'").get(eventId).n >= e.slots) fail('All slots are filled.', 409);
      }
      db.prepare('UPDATE event_joins SET status=?,decided_at=? WHERE id=?').run(status, now(), joinId);
      log(joinId, user.id, 'join ' + status);
      return db.prepare('SELECT * FROM event_joins WHERE id=?').get(joinId);
    });
  }
  function listMyJoins(user) {
    requireUser(user);
    return db.prepare('SELECT event_joins.*, events.name AS event_name, events.start_date, events.city, events.state, events.venue, events.format, users.name AS organiser FROM event_joins JOIN events ON events.id=event_joins.event_id JOIN users ON users.id=events.organiser_id WHERE event_joins.user_id=? ORDER BY event_joins.created_at DESC').all(user.id);
  }

  // ---------- platform: merchant marketplace ----------
  const LISTING_CATEGORIES = ['Boards', 'Strikers', 'Coins', 'Powder', 'Accessories', 'Apparel', 'Other'];
  const CATEGORY_EMOJI = { Boards: '🟫', Strikers: '⚪', Coins: '⚫', Powder: '🧂', Accessories: '🧩', Apparel: '👕', Other: '📦' };
  const listingRow = (l, user) => ({ ...l, active: !!l.active, mine: !!user && (user.id === l.merchant_id || user.role === 'admin') });
  function createListing(user, input) {
    requireRole(user, ['merchant', 'admin'], 'Only merchant accounts can list products. Ask an admin to change your role.');
    const name = txt(input.name, 3, 80, 'Product name');
    if (!LISTING_CATEGORIES.includes(input.category)) fail('Choose a category.');
    const price = int(input.price, 1, 10000000, 'Price (₹)');
    const mrp = input.mrp ? int(input.mrp, price, 10000000, 'MRP (₹)') : price;
    const stock = int(input.stock, 0, 100000, 'Stock');
    const id = 'L-' + randomUUID().slice(0, 8).toUpperCase();
    db.prepare('INSERT INTO listings VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)').run(id, user.id, name, input.category, price, mrp, stock, String(input.description || '').trim().slice(0, 600), String(input.specs || '').trim().slice(0, 300), CATEGORY_EMOJI[input.category], now(), now());
    log(id, user.id, 'listing created');
    return listingRow(db.prepare('SELECT * FROM listings WHERE id=?').get(id), user);
  }
  function listListings(user, scope) {
    const rows = scope === 'mine' && user
      ? db.prepare('SELECT listings.*, users.name AS merchant, users.org AS merchant_org FROM listings JOIN users ON users.id=listings.merchant_id WHERE merchant_id=? ORDER BY created_at DESC').all(user.id)
      : db.prepare('SELECT listings.*, users.name AS merchant, users.org AS merchant_org FROM listings JOIN users ON users.id=listings.merchant_id WHERE active=1 ORDER BY created_at DESC').all();
    return rows.map((l) => listingRow(l, user));
  }
  function updateListing(user, id, input) {
    requireUser(user);
    const l = db.prepare('SELECT * FROM listings WHERE id=?').get(id) || fail('Listing not found.', 404);
    if (l.merchant_id !== user.id && user.role !== 'admin') fail('Only the merchant can edit this listing.', 403);
    const price = input.price !== undefined ? int(input.price, 1, 10000000, 'Price (₹)') : l.price;
    const mrp = input.mrp !== undefined ? int(input.mrp, price, 10000000, 'MRP (₹)') : Math.max(l.mrp, price);
    let stock = input.stock !== undefined ? int(input.stock, 0, 100000, 'Stock') : l.stock;
    if (input.stock_delta !== undefined) stock = Math.max(0, Math.min(100000, l.stock + int(input.stock_delta, -100000, 100000, 'Stock change')));
    db.prepare('UPDATE listings SET name=?,price=?,mrp=?,stock=?,description=?,specs=?,active=?,updated_at=? WHERE id=?')
      .run(input.name !== undefined ? txt(input.name, 3, 80, 'Product name') : l.name, price, mrp, stock, String(input.description ?? l.description).trim().slice(0, 600), String(input.specs ?? l.specs).trim().slice(0, 300), input.active === undefined ? l.active : (input.active ? 1 : 0), now(), id);
    log(id, user.id, 'listing updated');
    return listingRow(db.prepare('SELECT * FROM listings WHERE id=?').get(id), user);
  }
  function createOrder(user, input) {
    requireUser(user);
    return transaction(() => {
      const l = db.prepare('SELECT * FROM listings WHERE id=? AND active=1').get(input.listing_id) || fail('This product is no longer available.', 404);
      if (l.merchant_id === user.id) fail('You cannot order your own listing.');
      const qty = int(input.qty, 1, 20, 'Quantity');
      if (l.stock < qty) fail(l.stock ? `Only ${l.stock} left in stock.` : 'Out of stock.', 409);
      if (!validPhone(input.phone)) fail('Enter a valid 10-digit mobile number.');
      const address = txt(input.address, 10, 300, 'Delivery address');
      const name = txt(input.name || user.name, 2, 60, 'Name');
      if (!['UPI', 'Card', 'Cash on delivery'].includes(input.payment)) fail('Choose a payment method.');
      const id = 'ORD-' + randomUUID().slice(0, 6).toUpperCase();
      db.prepare('UPDATE listings SET stock=stock-?,updated_at=? WHERE id=?').run(qty, now(), l.id);
      db.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, l.id, l.merchant_id, user.id, qty, l.price, l.price * qty, name, input.phone, address, input.payment, 'placed', now(), now());
      log(id, user.id, 'order placed');
      return db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    });
  }
  function listOrders(user) {
    requireUser(user);
    const base = 'SELECT orders.*, listings.name AS product, listings.emoji, listings.category, buyer.name AS buyer, merchant.name AS merchant FROM orders JOIN listings ON listings.id=orders.listing_id JOIN users buyer ON buyer.id=orders.buyer_id JOIN users merchant ON merchant.id=orders.merchant_id';
    if (user.role === 'admin') return db.prepare(base + ' ORDER BY orders.created_at DESC').all();
    return db.prepare(base + ' WHERE orders.buyer_id=? OR orders.merchant_id=? ORDER BY orders.created_at DESC').all(user.id, user.id).map((o) => ({ ...o, selling: o.merchant_id === user.id }));
  }
  function updateOrder(user, id, status) {
    requireUser(user);
    return transaction(() => {
      const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id) || fail('Order not found.', 404);
      const merchant = o.merchant_id === user.id || user.role === 'admin';
      const buyer = o.buyer_id === user.id;
      const flow = ['placed', 'packed', 'shipped', 'delivered'];
      if (status === 'cancelled') {
        if (!merchant && !buyer) fail('Not your order.', 403);
        if (o.status !== 'placed' && !(merchant && o.status === 'packed')) fail('This order can no longer be cancelled.', 409);
        db.prepare('UPDATE listings SET stock=stock+? WHERE id=?').run(o.qty, o.listing_id);
      } else {
        if (!merchant) fail('Only the merchant can update fulfilment.', 403);
        if (!flow.includes(status) || flow.indexOf(status) !== flow.indexOf(o.status) + 1) fail(`Next step after "${o.status}" is "${flow[flow.indexOf(o.status) + 1] || 'none'}".`, 409);
      }
      db.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').run(status, now(), id);
      log(id, user.id, 'order ' + status);
      return db.prepare('SELECT * FROM orders WHERE id=?').get(id);
    });
  }

  function requirePlayer(actorId) {
    const actor = account(actorId);
    if (actor.role !== 'player') fail('A player account is required.', 403);
    return actor;
  }
  function expire() {
    db.prepare("UPDATE challenges SET status='expired' WHERE status IN ('pending','accepted') AND scheduled_at<=?").run(new Date().toISOString());
  }
  function state(actorId) {
    const actor = account(actorId);
    expire();
    const results = db.prepare(`SELECT results.*, accounts.name AS submitter,
      reviewer.name AS reviewer FROM results JOIN accounts ON accounts.id=results.submitted_by
      LEFT JOIN accounts reviewer ON reviewer.id=results.reviewed_by
      WHERE status='verified' OR submitted_by=? OR tournament_id IN
      (SELECT id FROM tournaments WHERE organizer_id=?) ORDER BY created_at DESC`).all(actor.id, actor.id);
    return {
      actor, accounts: db.prepare('SELECT * FROM accounts').all(),
      players: db.prepare('SELECT * FROM players').all().map((entry) => {
        const totals = db.prepare("SELECT count(*) AS recorded_results, coalesce(sum(winnings),0) AS winnings, coalesce(sum(placement=1),0) AS titles FROM results WHERE player_id=? AND status='verified'").get(entry.id);
        return { ...JSON.parse(entry.details), ...entry, ...totals, details: undefined };
      }),
      tournaments: db.prepare('SELECT * FROM tournaments').all().map((entry) => ({ ...entry, categories: JSON.parse(entry.categories) })),
      clubs: seed.clubs, results,
      radar: actor.player_id ? db.prepare('SELECT target_id FROM radar WHERE owner_id=?').all(actor.player_id).map((row) => row.target_id) : [],
      challenges: db.prepare('SELECT * FROM challenges WHERE sender_id=? OR recipient_id=? ORDER BY created_at DESC').all(actor.player_id, actor.player_id)
    };
  }
  function submitResult(actorId, input) {
    return transaction(() => {
      const actor = account(actorId);
      const event = tournament(input.tournament_id);
      player(input.player_id);
      if (event.status !== 'completed') fail('Results can only be submitted for completed tournaments.');
      if (actor.role === 'player' && actor.player_id !== input.player_id) fail('Players may submit only their own results.', 403);
      if (actor.role === 'organizer' && event.organizer_id !== actor.id) fail('You are not assigned to this tournament.', 403);
      if (!JSON.parse(event.categories).includes(input.category)) fail('Invalid event category.');
      if (!Number.isInteger(input.placement) || input.placement < 1 || input.placement > 256) fail('Placement must be between 1 and 256.');
      if (!Number.isSafeInteger(input.winnings) || input.winnings < 0 || input.winnings > event.prize) fail('Winnings must be a whole INR amount within the prize pool.');
      let evidence;
      try { evidence = new URL(input.evidence); } catch { fail('Enter a valid HTTPS result-sheet URL.'); }
      if (evidence.protocol !== 'https:' || evidence.username || evidence.password || evidence.href.length > 1000) fail('Enter a public HTTPS result-sheet URL without credentials.');
      if (db.prepare("SELECT id FROM results WHERE player_id=? AND tournament_id=? AND category=? AND status IN ('verified','pending')").get(input.player_id, event.id, input.category)) fail('This player already has a pending or verified result for this category.', 409);
      const id = randomUUID();
      const verified = actor.role === 'organizer';
      db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, input.player_id, event.id, input.category, input.placement, input.winnings, evidence.href, verified ? 'verified' : 'pending', actor.id, verified ? actor.id : null, '', new Date().toISOString(), verified ? new Date().toISOString() : null);
      if (verified) validateAwards(event);
      log(id, actor.id, verified ? 'published' : 'claimed');
      return { id };
    });
  }
  function validateAwards(event) {
    const total = db.prepare("SELECT coalesce(sum(winnings),0) AS total FROM results WHERE tournament_id=? AND status='verified'").get(event.id).total;
    if (total > event.prize) fail('Verified awards would exceed this tournament prize pool.');
  }
  function review(actorId, id, input) {
    return transaction(() => {
      const actor = account(actorId);
      const result = db.prepare('SELECT * FROM results WHERE id=?').get(id) || fail('Result not found.', 404);
      const event = tournament(result.tournament_id);
      if (actor.role !== 'organizer' || event.organizer_id !== actor.id) fail('Only the assigned organizer can review this result.', 403);
      if (result.status !== 'pending') fail('This result has already been reviewed.', 409);
      if (!['verified','rejected'].includes(input.status)) fail('Invalid review decision.');
      if (typeof input.note !== 'string' || input.note.trim().length < 5 || input.note.length > 500) fail('Add a review note (5-500 characters).');
      db.prepare('UPDATE results SET status=?,note=?,reviewed_by=?,reviewed_at=? WHERE id=?').run(input.status, input.note.trim(), actor.id, new Date().toISOString(), id);
      validateAwards(event);
      log(id, actor.id, input.status);
    });
  }
  function updateProfile(actorId, input) {
    const actor = requirePlayer(actorId);
    if (typeof input.style !== 'string' || input.style.trim().length < 2 || input.style.length > 80 || typeof input.accepting !== 'boolean') fail('Enter a playing style (2-80 characters) and availability.');
    transaction(() => {
      db.prepare('UPDATE players SET style=?,accepting=? WHERE id=?').run(input.style.trim(), Number(input.accepting), actor.player_id);
      log(actor.player_id, actor.id, 'profile updated');
    });
  }
  function radar(actorId, targetId, enabled) {
    const actor = requirePlayer(actorId);
    player(targetId);
    if (actor.player_id === targetId) fail('You cannot add yourself to your radar.');
    if (typeof enabled !== 'boolean') fail('Invalid radar setting.');
    if (enabled) db.prepare('INSERT OR IGNORE INTO radar VALUES(?,?)').run(actor.player_id, targetId);
    else db.prepare('DELETE FROM radar WHERE owner_id=? AND target_id=?').run(actor.player_id, targetId);
  }
  function challenge(actorId, input) {
    return transaction(() => {
      expire();
      const actor = requirePlayer(actorId);
      const sender = player(actor.player_id);
      const recipient = player(input.recipient_id);
      if (sender.id === recipient.id) fail('You cannot challenge yourself.');
      if (sender.category === 'Junior' || recipient.category === 'Junior') fail('Junior challenges require a guardian workflow and are unavailable.');
      if (!recipient.accepting) fail('This player is not accepting challenges.');
      if (!db.prepare('SELECT 1 FROM radar WHERE owner_id=? AND target_id=?').get(sender.id, recipient.id)) fail('Add this player to your radar first.');
      if (!seed.clubs.some((entry) => entry.id === input.venue_id)) fail('Choose a listed club as the venue.');
      if (!['Best of 3', 'Practice session'].includes(input.format)) fail('Choose a valid format.');
      const time = new Date(input.scheduled_at).getTime();
      if (!Number.isFinite(time) || time < Date.now() + 30 * 60000 || time > Date.now() + 90 * 86400000) fail('Schedule between 30 minutes and 90 days from now.');
      const id = randomUUID();
      db.prepare('INSERT INTO challenges VALUES(?,?,?,?,?,?,?,?,?)').run(id, sender.id, recipient.id, [sender.id,recipient.id].sort().join(':'), input.venue_id, new Date(time).toISOString(), input.format, 'pending', new Date().toISOString());
      log(id, actor.id, 'challenge sent');
      return { id };
    });
  }
  function respond(actorId, id, input) {
    return transaction(() => {
      expire();
      const actor = requirePlayer(actorId);
      const entry = db.prepare('SELECT * FROM challenges WHERE id=?').get(id) || fail('Challenge not found.', 404);
      const recipient = actor.player_id === entry.recipient_id;
      const sender = actor.player_id === entry.sender_id;
      if (!recipient && !sender) fail('This challenge does not belong to you.', 403);
      const allowed = (entry.status === 'pending' && recipient && ['accepted','declined'].includes(input.status)) ||
        (['pending','accepted'].includes(entry.status) && input.status === 'cancelled' && (sender || entry.status === 'accepted'));
      if (!allowed) fail('This challenge action is not allowed.', 409);
      db.prepare('UPDATE challenges SET status=? WHERE id=?').run(input.status, id);
      log(id, actor.id, input.status);
    });
  }
  return { db, state, account, submitResult, review, updateProfile, radar, challenge, respond,
    requestOtp, verifyOtp, sessionUser, logout, updateUser, publicUser,
    createRequest, listRequests, updateRequest, matchVendors, listVendors, addVendor, updateVendor,
    getContent, setContent, deleteContent, listUsers, setRole, ORG_TYPES, SERVICES,
    createEvent, listEvents, getEvent, updateEvent, joinEvent, decideJoin, listMyJoins, EVENT_TYPES, EVENT_FORMATS,
    createListing, listListings, updateListing, createOrder, listOrders, updateOrder, LISTING_CATEGORIES };
}

module.exports = { createDatabase };