#!/usr/bin/env python3
"""Print the .sig.json diagram embedded in an SVG or PNG exported from Lineup.

    python extract.py diagram.svg            # prints the JSON
    python extract.py diagram.png -o rx.sig.json

Standard library only. Exit code 1 if the file has no embedded diagram.
"""
import argparse
import re
import struct
import sys
import zlib


def from_svg(text: str):
    m = re.search(r'<metadata[^>]*id="sig-source"[^>]*>(.*?)</metadata>', text, re.S)
    if not m:
        return None
    body = m.group(1)
    parts = re.findall(r"<!\[CDATA\[(.*?)\]\]>", body, re.S)
    if parts:
        return "".join(parts)
    import html
    return html.unescape(body.strip())


def from_png(data: bytes):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    off = 8
    while off + 12 <= len(data):
        length, ctype = struct.unpack(">I4s", data[off:off + 8])
        chunk = data[off + 8:off + 8 + length]
        if ctype in (b"iTXt", b"tEXt") and chunk.split(b"\0", 1)[0] == b"sig.json":
            if ctype == b"tEXt":
                return chunk.split(b"\0", 1)[1].decode("latin-1")
            rest = chunk[len(b"sig.json") + 1:]
            compressed, rest = rest[0], rest[2:]
            rest = rest.split(b"\0", 1)[1]  # language tag
            rest = rest.split(b"\0", 1)[1]  # translated keyword
            return (zlib.decompress(rest) if compressed else rest).decode("utf-8")
        if ctype == b"IEND":
            break
        off += 12 + length
    return None


def extract(path: str):
    with open(path, "rb") as f:
        data = f.read()
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return from_png(data)
    return from_svg(data.decode("utf-8", errors="replace"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", help="SVG or PNG exported from Lineup")
    ap.add_argument("-o", "--out", help="write the JSON to this file instead of stdout")
    args = ap.parse_args()
    src = extract(args.image)
    if src is None:
        print(f"{args.image}: no embedded Lineup diagram (only SVG/PNG exported from Lineup carry one)", file=sys.stderr)
        sys.exit(1)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(src)
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(src)


if __name__ == "__main__":
    main()
