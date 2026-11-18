# Symbols

Generated from `/symbols` by `npm run symbols:doc`. Use the **type** in a block's `type` field and the **port** names in connections (`blockId.port`).

Port notation: `name` (direction, domain, side). Directions: in, out, bi (bidirectional). Ports marked *optional* draw only when connected.

## Gain

| Type | Name | Ports | Properties | Variants |
| --- | --- | --- | --- | --- |
| `amp` | Amplifier | `in` (in, signal, l)<br>`out` (out, signal, r) | `gain`, `nf`, `oip3`, `p1db` | `adjustable` |
| `att` | Attenuator | `in` (in, signal, l)<br>`out` (out, signal, r) | `il` | `adjustable` |

## Filters

| Type | Name | Ports | Properties | Variants |
| --- | --- | --- | --- | --- |
| `bpf` | Band-pass filter | `in` (in, signal, l)<br>`out` (out, signal, r) | `fc`, `bw`, `il` | `adjustable` |
| `bsf` | Band-stop filter | `in` (in, signal, l)<br>`out` (out, signal, r) | `fc`, `bw`, `il` | `adjustable` |
| `hpf` | High-pass filter | `in` (in, signal, l)<br>`out` (out, signal, r) | `fc`, `il` | `adjustable` |
| `lpf` | Low-pass filter | `in` (in, signal, l)<br>`out` (out, signal, r) | `fc`, `il` | `adjustable` |

## Conversion

| Type | Name | Ports | Properties | Variants |
| --- | --- | --- | --- | --- |
| `div` | Frequency divider | `in` (in, lo, l)<br>`out` (out, lo, r) | `ratio` | — |
| `iq_demod` | I/Q demodulator | `rf` (in, signal, l)<br>`lo` (in, lo, b)<br>`i` (out, signal, r)<br>`q` (out, signal, r) | `gain`, `nf`, `iip3` | — |
| `iq_mod` | I/Q modulator | `i` (in, signal, l)<br>`q` (in, signal, l)<br>`lo` (in, lo, b)<br>`rf` (out, signal, r) | `gain` | — |
| `mixer` | Mixer | `rf` (in, signal, l)<br>`if` (out, signal, r)<br>`lo` (in, lo, b) | `gain`, `nf`, `iip3` | — |
| `mult` | Frequency multiplier | `in` (in, lo, l)<br>`out` (out, lo, r) | `ratio` | — |

## Sources

| Type | Name | Ports | Properties | Variants |
| --- | --- | --- | --- | --- |
| `lo` | Oscillator / LO | `ref` (in, clk, l, optional)<br>`out` (out, lo, r) | `freq` | `adjustable` |
| `xo` | Crystal oscillator | `out` (out, clk, r) | `freq` | — |

## RF passives

| Type | Name | Ports | Properties | Variants |
| --- | --- | --- | --- | --- |
| `antenna` | Antenna | `io` (bi, signal, r) | — | — |
| `balun` | Balun | `in` (bi, signal, fixed, l)<br>`out` (bi, signal, diff, fixed, r) | `il` | — |
| `circulator` | Circulator | `p1` (bi, signal, l)<br>`p2` (bi, signal, r)<br>`p3` (bi, signal, b) | `il` | — |
| `coupler` | Directional coupler | `in` (in, signal, l)<br>`out` (out, signal, r)<br>`cpl` (out, signal, b) | `il`, `coupling` | — |
| `duplexer` | Duplexer / diplexer | `ant` (bi, signal, l)<br>`tx` (bi, signal, r)<br>`rx` (bi, signal, r) | `il` | — |
| `hybrid90` | 90° hybrid | `in` (bi, signal, l)<br>`iso` (bi, signal, l)<br>`p0` (bi, signal, r)<br>`p90` (bi, signal, r) | `il` | — |
| `isolator` | Isolator | `in` (in, signal, l)<br>`out` (out, signal, r) | `il` | — |
| `phase` | Phase shifter | `in` (in, signal, l)<br>`out` (out, signal, r) | `il` | `adjustable` |
| `spdt` | SPDT switch | `c` (bi, signal, l)<br>`t1` (bi, signal, r)<br>`t2` (bi, signal, r)<br>`ctrl` (in, ctrl, b, optional) | `il` | — |
| `splitter` | Splitter / combiner | `in` (bi, signal, l)<br>`o1` (bi, signal, r)<br>`o2` (bi, signal, r) | `il` | — |
| `spnt` | SP4T switch | `c` (bi, signal, l)<br>`t1` (bi, signal, r)<br>`t2` (bi, signal, r)<br>`t3` (bi, signal, r)<br>`t4` (bi, signal, r)<br>`ctrl` (in, ctrl, b, optional) | `il` | — |
| `term` | Termination | `io` (bi, signal, l) | — | — |

