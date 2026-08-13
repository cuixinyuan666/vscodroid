#!/usr/bin/env python3
"""Check that an ELF binary can actually load on Android.

    verify-android-elf.py <file> [--lib-dir DIR]...

Three things, each of which fails the same quiet way at runtime — the file is
present, the build is green, and the process dies or the addon refuses to load
with a message nobody sees:

  * aarch64, so it matches the only ABI this app ships;
  * every DT_NEEDED library is one Bionic provides or one we bundle, since a
    glibc or musl dependency has no loader here;
  * every LOAD segment aligned to at least 16 KB, which Android 16 requires and
    NDK 27 does not do by default.

Pure Python on purpose: the NDK's readelf is not available everywhere this runs,
and having one implementation means the addon build and the runtime download
cannot drift apart in what they consider acceptable.
"""

import argparse
import pathlib
import struct
import sys

ELF_MAGIC = b"\x7fELF"
EM_AARCH64 = 0xB7
PT_LOAD, PT_DYNAMIC = 1, 2
DT_NULL, DT_NEEDED, DT_STRTAB, DT_STRSZ = 0, 1, 5, 10
MIN_ALIGN = 16384

# Provided by the system on every supported device, so they never need bundling.
BIONIC = {
    "libc.so", "libm.so", "libdl.so", "liblog.so", "libandroid.so",
    "libz.so", "libstdc++.so", "libnetd_client.so",
}


class NotAnElf(Exception):
    pass


def read_elf(path: pathlib.Path):
    data = path.read_bytes()
    if data[:4] != ELF_MAGIC:
        raise NotAnElf(f"{path.name} is not an ELF file")
    if data[4] != 2:
        raise NotAnElf(f"{path.name} is not 64-bit")

    machine = struct.unpack_from("<H", data, 18)[0]
    phoff, = struct.unpack_from("<Q", data, 32)
    phentsize, phnum = struct.unpack_from("<HH", data, 54)

    loads, dynamic = [], None
    for i in range(phnum):
        off = phoff + i * phentsize
        p_type, = struct.unpack_from("<I", data, off)
        p_offset, p_vaddr = struct.unpack_from("<QQ", data, off + 8)
        p_filesz, = struct.unpack_from("<Q", data, off + 32)
        p_align, = struct.unpack_from("<Q", data, off + 48)
        if p_type == PT_LOAD:
            loads.append((p_vaddr, p_offset, p_filesz, p_align))
        elif p_type == PT_DYNAMIC:
            dynamic = (p_offset, p_filesz)

    def to_offset(vaddr):
        for v, o, sz, _ in loads:
            if v <= vaddr < v + sz:
                return o + (vaddr - v)
        return None

    needed = []
    if dynamic:
        d_off, d_size = dynamic
        entries, pos = [], d_off
        while pos < d_off + d_size:
            tag, val = struct.unpack_from("<qQ", data, pos)
            pos += 16
            if tag == DT_NULL:
                break
            entries.append((tag, val))
        strtab = next((v for t, v in entries if t == DT_STRTAB), None)
        strsz = next((v for t, v in entries if t == DT_STRSZ), 0)
        base = to_offset(strtab) if strtab is not None else None
        if base is not None:
            table = data[base:base + strsz]
            for tag, val in entries:
                if tag == DT_NEEDED:
                    end = table.index(b"\0", val)
                    needed.append(table[val:end].decode())

    return machine, needed, [a for *_, a in loads]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file", type=pathlib.Path)
    ap.add_argument("--lib-dir", type=pathlib.Path, action="append", default=[],
                    help="directory whose libraries ship with the app")
    args = ap.parse_args()

    try:
        machine, needed, aligns = read_elf(args.file)
    except (NotAnElf, IndexError, struct.error) as e:
        print(f"  FAIL   {e}")
        return 1

    failed = False

    def check(ok, label, detail=""):
        nonlocal failed
        print(f"  {'ok    ' if ok else 'FAIL  '} {label}{'' if ok else '  ' + detail}")
        failed = failed or not ok

    check(machine == EM_AARCH64, "aarch64", f"e_machine = {machine:#x}")

    bundled = {p.name for d in args.lib_dir if d.is_dir() for p in d.iterdir()}
    missing = [lib for lib in needed if lib not in BIONIC and lib not in bundled]
    check(not missing, f"{len(needed)} linked libraries resolvable",
          "not provided by Bionic and not bundled: " + ", ".join(missing))

    worst = min(aligns, default=0)
    check(worst >= MIN_ALIGN, f"LOAD segments aligned to {worst:#x}",
          f"Android 16 needs {MIN_ALIGN:#x}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
