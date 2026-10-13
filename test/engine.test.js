'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/engine.js');

const totalGoods = (s) => G.GOODS.reduce((n, g) => n + s.inventory[g.id].qty, 0);

test('new game starts in a sane state', () => {
  const s = G.newGame(1);
  assert.strictEqual(s.day, 1);
  assert.strictEqual(s.cash, G.CONFIG.startCash);
  assert.strictEqual(s.debt, G.CONFIG.startDebt);
  assert.ok(Object.keys(s.prices).length >= 3);
  assert.strictEqual(s.encounter, null);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
});

test('same seed and same moves give the same game', () => {
  const a = G.newGame(42);
  const b = G.newGame(42);
  for (const to of ['oldtown', 'financial', 'jaderow', 'docks']) {
    G.travel(a, to);
    G.travel(b, to);
    if (a.encounter) G.encounterAct(a, 'surrender');
    if (b.encounter) G.encounterAct(b, 'surrender');
  }
  assert.deepStrictEqual(a, b);
});

test('buying and selling respects cash and capacity', () => {
  const s = G.newGame(7);
  const goodId = Object.keys(s.prices)[0];
  const max = G.maxBuy(s, goodId);
  assert.ok(max > 0);
  assert.strictEqual(G.buy(s, goodId, max + 1).ok, false);
  assert.ok(G.buy(s, goodId, max).ok);
  assert.ok(s.cash >= 0);
  assert.ok(G.capacityUsed(s) <= s.capacity);
  assert.strictEqual(G.sell(s, goodId, max + 1).ok, false);
  assert.ok(G.sell(s, goodId, max).ok);
  assert.strictEqual(s.inventory[goodId].qty, 0);
  assert.strictEqual(s.inventory[goodId].cost, 0);
});

test('debt compounds and the game ends after the last day', () => {
  const s = G.newGame(3);
  s.health = 1e9; // survive whatever happens on the road
  const order = ['oldtown', 'docks'];
  let i = 0;
  while (!s.over) {
    if (s.encounter) G.encounterAct(s, 'surrender');
    else G.travel(s, order[i++ % 2]);
  }
  assert.strictEqual(s.endReason, 'time');
  assert.strictEqual(s.day, G.CONFIG.maxDays);
  assert.ok(s.debt > G.CONFIG.startDebt * 10);
});

test('services only work in their district', () => {
  const s = G.newGame(5); // starts at the Docks (fence)
  assert.strictEqual(G.deposit(s, 100).ok, false);
  assert.strictEqual(G.borrow(s, 100).ok, false);
  s.location = 'oldtown';
  assert.ok(G.borrow(s, 1000).ok);
  assert.ok(G.repay(s, 500).ok);
  s.location = 'financial';
  assert.ok(G.deposit(s, 100).ok);
  assert.ok(G.withdraw(s, 100).ok);
});

test('a Marked faction shuts its services', () => {
  const s = G.newGame(5);
  s.location = 'oldtown';
  s.factions.syndicate.rep = -80;
  const r = G.borrow(s, 100);
  assert.strictEqual(r.ok, false);
  assert.match(r.msg, /turns you away/);
});

test('courier job: deliver pays, or betrayal is handled', () => {
  for (let seed = 1; seed < 60; seed++) {
    const s = G.newGame(seed);
    const c = { id: 999, type: 'courier', client: 'syndicate', to: s.location, reward: 2000,
      deadline: 10, contents: 'cash', peeked: false, disarmed: false, expired: false, orphaned: false };
    s.contracts.push(c);
    const cash = s.cash;
    const r = G.deliver(s, 999);
    assert.ok(r.ok);
    if (s.encounter) {
      assert.strictEqual(s.encounter.kind, 'ambush');
      G.encounterAct(s, 'surrender');
      assert.strictEqual(s.contracts.length, 0);
    } else {
      assert.strictEqual(s.contracts.length, 0);
      assert.ok(s.cash > cash);
    }
  }
});

