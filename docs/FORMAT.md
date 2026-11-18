# Lineup file format (v0.1)

Lineup files are JSON, saved with the extension `.sig.json`, and validated by [`schema/lineup.schema.json`](../schema/lineup.schema.json). This page is written for people **and AI agents** that read or generate diagrams.

**The short version:** list blocks (`id` + `type`) and connections (`from` + `to` as `blockId.port`). Leave out coordinates; Lineup lays the diagram out for you.

## Minimal example

```json
{
  "lineup": "0.1",
  "title": "Simple RX",
  "blocks": [
    {"id": "ant", "type": "antenna"},
    {"id": "lna", "type": "lna", "params": {"gain": 18, "nf": 1.2}, "show": ["gain", "nf"]},
    {"id": "mix", "type": "mixer"},
    {"id": "lo",  "type": "lo", "params": {"freq": 2.4e9}, "show": ["freq"]},
    {"id": "adc", "type": "adc", "params": {"bits": 12}}
  ],
  "connections": [
    {"from": "ant.io",  "to": "lna.in"},
    {"from": "lna.out", "to": "mix.rf"},
    {"from": "lo.out",  "to": "mix.lo"},
    {"from": "mix.if",  "to": "adc.in"}
  ]
}
```

## Top level

| Key | Required | Meaning |
| --- | --- | --- |
| `lineup` | yes | Format version, `"0.1"` |
| `title` | no | Diagram title |
| `theme` | no | `"mono"` (default, black and white) or `"color"` (adds a hue per signal domain) |
| `style` | no | `{"hops": false}` turns off crossing hops; `{"pmMarks": true}` labels differential pins + / − |
| `blocks` | yes | Array of blocks |
| `connections` | yes | Array of connections |
| `groups` | no | Dashed boxes: `{"id", "label", "members": [blockIds]}` |
| `notes` | no | Free text: `{"text", "x", "y"}` or `{"text", "near": blockId}` |

## Blocks

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique; letters, digits, `_`, `-`; starts with a letter or `_` |
| `type` | yes | Symbol type or alias from [SYMBOLS.md](SYMBOLS.md) (`lna` → amplifier labelled "LNA"). Unknown types load as custom blocks with a warning |
| `label` | no | Text under the symbol. Omit for the symbol's default (e.g. "LNA"); `""` for none |
| `x`, `y` | no | Top-left corner in grid units (1 unit = 10 px). Omit both to auto-place |
| `rot` | no | `0`, `90`, `180`, `270` (clockwise) |
| `flip` | no | Mirror horizontally (e.g. an antenna at the right end of a TX chain) |
| `variant` | no | Symbol variant, e.g. `"adjustable"` adds a tuning arrow (see SYMBOLS.md) |
| `signal` | no | `"diff"` makes the block's signal-path ports differential |
| `iq` | no | `true` draws the block as a linked I and Q pair (usually set automatically, see below) |
| `iqOverride` | no | Per-rail differences: `{"q": {"params": {"gain": 19}}}` |
| `params` | no | Properties, see below |
| `show` | no | Which param keys to print under the symbol, in order |
| `ports`, `size` | custom only | Port list and cell size `[w, h]` for `type: "custom"` |
| `icon` | custom only | SVG path data in grid units, drawn inside the box (e.g. `"M2,4 H6"`) |

### Custom block ports

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Unique within the block |
| `side` | yes | `l`, `r`, `t`, `b` |
| `dir` | yes | `in`, `out`, `bi` |
| `domain` | no | `signal` (default), `lo`, `clk`, `digital`, `ctrl` |
| `signal` | no | `se` (default) or `diff` |
| `width` | no | Bus width for `digital` ports |
| `at` | no | Offset along the side in grid units; omit to spread ports evenly |
| `rail` | no | `"i"` or `"q"`: the port carries one I/Q rail (ports named `i`/`q` already do) |
| `optional` | no | Draw the port's lead only when it is connected |

## Connections

| Field | Required | Meaning |
| --- | --- | --- |
| `from`, `to` | yes | `blockId.port`. Order doesn't matter; Lineup draws from the driving port |
| `label` | no | Text along the wire, e.g. `"−30 dBm"` |
| `domain` | no | Override the line style: `signal`, `lo`, `clk`, `digital`, `ctrl`. (`rf`, `if`, `bb` from older files mean `signal`.) |
| `via` | no | Waypoints `[[x, y], …]` in grid units; the wire runs through them with right-angle elbows. Omit for automatic routing |

One output may feed several inputs (fan-out). An input may only have one driver; use a `splitter` (all ports are bidirectional) to combine.

## Properties

Reserved keys are **plain numbers in base units** so a future cascade calculator can trust them. Any other key may be a number or a string.

