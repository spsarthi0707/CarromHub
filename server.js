const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { createDatabase } = require('./database');

function createServer(service = createDatabase(), options = {}) {
  const sessions = new Map();
  const adminKey = options.adminKey ?? process.env.ADMIN_KEY ?? '';
  // Without an SMS gateway the OTP is returned to the client (and logged) so the flow can be tested.
  const otpDev = options.otpDev ?? process.env.OTP_DELIVERY !== 'sms';
  const smsWebhook = process.env.SMS_WEBHOOK_URL || '';
  const allowedHosts = (options.allowedHosts ?? process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === '1';
  const STATIC = { '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'], '/sw.js': ['sw.js', 'text/javascript'], '/icons/icon.svg': ['icons/icon.svg', 'image/svg+xml'], '/icons/maskable.svg': ['icons/maskable.svg', 'image/svg+xml'] };
  const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  // Per-IP OTP throttle (sliding 15-minute window) so the SMS budget can't be drained.
  const otpHits = new Map();
  const otpAllowed = (ip) => {
    const t = Date.now(), win = 15 * 60000;
    const hits = (otpHits.get(ip) || []).filter((x) => t - x < win);
    hits.push(t); otpHits.set(ip, hits);
    if (otpHits.size > 5000) for (const [k, v] of otpHits) if (t - v[v.length - 1] > win) otpHits.delete(k);
    return hits.length <= 10;
  };
  const sendSms = async (phone, message) => {
    if (!smsWebhook) throw Object.assign(new Error('SMS gateway not configured (SMS_WEBHOOK_URL).'), { status: 503 });
    const res = await fetch(smsWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(process.env.SMS_WEBHOOK_KEY ? { Authorization: 'Bearer ' + process.env.SMS_WEBHOOK_KEY } : {}) }, body: JSON.stringify({ to: '+91' + phone, message }) });
    if (!res.ok) throw Object.assign(new Error('Could not send the OTP right now. Try again shortly.'), { status: 502 });
  };
  const json = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  const body = async (request) => {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 65536) throw Object.assign(new Error('Request too large.'), { status: 413 });
    }
    try {
      const input = JSON.parse(raw);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
      return input;
    } catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400 }); }
  };
  const cookie = (request, name) => new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(request.headers.cookie || '')?.[1];
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', CSP);
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    const scheme = trustProxy && request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    if (scheme === 'https') response.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    const ip = (trustProxy && (request.headers['x-forwarded-for'] || '').split(',')[0].trim()) || request.socket.remoteAddress || '';
    const port = request.socket.localPort;
    const host = request.headers.host || '';
    const okHosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...allowedHosts];
    if (!allowedHosts.includes('*') && !okHosts.includes(host)) return json(response, 403, { error: 'Host not allowed. Set ALLOWED_HOSTS=your.domain (or host:port) for this address.' });
    const origin = `${scheme}://${host}`;
    if (request.headers.origin && request.headers.origin !== origin) return json(response, 403, { error: 'Cross-origin requests are not allowed.' });
    const cookieFlags = `HttpOnly; SameSite=Strict; Path=/${scheme === 'https' ? '; Secure' : ''}`;
    try {
      const path = new URL(request.url, origin).pathname;
      if (path === '/healthz') return json(response, 200, { ok: true, uptime: Math.round(process.uptime()) });

      // ---- platform API: auth, organiser requests, partners, content ----
      if (path.startsWith('/api/auth/') || ['/api/me', '/api/requests', '/api/vendors', '/api/content', '/api/users', '/api/events', '/api/joins', '/api/listings', '/api/orders'].some((p) => path === p || path.startsWith(p + '/'))) {
        const token = cookie(request, 'carrom_auth');
        let user = service.sessionUser(token);
        // Scripted / AI updates: a matching X-Admin-Key header acts as a synthetic admin.
        if (!user && adminKey && request.headers['x-admin-key'] === adminKey) user = { id: 'admin-key', name: 'Admin key', role: 'admin', phone: '0000000000' };
        const needJson = () => { if (request.headers['content-type'] !== 'application/json') throw Object.assign(new Error('JSON requests required.'), { status: 415 }); };
        const idOf = () => decodeURIComponent(path.split('/').pop());
        if (path === '/api/me' && request.method === 'GET') return json(response, 200, { user: user && user.id !== 'admin-key' ? service.publicUser(user) : user, otpDev, features: { adminKey: !!adminKey } });
        if (path === '/api/me' && request.method === 'PATCH') {
          needJson();
          if (!user || user.id === 'admin-key') return json(response, 401, { error: 'Sign in to continue.' });
          return json(response, 200, { user: service.updateUser(user, await body(request)) });
        }
        if (path === '/api/auth/request-otp' && request.method === 'POST') {
          needJson();
          if (!otpAllowed(ip)) return json(response, 429, { error: 'Too many codes requested from this network. Try again in 15 minutes.' });
          const out = service.requestOtp((await body(request)).phone);
          if (otpDev) console.log(`[otp] ${out.phone} -> ${out.code}`);
          else await sendSms(out.phone, `${out.code} is your CarromHub sign-in code. Valid for 5 minutes.`);
          return json(response, 200, { phone: out.phone, known: out.known, expiresInSec: out.expiresInSec, ...(otpDev ? { devCode: out.code } : {}) });
        }
        if (path === '/api/auth/verify' && request.method === 'POST') {
          needJson();
          const input = await body(request);
          const out = service.verifyOtp(input.phone, input.code, input);
          response.setHeader('Set-Cookie', `carrom_auth=${out.token}; ${cookieFlags}; Max-Age=${30 * 86400}`);
          return json(response, 200, { user: out.user });
        }
        if (path === '/api/auth/logout' && request.method === 'POST') {
          if (token) service.logout(token);
          response.setHeader('Set-Cookie', `carrom_auth=; ${cookieFlags}; Max-Age=0`);
          return json(response, 200, {});
        }
        if (path === '/api/requests' && request.method === 'GET') return json(response, 200, { requests: service.listRequests(user), orgTypes: service.ORG_TYPES, services: service.SERVICES });
        if (path === '/api/requests' && request.method === 'POST') { needJson(); return json(response, 201, service.createRequest(user, await body(request))); }
        if (path.startsWith('/api/requests/') && request.method === 'PATCH') { needJson(); return json(response, 200, service.updateRequest(user, idOf(), await body(request))); }
        if (path === '/api/vendors' && request.method === 'GET') return json(response, 200, { vendors: service.listVendors(user), services: service.SERVICES });
        if (path === '/api/vendors' && request.method === 'POST') { needJson(); return json(response, 201, service.addVendor(user, await body(request))); }
        if (path.startsWith('/api/vendors/') && request.method === 'PATCH') { needJson(); return json(response, 200, service.updateVendor(user, idOf(), await body(request))); }
        if (path === '/api/content' && request.method === 'GET') return json(response, 200, service.getContent());
        if (path.startsWith('/api/content/') && request.method === 'PUT') { needJson(); return json(response, 200, service.setContent(user, idOf(), (await body(request)).value, user && user.id === 'admin-key' ? 'admin-key' : undefined)); }
        if (path.startsWith('/api/content/') && request.method === 'DELETE') { service.deleteContent(user, idOf()); return json(response, 200, {}); }
        if (path === '/api/users' && request.method === 'GET') return json(response, 200, { users: service.listUsers(user) });
        if (path.startsWith('/api/users/') && request.method === 'PATCH') { needJson(); service.setRole(user, idOf(), (await body(request)).role); return json(response, 200, {}); }
        // Organiser events & join requests
        const seg = path.split('/').filter(Boolean); // ['api','events',id,'joins',jid]
        if (path === '/api/events' && request.method === 'GET') return json(response, 200, { events: service.listEvents(user, new URL(request.url, origin).searchParams.get('scope')), types: service.EVENT_TYPES, formats: service.EVENT_FORMATS });
        if (path === '/api/events' && request.method === 'POST') { needJson(); return json(response, 201, service.createEvent(user, await body(request))); }
        if (seg[1] === 'events' && seg.length === 3 && request.method === 'GET') return json(response, 200, service.getEvent(user, seg[2]));
        if (seg[1] === 'events' && seg.length === 3 && request.method === 'PATCH') { needJson(); return json(response, 200, service.updateEvent(user, seg[2], await body(request))); }
        if (seg[1] === 'events' && seg[3] === 'joins' && seg.length === 4 && request.method === 'POST') { needJson(); return json(response, 201, service.joinEvent(user, seg[2], await body(request))); }
        if (seg[1] === 'events' && seg[3] === 'joins' && seg.length === 5 && request.method === 'PATCH') { needJson(); return json(response, 200, service.decideJoin(user, seg[2], seg[4], (await body(request)).status)); }
        if (path === '/api/joins' && request.method === 'GET') return json(response, 200, { joins: service.listMyJoins(user) });
        // Merchant marketplace
        if (path === '/api/listings' && request.method === 'GET') return json(response, 200, { listings: service.listListings(user, new URL(request.url, origin).searchParams.get('scope')), categories: service.LISTING_CATEGORIES });
        if (path === '/api/listings' && request.method === 'POST') { needJson(); return json(response, 201, service.createListing(user, await body(request))); }
        if (seg[1] === 'listings' && seg.length === 3 && request.method === 'PATCH') { needJson(); return json(response, 200, service.updateListing(user, seg[2], await body(request))); }
        if (path === '/api/orders' && request.method === 'GET') return json(response, 200, { orders: service.listOrders(user) });
        if (path === '/api/orders' && request.method === 'POST') { needJson(); return json(response, 201, service.createOrder(user, await body(request))); }
        if (seg[1] === 'orders' && seg.length === 3 && request.method === 'PATCH') { needJson(); return json(response, 200, service.updateOrder(user, seg[2], (await body(request)).status)); }
        return json(response, 404, { error: 'Endpoint not found.' });
      }

      if (path.startsWith('/api/')) {
        let token = /(?:^|;\s*)carrom_session=([^;]+)/.exec(request.headers.cookie || '')?.[1];
        if (!token || !sessions.has(token)) {
          if (request.method !== 'GET') return json(response, 401, { error: 'Reload to start a demo session.' });
          token = randomUUID();
          sessions.set(token, 'p1');
          response.setHeader('Set-Cookie', `carrom_session=${token}; ${cookieFlags}`);
        }
        const actor = sessions.get(token);
        if (path === '/api/state' && request.method === 'GET') return json(response, 200, service.state(actor));
        if (request.headers['content-type'] !== 'application/json') return json(response, 415, { error: 'JSON requests required.' });
        const input = await body(request);
        let output = {};
        if (path === '/api/demo-session' && request.method === 'POST') {
          service.account(input.account_id);
          sessions.set(token, input.account_id);
        } else if (path === '/api/results' && request.method === 'POST') output = service.submitResult(actor, input);
        else if (/^\/api\/results\/[\w-]+$/.test(path) && request.method === 'PATCH') service.review(actor, path.split('/').pop(), input);
        else if (path === '/api/profile' && request.method === 'PATCH') service.updateProfile(actor, input);
        else if (/^\/api\/radar\/\w+$/.test(path) && request.method === 'PUT') service.radar(actor, path.split('/').pop(), input.enabled);
        else if (path === '/api/challenges' && request.method === 'POST') output = service.challenge(actor, input);
        else if (/^\/api\/challenges\/[\w-]+$/.test(path) && request.method === 'PATCH') service.respond(actor, path.split('/').pop(), input);
        else return json(response, 404, { error: 'Endpoint not found.' });
        return json(response, 200, output);
      }
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
      let file, type;
      if (path === '/' || path === '/index.html') file = 'index.html';
      else if (STATIC[path]) [file, type] = STATIC[path];
      else if (path === '/vendor/lucide.js') file = 'node_modules/lucide/dist/umd/lucide.min.js';
      else if (/^\/(css|js)\/[a-zA-Z0-9_./-]+\.(js|css)$/.test(path) && !path.includes('..')) file = path.slice(1);
      else return json(response, 404, { error: 'Not found.' });
      const content = await readFile(join(__dirname, file));
      response.writeHead(200, { 'Content-Type': type || (file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html'), 'Cache-Control': 'no-cache', ...(file === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
      response.end(content);
    } catch (error) {
      const status = error.status || (error.code === 'ENOENT' ? 404 : 500);
      if (status === 500) console.error(error);
      json(response, status, { error: status === 500 ? 'Unable to save. Please try again.' : error.message });
    }
  });
}

