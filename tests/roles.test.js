const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../database');

const signIn = (service, phone, profile) => service.sessionUser(service.verifyOtp(phone, service.requestOtp(phone).code, profile).token);
const soon = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

test('roles: sign-up accepts player/organiser/merchant only; legacy vendor/umpire databases migrate', () => {
  const service = createDatabase(':memory:');
  try {
    signIn(service, '9000000001', { name: 'Admin' });
    assert.equal(signIn(service, '9000000002', { name: 'Shop Owner', role: 'merchant' }).role, 'merchant');
    assert.equal(signIn(service, '9000000003', { name: 'Ump', role: 'umpire' }).role, 'player', 'unknown roles fall back to player');
    assert.equal(signIn(service, '9000000004', { name: 'Vend', role: 'vendor' }).role, 'player');
  } finally { service.db.close(); }
});

test('organiser creates events; players request to join; organiser approves within slots; players can withdraw', () => {
  const service = createDatabase(':memory:');
  try {
    signIn(service, '9100000000', { name: 'Admin' });
    const org = signIn(service, '9100000001', { name: 'Office Organiser', role: 'organiser', org: 'CEA' });
    const p1 = signIn(service, '9100000002', { name: 'Player One' });
    const p2 = signIn(service, '9100000003', { name: 'Player Two' });
    const p3 = signIn(service, '9100000004', { name: 'Player Three' });
    const input = { name: 'CEA Inter-Division Cup', type: 'Tournament', format: 'Singles', city: 'New Delhi', state: 'Delhi', start_date: soon(10), end_date: soon(11), slots: 2, fee: 100, venue: 'Sewa Bhawan' };
    assert.throws(() => service.createEvent(p1, input), /organiser accounts/);
    assert.throws(() => service.createEvent(org, { ...input, start_date: '2001-01-01' }), /today or later/);
    assert.throws(() => service.createEvent(org, { ...input, slots: 1 }), /Slots/);
    const ev = service.createEvent(org, input);
    assert.match(ev.id, /^EV-/);
    assert.equal(ev.status, 'open');
    assert.throws(() => service.joinEvent(org, ev.id), /organiser of this event/);
    const j1 = service.joinEvent(p1, ev.id, { note: 'Men singles please' });
    assert.equal(j1.status, 'pending');
    assert.throws(() => service.joinEvent(p1, ev.id), /already have a request/);
    const j2 = service.joinEvent(p2, ev.id);
    const j3 = service.joinEvent(p3, ev.id);
    assert.equal(service.listEvents(p1)[0].my.status, 'pending');
    assert.equal(service.listEvents(p1)[0].pending, undefined, 'pending count hidden from non-owners');
    assert.equal(service.listEvents(org)[0].pending, 3);
    assert.throws(() => service.decideJoin(p2, ev.id, j1.id, 'approved'), /Only the organiser/);
    assert.throws(() => service.decideJoin(org, ev.id, j1.id, 'withdrawn'), /Only the player/);
    assert.equal(service.decideJoin(org, ev.id, j1.id, 'approved').status, 'approved');
    assert.equal(service.decideJoin(org, ev.id, j2.id, 'approved').status, 'approved');
    assert.throws(() => service.decideJoin(org, ev.id, j3.id, 'approved'), /slots are filled/);
    assert.throws(() => service.joinEvent(signIn(service, '9100000005', { name: 'Late Player' }), ev.id), /slots are filled/);
    assert.equal(service.decideJoin(p1, ev.id, j1.id, 'withdrawn').status, 'withdrawn');
    assert.equal(service.decideJoin(org, ev.id, j3.id, 'approved').status, 'approved', 'withdrawal frees a slot');
    const detail = service.getEvent(p2, ev.id);
    assert.equal(detail.approved, 2);
    assert.ok(detail.joins.every((j) => j.status === 'approved' && !j.note), 'public view shows only approved roster');
    assert.equal(service.getEvent(org, ev.id).joins.length, 3);
    assert.equal(service.listMyJoins(p1)[0].event_name, 'CEA Inter-Division Cup');
    assert.equal(service.updateEvent(org, ev.id, { status: 'closed' }).status, 'closed');
    assert.throws(() => service.joinEvent(signIn(service, '9100000006', { name: 'Another' }), ev.id), /not accepting/);
    assert.throws(() => service.updateEvent(p1, ev.id, { status: 'open' }), /Only the organiser/);
  } finally { service.db.close(); }
});

test('merchant lists products, manages stock; buyers order (stock decrements), fulfilment steps and cancellation restock', () => {
  const service = createDatabase(':memory:');
  try {
    signIn(service, '9200000000', { name: 'Admin' });
    const shop = signIn(service, '9200000001', { name: 'Synco Store', role: 'merchant', org: 'Synco Sports' });
    const buyer = signIn(service, '9200000002', { name: 'Buyer' });
    const item = { name: 'Tournament striker 15 g', category: 'Strikers', price: 899, mrp: 1099, stock: 5, specs: '4.13 cm, 15 g' };
    assert.throws(() => service.createListing(buyer, item), /merchant accounts/);
    assert.throws(() => service.createListing(shop, { ...item, mrp: 500 }), /MRP/);
    const l = service.createListing(shop, item);
    assert.equal(l.emoji, '⚪');
    assert.equal(service.listListings(null).length, 1);
    assert.equal(service.updateListing(shop, l.id, { stock_delta: 5 }).stock, 10);
    assert.throws(() => service.updateListing(buyer, l.id, { stock: 0 }), /Only the merchant/);
    const orderInput = { listing_id: l.id, qty: 3, phone: '9811111111', address: '12 Sewa Bhawan, R.K. Puram, New Delhi 110066', payment: 'UPI' };
    assert.throws(() => service.createOrder(shop, orderInput), /own listing/);
    assert.throws(() => service.createOrder(buyer, { ...orderInput, qty: 50 }), /Quantity/);
    assert.throws(() => service.createOrder(buyer, { ...orderInput, qty: 11 }), /Only 10 left/);
    const o = service.createOrder(buyer, orderInput);
    assert.equal(o.total, 899 * 3);
    assert.equal(service.listListings(null)[0].stock, 7);
    assert.equal(service.listOrders(buyer)[0].selling, false);
    assert.equal(service.listOrders(shop)[0].selling, true);
    assert.throws(() => service.updateOrder(buyer, o.id, 'packed'), /Only the merchant/);
    assert.throws(() => service.updateOrder(shop, o.id, 'shipped'), /Next step/);
    assert.equal(service.updateOrder(shop, o.id, 'packed').status, 'packed');
    assert.throws(() => service.updateOrder(buyer, o.id, 'cancelled'), /no longer be cancelled/);
    assert.equal(service.updateOrder(shop, o.id, 'cancelled').status, 'cancelled');
    assert.equal(service.listListings(null)[0].stock, 10, 'cancellation restocks');
    service.updateListing(shop, l.id, { active: false });
    assert.equal(service.listListings(null).length, 0);
    assert.equal(service.listListings(shop, 'mine').length, 1);
    assert.throws(() => service.createOrder(buyer, orderInput), /no longer available/);
  } finally { service.db.close(); }
});
