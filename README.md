# Under the Rose

A trading game in the style of **Dope Wars**, with the faction politics and double-crosses of **Sub Rosa**.

You owe the mob money at 10% a day and have 30 days. Buy low in one district, sell high in another. Take courier jobs from five factions that can turn on you, and on each other, at any moment. Or turn on them first.

## Play

Open `index.html` in a browser. No build step and no server needed. Progress saves automatically in your browser.

## Develop

```
npm test        # engine unit tests + a 400-game random-play fuzz test
```

| File | What it is |
| --- | --- |
| `src/engine.js` | All game rules. Pure functions over one JSON state object, no DOM. Seeded RNG, so games replay exactly. |
| `src/ui.js` | Browser rendering and input. Calls engine actions and re-renders. |
| `src/style.css` | Styling. |
| `test/engine.test.js` | Node tests (`node:test`, no dependencies). |
| `DESIGN.md` | Game design: systems, how they connect, tuning knobs, ideas for what to build next. |
