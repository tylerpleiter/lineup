#!/usr/bin/env python3
"""Check .sig.json diagrams the way Lineup does, before a human opens them.

    python check.py diagram.sig.json [more.sig.json ...]
    python check.py diagram.svg          # also works on exported SVG/PNG (embedded source)

Reports errors (Lineup will flag these) and warnings (allowed, but probably unintended).
Exit code 0 when there are no errors. Standard library only; if the `jsonschema` package
is installed, the file is also validated against the full JSON Schema.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = json.load(open(os.path.join(HERE, "symbols.json"), encoding="utf-8"))
SYMBOLS, ALIASES = DATA["symbols"], DATA["aliases"]
SCHEMA_PATH = os.path.join(HERE, "..", "references", "lineup.schema.json")

ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$")
REF_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*)(?::([iq]))?\.([A-Za-z0-9_-]+)$")
AUX = {"lo", "clk", "ctrl"}
SIGNAL_PATH = {"signal", "digital"}
LEGACY = {"rf", "if", "bb"}
RESERVED_NUMERIC = {"gain", "nf", "oip3", "iip3", "p1db", "il", "freq", "fc", "bw", "bits", "fs", "ratio"}
DEFAULT_CUSTOM_PORTS = [{"name": "in", "side": "l", "dir": "in"}, {"name": "out", "side": "r", "dir": "out"}]


def norm_domain(d):
    return "signal" if d in (None, *LEGACY) else d


def rail_of(port):
    if port.get("rail"):
        return port["rail"]
    return port["name"] if port["name"] in ("i", "q") else None


class Checker:
    def __init__(self, doc):
        self.doc = doc
        self.errors, self.warnings = [], []

    def err(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    # -- blocks ---------------------------------------------------------------
    def resolve_blocks(self):
        self.blocks, self.ports = {}, {}
        renames = {}
        for i, b in enumerate(self.doc.get("blocks", [])):
            if not isinstance(b, dict) or "id" not in b or "type" not in b:
                self.err(f"blocks[{i}]: every block needs an id and a type")
                continue
            bid, btype = b["id"], b["type"]
            if not ID_RE.match(str(bid)):
                self.err(f"{bid}: ids start with a letter or _ and use letters, digits, _ and -")
            if bid in self.blocks:
                self.err(f"{bid}: duplicate block id")
                continue
            b = dict(b)
            if btype in ALIASES:
                a = ALIASES[btype]
                b["type"] = a["type"]
                b.setdefault("label", a.get("label"))
                if a.get("variant"):
                    b.setdefault("variant", a["variant"])
                if a.get("customPorts") and "ports" not in b:
                    b["ports"] = a["customPorts"]
                renames[bid] = a.get("ports", {})
            self.blocks[bid] = b
            self.ports[bid] = self.block_ports(b)
        self.renames = renames

    def block_ports(self, b):
        t = b["type"]
        if t == "custom" or t not in SYMBOLS:
            if t not in SYMBOLS:
                self.warn(f'{b["id"]}: unknown type "{t}" (Lineup draws it as a labelled box; see SYMBOLS.md)')
                if "ports" not in b:
                    return None  # ports inferred from connections: can't check them
            ports = [dict(p) for p in b.get("ports") or DEFAULT_CUSTOM_PORTS]
            for p in ports:
                p.setdefault("signal", "se")
                p["domain"] = norm_domain(p.get("domain"))
        else:
            sym = SYMBOLS[t]
            ports = [dict(p) for p in sym["ports"]]
            v = b.get("variant")
            if v:
                if v not in sym["variants"]:
                    self.err(f'{b["id"]}: {t} has no variant "{v}" (has: {", ".join(sym["variants"]) or "none"})')
                else:
                    ports += [dict(p) for p in sym["variants"][v]]
        sig = b.get("signal")
        for p in ports:
            if sig and not p.get("fixed") and p["domain"] == "signal":
                p["signal"] = sig
        names = [p["name"] for p in ports]
        if len(set(names)) != len(names):
            self.err(f'{b["id"]}: duplicate port names')
        return {p["name"]: p for p in ports}

    def check_params(self):
        for bid, b in self.blocks.items():
            params = b.get("params") or {}
            for k, v in params.items():
                if k in RESERVED_NUMERIC and not isinstance(v, (int, float)):
                    self.err(f'{bid}.params.{k}: reserved properties are plain numbers in base units (e.g. 2.44e9, not "{v}")')
            for k in b.get("show") or []:
                if k not in params:
                    self.warn(f'{bid}: shows "{k}" but has no value for it')

    # -- connections ----------------------------------------------------------
    def parse_ref(self, s, ci):
        m = REF_RE.match(s or "")
        if not m:
            self.err(f'connection {ci + 1}: bad endpoint "{s}" (use block.port, or block:i.port for one I/Q rail)')
            return None
        bid, rail, port = m.groups()
        port = self.renames.get(bid, {}).get(port, port)
        if bid not in self.blocks:
            self.err(f'connection {ci + 1}: "{s}" refers to a block that does not exist')
            return None
        ports = self.ports.get(bid)
        if ports is not None and port not in ports:
            self.err(f'connection {ci + 1}: {bid} ({self.blocks[bid]["type"]}) has no port "{port}"; ports: {", ".join(ports)}')
            return None
        return bid, rail, port

    def port(self, bid, name):
        ports = self.ports.get(bid)
        return ports.get(name) if ports else {"name": name, "dir": "bi", "domain": "signal", "signal": "se"}

    def propagate_iq(self, conns):
        """Blocks downstream of split outputs / upstream of merge inputs become I/Q pairs."""
        iq = {bid for bid, b in self.blocks.items() if b.get("iq")}
        edges = []
        for f, t in conns:
            pf, pt = self.port(f[0], f[2]), self.port(t[0], t[2])
            if pf["dir"] == "in" and pt["dir"] != "in":
                f, t, pf, pt = t, f, pt, pf
            edges.append((f, t, pf, pt))
        sig = lambda pf, pt: pf["domain"] in SIGNAL_PATH and pt["domain"] in SIGNAL_PATH
        # Forward: everything downstream of a split block's rail outputs, until a merge input.
        fwd = [t[0] for f, t, pf, pt in edges if f[0] not in iq and rail_of(pf) and not rail_of(pt) and sig(pf, pt)]
        while fwd:
            bid = fwd.pop()
            if bid in iq:
                continue
            iq.add(bid)
            fwd += [t[0] for f, t, pf, pt in edges if f[0] == bid and not rail_of(pt) and sig(pf, pt)]
        # Backward: everything upstream of a merge block's rail inputs, until a split output.
        back = [f[0] for f, t, pf, pt in edges if t[0] not in iq and rail_of(pt) and not rail_of(pf) and sig(pf, pt)]
        while back:
            bid = back.pop()
            if bid in iq:
                continue
            iq.add(bid)
            back += [f[0] for f, t, pf, pt in edges if t[0] == bid and not rail_of(pf) and sig(pf, pt)]
        return iq, edges

    def check_connections(self):
        conns = []
        for ci, c in enumerate(self.doc.get("connections", [])):
            if not isinstance(c, dict) or "from" not in c or "to" not in c:
                self.err(f"connection {ci + 1}: needs from and to")
                continue
            f, t = self.parse_ref(c["from"], ci), self.parse_ref(c["to"], ci)
            if f and t:
                if f[0] == t[0]:
                    self.err(f"connection {ci + 1}: {c['from']} → {c['to']} connects a block to itself")
                conns.append((f, t))
        iq, edges = self.propagate_iq(conns)
        self.iq_blocks = iq
        drivers = {}
        for f, t, pf, pt in edges:
            name = f"{f[0]}.{f[2]} → {t[0]}.{t[2]}"
            if pf["dir"] == "out" and pt["dir"] == "out":
                self.err(f"{name}: output connected to output")
            if pf["dir"] == "in" and pt["dir"] == "in":
                self.err(f"{name}: input connected to input")
            if pf["signal"] != pt["signal"]:
                self.warn(f"{name}: single-ended ↔ differential (add a balun, or set both blocks' signal the same)")
            f_iq, t_iq = f[0] in iq, t[0] in iq
            aux = pf["domain"] in AUX or pt["domain"] in AUX
            if t_iq and not f_iq and not (rail_of(pf) or t[1] or aux):
                self.err(f"{name}: a single path can't feed an I/Q pair; start I/Q at a split block (iq_demod, ddc) or pick a rail with {t[0]}:i.{t[2]}")
            if f_iq and not t_iq and not (rail_of(pt) or f[1]):
                self.err(f"{name}: an I/Q pair can only end at a merge block (iq_mod, duc) or a chosen rail")
            # Count drivers per drawn input (per rail for I/Q pairs).
            if pt["dir"] == "in":
                if f_iq and t_iq and not (f[1] or t[1]):
                    rails = ["i", "q"]
                elif t_iq:
                    rails = [t[1] or rail_of(pf) or f[1] or "i"] if not aux else ["i", "q"]
                else:
                    rails = [None]
                for r in rails:
                    drivers.setdefault((t[0], r, t[2]), []).append(name)
        for (bid, r, port), names in drivers.items():
            if len(names) > 1:
                where = f"{bid}{':' + r if r else ''}.{port}"
                self.err(f"{where} has {len(names)} drivers ({'; '.join(names)}); use a splitter/combiner or sum block")

    def check_groups(self):
        for g in self.doc.get("groups", []) or []:
            for m in g.get("members", []):
                if m not in self.blocks:
                    self.warn(f'group {g.get("id")}: member "{m}" is not a block')
        for n in self.doc.get("notes", []) or []:
            if n.get("near") and n["near"] not in self.blocks:
                self.warn(f'note "{n.get("text", "")[:20]}": near "{n["near"]}" is not a block')

    def schema(self):
        try:
            import jsonschema  # optional
        except ImportError:
            return
        schema = json.load(open(SCHEMA_PATH, encoding="utf-8"))
        v = jsonschema.Draft202012Validator(schema)
        for e in sorted(v.iter_errors(self.doc), key=lambda e: list(e.path)):
            loc = "/".join(str(p) for p in e.path) or "/"
            self.err(f"schema: {loc}: {e.message}")

    def run(self):
        d = self.doc
        if not isinstance(d, dict) or not isinstance(d.get("blocks"), list):
            self.err('not a Lineup diagram: expected an object with a "blocks" array')
            return self
        if not isinstance(d.get("connections", []), list):
            self.err('"connections" must be an array')
            return self
        if d.get("lineup") != "0.1":
            self.warn('"lineup": "0.1" is missing or different')
        self.schema()
        self.resolve_blocks()
        self.check_params()
        self.check_connections()
        self.check_groups()
        return self


def load(path):
    if path.lower().endswith((".svg", ".png")):
        sys.path.insert(0, HERE)
        from extract import extract
        src = extract(path)
        if src is None:
            raise ValueError("no embedded Lineup diagram")
        return json.loads(src)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0 if argv else 2
    as_json = "--json" in argv
    paths = [a for a in argv if a != "--json"]
    failed = False
    report = {}
    for path in paths:
        try:
            c = Checker(load(path)).run()
        except (ValueError, json.JSONDecodeError, OSError) as e:
            c = Checker({}).run()
            c.errors = [f"cannot read: {e}"]
        failed |= bool(c.errors)
        if as_json:
            report[path] = {"errors": c.errors, "warnings": c.warnings}
            continue
        for m in c.errors:
            print(f"{path}: error: {m}")
        for m in c.warnings:
            print(f"{path}: warning: {m}")
        if not c.errors and not c.warnings:
            n = len(c.doc.get("blocks", []))
            print(f"{path}: ok ({n} blocks, {len(c.doc.get('connections', []))} connections)")
    if as_json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
