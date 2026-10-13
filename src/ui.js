/* Under the Rose — browser UI. Renders the engine state and wires up buttons. */
(function () {
  'use strict';
  const G = window.UnderTheRose;
  const SAVE_KEY = 'under-the-rose-save-v1';
  const $ = (id) => document.getElementById(id);
  const fmt = G.fmt;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let s = load() || G.newGame();
  let helpOpen = false;

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const st = raw && JSON.parse(raw);
      return st && st.version === 1 ? st : null;
    } catch (e) {
      return null;
    }
  }
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* private mode: play without saving */ }
  }

  let toastTimer;
  function toast(msg, isError) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function act(result) {
    if (result && result.msg) toast(result.msg, !result.ok);
    save();
    render();
  }

  // --------------------------------------------------------------- panels --

  const factionDot = (fid) => `<span class="dot" style="background:${G.FACTION[fid].color}"></span>`;
  const factionName = (fid) => `${factionDot(fid)}${esc(G.FACTION[fid].short)}`;

  function bar(pct, color) {
    return `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></i></div>`;
  }

  function renderStats() {
    const daysLeft = G.CONFIG.maxDays - s.day;
    $('stats').innerHTML = [
      ['Day', `${s.day} / ${G.CONFIG.maxDays}`, daysLeft <= 3 ? 'bad' : ''],
      ['Cash', fmt(s.cash)],
      ['Bank', fmt(s.bank)],
      ['Debt', fmt(s.debt), s.debt > 0 ? 'bad' : ''],
      ['Stash', `${G.capacityUsed(s)} / ${s.capacity}`],
      ['Guns', s.guns],
    ].map(([k, v, cls]) => `<div class="stat"><span class="k">${k}</span><span class="v ${cls || ''}">${v}</span></div>`).join('') +
      `<div class="stat"><span class="k">Health ${s.health}</span>${bar(s.health, s.health > 40 ? 'var(--good)' : 'var(--danger)')}</div>` +
      `<div class="stat"><span class="k">Heat ${Math.round(s.heat)}</span>${bar(s.heat, 'var(--rose)')}</div>`;
  }

  function renderLocation() {
    const d = G.DISTRICT[s.location];
    const ctrl = s.control[s.location];
    const rep = s.factions[ctrl].rep;
    const wars = G.warsOf(s, ctrl);
    let html = `<h2>${esc(d.name)}</h2><p class="muted">${esc(d.blurb)}</p>
      <p>Turf of ${factionName(ctrl)} — you are <span class="standing-${G.standing(rep)}">${G.standing(rep)}</span> here.</p>`;
    if (wars.length) html += `<p class="down">Contested: at war with ${wars.map(factionName).join(', ')}. Prices up 25%.</p>`;
    if (!G.FACTION[ctrl].isLaw && rep >= 20) html += '<p class="up">Trusted: 8% better prices, no muggings.</p>';

    const st = G.serviceStatus(s);
    html += `<div class="service"><strong>${esc(G.SERVICES[st.service])}</strong>`;
    if (!st.open) {
      html += `<p class="down">${esc(st.why)}</p></div>`;
      $('panel-location').innerHTML = html;
      return;
    }
    switch (st.service) {
      case 'bank':
        html += `<div class="row"><input type="number" id="amt" min="1" placeholder="amount">
          <button data-act="deposit">Deposit</button><button data-act="withdraw">Withdraw</button>
          <button class="ghost small" data-act="deposit-all">Deposit all</button></div>
          <p class="muted">Pays ${Math.round(G.CONFIG.bankRate * 100)}% a day. Safe from muggers and cops.</p>`;
        break;
      case 'loanshark':
        html += `<div class="row"><input type="number" id="amt" min="1" placeholder="amount">
          <button data-act="borrow">Borrow</button><button data-act="repay">Repay</button>
          <button class="ghost small" data-act="repay-all">Repay max</button></div>
          <p class="muted">${Math.round(G.CONFIG.debtRate * 100)}% a day. Will lend ${fmt(G.loanLimit(s))} more. Big debts attract collectors.</p>`;
        break;
      case 'gunsmith':
        html += `<div class="row"><button data-act="gun" ${s.guns >= G.CONFIG.maxGuns ? 'disabled' : ''}>Buy pistol (${fmt(G.CONFIG.gunPrice)})</button></div>
          <p class="muted">Each gun takes ${G.CONFIG.gunSize} stash space. More guns, better aim. Max ${G.CONFIG.maxGuns}.</p>`;
        break;
      case 'doctor':
        html += `<div class="row"><button data-act="heal" ${s.health >= 100 ? 'disabled' : ''}>Patch me up (${fmt(G.healCost(s))})</button></div>`;
        break;
      case 'fence':
        html += `<div class="row"><button data-act="stash">Rent a lock-up (+${G.CONFIG.stashUpgradeSize} space, ${fmt(G.stashUpgradeCost(s))})</button></div>`;
        break;
      case 'desk': {
        html += `<div class="row"><button data-act="bribe" ${s.heat < 1 ? 'disabled' : ''}>Bribe a sergeant (${fmt(G.bribeCost(s))}, −40 heat)</button></div>`;
        const cooldown = G.CONFIG.informCooldown - (s.day - s.lastInform);
        html += '<h3>Inform on a faction</h3>';
        if (s.factions.precinct.rep < -30) html += '<p class="down">They won\'t take your tips.</p>';
        else if (cooldown > 0) html += `<p class="muted">Detectives are still checking your last tip (${cooldown} day${cooldown > 1 ? 's' : ''}).</p>`;
        else {
          html += '<div class="row">' + G.FACTIONS.filter((f) => !f.isLaw && s.factions[f.id].alive)
            .map((f) => `<button class="ghost small" data-act="inform" data-id="${f.id}">${esc(f.short)} (${fmt(G.informPayout(s, f.id))})</button>`).join('') + '</div>';
          html += '<p class="muted">Raids weaken them and cool your heat. If it leaks, they will want you dead.</p>';
        }
        break;
      }
    }
    html += '</div>';
    $('panel-location').innerHTML = html;
  }

  function renderMarket() {
    let html = '<h2>Market</h2><div class="table-wrap"><table><tr><th>Goods</th><th class="num">Price</th><th class="num">Held</th><th class="num">Paid avg</th><th>Qty</th><th></th></tr>';
    for (const g of G.GOODS) {
      const q = G.quote(s, g.id);
      const inv = s.inventory[g.id];
      const avg = inv.qty ? inv.cost / inv.qty : 0;
      let priceCell = '<span class="muted">—</span>';
      if (q) {
        const cls = inv.qty ? (q.sell > avg ? 'up' : 'down') : '';
        priceCell = `<span class="${cls}">${fmt(q.buy)}</span>`;
      }
      html += `<tr><td>${esc(g.name)}<div class="muted" style="font-size:11px">${fmt(g.min)}–${fmt(g.max)}</div></td>
        <td class="num">${priceCell}</td><td class="num">${inv.qty || ''}</td><td class="num">${inv.qty ? fmt(avg) : ''}</td>
        <td><input type="number" min="1" id="qty-${g.id}" placeholder="max" ${q ? '' : 'disabled'}></td>
        <td><div class="row">
          <button class="small" data-act="buy" data-id="${g.id}" ${q && G.maxBuy(s, g.id) > 0 ? '' : 'disabled'}>Buy</button>
          <button class="small ghost" data-act="sell" data-id="${g.id}" ${q && inv.qty ? '' : 'disabled'}>Sell</button>
        </div></td></tr>`;
    }
    html += '</table></div><p class="muted">Leave quantity empty to buy the max you can afford and carry, or sell everything.</p>';
    $('panel-market').innerHTML = html;
  }

  function contractStatus(c) {
    if (c.orphaned) return '<div class="warn">Client destroyed. The case is yours to sell.</div>';
    if (c.expired) return '<div class="warn">Burned. They think you stole it — sell it or dump it.</div>';
    const left = c.deadline - s.day;
    return `<div class="muted">${left <= 0 ? 'Due today' : `${left} day${left > 1 ? 's' : ''} left`}</div>`;
  }

  function renderJobs() {
    let html = '<h2>Jobs</h2>';
    if (s.contracts.length) {
      html += '<h3>Active</h3>';
      for (const c of s.contracts) {
        const so = G.sellOutQuote(s, c.id);
        const canDeliver = !c.expired && !c.orphaned && c.to === s.location;
        html += `<div class="job"><div class="title">${factionDot(c.client)}${esc(G.describeContract(c))}</div>${contractStatus(c)}`;
        if (c.type === 'courier' && c.peeked) {
          const label = { cash: 'Bundled cash', ledger: 'An incriminating ledger', decoy: 'Phone books (decoy)', tracker: 'A tracker (smashed)' }[c.contents];
          html += `<div class="muted">Inside: ${label}</div>`;
        }
        html += '<div class="row" style="margin-top:6px">';
        if (!c.expired && !c.orphaned) html += `<button class="small" data-act="deliver" data-id="${c.id}" ${canDeliver ? '' : 'disabled'}>Deliver</button>`;
        if (so) html += `<button class="small" data-act="sellout" data-id="${c.id}">Sell to ${esc(G.FACTION[so.buyer].short)} (${fmt(so.price)})</button>`;
        if (c.type === 'courier' && !c.peeked) html += `<button class="small ghost" data-act="peek" data-id="${c.id}">Peek inside</button>`;
        html += `<button class="small ghost" data-act="drop" data-id="${c.id}">${c.type === 'courier' ? 'Dump' : 'Walk away'}</button></div></div>`;
      }
    }
    html += '<h3>Offers here</h3>';
    if (!s.offers.length) {
      const ctrl = s.control[s.location];
      html += `<p class="muted">${G.FACTION[ctrl].isLaw ? 'The Precinct doesn\'t hire couriers. Try the desk.' : 'Nobody has work for you here today.'}</p>`;
    }
    for (const o of s.offers) {
      html += `<div class="job"><div class="title">${factionDot(o.client)}${esc(G.describeContract(o))}</div>
        ${o.type === 'courier' ? `<div class="muted">Takes ${G.CONFIG.briefcaseSize} stash space. Contents unknown.</div>` : ''}
        <div class="row" style="margin-top:6px"><button class="small" data-act="accept" data-id="${o.id}">Accept</button></div></div>`;
    }
    $('panel-jobs').innerHTML = html;
  }

  function riskWord(p) {
    if (p < 0.08) return '<span class="up">low</span>';
    if (p < 0.18) return '<span class="muted">moderate</span>';
    return '<span class="down">high</span>';
  }

  function renderFactions() {
    let html = '<h2>Factions</h2>';
    for (const fd of G.FACTIONS) {
      const f = s.factions[fd.id];
      if (!f.alive) {
        html += `<div class="faction dead"><div class="head"><span>${factionDot(fd.id)}${esc(fd.name)}</span><span class="chip">Destroyed</span></div></div>`;
        continue;
      }
      const st = G.standing(f.rep);
      const repW = Math.abs(f.rep) / 2;
      const repStyle = f.rep >= 0 ? `left:50%;width:${repW}%;background:var(--good)` : `right:50%;width:${repW}%;background:var(--bad)`;
      const wars = G.warsOf(s, fd.id);
      const turf = G.districtsOf(s, fd.id).length;
      html += `<div class="faction"><div class="head"><span>${factionDot(fd.id)}${esc(fd.name)}</span><span class="chip standing-${st}">${st}</span></div>
        <div class="meta">${esc(fd.blurb)}</div>
        <div class="bars"><span>Rep ${f.rep}</span><div class="rep-bar"><i style="${repStyle}"></i></div>
        <span>Power ${Math.round(f.power)}</span>${bar(f.power, fd.color)}</div>
        <div class="meta">Turf: ${turf} district${turf === 1 ? '' : 's'} · Word is they're ${G.traitRead(f)}${fd.isLaw ? '' : ` · Double-cross risk: ${riskWord(G.betrayChance(s, fd.id))}`}</div>
        ${wars.length ? `<div class="meta down">At war with ${wars.map((w) => esc(G.FACTION[w].short)).join(', ')}</div>` : ''}
        </div>`;
    }
    $('panel-factions').innerHTML = html;
  }

  function renderTravel() {
    let html = '<h2>Travel</h2><p class="muted">Each trip takes a day. Debt grows while you move.</p><div class="travel">';
    for (const d of G.DISTRICTS) {
      const ctrl = s.control[d.id];
      const here = d.id === s.location;
      const due = s.contracts.filter((c) => c.to === d.id && !c.expired && !c.orphaned).length;
      html += `<button class="${here ? 'here' : ''}" data-act="travel" data-id="${d.id}" ${here ? 'disabled' : ''}>
        ${esc(d.name)}${due ? ' 📦' : ''}<span class="sub">${factionDot(ctrl)}${esc(G.FACTION[ctrl].short)} · ${esc(G.SERVICES[d.service])}</span></button>`;
    }
    html += '</div><div class="row" style="margin-top:10px"><button class="ghost" data-act="laylow">Lie low a day (−heat)</button></div>';
    $('panel-travel').innerHTML = html;
  }

  function renderLog() {
    const entries = s.log.slice(-80).reverse();
    $('panel-log').innerHTML = '<h2>The Word on the Street</h2><div class="log">' +
      entries.map((e) => `<p class="${e.tone}"><span class="d">D${e.day}</span>${esc(e.text)}</p>`).join('') + '</div>';
  }

  // --------------------------------------------------------------- modals --

  const ENCOUNTER_TITLE = {
    police: 'Busted', squad: 'Hit Squad', interceptors: 'Intercepted', collectors: 'Collection Day',
    muggers: 'Mugged', ambush: 'Double-Cross',
  };

  function renderModal() {
    const modal = $('modal');
    const card = $('modal-card');
    if (helpOpen) {
      card.innerHTML = HELP_HTML + '<div class="actions"><button data-act="close-help">Got it</button></div>';
      modal.hidden = false;
      return;
    }
    if (s.encounter) {
      const e = s.encounter;
      const last = [...s.log].reverse().find((l) => l.tone === 'danger');
      card.innerHTML = `<h2>${ENCOUNTER_TITLE[e.kind]}</h2>
        <p>${esc(last ? last.text : '')}</p>
        <div class="enemies">${'☗'.repeat(e.enemies)}</div>
        <p class="muted">Health ${s.health} · Cash ${fmt(s.cash)} · Guns ${s.guns}</p>
        <div class="actions">${G.encounterOptions(s).map((o) => `<button data-act="enc" data-id="${o.id}">${esc(o.label)}</button>`).join('')}</div>`;
      modal.hidden = false;
      return;
    }
    if (s.over) {
      const pts = G.score(s);
      card.innerHTML = s.endReason === 'dead'
        ? `<h2>Dead</h2><p>You died on day ${s.day}. The city keeps turning.</p>`
        : `<h2>${esc(G.rank(pts))}</h2><p>Thirty days are up.</p>
           <p>Cash ${fmt(s.cash)} + Bank ${fmt(s.bank)} − Debt ${fmt(s.debt)} = <strong>${fmt(pts)}</strong></p>`;
      card.innerHTML += `<ul><li>Jobs delivered: ${s.stats.delivered}</li><li>Times double-crossed: ${s.stats.betrayedBy}</li>
        <li>Clients you sold out: ${s.stats.soldOut}</li><li>Bodies: ${s.stats.kills}</li>
        <li>Factions destroyed: ${G.FACTIONS.filter((f) => !s.factions[f.id].alive).map((f) => esc(f.short)).join(', ') || 'none'}</li></ul>
        <div class="actions"><button data-act="new">Play again</button></div>`;
      modal.hidden = false;
      return;
    }
    modal.hidden = true;
  }

  const HELP_HTML = `<h2>How to play</h2>
    <p>You owe the Calloway Syndicate money at 10% a day. You have 30 days to get rich — or at least get even.</p>
    <ul>
      <li><strong>Trade.</strong> Buy low, travel (1 day), sell high. Each district's ruling faction shifts prices: they pay up for what they want and flood what they make. Wars push prices up.</li>
      <li><strong>Take jobs.</strong> Factions hire you to carry locked briefcases or bring them goods. Deliver on time and your reputation grows; Trusted factions give better prices and more work.</li>
      <li><strong>Nobody is safe.</strong> A greedy or desperate client may short-pay or ambush you on delivery. Coups replace leaders and wipe old favors. Wars change who controls each district. Factions can be destroyed outright.</li>
      <li><strong>Betray them first.</strong> Peek in the briefcase. Sell it to your client's enemies. Inform on a faction to the Precinct. It pays — until they find out and send a hit squad.</li>
      <li><strong>Heat</strong> rises when you move a lot of product. High heat means police stops. Lie low or bribe the Precinct desk to cool off.</li>
      <li><strong>Score</strong> = cash + bank − debt on day 30. Dying ends the game early.</li>
    </ul>`;

  function render() {
    renderStats();
    renderLocation();
    renderMarket();
    renderJobs();
    renderFactions();
    renderTravel();
    renderLog();
    renderModal();
  }

  // --------------------------------------------------------------- events --

  function amount() {
    const v = parseInt(($('amt') || {}).value, 10);
    return Number.isFinite(v) ? v : NaN;
  }

  function qtyFor(goodId, fallback) {
    const v = parseInt($('qty-' + goodId).value, 10);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  document.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const id = btn.dataset.id;
    const num = Number(id);
    switch (btn.dataset.act) {
      case 'buy': return act(G.buy(s, id, qtyFor(id, G.maxBuy(s, id))));
      case 'sell': return act(G.sell(s, id, qtyFor(id, s.inventory[id].qty)));
      case 'travel': return act(G.travel(s, id));
      case 'laylow': return act(G.layLow(s));
      case 'deposit': return act(G.deposit(s, amount()));
      case 'deposit-all': return act(G.deposit(s, s.cash));
      case 'withdraw': return act(G.withdraw(s, amount()));
      case 'borrow': return act(G.borrow(s, amount()));
      case 'repay': return act(G.repay(s, amount()));
      case 'repay-all': return act(G.repay(s, Math.min(s.cash, s.debt)));
      case 'gun': return act(G.buyGun(s));
      case 'heal': return act(G.heal(s));
      case 'stash': return act(G.upgradeStash(s));
      case 'bribe': return act(G.bribe(s));
      case 'inform': return act(G.inform(s, id));
      case 'accept': return act(G.acceptOffer(s, num));
      case 'deliver': return act(G.deliver(s, num));
      case 'sellout': return act(G.sellOut(s, num));
      case 'peek': return act(G.peek(s, num));
      case 'drop': return act(G.dropContract(s, num));
      case 'enc': return act(G.encounterAct(s, id));
      case 'new': s = G.newGame(); return act(null);
      case 'close-help': helpOpen = false; return render();
      default: return undefined;
    }
  });

  $('btn-new').addEventListener('click', () => {
    if (s.over || confirm('Abandon this run and start over?')) { s = G.newGame(); act(null); }
  });
  $('btn-help').addEventListener('click', () => { helpOpen = true; render(); });

  if (s.day === 1 && s.log.length <= 2) helpOpen = true;
  render();
})();