if (require.main === module) {
  const server = createServer();
  let port = Number(process.env.PORT || 3000);
  const fixedPort = !!process.env.PORT;
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && !fixedPort && port < 3020) server.listen(++port, process.env.HOST || '127.0.0.1');
    else throw error;
  });
  server.on('listening', () => console.log(`CarromHub: http://${process.env.HOST && process.env.HOST !== '127.0.0.1' ? (process.env.ALLOWED_HOSTS || '0.0.0.0:' + port).split(',')[0] : 'localhost:' + port}\nData: ${process.env.DATA_DIR || 'data'}/carrom.sqlite · OTP: ${process.env.OTP_DELIVERY === 'sms' ? (process.env.SMS_WEBHOOK_URL ? 'sms webhook' : 'sms (NO SMS_WEBHOOK_URL SET)') : 'dev (code shown in app + console)'} · Admin key: ${process.env.ADMIN_KEY ? 'set' : 'not set (first sign-up becomes admin)'} · Proxy: ${process.env.TRUST_PROXY === '1' ? 'trusted (HTTPS cookies on)' : 'off'}\nLAN access: HOST=0.0.0.0 ALLOWED_HOSTS=<your-ip>:${port}`));
  server.listen(port, process.env.HOST || '127.0.0.1');
}

module.exports = { createServer };