| Key | Unit | Shown as |
| --- | --- | --- |
| `gain` | dB (negative = loss) | `G = 18 dB` |
| `nf` | dB | `NF = 1.2 dB` |
| `oip3`, `iip3` | dBm | `OIP3 = 30 dBm` |
| `p1db` | dBm (output) | `P1dB = 20 dBm` |
| `il` | dB | `IL = 1.5 dB` |
| `freq` | Hz | `2.44 GHz` |
| `fc` | Hz | `fc = 20 MHz` |
| `bw` | Hz | `BW = 80 MHz` |
| `bits` | count | `14-bit` |
| `fs` | S/s | `fs = 61.4 MS/s` |
| `ratio` | count | `4` |

Write `2.44e9`, not `"2.44 GHz"`.

## Differential signals

Set `"signal": "diff"` on a block and its signal ports become pin pairs, drawn as two parallel wires. A connection between two differential ports is still **one** connection. LO, clock, control and digital ports are not changed by `signal`. The `balun` is single-ended on `in` and differential on `out`. Connecting single-ended to differential gives a warning.

## I/Q paths

A block with `"iq": true` is one entry in the file but is drawn as two stacked instances: I on top, Q below, 6 grid units apart. You rarely need to write `iq` yourself:

- **Split blocks** have I and Q output ports (`iq_demod`, `ddc`, `cmul`, or any custom block with `i`/`q` outputs). Everything downstream of them becomes an I/Q pair automatically, until a merge block.
- **Merge blocks** have I and Q input ports (`iq_mod`, `duc`, `cmul`, or a custom block). Everything upstream of them becomes an I/Q pair automatically.

A port is an I or Q port when it's named `i`/`q` or declares `"rail": "i"`/`"q"` (e.g. `cmul`'s `oi`/`oq` outputs).

So you connect both rails to the same port name:

```json
{"from": "dmd.i", "to": "lpf.in"},
{"from": "dmd.q", "to": "lpf.in"},
{"from": "lpf.out", "to": "adc.in"}
```

`dmd.i` lands on the I instance of `lpf` and `dmd.q` on the Q instance. `lpf.out → adc.in` then draws I→I and Q→Q. An LO, clock or control source connected to an I/Q pair feeds both rails.

To address one rail explicitly, use `blockId:i.port` or `blockId:q.port`.

## Groups and notes

```json
"groups": [{"id": "fe", "label": "RF front end", "members": ["bpf1", "lna"]}],
"notes": [{"text": "Rev A, under test", "near": "lna"}, {"text": "Shield can", "x": 40, "y": 30}]
```

A group draws a dashed box around its members. A note is free text, either at `x`/`y` or under a block with `near`. Use `\n` for line breaks.

## Layout

Blocks without `x`/`y` are placed by ELK's layered algorithm, left to right, with I/Q pairs kept straight. LO, clock and control sources are placed beside the port they feed. Blocks that already have coordinates stay where they are.

## Embedded source in exported images

SVG and PNG exports carry the full `.sig.json`, so an image pasted into an issue, wiki or doc still holds the exact diagram. Lineup reopens these images directly (Open or drag and drop). To read one in a script or as an agent:

- **SVG:** the JSON is the text of `<metadata id="sig-source" data-format="sig.json">`, wrapped in `<![CDATA[…]]>`.
  ```python
  import re
  svg = open("rx.svg", encoding="utf-8").read()
  body = re.search(r'<metadata id="sig-source"[^>]*>(.*?)</metadata>', svg, re.S).group(1)
  source = "".join(re.findall(r"<!\[CDATA\[(.*?)\]\]>", body, re.S))
  ```
- **PNG:** the JSON is in an uncompressed `iTXt` chunk with the keyword `sig.json`.
  ```python
  from PIL import Image
  source = Image.open("rx.png").text["sig.json"]
  ```
  `exiftool -sig.json rx.png` also prints it.

The embedded copy includes positions, so reopening it restores the layout exactly. "Copy as image" puts a PNG on the clipboard, but browsers strip extra PNG data from clipboard images; use an exported file when the source needs to travel with the image.

## Rules for agents

1. Use types and port names from [SYMBOLS.md](SYMBOLS.md). Aliases like `lna`, `pa`, `saw`, `pll`, `fir` are fine; Lineup saves them as the core type plus a label.
2. Prefer topology-only files (no `x`, `y`, `via`); they are shorter and always lay out cleanly.
3. Use reserved params with base-unit numbers.
4. Give every block a short, meaningful `id` (`lna1`, `bpf_rx`, `adc`).
5. Don't write `iq` unless you need a pair that isn't next to a split/merge block.
6. Validate against the schema; Lineup also lists any problems in its Checks panel.

Lineup saves keys in a stable order and blocks in signal-flow order, so files diff cleanly in git.
