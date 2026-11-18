# Contributing to Lineup

Thanks for helping! Issues and pull requests are welcome.

## Development

```sh
npm install
npm run dev     # dev server
npm test        # vitest
npm run check   # svelte-check / TypeScript
```

Please keep `npm test` and `npm run check` passing.

## Adding a symbol

First check whether you need one: if the drawing is the same as an existing symbol and only the label differs (an LNA is an amplifier, a SAW filter is a band-pass filter), add an alias to `symbols/aliases.json` instead. New symbols are for new drawings.

Symbols are data. Add one JSON file to `/symbols` and it appears in the palette.

```json
{
  "id": "lna",
  "name": "Low-noise amplifier",
  "category": "gain",
  "size": [6, 6],
  "body": "M1,1 L5,3 L1,5 Z",
  "mask": "M1,1 L5,3 L1,5 Z",
  "ports": [
    {"name": "in",  "side": "l", "at": 3, "dir": "in",  "signal": "se"},
    {"name": "out", "side": "r", "at": 3, "dir": "out", "signal": "se", "diffLead": 2}
  ],
  "params": {"gain": null, "nf": null, "oip3": null, "p1db": null},
  "label": "LNA"
}
```

Rules that keep diagrams consistent:

- **Grid units.** All coordinates are in grid units (1 unit = 10 px). The standard cell is `6 × 6`; wider symbols grow in 2-unit steps.
- **Body inside the inner area.** Draw the body inside `1…size-1`. The outer unit on each side holds port leads, which Lineup draws for you (`lead`, default 1). If a differential pin pair lands on a slanted edge, set `diffLead` so both leads reach the body.
- **Domains.** Leave `domain` out for the main signal path. Set `lo`, `clk`, `ctrl` or `digital` only for ports drawn differently.
- **Ports on integer grid points.** Main signal ports go at mid-height (`at: 3`) on the left and right. LO and control ports go on the bottom.
- **No colours or stroke widths.** `body` is stroked with the theme stroke, `fill` paths are filled solid (dots, arrowheads), and `mask` is filled white to hide wires behind the symbol. `texts` places upright text.
- **Categories:** `gain`, `filter`, `conversion`, `source`, `passive`, `converter`, `dsp`, `generic`.
- **Text templates:** `texts` may contain `{param|fallback}`, e.g. `"↓{ratio|M}"` shows `↓8` when the block's `ratio` is 8.
- **Variants:** `"variants": {"adjustable": {"name": "Adjustable", "body": "…", "fill": "…"}}` adds paths (and optionally `ports`) when a block sets `"variant": "adjustable"`.
- **I/Q ports:** ports named `i`/`q`, or with `"rail": "i"`/`"q"`, make the symbol a split (outputs) or merge (inputs) block.
- **Params:** use reserved keys where they apply (see `docs/FORMAT.md`).

Then run `npm run symbols:doc` to regenerate `docs/SYMBOLS.md`.

## Fonts

`src/assets/fonts` holds Inter cut down to the characters diagrams use (Latin, Greek, arrows, math operators, super/subscripts). If a symbol or label needs a character outside that set, add its range in `scripts/build-fonts.py` and rebuild (instructions at the top of the script).

## Code layout

The model (`src/model`) is plain TypeScript with no UI dependencies and is unit-tested. The SVG is a pure function of the model. If you change the file format, update the schema, `docs/FORMAT.md` and the tests together.
