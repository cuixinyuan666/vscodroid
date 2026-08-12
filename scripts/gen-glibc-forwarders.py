#!/usr/bin/env python3
"""Generate the versioned stub libraries a glibc-built addon needs to load here.

    gen-glibc-forwarders.py <addon.node|.so> [more...] --out <dir>

A prebuilt linux-arm64 addon is machine code Android can execute -- same ISA,
same calling convention -- and the only thing refusing it is the dynamic linker.
Its imports are not plain names but versioned bindings to specific libraries:
`malloc@GLIBC_2.17` looked up in `libc.so.6`. Android has no libc.so.6, and an
empty stub with that soname does not help, because the lookup carries a version
the stub does not define.

So this writes stubs that do define them. For each library the addon names, it
emits a shared object with that soname exporting exactly the symbols the addon
asks for, at exactly the versions it asks for, each one a tail branch to Bionic's
implementation of the same name:

    __asm__("__fwd_malloc: adrp x16, ptr\\n ldr x16, [x16, :lo12:ptr]\\n br x16");
    __asm__(".symver __fwd_malloc,malloc@@GLIBC_2.17");

The jump is indirect, through a pointer filled at load time from Bionic's libc,
and that indirection is not decoration. A direct `b malloc` inside a library
that itself exports `malloc` binds to its own definition -- the trampoline
branches to itself, and the addon hangs on the first allocation instead of
failing with something legible. Going through a pointer resolved against libc by
name is what makes the target unambiguous.

Either way no function signature is needed anywhere in this file. `br` is a tail
call: arguments stay in their registers, the return goes straight to the
original caller, and the trampoline never appears on the stack. x16 is the
register the ABI reserves for exactly this kind of thunk. Three instructions
forward any signature, including varargs.

Symbols Bionic does not have at all are supplied by glibc-shim.c, which these
stubs link against -- the two halves are meant to be built together by
build-glibc-shim.sh.

What this is not: an emulator, or a glibc. It works where the two libcs agree on
the ABI, which is most of it. Where they disagree -- a struct laid out
differently, a function whose error semantics diverge -- an addon will load and
then misbehave somewhere this cannot see. Anything depending on it needs testing
on a device, not trust.
"""

import argparse
import pathlib
import re
import struct
import sys

# Bionic folded these into libc long ago, so a name that used to live in one of
# them resolves from libc now. The stubs still have to exist under the old names
# because that is what the addon's DT_NEEDED asks for.
BIONIC_LIBS = ["-lc", "-lm", "-ldl", "-llog"]

# Provided by whatever loads the addon rather than by any library: Node defines
# these itself and resolves them at dlopen. Forwarding them would bind to
# nothing.
RUNTIME_PROVIDED = re.compile(r"^(napi_|node_api_)")

# Always optional. The linker emits references to them for instrumentation that
# is not present, and a forwarder would fail to link.
WEAK_OPTIONAL = {
    "_ITM_registerTMCloneTable", "_ITM_deregisterTMCloneTable",
    "__gmon_start__", "__cxa_finalize", "__cxa_atexit",
}

SHT_DYNSYM, SHT_GNU_VERNEED, SHT_GNU_VERSYM = 11, 0x6FFFFFFE, 0x6FFFFFFF
STT_FUNC, STT_OBJECT = 2, 1

# Data imports cannot be a branch -- the addon reads the storage itself, so the
# stub has to own a variable of the right type and fill it with Bionic's value
# before anything runs. Only the ones that actually turn up are listed; a new one
# is reported rather than guessed at, because guessing a type here means memory
# corruption rather than a link error.
DATA_SYMBOLS = {
    "stdout": ("FILE *", "stdout"),
    "stderr": ("FILE *", "stderr"),
    "stdin": ("FILE *", "stdin"),
    "environ": ("char **", "environ"),
    "__environ": ("char **", "environ"),
    "_environ": ("char **", "environ"),
}


