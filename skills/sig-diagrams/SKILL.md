---
name: sig-diagrams
description: Create, edit, check or explain RF/DSP block diagrams in Lineup .sig.json files, including SVG/PNG exports from Lineup. Use for .sig.json files or to draw or describe a receiver/transmitter chain.
---

# Lineup signal diagrams (.sig.json)

Lineup (https://tylerpleiter.github.io/lineup/) draws RF and DSP block diagrams from plain JSON. You write the topology (blocks and connections) and Lineup lays it out, routes wires and draws the symbols. The full format is in `references/FORMAT.md`, and every block type, port name and alias is in `references/SYMBOLS.md`. Read those when a detail below isn't enough.

## Minimal file

```json
{
  "lineup": "0.1",
  "title": "2.4 GHz receiver",
  "blocks": [
    {"id": "ant", "type": "antenna"},
    {"id": "bpf", "type": "saw", "params": {"fc": 2.44e9, "bw": 80e6}, "show": ["fc"]},
    {"id": "lna", "type": "lna", "params": {"gain": 18, "nf": 1.2}, "show": ["gain", "nf"]},
    {"id": "mix", "type": "mixer"},
    {"id": "lo",  "type": "pll", "params": {"freq": 2.3e9}, "show": ["freq"]},
    {"id": "adc", "type": "adc", "params": {"bits": 14}}
  ],
  "connections": [
    {"from": "ant.io",  "to": "bpf.in"},
    {"from": "bpf.out", "to": "lna.in"},
    {"from": "lna.out", "to": "mix.rf"},
    {"from": "lo.out",  "to": "mix.lo"},
    {"from": "mix.if",  "to": "adc.in"}
  ]
}
```

## Creating a diagram

1. **Order the chain** from input to output (antenna → … → ADC, or DAC → … → antenna). Each stage is one block. Give each a short, meaningful `id` (`lna`, `bpf_rx`, `adc`).
2. **Pick types from `references/SYMBOLS.md`.** Everyday aliases are fine and keep the file readable: `lna`, `pa`, `vga`, `saw`, `aaf`, `pll`, `vco`, `fir`, `nco`, `combiner`, `diplexer`. Anything not drawn by a symbol is `"type": "custom"` with a `label` (and `ports` if it isn't one-in/one-out).
3. **Connect ports as `blockId.port`.** Port names differ per symbol. A mixer has `rf`, `lo` and `if`; an antenna has `io`; an I/Q demodulator has `rf`, `lo`, `i` and `q`. Check SYMBOLS.md rather than guessing. One output may feed several inputs; an input takes only one driver.
4. **Leave out `x`, `y` and `via`.** Lineup auto-places blocks without coordinates and keeps LO sources next to the port they feed.
5. **Properties:** reserved keys are plain numbers in base units: `gain`/`nf`/`il` in dB, `oip3`/`iip3`/`p1db` in dBm, `freq`/`fc`/`bw` in Hz, `fs` in S/s, `bits` and `ratio` as counts. Write `2.44e9`, never `"2.44 GHz"`. List the keys to print under the symbol in `show`.
6. **Differential:** set `"signal": "diff"` on each block in the differential section. Go from single-ended to differential through a `balun` (`in` is single-ended, `out` is differential).
7. **Analog vs DSP:** analog blocks need nothing. In the DSP part of a chain, set `"domain"` on DSP-capable blocks (✓ in SYMBOLS.md): `"digital"` for real samples, `"complex"` for I+jQ streams (e.g. after a `ddc`). Example: `{"id": "chf", "type": "lpf", "label": "FIR", "domain": "complex"}`. ADC outputs are digital and DDC outputs are complex, fixed. Analog ↔ digital or real ↔ complex links warn.
8. **I/Q (analog, or digital before a DDC):** don't set `iq` yourself. Connect a split block's `i` and `q` outputs to the *same* input, e.g. `dmd.i → lpf.in` and `dmd.q → lpf.in`. Everything downstream then becomes an I/Q pair automatically, until a merge block (`iq_mod.i`/`.q`) or a custom block. For TX, connect one block's output to both `mod.i` and `mod.q`; everything upstream becomes a pair. A custom block (serializer, FPGA) can take a pair into one port, or feed a pair from one port.
9. **Switches and branches:** `{"type": "switch", "params": {"throws": 4}}` (or `sp4t`) has ports `c`, `t1`…`t4`. A switched filter bank is `sw1.c` ← input, `sw1.tN → fN.in`, `fN.out → sw2.tN`, `sw2.c` → onward; layout turns `sw2` around for you. Use a `node` (`in`, `o1`–`o3`) for an explicit branch point.
10. **Sheets (hierarchy):** for a big design, put a subsystem in `"sheets": {"frontend": {"blocks": [...], "connections": [...]}}` and place it with `{"id": "fe", "type": "sheet", "sheet": "frontend"}`. Inside, `port_in`/`port_out` blocks become the sheet block's ports, named by their ids: `ant.io → fe.rf_in` when the sheet has a `port_in` with id `rf_in`.
11. **Cascade:** give stages `gain` (passives: `il`) and `nf`, plus `iip3`/`oip3` and `p1db` where known, and add `"analysis": {"pin": -90, "fin": 915e6, "bw": 200e3}`. Lineup then shows gain, NF, IP3, P1dB, levels, MDS/SNR and a frequency plan (image and Nyquist checks). `"mix": "sum"` on a mixer makes it an upconverter.
12. **Optional extras:** a `label` on a connection (e.g. `"−30 dBm"`); `"groups": [{"id": "fe", "label": "RF front end", "members": [...]}]`; `"notes": [{"text": "...", "near": "lna"}]`.
13. **Check it:** `python scripts/check.py file.sig.json`. Fix every error and reconsider each warning. Then tell the user they can open the file in Lineup: Open, or drag and drop.

## Editing an existing diagram

- **Keep positions:** don't change `x`/`y` of blocks you didn't touch. Give new blocks no coordinates; Lineup places them near their neighbours.
- **Inserting a block between A and B:** replace `A.out → B.in` with `A.out → new.in` and `new.out → B.in`. Copy any `label` across.
- **Renaming a block id:** update every connection, group `members` entry and note `near` that uses it.
- **Wires:** if you change either end of a connection, delete its `via` (manual bends), since it no longer fits.
- **Formatting:** keep the file's existing key order and formatting, so diffs stay small.
- Run `scripts/check.py` before handing back.

## Understanding a diagram (issues, docs, reviews)

- **From an image:** if given an SVG or PNG exported from Lineup, run `python scripts/extract.py image.png` first. The exact diagram is embedded, so don't read it off the pixels. If there's no embedded source, it isn't a Lineup export; fall back to reading the image.
- **Describing it:** walk the signal path from input to output, giving each stage's type, label and key properties. Note where the path splits into I and Q, and which source feeds each mixer's LO. Point out differential sections and anything `check.py` reports.
- **Sheets:** describe the top level first, then each sheet; a sheet block's ports are the sheet's `port_in`/`port_out` ids. Blocks inside sheet block `fe` are `fe/lna` in analysis paths.
- **Comparing two versions:** list added and removed blocks, changed properties and rewired connections, by block id.

## Gotchas

- Unknown `type` values still load, as plain labelled boxes, so a typo won't fail loudly. `check.py` warns about them.
- `"signal": "diff"` only affects signal-path ports. LO, clock and control ports stay single-ended unless the symbol says otherwise.
- `domain` on a connection only changes the line style (`signal`, `lo`, `clk`, `digital`, `ctrl`). It rarely needs setting.
- An LO, clock or control source connected to an I/Q pair feeds both rails. Any other single path into a pair is an error.
