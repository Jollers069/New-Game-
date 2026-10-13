# Under the Rose: Design Notes

## The pitch

**Dope Wars** is a tense loop: buy, travel, sell, while debt grows and random events hit. **Sub Rosa** is about factions hiring you to move a briefcase, where any deal can become a betrayal. *Under the Rose* (the English meaning of *sub rosa*, "in secret") puts the two together. The Dope Wars market is the engine. The factions decide what the market looks like, who you can trust, and who's waiting for you at the next stop.

The design rule: **every faction is useful, and every faction is dangerous.** Nothing about them stays fixed. Reputation, traits, territory and even whether they still exist can all change during a 30-day run.

## Core loop (straight from Dope Wars)

| Dope Wars | Under the Rose |
| --- | --- |
| 6 boroughs, travel costs a day | 6 districts, travel costs a day (or lie low in place) |
| Drugs with price ranges | 6 contraband goods, $20–$16,000 |
| Price spikes / crashes | Same, but caused by faction actions ("Kestrel is dumping Stolen Tech") |
| Loan shark, 10%/day | Calloway Syndicate loan book, 10%/day. Big debts bring collectors |
| Bank | Bank in the Financial District, 3%/day |
| Trench coat capacity | Stash capacity. Upgrade at the Docks fence |
| Officer Hardass | Police stops scale with **Heat** |
| Guns, fight / run | Guns improve aim. Fight, run, bribe or surrender |
| Score on day 30 | Cash + bank − debt, with a rank title |

## The faction layer (inspired by Sub Rosa)

### Five factions
| Faction | Personality | Wants (pays more) | Floods (sells cheap) |
| --- | --- | --- | --- |
| Calloway Syndicate | Honorable old mob, runs the loans | Hot Jewels | Moonshine |
| Kestrel Dynamics | Corporate, greedy, pays 35% more | Black Ledgers | Stolen Tech |
| Red Lantern Society | Disciplined, long memory | Stolen Tech | Bootleg Meds |
| Wharf Rats | Volatile, treacherous, pays least | Moonshine | Counterfeit Bills |
| 9th Precinct | The law. Buys info, sells favors | — | — (all prices +15%) |

Each faction has hidden **greed / honor / volatility** values, plus **power** (0–100) and your **reputation** with it (−100 to +100). The UI shows only a vague read ("greedy, treacherous") and a double-cross risk word. That information goes out of date when a coup replaces the leadership.

### Reputation tiers
- **Made** (50+) / **Trusted** (20+): 8% better prices on their turf, more job offers, no muggings there.
- **Neutral**
- **Distrusted** (−20 or lower): fewer jobs.
- **Marked** (−50 or lower): their services refuse you, and hit squads wait on their turf.

### Jobs
- **Courier:** carry a locked briefcase (10 stash space) to a district by a deadline. Contents are hidden: cash, an incriminating ledger, a **decoy** (a loyalty test that pays bonus reputation if you deliver it honestly), or a **tracker** that draws rivals to you.
- **Supply:** bring N units of a good to a district by a deadline, for a premium price.

### Ways it goes wrong, for them and for you
- **Client double-cross:** on delivery the client may short-pay (40%) or ambush you. The chance comes from their greed, honor, how desperate they are (low power) and your reputation. If you survive the ambush, the briefcase is yours to sell.
- **Peek inside:** learn the contents and disarm a tracker. The client may find out.
- **Sell out:** sell the briefcase to any faction hostile to your client (or to the Precinct, which pays 3× for ledgers). Big money. The client marks you.
- **Inform:** give the Precinct dirt on a faction. You get cash and lose heat, and the faction gets raided. If it leaks, they mark you.
- **Missed deadline:** a late briefcase counts as stolen.

### The world changes without you
Every day:
- **Relations drift** between gangs. Volatile factions swing harder. A grudge at −45 or below can turn into **war**.
- **Wars** cause skirmishes. A district can **change hands**, which changes its prices, its job offers and whose hit squads wait there. Contested districts cost 25% more.
- **Upheavals**, more often for volatile factions: a **coup** (new traits, old reputation mostly wiped), a **mole hunt** (your reputation drops if you're close to them), a **big score** (power up) or a **defection** (power moves to a rival).
- **Precinct raids** reduce faction power. **Crackdowns** raise everyone's heat. **Scandals** make the police easier to bribe.
- A faction at 0 power **collapses**. Its turf goes to its strongest enemy, and any briefcase you carry for it becomes an orphan you can sell to anyone.

In 500 simulated games there were about 1.7 wars per run, and a faction was destroyed in about 4 runs out of 10.

## Tuning knobs

Everything is in `src/engine.js`:
- `CONFIG`: starting money, interest rates, capacities, prices of services.
- `GOODS`, `FACTIONS`, `DISTRICTS`, `STARTING_RELATIONS`: world data.
- `betrayChance()`: how often clients double-cross you.
- `factionTick()`: war threshold (−45), truce chance, skirmish rate, upheaval rate.
- `rollEncounter()`: encounter odds.

`npm test` includes a fuzz test that plays 400 random games and checks invariants (no negative cash, no overloaded stash, reputation stays in range, the Precinct keeps Hillcrest).

## Ideas for next steps
1. **Multiplayer, Sub Rosa style:** each player secretly works for a faction. Share one city state and let players double-cross each other.
2. **Faction-specific missions:** heists, protection rackets, "kill the courier carrying our rival's case".
3. **Lieutenants:** recruit NPC runners who carry goods in parallel and may also betray you.
4. **Intel as a commodity:** buy rumors that reveal a faction's real traits, upcoming raids or hidden briefcase contents.
5. **Longer campaign:** keep turf you've earned between runs, or play as the head of a faction.
6. **Sound and art pass:** noir soundtrack, district illustrations, portraits for faction bosses.
