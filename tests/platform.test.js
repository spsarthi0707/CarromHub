const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../database');

const signIn = (service, phone, profile) => {
  const { code } = service.requestOtp(phone);
  return service.verifyOtp(phone, code, profile);
};
const request = { org_name: 'Central Electricity Authority', org_type: 'Academy', contact_name: 'Rakesh Verma', phone: '9811111111', city: 'New Delhi', state: 'Delhi', start_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), players: 48, boards: 8, umpires: 3, services: ['boards', 'umpires', 'scoring'], budget: 35000, notes: 'Inter-division cup' };

test('OTP sign-in creates accounts, first user is admin, sessions resolve and expire on logout', () => {
  const service = createDatabase(':memory:');
  try {
    assert.throws(() => service.requestOtp('12345'), /valid 10-digit/);
    const first = signIn(service, '9876543210', { name: 'Asha Admin', role: 'player' });
    assert.equal(first.user.role, 'admin');
    assert.match(first.user.phone, /^98\*{5}210$/);
    const second = signIn(service, '9876543211', { name: 'Omar Organiser', role: 'organiser', org: 'CEA' });
    assert.equal(second.user.role, 'organiser');
    assert.throws(() => service.verifyOtp('9876543211', '000000'), /Request an OTP/);
    service.requestOtp('9876543211');
    assert.throws(() => service.verifyOtp('9876543211', '000000'), /Incorrect/);
    assert.equal(service.sessionUser(second.token).id, second.user.id);
    service.logout(second.token);
    assert.equal(service.sessionUser(second.token), null);
    const { code } = service.requestOtp('9876543212');
    assert.throws(() => service.verifyOtp('9876543212', code, { name: '' }), /name/);
    assert.throws(() => service.requestOtp('9876543212'), /just sent/);
  } finally { service.db.close(); }
});

test('organiser requests are validated, matched to partners, visible only to owner/admin, and cancellable', () => {
  const service = createDatabase(':memory:');
  try {
    const admin = service.sessionUser(signIn(service, '9000000001', { name: 'Admin One' }).token);
    const org = service.sessionUser(signIn(service, '9000000002', { name: 'Org Two', role: 'organiser' }).token);
    const other = service.sessionUser(signIn(service, '9000000003', { name: 'Other Three' }).token);
    assert.throws(() => service.createRequest(null, request), /Sign in/);
    assert.throws(() => service.createRequest(org, { ...request, services: [] }), /at least one service/);
    assert.throws(() => service.createRequest(org, { ...request, start_date: '2001-01-01' }), /future/);
    assert.throws(() => service.createRequest(org, { ...request, players: 2 }), /Expected players/);
    const out = service.createRequest(org, request);
    assert.match(out.id, /^REQ-/);
    assert.ok(out.suggestions.length >= 3, 'demo partners suggested');
    assert.ok(out.suggestions.every((v) => request.services.includes(v.type)));
    assert.equal(service.listRequests(org).length, 1);
    assert.equal(service.listRequests(other).length, 0);
    assert.equal(service.listRequests(admin).length, 1);
    assert.throws(() => service.updateRequest(other, out.id, { status: 'cancelled' }), /Not your request/);
    assert.throws(() => service.updateRequest(org, out.id, { status: 'confirmed' }), /only cancel/);
    const vendor = service.listVendors(admin).find((v) => v.type === 'umpires');
    const updated = service.updateRequest(admin, out.id, { status: 'matching', vendor_ids: [vendor.id, 'bogus'], admin_note: 'Matched umpire panel' });
    assert.equal(updated.status, 'matching');
    assert.deepEqual(updated.vendor_ids, [vendor.id]);
    assert.equal(service.updateRequest(org, out.id, { status: 'cancelled' }).status, 'cancelled');
    assert.throws(() => service.updateRequest(org, out.id, { status: 'cancelled' }), /already closed/);
  } finally { service.db.close(); }
});

test('partner listings start unverified, hide contact until verified, and only admins verify; content is admin-editable', () => {
  const service = createDatabase(':memory:');
  try {
    const admin = service.sessionUser(signIn(service, '9100000001', { name: 'Admin' }).token);
    const vendorUser = service.sessionUser(signIn(service, '9100000002', { name: 'Board Hire Co' }).token);
    assert.throws(() => service.addVendor(vendorUser, { name: 'X', type: 'boards', city: 'Pune', state: 'MH', contact: 'a@b.c', services: 'boards' }), /business/);
    assert.throws(() => service.addVendor(vendorUser, { name: 'Pune Boards', type: 'boards', city: 'Pune', state: 'Maharashtra', contact: 'pune@boards.in', url: 'http://insecure', services: 'Twelve tournament boards' }), /https/);
    const { id } = service.addVendor(vendorUser, { name: 'Pune Boards', type: 'boards', city: 'Pune', state: 'Maharashtra', contact: 'pune@boards.in', services: 'Twelve tournament boards with stands' });
    assert.equal(service.sessionUser(signIn(service, '9100000002', {}).token).role, 'player', 'listing a partner service does not change the account role');
    const publicView = service.listVendors(null).find((v) => v.id === id);
    assert.equal(publicView.verified, false);
    assert.equal(publicView.contact, 'Via CarromHub');
    assert.throws(() => service.updateVendor(vendorUser, id, { verified: 1 }), /Admin/);
    assert.equal(service.updateVendor(admin, id, { verified: 1 }).verified, true);
    assert.equal(service.listVendors(null).find((v) => v.id === id).contact, 'pune@boards.in');
    assert.ok(service.getContent().announcement.value.active);
    assert.throws(() => service.setContent(vendorUser, 'announcement', { active: false }), /Admin/);
    assert.throws(() => service.setContent(admin, 'Bad Key', {}), /Content key/);
    service.setContent(admin, 'announcement', { active: false, text: 'x' }, 'test');
    assert.equal(service.getContent().announcement.value.active, false);
    assert.equal(service.getContent().announcement.updated_by, 'test');
    service.setRole(admin, vendorUser.id, 'admin');
    assert.throws(() => service.setRole(admin, admin.id, 'player'), /own admin/);
    assert.equal(service.listUsers(admin).find((u) => u.id === vendorUser.id).role, 'admin');
  } finally { service.db.close(); }
});
