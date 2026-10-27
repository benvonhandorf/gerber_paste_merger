# Gerber Paste Merger

A client-side tool for combining the solder-paste layers of several PCB
designs into one panel, so they can be sent out as a single stencil. Arrange
designs interactively, align/distribute them precisely, and export a
standard RS-274X Gerber file.

Everything runs in the browser. No file is ever uploaded anywhere - the page
even sets `connect-src 'none'` so it cannot make network requests at all
once loaded.

## Using it

- **Load designs**: drag & drop, or use the file picker. Each `.zip` (e.g. a
  KiCad/Altium/Eagle fab output archive) becomes one design; any loose files
  selected together become one more design. Paste (top/bottom) and outline
  layers are auto-detected by filename via `@tracespace/identify-layers`.
- **Arrange**: click a design to select it, drag to move, `[`/`]` to rotate
  90° at a time, `f` to flip, arrow keys to nudge (hold Shift for 10mm
  steps).
- **Flip**: check "Flip top/bottom" on a design (or press `f` with it
  selected) to mount it upside-down on the panel - its bottom paste
  (mirrored in place) becomes its contribution to the top-side export, and
  its top paste becomes its contribution to the bottom-side export. This
  lets a single exported side cover both faces of a board: print paste
  normally for the boards left as-is, then flip those same boards over and
  print again with the same stencil at the flipped design's position.
- **Align**: click one design (the reference), shift-click others, then use
  an Align button, or "Place adjacent" for e.g. "right of the reference with
  a 15mm margin".
- **Distribute**: select several designs and space them with a fixed gap, or
  evenly between the first and last.
- **Export**: pick top or bottom paste and click Export to download the
  merged Gerber, or "Export SVG for laser cutting" for a true-scale SVG of
  pad outlines (red hairlines, no fill) to cut stencil film on a laser. The
  "Laser kerf" field shrinks each pad by half the beam width so the cut
  hole matches the real pad size.

## Development

```sh
npm install
npm run dev       # dev server
npm test          # unit tests (gerber pipeline + align/distribute math)
npm run build     # type-check + production build to dist/
npm run preview   # serve the production build locally
```

## Deployment

Pushing to `main` builds and deploys the site to GitHub Pages via
`.github/workflows/deploy.yml`. To enable it on a repo: **Settings → Pages →
Source → GitHub Actions**. The build automatically picks the correct base
path (`/<repo-name>/`) from `GITHUB_REPOSITORY`, so no manual configuration
is needed even if the repo is renamed or forked.

## How it works

- `@tracespace/parser` + `@tracespace/plotter` parse each Gerber file into
  fully-resolved numeric geometry (`src/gerber/parse.ts`).
- `src/gerber/transform.ts` mirrors (for a flipped design), rotates (90°
  steps only), and translates that geometry; `src/gerber/merge.ts`
  concatenates several placed designs.
- `src/gerber/write.ts` serializes the merged geometry back to RS-274X:
  circle/rectangle/obround flashes get real, deduplicated apertures; any
  other shape (irregular polygons, macro-derived pads, holes) is written as
  an equivalent filled region.
- `src/gerber/exportSvg.ts` renders the same merged geometry as SVG outlines;
  circles/rectangles are exact, everything else is flattened to polygons and
  inset by the kerf with `clipper-lib`.
- `src/tools/align.ts` holds the pure align/distribute math, decoupled from
  the UI so it's unit-tested directly.
- `src/render/workspace.ts` is a hand-rolled pan/zoom/drag SVG canvas;
  `@tracespace/renderer` supplies the actual pad/trace SVG for each design.

See `src/gerber/roundtrip.test.ts` for the parse → transform → write → parse
round-trip tests, which are the main correctness guardrail for the Gerber
pipeline.

## Known limitations

- Rotation is restricted to 90° steps (no arbitrary angles). Mirroring is
  supported only as the all-or-nothing per-design "flip" (see above), not as
  an arbitrary mirror axis.
- Excellon drill files are out of scope; only Gerber layers are read.
- A region with multiple contours from the *same* source `G36...G37` block
  (e.g. a copper pour with a hole cut via opposite-winding sub-contours) is
  written back as separate regions, since the plotter doesn't retain which
  contours were grouped together. This does not affect the primary use case
  (paste-layer pads), where this pattern essentially never occurs.