class Elf:
    """Just enough ELF64 to read what symbols an object imports, and from where."""

    def __init__(self, path: pathlib.Path):
        self.data = path.read_bytes()
        self.path = path
        if self.data[:4] != b"\x7fELF" or self.data[4] != 2:
            raise ValueError(f"{path.name} is not a 64-bit ELF file")

        e_shoff, = struct.unpack_from("<Q", self.data, 40)
        e_shentsize, e_shnum, e_shstrndx = struct.unpack_from("<HHH", self.data, 58)

        self.sections = []
        for i in range(e_shnum):
            off = e_shoff + i * e_shentsize
            name, s_type = struct.unpack_from("<II", self.data, off)
            s_offset, = struct.unpack_from("<Q", self.data, off + 24)
            s_size, s_link = struct.unpack_from("<QI", self.data, off + 32)
            s_entsize, = struct.unpack_from("<Q", self.data, off + 56)
            self.sections.append(
                dict(name=name, type=s_type, offset=s_offset, size=s_size,
                     link=s_link, entsize=s_entsize))

        shstr = self.sections[e_shstrndx]
        for s in self.sections:
            s["sname"] = self._cstr(shstr["offset"] + s["name"])

    def _cstr(self, off: int) -> str:
        end = self.data.index(b"\0", off)
        return self.data[off:end].decode("utf-8", "replace")

    def _by_type(self, want):
        return next((s for s in self.sections if s["type"] == want), None)

    def imports(self):
        """Yield (soname, version, symbol, is_func) for every undefined import.

        soname and version are None for imports with no version requirement --
        those bind by name alone and need no stub.
        """
        dynsym = self._by_type(SHT_DYNSYM)
        if not dynsym:
            return
        strtab = self.sections[dynsym["link"]]

        versym = self._by_type(SHT_GNU_VERSYM)
        # version index -> (version name, library it must come from)
        vermap = {}
        verneed = self._by_type(SHT_GNU_VERNEED)
        if verneed:
            # Verneed carries its own string table link; usually .dynstr, but
            # reading it from the section rather than assuming keeps this honest.
            vstr = self.sections[verneed["link"]]
            pos = verneed["offset"]
            while True:
                # Elf64_Verneed: version(2) cnt(2) file(4) aux(4) next(4)
                _, vn_cnt = struct.unpack_from("<HH", self.data, pos)
                vn_file, vn_aux, vn_next = struct.unpack_from("<III", self.data, pos + 4)
                soname = self._cstr(vstr["offset"] + vn_file)
                aux = pos + vn_aux
                for _ in range(vn_cnt):
                    vna_name, = struct.unpack_from("<I", self.data, aux + 8)
                    vna_other, = struct.unpack_from("<H", self.data, aux + 6)
                    vna_next, = struct.unpack_from("<I", self.data, aux + 12)
                    vermap[vna_other] = (self._cstr(vstr["offset"] + vna_name), soname)
                    if not vna_next:
                        break
                    aux += vna_next
                if not vn_next:
                    break
                pos += vn_next

        count = dynsym["size"] // dynsym["entsize"]
        for i in range(count):
            off = dynsym["offset"] + i * dynsym["entsize"]
            st_name, st_info = struct.unpack_from("<IB", self.data, off)
            st_shndx, = struct.unpack_from("<H", self.data, off + 6)
            if st_shndx != 0:            # defined here, not imported
                continue
            name = self._cstr(strtab["offset"] + st_name)
            if not name:
                continue

            version = soname = None
            if versym:
                idx, = struct.unpack_from("<H", self.data, versym["offset"] + i * 2)
                version, soname = vermap.get(idx & 0x7FFF, (None, None))

            yield soname, version, name, (st_info & 0xF) == STT_FUNC


