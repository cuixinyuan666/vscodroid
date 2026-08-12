#!/usr/bin/env python3
"""Check that a vscode-reh server tree is the one this app can actually run.

Used from both ends of the pivot: build-vscode-oss.sh runs it on what gulp
produced, and fetch-vscode-oss.sh runs it on what was downloaded. Same checks
either side, because the failures it catches are the ones that survive every
other gate and only show up on a device.

    verify-server-tree.py <tree>
"""

import json
import pathlib
import struct
import sys

# e_machine values from the ELF spec. The tree also carries Windows PE addons for
# extensions that never load here; those are skipped rather than flagged.
AARCH64 = 0xB7
MACHINES = {0x3E: "x86-64", AARCH64: "aarch64", 0x28: "arm", 0xF3: "riscv"}

# The paths VSCodroid loads by name. server.js:57 forks the first, rewrites the
# second on every start, and the Search service execs into the third.
REQUIRED = [
    "out/server-main.js",
    "product.json",
    "node_modules/@vscode/ripgrep/bin/rg",
    # Code - OSS is MIT and this tree is redistributed inside every APK, so the
    # copyright notice has to travel with it. product.json names it too.
    "LICENSE.txt",
]

failed = False


def check(ok, label, detail=""):
    global failed
    print(f"  {'ok     ' if ok else 'FAIL   '} {label}{'' if ok else '  ' + detail}")
    if not ok:
        failed = True


def main(tree):
    for rel in REQUIRED:
        check((tree / rel).exists(), rel)

    # Present only in Microsoft's build. Its presence means this is not the tree
    # we think it is, whatever the filename said.
    check(not (tree / "node_modules/vsda").exists(), "no vsda",
          "this is not an OSS tree")

    # gulp's node-linux-arm64 task ships a GNU/Linux Node whose interpreter does
    # not exist on Android. Nothing references it; the runtime uses
    # nativeLibraryDir/libnode.so. 92 MiB of dead weight in every APK.
    check(not (tree / "node").exists(), "no bundled GNU/Linux node",
          "prune it before packaging")

    # Every native module is built for the build host, and only node-pty and
    # @parcel/watcher are overlaid for Bionic afterwards. ripgrep is the one that
    # bites: its postinstall downloads a binary for whatever os.platform() and
    # arch() report, so an x86-64 build host yields a tree that installs cleanly,
    # passes every other check, and then fails at exec with Search silently
    # returning no results.
    wrong, checked = [], 0
    for path in sorted(tree.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        if path.suffix != ".node" and path.name != "rg":
            continue
        head = path.open("rb").read(20)
        if head[:4] != b"\x7fELF":
            continue
        machine = struct.unpack_from("<H", head, 18)[0]
        checked += 1
        if machine != AARCH64:
            wrong.append((path.relative_to(tree), MACHINES.get(machine, hex(machine))))

    for rel, arch in wrong:
        check(False, f"{rel} is {arch}, not aarch64", "build on an arm64 host")
    if not wrong:
        check(True, f"{checked} native binaries are aarch64")

    product_path = tree / "product.json"
    if product_path.exists():
        product = json.loads(product_path.read_text())
        check(product.get("nameLong") == "VSCodroid", "product.json is branded",
              f"nameLong = {product.get('nameLong')!r}")
        # workbench.js hardcodes *.vscode-cdn.net and the WebView cannot reach it;
        # the template being absent is what makes the Kotlin-side interception the
        # only path.
        check("webviewContentExternalBaseUrlTemplate" not in product,
              "no vscode-cdn.net template")
        gallery = product.get("extensionsGallery", {}).get("serviceUrl", "")
        check("open-vsx.org" in gallery, "gallery points at Open VSX",
              f"serviceUrl = {gallery!r}")

    return 1 if failed else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: verify-server-tree.py <tree>", file=sys.stderr)
        sys.exit(2)
    root = pathlib.Path(sys.argv[1])
    if not root.is_dir():
        print(f"  FAIL    {root} is not a directory", file=sys.stderr)
        sys.exit(1)
    sys.exit(main(root))
