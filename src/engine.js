/*
 * Under the Rose — game engine.
 *
 * Pure game logic with no DOM access. The whole game lives in one plain,
 * JSON-serialisable state object (including the RNG state), so it can be
 * saved to localStorage and replayed deterministically in tests.
 *
 * Every action takes the state, mutates it, and returns { ok, msg }.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UnderTheRose = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- tuning --

  const CONFIG = {
    maxDays: 30,
    startCash: 2000,
    startDebt: 5500,
    startCapacity: 100,
    debtRate: 0.10,          // per day, compounding (loan shark)
    bankRate: 0.03,          // per day
    briefcaseSize: 10,
    gunSize: 5,
    maxGuns: 4,
    gunPrice: 450,
    healCostPerHp: 15,
    stashUpgradeSize: 25,
    stashUpgradeBase: 2500,
    maxContracts: 3,
    informCooldown: 3,
    loanLimitFriendly: 30000,
    loanLimitDefault: 10000,
  };

  // ------------------------------------------------------------ world data --

  const GOODS = [
    { id: 'moonshine', name: 'Moonshine', min: 20, max: 90 },
    { id: 'meds', name: 'Bootleg Meds', min: 150, max: 600 },
    { id: 'tech', name: 'Stolen Tech', min: 500, max: 1600 },
    { id: 'bills', name: 'Counterfeit Bills', min: 1000, max: 3200 },
    { id: 'jewels', name: 'Hot Jewels', min: 2500, max: 7500 },
    { id: 'ledgers', name: 'Black Ledgers', min: 6000, max: 16000 },
  ];

  // Traits are only the *starting* values; coups re-roll them during play.
  //  greed      — how tempted they are to stiff you
  //  honor      — how much a deal means to them
  //  volatility — how fast their alliances and moods swing
  const FACTIONS = [
    {
      id: 'syndicate', name: 'Calloway Syndicate', short: 'Syndicate', color: '#c9a227',
      blurb: 'Old-money mob. Runs the loan book. Keeps its word, mostly.',
      greed: 0.3, honor: 0.75, volatility: 0.2, demand: 'jewels', supply: 'moonshine', payMult: 1.0,
    },
    {
      id: 'kestrel', name: 'Kestrel Dynamics', short: 'Kestrel', color: '#4aa3df',
      blurb: 'A corporation with a security division and no conscience. Pays best.',
      greed: 0.8, honor: 0.3, volatility: 0.25, demand: 'ledgers', supply: 'tech', payMult: 1.35,
    },
    {
      id: 'lantern', name: 'Red Lantern Society', short: 'Lantern', color: '#d64545',
      blurb: 'Patient, disciplined, and long memories in both directions.',
      greed: 0.5, honor: 0.6, volatility: 0.3, demand: 'tech', supply: 'meds', payMult: 1.1,
    },
    {
      id: 'rats', name: 'Wharf Rats', short: 'Rats', color: '#7fb069',
      blurb: 'Dock crews and chop shops. Loud, hungry, impossible to predict.',
      greed: 0.55, honor: 0.3, volatility: 0.85, demand: 'moonshine', supply: 'bills', payMult: 0.85,
    },
    {
      id: 'precinct', name: 'The 9th Precinct', short: 'Precinct', color: '#9b8cd9', isLaw: true,
      blurb: 'The law, such as it is. Buys information. Sells looking the other way.',
      greed: 0.6, honor: 0.4, volatility: 0.3, demand: null, supply: null, payMult: 1.0,
    },
  ];

  const DISTRICTS = [
    { id: 'docks', name: 'The Docks', control: 'rats', service: 'fence',
      blurb: 'Fog, cranes and containers nobody inspects.' },
    { id: 'oldtown', name: 'Old Town', control: 'syndicate', service: 'loanshark',
      blurb: 'Social clubs with no members and very good espresso.' },
    { id: 'financial', name: 'Financial District', control: 'kestrel', service: 'bank',
      blurb: 'Glass towers. The crimes here have lawyers.' },
    { id: 'jaderow', name: 'Jade Row', control: 'lantern', service: 'doctor',
      blurb: 'Night markets, tea houses and a doctor who asks nothing.' },
    { id: 'foundry', name: 'The Foundry', control: 'syndicate', service: 'gunsmith',
      blurb: 'Dead mills and a gunsmith who works by appointment.' },
    { id: 'hillcrest', name: 'Hillcrest', control: 'precinct', service: 'desk', locked: true,
      blurb: 'Precinct HQ and nice lawns. Every price carries a risk premium.' },
  ];

  const SERVICES = {
    fence: 'Fence (stash upgrades)',
    loanshark: 'Loan Shark',
    bank: 'Bank',
    doctor: 'Back-alley Doctor',
    gunsmith: 'Gunsmith',
    desk: 'Precinct Desk',
  };

  const STARTING_RELATIONS = {
    'kestrel|syndicate': -20,
    'lantern|syndicate': 10,
    'rats|syndicate': -45,
    'kestrel|lantern': -35,
    'kestrel|rats': 15,
    'lantern|rats': -30,
  };

  const BRIEFCASE_CONTENTS = [
    { id: 'cash', weight: 35, label: 'Bundled cash' },
    { id: 'ledger', weight: 25, label: 'Incriminating ledger' },
    { id: 'decoy', weight: 20, label: 'Phone books — a decoy' },
    { id: 'tracker', weight: 20, label: 'A GPS tracker taped to the lining' },
  ];

  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
  const GOOD = byId(GOODS);
  const FACTION = byId(FACTIONS);
  const DISTRICT = byId(DISTRICTS);

  // ------------------------------------------------------------- utilities --

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');

  // mulberry32, with its state stored on the game state so saves are exact.
  function rand(s) {
    s.rng = (s.rng + 0x6d2b79f5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const randInt = (s, lo, hi) => lo + Math.floor(rand(s) * (hi - lo + 1));
  const randFloat = (s, lo, hi) => lo + rand(s) * (hi - lo);
  const chance = (s, p) => rand(s) < p;
  const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];
  function pickWeighted(s, arr) {
    const total = arr.reduce((a, x) => a + x.weight, 0);
    let r = rand(s) * total;
    for (const x of arr) {
      r -= x.weight;
      if (r < 0) return x;
    }
    return arr[arr.length - 1];
  }

  const relKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const relation = (s, a, b) => (a === b ? 100 : s.relations[relKey(a, b)] ?? 0);
  const setRelation = (s, a, b, v) => { s.relations[relKey(a, b)] = clamp(Math.round(v), -100, 100); };
  const atWar = (s, a, b) => s.wars.includes(relKey(a, b));
  const warsOf = (s, id) => s.wars.map((k) => k.split('|')).filter((p) => p.includes(id)).map((p) => (p[0] === id ? p[1] : p[0]));

  function log(s, text, tone = 'info') {
    s.log.push({ day: s.day, text, tone });
    if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
  }
  const ok = (msg) => ({ ok: true, msg });
  const fail = (msg) => ({ ok: false, msg });

  const gangs = (s) => FACTIONS.filter((f) => !f.isLaw && s.factions[f.id].alive).map((f) => f.id);
  const districtsOf = (s, fid) => DISTRICTS.filter((d) => s.control[d.id] === fid).map((d) => d.id);
  const adjustRep = (s, fid, delta) => { const f = s.factions[fid]; f.rep = clamp(Math.round(f.rep + delta), -100, 100); };

  // -------------------------------------------------------- derived values --

  function standing(rep) {
    if (rep >= 50) return 'Made';
    if (rep >= 20) return 'Trusted';
    if (rep > -20) return 'Neutral';
    if (rep > -50) return 'Distrusted';
    return 'Marked';
  }

  function capacityUsed(s) {
    let used = s.guns * CONFIG.gunSize;
    for (const g of GOODS) used += s.inventory[g.id].qty;
    used += s.contracts.filter((c) => c.type === 'courier').length * CONFIG.briefcaseSize;
    return used;
  }
  const capacityFree = (s) => s.capacity - capacityUsed(s);

  function isTrusted(s, fid) {
    return !FACTION[fid].isLaw && s.factions[fid].alive && s.factions[fid].rep >= 20;
  }

  /** Prices the player actually pays/receives here, after trust bonuses. */
  function quote(s, goodId) {
    const p = s.prices[goodId];
    if (p == null) return null;
    const trusted = isTrusted(s, s.control[s.location]);
    return {
      buy: Math.max(1, Math.round(p * (trusted ? 0.92 : 1))),
      sell: Math.max(1, Math.round(p * (trusted ? 1.08 : 1))),
    };
  }

  function maxBuy(s, goodId) {
    const q = quote(s, goodId);
    if (!q) return 0;
    return Math.max(0, Math.min(Math.floor(s.cash / q.buy), capacityFree(s)));
  }

  /** Rough chance a faction stiffs you on delivery. Shown to the player as a vibe, not a number. */
  function betrayChance(s, fid) {
    const f = s.factions[fid];
    let p = 0.04 + f.greed * 0.18 - f.honor * 0.08 - f.rep / 500;
    if (f.power < 30) p += 0.12; // desperate outfits cut corners
    return clamp(p, 0.02, 0.5);
  }

  function traitRead(f) {
    const words = [];
    if (f.greed >= 0.65) words.push('greedy');
    if (f.honor >= 0.6) words.push('honorable');
    else if (f.honor <= 0.35) words.push('treacherous');
    if (f.volatility >= 0.6) words.push('volatile');
    if (f.power < 30) words.push('desperate');
    return words.length ? words.join(', ') : 'hard to read';
  }

  function score(s) {
    return Math.round(s.cash + s.bank - s.debt);
  }

  function rank(points) {
    if (points < 0) return 'Fish Food';
    if (points < 10000) return 'Street Rat';
    if (points < 50000) return 'Runner';
    if (points < 150000) return 'Operator';
    if (points < 500000) return 'Kingpin';
    return 'Sub Rosa Legend';
  }

  function serviceStatus(s) {
    const d = DISTRICT[s.location];
    const ctrl = s.control[s.location];
    const f = s.factions[ctrl];
    if (d.service === 'desk') {
      return f.rep > -60 ? { service: 'desk', open: true } : { service: 'desk', open: false, why: 'The desk sergeant has your photo on the wall.' };
    }
    if (f.rep <= -50) return { service: d.service, open: false, why: `${FACTION[ctrl].short} muscle turns you away at the door.` };
    return { service: d.service, open: true };
  }

  // -------------------------------------------------------------- new game --

  function newGame(seed) {
    const s = {
      version: 1,
      rng: (seed == null ? Math.floor(Math.random() * 2 ** 32) : seed) >>> 0,
      day: 1,
      cash: CONFIG.startCash,
      bank: 0,
      debt: CONFIG.startDebt,
      health: 100,
      heat: 0,
      guns: 0,
      capacity: CONFIG.startCapacity,
      stashUpgrades: 0,
      location: 'docks',
      inventory: Object.fromEntries(GOODS.map((g) => [g.id, { qty: 0, cost: 0 }])),
      prices: {},
      control: Object.fromEntries(DISTRICTS.map((d) => [d.id, d.control])),
      factions: Object.fromEntries(FACTIONS.map((f) => [f.id, {
        alive: true, rep: 0, power: f.isLaw ? 100 : 60,
        greed: f.greed, honor: f.honor, volatility: f.volatility,
      }])),
      relations: {},
      wars: [],
      contracts: [],
      offers: [],
      encounter: null,
      lastInform: -99,
      nextId: 1,
      stats: { delivered: 0, betrayedBy: 0, soldOut: 0, kills: 0 },
      over: false,
      endReason: null,
      log: [],
    };
    for (const a of gangs(s)) {
      for (const b of gangs(s)) if (a < b) setRelation(s, a, b, STARTING_RELATIONS[relKey(a, b)] ?? 0);
      setRelation(s, a, 'precinct', -20);
    }
    s.factions.syndicate.power = 70;
    s.factions.rats.power = 50;
    log(s, `You owe the Calloway Syndicate ${fmt(s.debt)} at 10% a day. You have ${CONFIG.maxDays} days. Everyone in this city is for sale — including you.`, 'story');
    arrive(s, true);
    return s;
  }

  // ---------------------------------------------------------------- market --

  function rollPrices(s) {
    const ctrl = s.control[s.location];
    const fdef = FACTION[ctrl];
    const contested = warsOf(s, ctrl).length > 0;
    s.prices = {};
    let available = GOODS.filter(() => !chance(s, 0.15));
    if (available.length < 3) available = GOODS.slice();
    for (const g of available) {
      let p = randInt(s, g.min, g.max);
      if (fdef.demand === g.id) p *= 1.45;
      if (fdef.supply === g.id) p *= 0.6;
      if (fdef.isLaw) p *= 1.15;
      if (contested) p *= 1.25;
      s.prices[g.id] = Math.max(1, Math.round(p));
    }
    if (chance(s, 0.2)) {
      const g = GOOD[pick(s, Object.keys(s.prices))];
      const other = FACTION[pick(s, gangs(s).concat('precinct'))];
      if (chance(s, 0.5)) {
        s.prices[g.id] = Math.round(s.prices[g.id] * randFloat(s, 2.5, 4));
        log(s, `${other.name} seized a shipment of ${g.name}. Prices here are through the roof!`, 'market');
      } else {
        s.prices[g.id] = Math.max(1, Math.round(s.prices[g.id] * randFloat(s, 0.25, 0.4)));
        log(s, `${other.name} is dumping ${g.name} to raise cash. Prices have crashed!`, 'market');
      }
    }
  }

  function addHeat(s, value) {
    const mult = FACTION[s.control[s.location]].isLaw ? 2 : 1;
    s.heat = clamp(s.heat + Math.min(12, value / 2500) * mult, 0, 100);
  }

  function buy(s, goodId, qty) {
    const blocked = guard(s); if (blocked) return blocked;
    const q = quote(s, goodId);
    if (!q) return fail('Nobody is selling that here.');
    qty = Math.floor(qty);
    if (!(qty > 0)) return fail('Buy how many?');
    if (qty * q.buy > s.cash) return fail("You can't afford that many.");
    if (qty > capacityFree(s)) return fail("You can't carry that many.");
    const inv = s.inventory[goodId];
    inv.qty += qty;
    inv.cost += qty * q.buy;
    s.cash -= qty * q.buy;
    addHeat(s, qty * q.buy);
    return ok(`Bought ${qty} ${GOOD[goodId].name} for ${fmt(qty * q.buy)}.`);
  }

  function sell(s, goodId, qty) {
    const blocked = guard(s); if (blocked) return blocked;
    const q = quote(s, goodId);
    if (!q) return fail('Nobody is buying that here.');
    const inv = s.inventory[goodId];
    qty = Math.floor(qty);
    if (!(qty > 0)) return fail('Sell how many?');
    if (qty > inv.qty) return fail("You don't have that many.");
    const avg = inv.cost / inv.qty;
    inv.cost -= avg * qty;
    inv.qty -= qty;
    if (inv.qty === 0) inv.cost = 0;
    s.cash += qty * q.sell;
    addHeat(s, qty * q.sell);
    const ctrl = s.control[s.location];
    if (!FACTION[ctrl].isLaw && qty * q.sell >= 5000) adjustRep(s, ctrl, 1); // they take a cut, and like it
    return ok(`Sold ${qty} ${GOOD[goodId].name} for ${fmt(qty * q.sell)}.`);
  }

  // ---------------------------------------------------------------- travel --

  function guard(s) {
    if (s.over) return fail('The game is over.');
    if (s.encounter) return fail('Deal with the situation in front of you first.');
    return null;
  }

  function travel(s, to) {
    const blocked = guard(s); if (blocked) return blocked;
    if (!DISTRICT[to]) return fail('No such place.');
    if (to === s.location) return fail("You're already here.");
    s.location = to;
    advanceDay(s);
    if (s.over) return ok('Time is up.');
    arrive(s);
    return ok(`You arrive at ${DISTRICT[to].name}.`);
  }

  /** Stay put for a day: costs time, cools the heat. */
  function layLow(s) {
    const blocked = guard(s); if (blocked) return blocked;
    s.heat = Math.max(0, s.heat - 10);
    advanceDay(s);
    if (s.over) return ok('Time is up.');
    arrive(s, true);
    return ok('You lie low for a day.');
  }

  function advanceDay(s) {
    s.day += 1;
    if (s.debt > 0) s.debt = Math.round(s.debt * (1 + CONFIG.debtRate));
    s.bank = Math.round(s.bank * (1 + CONFIG.bankRate));
    s.heat = Math.max(0, s.heat - 3);
    factionTick(s);
    contractTick(s);
    if (s.day > CONFIG.maxDays) endGame(s, 'time');
  }

  function arrive(s, quiet = false) {
    rollPrices(s);
    generateOffers(s);
    if (!quiet || s.day > 1) rollEncounter(s);
    if (!s.encounter) randomEvent(s);
  }

  function randomEvent(s) {
    if (!chance(s, 0.18)) return;
    const roll = rand(s);
    if (roll < 0.3) {
      const cash = randInt(s, 100, 900);
      s.cash += cash;
      log(s, `You find ${fmt(cash)} in a coat somebody left on a bench. Nobody's coming back for it.`, 'good');
    } else if (roll < 0.55) {
      const g = pick(s, GOODS.slice(0, 4));
      const n = Math.min(capacityFree(s), randInt(s, 2, 8));
      if (n > 0) {
        s.inventory[g.id].qty += n;
        log(s, `A spooked courier drops ${n} ${g.name} and runs. Finders keepers.`, 'good');
      }
    } else if (roll < 0.8) {
      s.heat = clamp(s.heat + 10, 0, 100);
      log(s, 'A patrol car slows down to look at you. Your heat rises.', 'bad');
    } else {
      const fid = pick(s, gangs(s));
      if (fid) {
        adjustRep(s, fid, 5);
        log(s, `You buy a round for some ${FACTION[fid].short} soldiers. They remember the gesture.`, 'good');
      }
    }
  }

  // -------------------------------------------------------------- services --

  function needService(s, service) {
    const st = serviceStatus(s);
    if (st.service !== service) return fail(`There's no ${SERVICES[service]} here.`);
    if (!st.open) return fail(st.why);
    return null;
  }

  function deposit(s, amt) {
    const blocked = guard(s) || needService(s, 'bank'); if (blocked) return blocked;
    amt = Math.floor(amt);
    if (!(amt > 0) || amt > s.cash) return fail('Invalid amount.');
    s.cash -= amt; s.bank += amt;
    return ok(`Deposited ${fmt(amt)}.`);
  }

  function withdraw(s, amt) {
    const blocked = guard(s) || needService(s, 'bank'); if (blocked) return blocked;
    amt = Math.floor(amt);
    if (!(amt > 0) || amt > s.bank) return fail('Invalid amount.');
    s.bank -= amt; s.cash += amt;
    return ok(`Withdrew ${fmt(amt)}.`);
  }

  function loanLimit(s) {
    const limit = s.factions.syndicate.rep >= 0 ? CONFIG.loanLimitFriendly : CONFIG.loanLimitDefault;
    return Math.max(0, limit - s.debt);
  }

  function borrow(s, amt) {
    const blocked = guard(s) || needService(s, 'loanshark'); if (blocked) return blocked;
    amt = Math.floor(amt);
    if (!(amt > 0)) return fail('Invalid amount.');
    if (amt > loanLimit(s)) return fail(`The shark won't go past ${fmt(loanLimit(s))} more.`);
    s.cash += amt; s.debt += amt;
    return ok(`Borrowed ${fmt(amt)}. The meter is running.`);
  }

  function repay(s, amt) {
    const blocked = guard(s) || needService(s, 'loanshark'); if (blocked) return blocked;
    amt = Math.floor(Math.min(amt, s.debt));
    if (!(amt > 0) || amt > s.cash) return fail('Invalid amount.');
    s.cash -= amt; s.debt -= amt;
    if (s.debt === 0) {
      adjustRep(s, 'syndicate', 10);
      return ok('Debt cleared. The Syndicate appreciates a client who pays.');
    }
    return ok(`Paid ${fmt(amt)} toward your debt.`);
  }

  function buyGun(s) {
    const blocked = guard(s) || needService(s, 'gunsmith'); if (blocked) return blocked;
    if (s.guns >= CONFIG.maxGuns) return fail("You can't carry any more iron.");
    if (s.cash < CONFIG.gunPrice) return fail("You can't afford it.");
    if (capacityFree(s) < CONFIG.gunSize) return fail('No room in your stash.');
    s.cash -= CONFIG.gunPrice; s.guns += 1;
    return ok('You buy a pistol. Untraceable, allegedly.');
  }

  function healCost(s) {
    return (100 - s.health) * CONFIG.healCostPerHp;
  }

  function heal(s) {
    const blocked = guard(s) || needService(s, 'doctor'); if (blocked) return blocked;
    if (s.health >= 100) return fail("You're fine.");
    const hp = Math.min(100 - s.health, Math.floor(s.cash / CONFIG.healCostPerHp));
    if (hp <= 0) return fail("You can't afford the doctor.");
    s.cash -= hp * CONFIG.healCostPerHp; s.health += hp;
    return ok(`The doctor patches you up (+${hp} health).`);
  }

  function stashUpgradeCost(s) {
    return CONFIG.stashUpgradeBase * (s.stashUpgrades + 1);
  }

  function upgradeStash(s) {
    const blocked = guard(s) || needService(s, 'fence'); if (blocked) return blocked;
    const cost = stashUpgradeCost(s);
    if (s.cash < cost) return fail("You can't afford it.");
    s.cash -= cost; s.capacity += CONFIG.stashUpgradeSize; s.stashUpgrades += 1;
    return ok(`The fence rents you a lock-up. Capacity +${CONFIG.stashUpgradeSize}.`);
  }

  function bribeCost(s) {
    return Math.round(200 + s.heat * 30);
  }

  function bribe(s) {
    const blocked = guard(s) || needService(s, 'desk'); if (blocked) return blocked;
    if (s.heat < 1) return fail('Nobody is looking for you. Yet.');
    const cost = bribeCost(s);
    if (s.cash < cost) return fail("You can't afford the kind of friends you need.");
    s.cash -= cost; s.heat = Math.max(0, s.heat - 40);
    adjustRep(s, 'precinct', 3);
    return ok(`An envelope changes hands (${fmt(cost)}). Some paperwork goes missing.`);
  }

  function informPayout(s, target) {
    return 800 + s.factions[target].power * 30;
  }

  /** Sell a faction out to the Precinct. Lucrative. Dangerous if it leaks. */
  function inform(s, target) {
    const blocked = guard(s) || needService(s, 'desk'); if (blocked) return blocked;
    if (!FACTION[target] || FACTION[target].isLaw || !s.factions[target].alive) return fail('Inform on whom?');
    if (s.factions.precinct.rep < -30) return fail("They don't trust a word you say.");
    if (s.day - s.lastInform < CONFIG.informCooldown) return fail('The detectives are still checking your last tip.');
    const f = s.factions[target];
    const pay = informPayout(s, target);
    s.lastInform = s.day;
    s.cash += pay;
    s.heat = Math.max(0, s.heat - 25);
    adjustRep(s, 'precinct', 10);
    f.power = clamp(f.power - randInt(s, 10, 18), 0, 100);
    setRelation(s, target, 'precinct', relation(s, target, 'precinct') - 10);
    log(s, `You give the detectives names, dates and addresses. ${FACTION[target].name} gets raided. You get ${fmt(pay)}.`, 'story');
    if (chance(s, 0.2 + (f.rep > 20 ? 0.15 : 0))) {
      f.rep = clamp(Math.min(f.rep - 40, -50), -100, 100);
      log(s, `Word got out. ${FACTION[target].name} knows you're a rat.`, 'bad');
    }
    return ok('The detectives thank you for your civic spirit.');
  }

  // ------------------------------------------------------------- contracts --

  function makeContract(s, fid) {
    const fdef = FACTION[fid];
    const to = pick(s, DISTRICTS.filter((d) => d.id !== s.location)).id;
    const id = s.nextId++;
    if (chance(s, 0.6)) {
      const reward = Math.round(randInt(s, 12, 30) * 100 * (1 + s.day / 20) * fdef.payMult / 50) * 50;
      return {
        id, type: 'courier', client: fid, to, reward,
        deadline: s.day + randInt(s, 2, 4),
        contents: pickWeighted(s, BRIEFCASE_CONTENTS).id,
        peeked: false, disarmed: false, expired: false, orphaned: false,
      };
    }
    const g = pick(s, GOODS);
    const avg = (g.min + g.max) / 2;
    const qty = clamp(Math.round(randInt(s, 3000, 10000) * (1 + s.day / 15) / avg), 1, 40);
    return {
      id, type: 'supply', client: fid, to, good: g.id, qty,
      reward: Math.round(qty * avg * randFloat(s, 1.25, 1.6) * fdef.payMult / 50) * 50,
      deadline: s.day + randInt(s, 3, 6),
      expired: false, orphaned: false,
    };
  }

  function generateOffers(s) {
    s.offers = [];
    const ctrl = s.control[s.location];
    const f = s.factions[ctrl];
    if (FACTION[ctrl].isLaw || !f.alive || f.rep <= -40) return;
    const n = f.rep >= 20 ? randInt(s, 1, 2) : randInt(s, 0, 1);
    for (let i = 0; i < n; i++) s.offers.push(makeContract(s, ctrl));
  }

  function describeContract(c) {
    const who = FACTION[c.client].short;
    const where = DISTRICT[c.to].name;
    if (c.type === 'courier') return `${who}: carry a locked briefcase to ${where} by day ${c.deadline} — ${fmt(c.reward)}`;
    return `${who}: bring ${c.qty} ${GOOD[c.good].name} to ${where} by day ${c.deadline} — ${fmt(c.reward)}`;
  }

  function acceptOffer(s, id) {
    const blocked = guard(s); if (blocked) return blocked;
    const i = s.offers.findIndex((o) => o.id === id);
    if (i < 0) return fail('That offer is gone.');
    const c = s.offers[i];
    if (s.contracts.length >= CONFIG.maxContracts) return fail('You already have too many irons in the fire.');
    if (c.type === 'courier' && capacityFree(s) < CONFIG.briefcaseSize) return fail('No room for the briefcase.');
    s.offers.splice(i, 1);
    s.contracts.push(c);
    // Working for one side annoys its enemies.
    for (const other of gangs(s)) {
      if (other !== c.client && relation(s, other, c.client) <= -30) adjustRep(s, other, -3);
    }
    if (c.type === 'courier') log(s, `${FACTION[c.client].short} hands you a heavy, locked briefcase. "Don't open it."`, 'story');
    return ok('Deal.');
  }

  const findContract = (s, id) => s.contracts.find((c) => c.id === id);
  const removeContract = (s, id) => { s.contracts = s.contracts.filter((c) => c.id !== id); };

  function contractTick(s) {
    for (const c of s.contracts.slice()) {
      if (c.expired || c.orphaned || s.day <= c.deadline) continue;
      if (c.type === 'supply') {
        adjustRep(s, c.client, -15);
        removeContract(s, c.id);
        log(s, `You missed the ${FACTION[c.client].short} supply deadline. They won't forget.`, 'bad');
      } else {
        adjustRep(s, c.client, -30);
        c.expired = true;
        log(s, `The ${FACTION[c.client].short} briefcase is overdue. As far as they're concerned, you stole it.`, 'bad');
      }
    }
  }

  function deliver(s, id) {
    const blocked = guard(s); if (blocked) return blocked;
    const c = findContract(s, id);
    if (!c) return fail('No such job.');
    if (c.expired) return fail("It's too late to deliver. They think you stole it.");
    if (c.orphaned) return fail('Your client no longer exists.');
    if (c.to !== s.location) return fail(`The drop is in ${DISTRICT[c.to].name}.`);
    if (c.type === 'supply' && s.inventory[c.good].qty < c.qty) return fail(`You need ${c.qty} ${GOOD[c.good].name}.`);
    const client = FACTION[c.client];

    if (chance(s, betrayChance(s, c.client))) {
      s.stats.betrayedBy += 1;
      if (chance(s, 0.5)) {
        const pay = Math.round(c.reward * 0.4);
        handOver(s, c);
        s.cash += pay;
        log(s, `${client.short} counts out ${fmt(pay)} — 40% of the deal. "Times are tight. Take it or leave it." You take it.`, 'bad');
        return ok('Short-changed.');
      }
      adjustRep(s, c.client, -200); // floor it: this relationship is over
      startEncounter(s, 'ambush', c.client, { contractId: c.id });
      log(s, `It's a setup. ${client.short} gunmen step out from behind the van.`, 'bad');
      return ok('Ambush!');
    }

    handOver(s, c);
    s.cash += c.reward;
    s.stats.delivered += 1;
    adjustRep(s, c.client, randInt(s, 8, 15));
    let msg = `${client.short} pays ${fmt(c.reward)} in full.`;
    if (c.type === 'courier' && c.contents === 'decoy') {
      adjustRep(s, c.client, 10);
      msg += ' The case was full of phone books — a loyalty test. You passed.';
    }
    log(s, msg, 'good');
    return ok(msg);
  }

  function handOver(s, c) {
    if (c.type === 'supply') {
      const inv = s.inventory[c.good];
      const avg = inv.cost / inv.qty;
      inv.qty -= c.qty;
      inv.cost = inv.qty ? inv.cost - avg * c.qty : 0;
    }
    removeContract(s, c.id);
  }

  /** Who here would buy this briefcase instead of its owner, and for what. */
  function sellOutQuote(s, id) {
    const c = findContract(s, id);
    if (!c || c.type !== 'courier') return null;
    const buyer = s.control[s.location];
    if (buyer === c.client || !s.factions[buyer].alive) return null;
    const clientAlive = s.factions[c.client].alive;
    if (FACTION[buyer].isLaw) {
      const mult = { cash: 0.5, ledger: 3, tracker: 0.5, decoy: 0.1 }[c.contents];
      return { buyer, price: Math.round(c.reward * mult) };
    }
    if (clientAlive && relation(s, buyer, c.client) >= 0) return null;
    const mult = { cash: 1.6, ledger: 2, tracker: 1.2, decoy: 0.15 }[c.contents];
    return { buyer, price: Math.round(c.reward * mult * (clientAlive ? 1 : 0.8)) };
  }

  function sellOut(s, id) {
    const blocked = guard(s); if (blocked) return blocked;
    const q = sellOutQuote(s, id);
    if (!q) return fail('Nobody here wants that briefcase badly enough.');
    const c = findContract(s, id);
    removeContract(s, id);
    s.cash += q.price;
    s.stats.soldOut += 1;
    if (FACTION[q.buyer].isLaw) {
      s.heat = Math.max(0, s.heat - 25);
      adjustRep(s, 'precinct', 12);
    } else {
      adjustRep(s, q.buyer, 12);
    }
    if (s.factions[c.client].alive) {
      const f = s.factions[c.client];
      f.rep = clamp(Math.min(f.rep - 50, -50), -100, 100);
      if (!FACTION[q.buyer].isLaw) setRelation(s, q.buyer, c.client, relation(s, q.buyer, c.client) - 10);
    }
    const msg = c.contents === 'decoy'
      ? `${FACTION[q.buyer].short} pops the case: phone books. They toss you ${fmt(q.price)} out of pity. ${FACTION[c.client].short} will still want your head.`
      : `${FACTION[q.buyer].short} pays ${fmt(q.price)} for ${FACTION[c.client].short}'s briefcase. You've made an enemy.`;
    log(s, msg, 'story');
    return ok(msg);
  }

  function peek(s, id) {
    const blocked = guard(s); if (blocked) return blocked;
    const c = findContract(s, id);
    if (!c || c.type !== 'courier') return fail('Nothing to open.');
    if (c.peeked) return fail('You already know what is inside.');
    c.peeked = true;
    const label = BRIEFCASE_CONTENTS.find((x) => x.id === c.contents).label;
    let msg = `You jimmy the lock. Inside: ${label.toLowerCase()}.`;
    if (c.contents === 'tracker') {
      c.disarmed = true;
      msg += ' You smash it.';
    }
    if (s.factions[c.client].alive && chance(s, c.contents === 'tracker' ? 0.6 : 0.35)) {
      adjustRep(s, c.client, -15);
      msg += ` Somehow, ${FACTION[c.client].short} knows you looked.`;
    }
    log(s, msg, 'story');
    return ok(msg);
  }

  function dropContract(s, id) {
    const blocked = guard(s); if (blocked) return blocked;
    const c = findContract(s, id);
    if (!c) return fail('No such job.');
    removeContract(s, id);
    if (s.factions[c.client].alive && !c.expired) adjustRep(s, c.client, c.type === 'courier' ? -25 : -10);
    return ok(c.type === 'courier' ? 'You dump the briefcase in the river.' : 'You walk away from the job.');
  }

  // ------------------------------------------------------------ encounters --

  const ENCOUNTER_TEXT = {
    police: (s) => `Sirens. ${s.encounter.enemies} officers from the 9th Precinct box you in.`,
    squad: (s) => `${FACTION[s.encounter.faction].short} sent a hit squad — ${s.encounter.enemies} of them. You're Marked.`,
    interceptors: (s) => `${s.encounter.enemies} ${FACTION[s.encounter.faction].short} soldiers want the briefcase you're carrying.`,
    collectors: (s) => `${s.encounter.enemies} Syndicate collectors crack their knuckles. You owe ${fmt(s.debt)}.`,
    muggers: (s) => `${s.encounter.enemies} street punk${s.encounter.enemies > 1 ? 's' : ''} with knives want your wallet.`,
    ambush: (s) => `Your client's men — ${s.encounter.enemies} of them — open fire.`,
  };

  function startEncounter(s, kind, faction, extra = {}) {
    const enemies = {
      police: 2 + Math.floor(s.heat / 25) + randInt(s, 0, 1),
      squad: 3 + randInt(s, 0, 2),
      interceptors: 2 + randInt(s, 0, 2),
      collectors: 2,
      muggers: 1 + randInt(s, 0, 1),
      ambush: 3 + randInt(s, 0, 2),
    }[kind];
    s.encounter = { kind, faction, enemies, ...extra };
    log(s, ENCOUNTER_TEXT[kind](s), 'danger');
  }

  function rollEncounter(s) {
    const ctrl = s.control[s.location];
    const here = s.factions[ctrl];
    if (!FACTION[ctrl].isLaw && here.alive && here.rep <= -50 && chance(s, 0.55)) {
      return startEncounter(s, 'squad', ctrl);
    }
    if (s.debt > 20000 && s.factions.syndicate.alive && chance(s, 0.25)) {
      return startEncounter(s, 'collectors', 'syndicate');
    }
    const cases = s.contracts.filter((c) => c.type === 'courier');
    if (cases.length) {
      const c = pick(s, cases);
      const p = 0.12 + (c.contents === 'tracker' && !c.disarmed ? 0.25 : 0);
      const rivals = gangs(s).filter((g) => g !== c.client && relation(s, g, c.client) < 0);
      if (rivals.length && chance(s, p)) return startEncounter(s, 'interceptors', pick(s, rivals), { contractId: c.id });
    }
    const carrying = GOODS.some((g) => s.inventory[g.id].qty > 0);
    if ((carrying || s.heat > 20) && chance(s, 0.04 + s.heat / 200 + (FACTION[ctrl].isLaw ? 0.08 : 0))) {
      return startEncounter(s, 'police', 'precinct');
    }
    if (!isTrusted(s, ctrl) && chance(s, 0.05)) return startEncounter(s, 'muggers', null);
    return undefined;
  }

  function bribeEncounterCost(s) {
    return Math.round(300 + s.heat * 20 + s.encounter.enemies * 100);
  }

  function encounterOptions(s) {
    const e = s.encounter;
    if (!e) return [];
    const opts = [{ id: 'run', label: 'Run' }];
    if (s.guns > 0) opts.unshift({ id: 'fight', label: `Fight (${s.guns} gun${s.guns > 1 ? 's' : ''})` });
    if (e.kind === 'police') opts.push({ id: 'bribe', label: `Bribe (${fmt(bribeEncounterCost(s))})` });
    if (e.kind === 'collectors') opts.push({ id: 'pay', label: 'Pay what you can' });
    opts.push({ id: 'surrender', label: SURRENDER_LABEL[e.kind] });
    return opts;
  }

  const SURRENDER_LABEL = {
    police: 'Surrender (lose goods, fine)',
    squad: 'Beg (lose half your cash)',
    interceptors: 'Hand over the briefcase',
    collectors: 'Take the beating',
    muggers: 'Hand over your wallet',
    ambush: 'Walk away empty-handed',
  };

  function load(s) {
    return capacityUsed(s) / s.capacity;
  }

  function encounterAct(s, choice) {
    if (s.over) return fail('The game is over.');
    const e = s.encounter;
    if (!e) return fail('Nothing is happening.');
    if (!encounterOptions(s).some((o) => o.id === choice)) return fail("You can't do that.");

    if (choice === 'fight') {
      if (chance(s, Math.min(0.85, 0.45 + 0.1 * s.guns))) {
        e.enemies -= 1;
        s.stats.kills += 1;
        if (e.enemies <= 0) return winEncounter(s);
        log(s, `You drop one. ${e.enemies} left.`, 'danger');
      } else {
        log(s, 'You miss.', 'danger');
      }
      return enemyFire(s);
    }

    if (choice === 'run') {
      const p = clamp(0.55 - 0.03 * e.enemies + (load(s) < 0.5 ? 0.1 : 0), 0.15, 0.8);
      if (chance(s, p)) {
        log(s, 'You lose them in the alleys.', 'good');
        return escaped(s);
      }
      log(s, "You can't shake them.", 'danger');
      return enemyFire(s);
    }

    if (choice === 'bribe') {
      const cost = bribeEncounterCost(s);
      if (s.cash < cost) return fail("You don't have that kind of money on you.");
      if (chance(s, s.factions.precinct.honor * 0.3)) {
        log(s, '"Are you trying to bribe an officer?" This one is clean.', 'danger');
        s.heat = clamp(s.heat + 10, 0, 100);
        return enemyFire(s);
      }
      s.cash -= cost;
      s.heat = Math.max(0, s.heat - 10);
      log(s, `${fmt(cost)} buys you a warning and a wink.`, 'info');
      s.encounter = null;
      return ok('Bribed.');
    }

    if (choice === 'pay') {
      const owed = s.debt;
      const amt = Math.min(s.cash, owed);
      s.cash -= amt; s.debt -= amt;
      if (amt >= owed * 0.25) {
        adjustRep(s, 'syndicate', 2);
        log(s, `You hand over ${fmt(amt)}. "Pleasure doing business."`, 'info');
      } else {
        hurt(s, 15);
        log(s, `${fmt(amt)}? That's an insult. They make it clear how insulting.`, 'bad');
      }
      s.encounter = null;
      return ok('Paid.');
    }

    // surrender
    surrender(s);
    s.encounter = null;
    return ok('It could have been worse.');
  }

  function surrender(s) {
    const e = s.encounter;
    if (e.kind === 'police') {
      for (const g of GOODS) s.inventory[g.id] = { qty: 0, cost: 0 };
      const fine = Math.round(s.cash * 0.15);
      s.cash -= fine;
      s.heat = Math.max(0, s.heat - 30);
      adjustRep(s, 'precinct', 2);
      log(s, `They seize everything you're carrying and fine you ${fmt(fine)}.`, 'bad');
    } else if (e.kind === 'squad') {
      const lost = Math.round(s.cash * 0.5);
      s.cash -= lost;
      hurt(s, 15);
      adjustRep(s, e.faction, 10);
      log(s, `You beg. They take ${fmt(lost)} and a few teeth, and let you live — this time.`, 'bad');
    } else if (e.kind === 'interceptors') {
      const c = findContract(s, e.contractId);
      if (c) {
        removeContract(s, c.id);
        if (s.factions[c.client].alive && !c.expired) adjustRep(s, c.client, -20);
      }
      log(s, 'You hand over the briefcase. Your client will hear about this.', 'bad');
    } else if (e.kind === 'collectors') {
      hurt(s, 25);
      log(s, 'The collectors explain compound interest with a tyre iron.', 'bad');
    } else if (e.kind === 'muggers') {
      const lost = Math.round(s.cash * 0.25);
      s.cash -= lost;
      log(s, `They take ${fmt(lost)} and vanish.`, 'bad');
    } else if (e.kind === 'ambush') {
      const c = findContract(s, e.contractId);
      if (c) handOver(s, c);
      log(s, 'You put your hands up. They take the goods and leave you breathing.', 'bad');
    }
  }

  function hurt(s, dmg) {
    s.health = Math.max(0, s.health - dmg);
    if (s.health === 0) endGame(s, 'dead');
  }

  function enemyFire(s) {
    const e = s.encounter;
    let dmg = 0;
    for (let i = 0; i < e.enemies; i++) if (chance(s, 0.22)) dmg += randInt(s, 3, 9);
    if (dmg) log(s, `You're hit for ${dmg} damage.`, 'danger');
    hurt(s, dmg);
    if (s.over) s.encounter = null;
    return ok(dmg ? 'Hit.' : 'They miss.');
  }

  /** Escaping or winning an ambush leaves you holding goods you were never paid for. */
  function keepAmbushLoot(s) {
    const e = s.encounter;
    if (e.kind !== 'ambush') return;
    const c = findContract(s, e.contractId);
    if (!c) return;
    if (c.type === 'courier') {
      c.expired = true;
      log(s, "You still have their briefcase. They tried to kill you — it's yours to sell now.", 'story');
    } else {
      removeContract(s, c.id);
    }
  }

  function escaped(s) {
    keepAmbushLoot(s);
    if (s.encounter.kind === 'police') s.heat = clamp(s.heat + 5, 0, 100);
    s.encounter = null;
    return ok('Escaped.');
  }

  function winEncounter(s) {
    const e = s.encounter;
    keepAmbushLoot(s);
    let loot = 0;
    if (e.kind === 'police') {
      s.heat = clamp(s.heat + 20, 0, 100);
      adjustRep(s, 'precinct', -15);
      loot = randInt(s, 100, 600);
    } else if (e.kind === 'muggers') {
      loot = randInt(s, 20, 200);
    } else {
      if (e.faction && s.factions[e.faction].alive) {
        s.factions[e.faction].power = clamp(s.factions[e.faction].power - 4, 0, 100);
        adjustRep(s, e.faction, -5);
      }
      loot = randInt(s, 200, 1500);
    }
    s.cash += loot;
    let msg = `The last one goes down. You search the bodies: ${fmt(loot)}.`;
    if (chance(s, 0.2) && s.guns < CONFIG.maxGuns && capacityFree(s) >= CONFIG.gunSize) {
      s.guns += 1;
      msg += ' And a pistol.';
    }
    log(s, msg, 'good');
    s.encounter = null;
    return ok('Won.');
  }

  // --------------------------------------------------------- faction drama --

  function news(s, text) {
    log(s, text, 'news');
  }

  function factionTick(s) {
    const ids = gangs(s);

    // Relations drift; grudges become wars; wars occasionally burn out.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const fa = s.factions[a], fb = s.factions[b];
        const swing = 0.5 + (fa.volatility + fb.volatility) / 2;
        let v = relation(s, a, b) + randInt(s, -6, 5) * swing;
        const key = relKey(a, b);
        if (atWar(s, a, b)) {
          v -= 1;
          const tired = fa.power < 35 && fb.power < 35;
          if (chance(s, 0.08 + (tired ? 0.15 : 0))) {
            s.wars = s.wars.filter((k) => k !== key);
            v = -15;
            news(s, `${FACTION[a].short} and ${FACTION[b].short} sign a truce over dinner in a neutral restaurant.`);
          }
        } else if (v <= -45 && chance(s, 0.35)) {
          s.wars.push(key);
          news(s, `WAR: ${FACTION[a].name} and ${FACTION[b].name} are shooting at each other in the streets.`);
        }
        setRelation(s, a, b, v);
      }
    }

    for (const key of s.wars.slice()) if (chance(s, 0.45)) skirmish(s, key);

    // Turf pays; having none bleeds you.
    for (const id of ids) {
      const f = s.factions[id];
      f.power = clamp(f.power + districtsOf(s, id).length - 1, 0, 100);
    }

    // Anything can go wrong at any time.
    for (const id of ids) {
      if (s.factions[id].alive && chance(s, 0.03 + 0.05 * s.factions[id].volatility)) upheaval(s, id);
    }
    if (chance(s, 0.12) && ids.length) {
      const target = pick(s, ids);
      const f = s.factions[target];
      f.power = clamp(f.power - randInt(s, 5, 12), 0, 100);
      news(s, `The 9th Precinct raids a ${FACTION[target].short} stash house. Arrests on the evening news.`);
    }
    if (chance(s, 0.04)) {
      if (chance(s, 0.5)) {
        s.heat = clamp(s.heat + 15, 0, 100);
        news(s, 'The mayor announces a crackdown. Every cop in the city is looking harder.');
      } else {
        const p = s.factions.precinct;
        p.greed = clamp(p.greed + 0.15, 0, 1);
        p.honor = clamp(p.honor - 0.15, 0, 1);
        news(s, 'A corruption scandal guts the Precinct leadership. The new captain is very open to offers.');
      }
    }

    for (const id of ids) if (s.factions[id].alive && s.factions[id].power <= 0) collapse(s, id);
  }

  function skirmish(s, key) {
    let [a, b] = key.split('|');
    if (chance(s, 0.5)) [a, b] = [b, a];
    const fa = s.factions[a], fb = s.factions[b];
    const targets = districtsOf(s, b).filter((d) => !DISTRICT[d].locked);
    const winA = chance(s, (fa.power + 1) / (fa.power + fb.power + 2));
    const [win, lose] = winA ? [a, b] : [b, a];
    s.factions[lose].power = clamp(s.factions[lose].power - randInt(s, 4, 9), 0, 100);
    s.factions[win].power = clamp(s.factions[win].power - randInt(s, 1, 4), 0, 100);
    if (winA && targets.length) {
      const d = pick(s, targets);
      s.control[d] = a;
      news(s, `${FACTION[a].short} takes ${DISTRICT[d].name} from ${FACTION[b].short}.`);
    } else {
      news(s, `${FACTION[a].short} hits ${FACTION[b].short}. ${FACTION[win].short} comes out ahead.`);
    }
  }

  function upheaval(s, id) {
    const f = s.factions[id];
    const name = FACTION[id].name;
    const roll = rand(s);
    if (roll < 0.3) {
      f.greed = randFloat(s, 0.1, 0.9);
      f.honor = randFloat(s, 0.1, 0.9);
      f.volatility = randFloat(s, 0.1, 0.9);
      f.rep = Math.round(f.rep * 0.3);
      news(s, `COUP: ${name} has a new boss. Old favors — and old grudges — mostly don't count any more.`);
    } else if (roll < 0.5) {
      if (f.rep >= 20) {
        f.rep -= 20;
        news(s, `${name} is hunting for a mole. Your name keeps coming up.`);
      } else {
        news(s, `${name} is hunting for a mole. Two lieutenants disappear.`);
        f.power = clamp(f.power - 5, 0, 100);
      }
    } else if (roll < 0.75) {
      f.power = clamp(f.power + 12, 0, 100);
      news(s, `${name} pulls off a big score. They're flush, and feeling bold.`);
    } else {
      f.power = clamp(f.power - 15, 0, 100);
      const others = gangs(s).filter((g) => g !== id);
      if (others.length) {
        const to = pick(s, others);
        s.factions[to].power = clamp(s.factions[to].power + 8, 0, 100);
        news(s, `A ${FACTION[id].short} captain defects to ${FACTION[to].short}, taking a crew along.`);
      } else {
        news(s, `A ${FACTION[id].short} captain quits the life, taking a crew along.`);
      }
    }
  }

  function collapse(s, id) {
    const f = s.factions[id];
    f.alive = false;
    const enemies = warsOf(s, id).filter((g) => s.factions[g].alive);
    s.wars = s.wars.filter((k) => !k.split('|').includes(id));
    const heirs = gangs(s);
    const pool = enemies.length ? enemies : heirs;
    const heir = pool.length ? pool.reduce((best, g) => (s.factions[g].power > s.factions[best].power ? g : best)) : 'precinct';
    for (const d of districtsOf(s, id)) s.control[d] = heir;
    news(s, `${FACTION[id].name} is finished. ${FACTION[heir].short} moves into their turf.`);
    for (const c of s.contracts.slice()) {
      if (c.client !== id) continue;
      if (c.type === 'courier') {
        c.orphaned = true;
        log(s, `Your client is gone. Their briefcase is yours to sell to whoever wants it.`, 'story');
      } else {
        removeContract(s, c.id);
      }
    }
  }

  // ---------------------------------------------------------------- ending --

  function endGame(s, reason) {
    s.over = true;
    s.endReason = reason;
    s.day = Math.min(s.day, CONFIG.maxDays);
    if (reason === 'dead') {
      log(s, 'You bleed out on the pavement. The city doesn\'t notice.', 'danger');
    } else {
      const pts = score(s);
      log(s, `Day ${CONFIG.maxDays} is over. Net worth: ${fmt(pts)}. Rank: ${rank(pts)}.`, 'story');
    }
  }

  return {
    CONFIG, GOODS, FACTIONS, DISTRICTS, SERVICES, GOOD, FACTION, DISTRICT,
    newGame,
    // actions
    buy, sell, travel, layLow, deposit, withdraw, borrow, repay, buyGun, heal,
    upgradeStash, bribe, inform, acceptOffer, deliver, sellOut, peek, dropContract, encounterAct,
    // read-only helpers for UIs
    quote, maxBuy, capacityUsed, capacityFree, standing, relation, atWar, warsOf, traitRead,
    betrayChance, sellOutQuote, describeContract, encounterOptions, serviceStatus, loanLimit,
    healCost, stashUpgradeCost, bribeCost, informPayout, districtsOf, score, rank, fmt,
  };
});