## Converters

| Type | Name | Ports | Properties | Variants |
| --- | --- | --- | --- | --- |
| `adc` | Analog-to-digital converter | `in` (in, signal, l)<br>`out` (out, digital, r) | `bits`, `fs` | — |
| `dac` | Digital-to-analog converter | `in` (in, digital, l)<br>`out` (out, signal, r) | `bits`, `fs` | — |

## DSP

| Type | Name | Ports | Properties | Variants |
| --- | --- | --- | --- | --- |
| `cmul` | Complex multiply | `i` (in, signal, l)<br>`q` (in, signal, l)<br>`lo_i` (in, lo, b, optional)<br>`lo_q` (in, lo, b, optional)<br>`oi` (out, signal, rail i, r)<br>`oq` (out, signal, rail q, r) | — | — |
| `ddc` | Digital downconverter | `in` (in, signal, l)<br>`i` (out, signal, r)<br>`q` (out, signal, r) | `freq`, `ratio` | — |
| `decim` | Decimator | `in` (in, signal, l)<br>`out` (out, signal, r) | `ratio` | — |
| `delay` | Delay | `in` (in, signal, l)<br>`out` (out, signal, r) | — | — |
| `duc` | Digital upconverter | `i` (in, signal, l)<br>`q` (in, signal, l)<br>`out` (out, signal, r) | `freq`, `ratio` | — |
| `interp` | Interpolator | `in` (in, signal, l)<br>`out` (out, signal, r) | `ratio` | — |
| `sum` | Sum | `a` (in, signal, l)<br>`b` (in, signal, b)<br>`out` (out, signal, r) | — | — |

## Generic

| Type | Name | Ports | Properties | Variants |
| --- | --- | --- | --- | --- |
| `custom` | Custom block | `in` (in, signal, l)<br>`out` (out, signal, r) | — | — |
| `ground` | Ground | `io` (bi, signal, t) | — | — |
| `port_in` | Input port | `out` (out, signal, r) | — | — |
| `port_out` | Output port | `in` (in, signal, l) | — | — |

Any other `type` loads as a labelled custom block with a warning. Custom blocks (`type: "custom"`) take a `ports` array and optional `size`; ports named `i` and `q` on the same side are placed one rail pitch (6 units) apart so I/Q pairs line up. A custom block can also carry an `icon`: SVG path data in grid units drawn inside its box.

Set `variant` on a block to use a symbol variant; `adjustable` adds a diagonal tuning arrow.

## Aliases

These names are accepted as a block `type` and resolve to a core symbol on load (and in the quick-add box). Fields the block sets itself win over the alias defaults; aliases with port renames rewrite connection endpoints.

| Alias | Becomes | Defaults |
| --- | --- | --- |
| `lna` | `amp` | label "LNA" |
| `pa` | `amp` | label "PA" |
| `driver` | `amp` | label "DRV" |
| `drv` | `amp` | label "DRV" |
| `vga` | `amp` | label "VGA"; variant adjustable |
| `gain` | `amp` | — |
| `aaf` | `lpf` | label "AAF" |
| `saw` | `bpf` | label "SAW" |
| `baw` | `bpf` | label "BAW" |
| `pll` | `lo` | label "PLL" |
| `synth` | `lo` | label "Synth" |
| `vco` | `lo` | label "VCO"; variant adjustable |
| `irm` | `mixer` | label "IRM" |
| `combiner` | `splitter` | flipped; ports i1→o1, i2→o2, out→in |
| `diplexer` | `duplexer` | label "Diplexer"; ports com→ant, lb→tx, hb→rx |
| `fir` | `custom` | label "FIR" |
| `iir` | `custom` | label "IIR" |
| `fft` | `custom` | label "FFT" |
| `cordic` | `custom` | label "CORDIC" |
| `agc` | `custom` | label "AGC" |
| `nco` | `custom` | label "NCO"; ports out |
