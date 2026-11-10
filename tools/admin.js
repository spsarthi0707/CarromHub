#!/usr/bin/env node
// CarromHub admin CLI — lets a person or an AI assistant read/update platform data without the UI.
// Works directly on the SQLite file (no server needed). Examples:
//   node tools/admin.js content export > content.json
//   node tools/admin.js content import content.json
//   node tools/admin.js content set announcement '{"active":true,"text":"Entries open!","link":"#/events","label":"Register"}'
//   node tools/admin.js vendors list | verify <id> | add vendor.json
//   node tools/admin.js requests list | set <id> matching "Matched 2 umpire panels"
//   node tools/admin.js users list | role <id> admin
const { readFileSync } = require('node:fs');
const { createDatabase } = require('../database');

const [, , area, cmd, ...args] = process.argv;
const service = createDatabase();
const ADMIN = { id: 'admin-cli', name: 'Admin CLI', role: 'admin', phone: '0000000000' };
const out = (v) => process.stdout.write(JSON.stringify(v, null, 2) + '\n');
const readJson = (src) => JSON.parse(src.endsWith('.json') ? readFileSync(src, 'utf8') : src);

try {
  if (area === 'content' && cmd === 'export') out(Object.fromEntries(Object.entries(service.getContent()).map(([k, v]) => [k, v.value])));
  else if (area === 'content' && cmd === 'import') { const data = readJson(args[0]); for (const [k, v] of Object.entries(data)) service.setContent(ADMIN, k, v, 'admin-cli'); out({ imported: Object.keys(data) }); }
  else if (area === 'content' && cmd === 'set') out(service.setContent(ADMIN, args[0], readJson(args[1]), 'admin-cli'));
  else if (area === 'content' && cmd === 'delete') { service.deleteContent(ADMIN, args[0]); out({ deleted: args[0] }); }
  else if (area === 'vendors' && cmd === 'list') out(service.listVendors(ADMIN));
  else if (area === 'vendors' && cmd === 'verify') out(service.updateVendor(ADMIN, args[0], { verified: 1 }));
  else if (area === 'vendors' && cmd === 'unverify') out(service.updateVendor(ADMIN, args[0], { verified: 0 }));
  else if (area === 'vendors' && cmd === 'remove') out(service.updateVendor(ADMIN, args[0], { delete: true }));
  else if (area === 'vendors' && cmd === 'add') { const v = readJson(args[0]); const owner = service.listUsers(ADMIN)[0]; if (!owner) throw new Error('Create a user in the app first.'); out(service.addVendor({ ...owner, role: 'admin' }, v)); }
  else if (area === 'requests' && cmd === 'list') out(service.listRequests(ADMIN));
  else if (area === 'requests' && cmd === 'set') out(service.updateRequest(ADMIN, args[0], { status: args[1], admin_note: args[2] || '' }));
  else if (area === 'users' && cmd === 'list') out(service.listUsers(ADMIN));
  else if (area === 'users' && cmd === 'role') { service.setRole(ADMIN, args[0], args[1]); out({ id: args[0], role: args[1] }); }
  else {
    console.log('Usage: node tools/admin.js <content|vendors|requests|users> <command> [args]\nSee the header of this file for examples.');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
} finally { service.db.close(); }
