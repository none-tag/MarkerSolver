# MarkerSolver — Cut Marker Ratio Planner

A lightweight, browser-based tool for garment digitalization teams to automatically compute cut marker ratios.

## What it does

Given:
- **Size-wise order quantities** (fully dynamic — add/remove sizes freely)
- **Table Length** and **Fabric Consumption** → computes `Total Ratio = floor(table length / consumption)`
- **Max Ply Quantity**

It solves for the **minimum number of marker rows** (ratio + ply combinations) to fulfill the entire order without overproduction.

## Output

- **Marker Plan** — each row: size ratios, ply, × times repeated, pieces produced per size
- **Fulfillment Summary** — order qty vs produced, shortfall, fill rate per size
- **Constraint Checks** — ratio sum validation, ply limit check, overproduction check

## Algorithm

Greedy proportional allocation:

1. Compute ratios proportional to remaining quantities (largest-remainder rounding, sums exactly to Total Ratio)
2. Set ply = `min(floor(remaining[size] / ratio[size]))` across all active sizes → maximises output without overproducing
3. If `ply > Max Ply`: one row at Max Ply × `floor(cuts / Max Ply)`, plus one row for the leftover ply
4. Deduct produced pieces from remaining, repeat until all sizes are fulfilled

## Hosting on GitHub Pages

1. **Fork or create a repo** on GitHub
2. Upload the three files:
   - `index.html`
   - `style.css`
   - `solver.js`
   - `app.js`
3. Go to your repo → **Settings** → **Pages**
4. Under **Source**, select `Deploy from a branch`
5. Choose `main` branch, `/ (root)` folder → click **Save**
6. After ~1 minute, your site is live at:
   `https://<your-username>.github.io/<repo-name>/`

No build step, no dependencies, no server — pure HTML/CSS/JS.

## File structure

```
/
├── index.html   ← page structure & layout
├── style.css    ← all styling
├── solver.js    ← pure solver algorithm (no DOM)
├── app.js       ← UI controller, form handling, results rendering
└── README.md    ← this file
```

## Customisation

| What | Where |
|------|-------|
| Default sizes & quantities | `app.js` → `DEFAULTS` array |
| Default max ply | `index.html` → `value="100"` on `#maxPly` |
| Colours & fonts | `style.css` → `:root` CSS variables |
| Solver logic | `solver.js` → `solveMarkers()` |

## License

MIT — free to use and modify.