def generate(inputs, out_dir: pathlib.Path):
    # soname -> version -> {symbol: is_func}
    wanted: dict = {}
    skipped_data, skipped_runtime = set(), set()

    for path in inputs:
        for soname, version, name, is_func in Elf(path).imports():
            if RUNTIME_PROVIDED.match(name):
                skipped_runtime.add(name)
                continue
            if name in WEAK_OPTIONAL or soname is None:
                continue
            if not is_func and name not in DATA_SYMBOLS:
                skipped_data.add(name)
                continue
            wanted.setdefault(soname, {}).setdefault(version, {})[name] = is_func

    if not wanted:
        print("  nothing to generate: no versioned imports found")
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)
    for soname, versions in sorted(wanted.items()):
        stem = soname.replace(".", "_")
        c_path = out_dir / f"{stem}.c"
        map_path = out_dir / f"{stem}.map"

        lines = [
            "/* Generated by gen-glibc-forwarders.py -- do not edit.",
            f" * Stub for {soname}. Functions are a tail branch to the Bionic",
            " * function of the same name; data symbols are storage of our own,",
            " * filled from Bionic's before anything else runs. Both are exported",
            " * at the version the addon asks for.",
            " */",
            "#include <dlfcn.h>",
            "#include <stdio.h>",
            "#include <stdlib.h>",
            "",
            "extern char **environ;",
            "",
            "/* Bionic merged libm, libdl, libpthread and librt into libc, so one",
            " * handle answers for every name this stub stands in for. Opened with",
            " * NOLOAD because libc is always already mapped. */",
            "static void *__fwd_libc;",
            "",
        ]
        targets, inits = [], []
        for version, symbols in sorted(versions.items()):
            suffix = version.replace(".", "_")
            for name, is_func in sorted(symbols.items()):
                fwd = f"__fwd_{suffix}_{name}"
                if is_func:
                    ptr = f"__ptr_{suffix}_{name}"
                    targets.append((ptr, name, fwd))
                    # Hidden, and that is load-bearing: a default-visibility
                    # global is preemptible, so the linker routes reads through
                    # the GOT and the adrp/lo12 pair below would compute the
                    # wrong address. Hidden binds locally and makes the direct
                    # pair correct.
                    lines.append(f'void *{ptr} __attribute__((visibility("hidden")));')
                else:
                    ctype, source = DATA_SYMBOLS[name]
                    lines.append(f"{ctype}{fwd};")
                    inits.append(f"    {fwd} = {source};")
                lines.append(f'__asm__(".symver {fwd},{name}@@{version}");')

        for ptr, name, fwd in targets:
            lines.append(
                f'__asm__(".globl {fwd}\\n"\n'
                f'        "{fwd}:\\n"\n'
                f'        "  adrp x16, {ptr}\\n"\n'
                f'        "  ldr  x16, [x16, :lo12:{ptr}]\\n"\n'
                f'        "  br   x16\\n");')

        lines.append("")
        lines.append("__attribute__((constructor)) static void __fwd_init(void) {")
        lines.append('    __fwd_libc = dlopen("libc.so", RTLD_LAZY | RTLD_NOLOAD);')
        lines.append("    /* RTLD_NEXT, never RTLD_DEFAULT: on Bionic RTLD_DEFAULT is NULL")
        lines.append("     * and searches globally, where the first match is this stub's own")
        lines.append("     * exported symbol -- the pointer would aim at the trampoline that")
        lines.append("     * reads it, and the first call recurses until the stack ends. */")
        lines.append("    if (!__fwd_libc) __fwd_libc = RTLD_NEXT;")
        for ptr, name, _ in targets:
            lines.append(f'    {ptr} = dlsym(__fwd_libc, "{name}");')
        lines.extend(inits)
        lines.append("}")
        c_path.write_text("\n".join(lines) + "\n")

        map_lines = []
        for version, symbols in sorted(versions.items()):
            body = "; ".join(sorted(symbols))
            map_lines.append(f"{version} {{ global: {body}; }};")
        # Everything not named above stays local, so the stub exports exactly
        # what the addon asked for and nothing else.
        map_lines.append("LOCAL_ONLY { local: *; };")
        map_path.write_text("\n".join(map_lines) + "\n")

        total = sum(len(v) for v in versions.values())
        print(f"  {soname:<20} {total:4d} symbols across "
              f"{len(versions)} version(s)")

    if skipped_data:
        print(f"\n  data imports, not forwarded ({len(skipped_data)}) -- these must be"
              f" defined in glibc-shim.c or the addon will still fail to load:")
        for name in sorted(skipped_data):
            print(f"    {name}")
    if skipped_runtime:
        print(f"\n  {len(skipped_runtime)} runtime-provided symbols skipped"
              f" (napi_*), as the loader defines those")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+", type=pathlib.Path)
    ap.add_argument("--out", type=pathlib.Path, required=True)
    args = ap.parse_args()

    missing = [p for p in args.inputs if not p.is_file()]
    if missing:
        print("  ERROR: no such file: " + ", ".join(str(p) for p in missing),
              file=sys.stderr)
        return 1
    return generate(args.inputs, args.out)


if __name__ == "__main__":
    sys.exit(main())