test('selling a briefcase to the client\'s enemy marks you with the client', () => {
  const s = G.newGame(9);
  s.location = 'docks'; // Rats turf; Rats and Syndicate start hostile
  s.contracts.push({ id: 5, type: 'courier', client: 'syndicate', to: 'oldtown', reward: 2000,
    deadline: 10, contents: 'ledger', peeked: false, disarmed: false, expired: false, orphaned: false });
  const q = G.sellOutQuote(s, 5);
  assert.ok(q && q.buyer === 'rats' && q.price === 4000);
  assert.ok(G.sellOut(s, 5).ok);
  assert.ok(s.factions.syndicate.rep <= -50);
  assert.strictEqual(G.standing(s.factions.syndicate.rep), 'Marked');
});

test('the briefcase cannot be sold to the client itself or its friends', () => {
  const s = G.newGame(9);
  s.location = 'jaderow'; // Lantern; Lantern and Syndicate start friendly
  s.contracts.push({ id: 5, type: 'courier', client: 'syndicate', to: 'oldtown', reward: 2000,
    deadline: 10, contents: 'cash', peeked: false, disarmed: false, expired: false, orphaned: false });
  assert.strictEqual(G.sellOutQuote(s, 5), null);
  assert.strictEqual(G.sellOut(s, 5).ok, false);
});

test('actions are blocked during an encounter', () => {
  const s = G.newGame(11);
  s.encounter = { kind: 'muggers', faction: null, enemies: 1 };
  assert.strictEqual(G.travel(s, 'oldtown').ok, false);
  assert.ok(G.encounterAct(s, 'surrender').ok);
  assert.strictEqual(s.encounter, null);
});

test('fuzz: random play never breaks invariants', () => {
  const ids = G.DISTRICTS.map((d) => d.id);
  for (let seed = 1; seed <= 400; seed++) {
    const s = G.newGame(seed);
    let rng = seed;
    const r = () => { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
    const any = (arr) => arr[Math.floor(r() * arr.length)];
    let steps = 0;
    while (!s.over && steps++ < 2000) {
      if (s.encounter) {
        G.encounterAct(s, any(G.encounterOptions(s)).id);
      } else {
        const roll = r();
        const goods = Object.keys(s.prices);
        if (roll < 0.25) G.buy(s, any(goods), Math.max(1, Math.floor(G.maxBuy(s, any(goods)) * r())));
        else if (roll < 0.45) { const g = any(goods); G.sell(s, g, s.inventory[g].qty); }
        else if (roll < 0.52 && s.offers.length) G.acceptOffer(s, any(s.offers).id);
        else if (roll < 0.6 && s.contracts.length) G.deliver(s, any(s.contracts).id);
        else if (roll < 0.63 && s.contracts.length) G.sellOut(s, any(s.contracts).id);
        else if (roll < 0.65 && s.contracts.length) G.peek(s, any(s.contracts).id);
        else if (roll < 0.67) G.inform(s, any(['syndicate', 'kestrel', 'lantern', 'rats']));
        else if (roll < 0.69) G.buyGun(s);
        else if (roll < 0.71) G.heal(s);
        else if (roll < 0.73) G.repay(s, s.cash);
        else if (roll < 0.75) G.layLow(s);
        else G.travel(s, any(ids));
      }
      assert.ok(s.cash >= 0, `cash negative (seed ${seed})`);
      assert.ok(s.bank >= 0 && s.debt >= 0);
      assert.ok(s.health >= 0 && s.health <= 100);
      assert.ok(s.heat >= 0 && s.heat <= 100);
      assert.ok(G.capacityUsed(s) <= s.capacity + G.CONFIG.briefcaseSize, `overloaded (seed ${seed})`);
      assert.ok(totalGoods(s) >= 0);
      assert.ok(s.contracts.length <= G.CONFIG.maxContracts);
      assert.strictEqual(s.control.hillcrest, 'precinct');
      for (const f of Object.values(s.factions)) assert.ok(f.rep >= -100 && f.rep <= 100);
      for (const g of G.GOODS) assert.ok(Number.isFinite(s.inventory[g.id].cost));
    }
    assert.ok(s.over, `game ${seed} never ended`);
  }
});
