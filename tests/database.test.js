const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../database');

const claim = { player_id: 'p2', tournament_id: 't8', category: "Men's Singles", placement: 2, winnings: 120000, evidence: 'https://example.com/results.pdf' };
const invite = { recipient_id: 'p2', venue_id: 'c1', format: 'Best of 3', scheduled_at: new Date(Date.now() + 86400000).toISOString() };

test('claims do not count until the assigned organizer verifies evidence', () => {
  const service = createDatabase(':memory:');
  try {
    const result = service.submitResult('p2', claim);
    assert.equal(service.state('p2').players.find((entry) => entry.id === 'p2').winnings, 0);
    assert.throws(() => service.review('p2', result.id, { status: 'verified', note: 'Checked sheet' }), /assigned organizer/);
    assert.throws(() => service.review('o2', result.id, { status: 'verified', note: 'Checked sheet' }), /assigned organizer/);
    service.review('o1', result.id, { status: 'verified', note: 'Checked against signed result sheet' });
    assert.equal(service.state('p2').players.find((entry) => entry.id === 'p2').winnings, 120000);
    assert.throws(() => service.review('o1', result.id, { status: 'verified', note: 'Checked again' }), /already/);
    assert.throws(() => service.submitResult('p2', claim), /already/);
  } finally { service.db.close(); }
});

test('result validation, rejection, privacy and prize-pool rollback', () => {
  const service = createDatabase(':memory:');
  try {
    assert.throws(() => service.submitResult('p1', claim), /own results/);
    assert.throws(() => service.submitResult('o2', claim), /not assigned/);
    assert.throws(() => service.submitResult('p2', { ...claim, winnings: -1 }), /Winnings/);
    assert.throws(() => service.submitResult('p2', { ...claim, evidence: 'javascript:alert(1)' }), /HTTPS/);
    assert.throws(() => service.submitResult('p2', { ...claim, tournament_id: 't1' }), /completed/);
    const result = service.submitResult('p2', claim);
    assert.ok(!service.state('p1').results.some((entry) => entry.id === result.id));
    service.review('o1', result.id, { status: 'rejected', note: 'Missing signed result sheet' });
    assert.equal(service.state('p2').players.find((entry) => entry.id === 'p2').winnings, 0);
    service.submitResult('p2', { ...claim, winnings: 4900000 });
    const pending = service.state('o1').results.find((entry) => entry.status === 'pending');
    assert.throws(() => service.review('o1', pending.id, { status: 'verified', note: 'Checked signed sheet' }), /exceed/);
    assert.equal(service.state('o1').results.find((entry) => entry.id === pending.id).status, 'pending');
  } finally { service.db.close(); }
});

test('challenges require radar, future dates, availability and the right participant', () => {
  const service = createDatabase(':memory:');
  try {
    assert.throws(() => service.challenge('p1', invite), /radar/);
    service.radar('p1', 'p2', true);
    assert.throws(() => service.challenge('p1', { ...invite, recipient_id: 'p1' }), /yourself/);
    assert.throws(() => service.challenge('p1', { ...invite, recipient_id: 'p8' }), /guardian/);
    assert.throws(() => service.challenge('p1', { ...invite, scheduled_at: 'bad date' }), /Schedule/);
    service.updateProfile('p2', { style: 'Precision player', accepting: false });
    assert.throws(() => service.challenge('p1', invite), /not accepting/);
    service.updateProfile('p2', { style: 'Precision player', accepting: true });
    const result = service.challenge('p1', invite);
    assert.throws(() => service.challenge('p1', invite), /already exists/);
    assert.throws(() => service.respond('p3', result.id, { status: 'accepted' }), /not belong/);
    assert.throws(() => service.respond('p1', result.id, { status: 'accepted' }), /not allowed/);
    service.respond('p2', result.id, { status: 'accepted' });
    assert.equal(service.state('p1').challenges[0].status, 'accepted');
    service.respond('p1', result.id, { status: 'cancelled' });
    assert.throws(() => service.respond('p2', result.id, { status: 'accepted' }), /not allowed/);
    assert.equal(service.state('p3').challenges.length, 0);
  } finally { service.db.close(); }
});