#!/usr/bin/env python3
"""Inspect actual native packages. Run only on trusted build output in CI."""
import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "pos-app/src-tauri/icons"
PRODUCT_HASH = "4c5823371db86118b018da669dbc043684139a8f66693ef2e2309d4f18617a41"
ANDROID = "{http://schemas.android.com/apk/res/android}"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def pixels(file):
    with Image.open(file) as image:
        return image.size, image.convert("RGBA").tobytes()


def compare_png(actual, expected):
    require(pixels(actual) == pixels(expected), f"Wrong GlobiPOS artwork: {actual}")


def ico_frames(data):
    reserved, kind, count = struct.unpack_from("<HHH", data)
    require(reserved == 0 and kind == 1 and count > 0, "Invalid reference ICO")
    frames = []
    for index in range(count):
        size, offset = struct.unpack_from("<II", data, 6 + index * 16 + 8)
        require(offset + size <= len(data), "Truncated reference ICO")
        frames.append(data[offset:offset + size])
    return Counter(hashlib.sha256(frame).hexdigest() for frame in frames)


def pe_resources(data):
    """Read the PE resource tree, translating RVAs through section mappings."""
    require(data[:2] == b"MZ", "Not a Windows PE executable")
    pe = struct.unpack_from("<I", data, 0x3c)[0]
    require(data[pe:pe + 4] == b"PE\0\0", "Invalid PE header")
    sections, optional_size = struct.unpack_from("<H12xH", data, pe + 6)
    optional = pe + 24
    magic = struct.unpack_from("<H", data, optional)[0]
    require(magic in (0x10b, 0x20b), "Unsupported PE optional header")
    directories = optional + (96 if magic == 0x10b else 112)
    resource_rva, resource_size = struct.unpack_from("<II", data, directories + 16)
    require(resource_rva and resource_size, "PE has no icon resources")
    mappings = []
    for index in range(sections):
        section = optional + optional_size + index * 40
        vsize, rva, rawsize, raw = struct.unpack_from("<IIII", data, section + 8)
        mappings.append((rva, max(vsize, rawsize), raw, rawsize))

    def offset(rva, size=1):
        for base, span, raw, rawsize in mappings:
            if base <= rva and rva + size <= base + span:
                require(rva - base + size <= rawsize, "PE resource outside file data")
                result = raw + rva - base
                require(result + size <= len(data), "Truncated PE resource")
                return result
        raise ValueError("Unmapped PE resource RVA")

    tree = offset(resource_rva, resource_size)
    result = {}

    def walk(relative, keys=()):
        require(len(keys) < 4 and relative + 16 <= resource_size, "Invalid PE resource tree")
        named, ids = struct.unpack_from("<HH", data, tree + relative + 12)
        require(relative + 16 + (named + ids) * 8 <= resource_size, "Truncated PE directory")
        for index in range(named + ids):
            key, child = struct.unpack_from("<II", data, tree + relative + 16 + index * 8)
            key = key if not key & 0x80000000 else f"name:{key}"
            if child & 0x80000000:
                walk(child & 0x7fffffff, keys + (key,))
            else:
                require(child + 16 <= resource_size, "Truncated PE resource entry")
                rva, size = struct.unpack_from("<II", data, tree + child)
                start = offset(rva, size)
                result[keys + (key,)] = data[start:start + size]
    walk(0)
    return result


def verify_pe(file, reference=ICONS / "icon.ico"):
    resources = pe_resources(Path(file).read_bytes())
    expected = ico_frames(Path(reference).read_bytes())
    groups = [(key, value) for key, value in resources.items() if key[0] == 14]
    require(groups, f"No Windows group icon in {file}")
    for key, group in groups:
        reserved, kind, count = struct.unpack_from("<HHH", group)
        require(reserved == 0 and kind == 1 and count > 0, f"Invalid Windows icon group: {file}")
        frames = []
        for index in range(count):
            size, icon_id = struct.unpack_from("<IH", group, 6 + index * 14 + 8)
            frame = resources.get((3, icon_id, key[-1]))
            require(frame is not None and len(frame) == size, f"Missing Windows icon frame: {file}")
            frames.append(hashlib.sha256(frame).hexdigest())
        require(Counter(frames) == expected, f"Wrong GlobiPOS PE icon (possibly generic NSIS): {file}")


def run(*args, cwd=None):
    return subprocess.run([str(arg) for arg in args], cwd=cwd, check=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).stdout


def verify_windows(package, temp):
    if package.suffix.lower() == ".msi":
        result = subprocess.run(["msiexec", "/a", str(package), "/qn", f"TARGETDIR={temp}"])
        require(result.returncode in (0, 3010), f"MSI extraction failed: {result.returncode}")
        apps = list(temp.rglob("globipos-terminal.exe"))
        require(len(apps) == 1, "MSI did not contain exactly one GlobiPOS application")
        verify_pe(apps[0])
        return ["MSI application icon"]
    verify_pe(package)
    # 7-Zip cannot reliably recover the generated NSIS uninstaller. Install the
    # trusted CI build silently in an isolated directory and inspect its real PE.
    run(package, "/S", f"/D={temp}")
    uninstallers = list(temp.rglob("uninstall*.exe")) + list(temp.rglob("uninst.exe"))
    require(len(uninstallers) == 1, "NSIS package has no unique installed uninstaller")
    try:
        apps = list(temp.rglob("globipos-terminal.exe"))
        require(len(apps) == 1, "NSIS package has no unique installed application")
        verify_pe(apps[0])
        verify_pe(uninstallers[0])
    finally:
        # Keep NSIS in this process rather than spawning a temporary copy, so
        # cleanup cannot race the background uninstaller.
        run(uninstallers[0], "/S", f"_?={temp}")
    return ["NSIS setup icon", "installed application icon", "installed uninstaller icon"]


def verify_macos(package, temp):
    mount = temp / "mount"
    mount.mkdir()
    run("hdiutil", "attach", package, "-readonly", "-nobrowse", "-mountpoint", mount)
    try:
        apps = list(mount.glob("*.app"))
        require(len(apps) == 1, "DMG has no unique application bundle")
        contents = apps[0] / "Contents"
        with (contents / "Info.plist").open("rb") as stream:
            info = plistlib.load(stream)
        icon = info.get("CFBundleIconFile")
        require(isinstance(icon, str) and Path(icon).name == icon, "Invalid macOS icon reference")
        file = contents / "Resources" / (icon if icon.endswith(".icns") else f"{icon}.icns")
        require(file.read_bytes() == (ICONS / "icon.icns").read_bytes(), "Wrong GlobiPOS DMG ICNS")
    finally:
        run("hdiutil", "detach", mount)
    return ["DMG application ICNS"]


def verify_linux_tree(tree, icons=ICONS):
    desktops = list(tree.rglob("*.desktop"))
    require(desktops, "Package must contain an application launcher")
    # AppImages can include both a root launcher and its usr/share copy.
    names = set()
    for desktop in desktops:
        entries = [line[5:].strip() for line in desktop.read_text().splitlines() if line.startswith("Icon=")]
        require(len(entries) == 1, "Missing or ambiguous Linux launcher icon")
        names.add(entries[0])
    require(len(names) == 1, "Conflicting Linux launcher icons")
    name = names.pop()
    require("/" not in name and name not in ("", ".", ".."), "Unverified Linux launcher icon path")
    candidates = list(tree.rglob(name if name.endswith(".png") else f"{name}.png"))
    require(candidates, "No packaged Linux launcher artwork")
    approved = {pixels(file) for file in icons.glob("*.png")}
    for file in candidates:
        require(pixels(file) in approved, f"Wrong GlobiPOS Linux launcher artwork: {file}")
    if (tree / ".DirIcon").exists():
        require(pixels(tree / ".DirIcon") in approved, "Wrong GlobiPOS AppImage .DirIcon")
    # An unexpected SVG could override correct PNGs on some desktops.
    require(not list(tree.rglob(f"{Path(name).stem}.svg")), "Unverified Linux SVG launcher override")
    return ["Linux desktop launcher PNGs"]


def verify_linux(package, temp):
    if package.suffix == ".deb":
        run("dpkg-deb", "-x", package, temp)
        tree = temp
    else:
        shutil.copy2(package, temp / "application.AppImage")
        image = temp / "application.AppImage"
        image.chmod(0o755)
        run(image, "--appimage-extract", cwd=temp)
        tree = temp / "squashfs-root"
        require((tree / ".DirIcon").is_file(), "Missing AppImage .DirIcon")
    return verify_linux_tree(tree)


def verify_android_tree(tree, icons=ICONS / "android"):
    """apktool resolves compiled resource IDs to XML names, not raw-byte matches."""
    app = ET.parse(tree / "AndroidManifest.xml").getroot().find("application")
    require(app is not None and app.get(ANDROID + "icon") == "@mipmap/ic_launcher",
            "APK manifest does not select the GlobiPOS launcher")
    if app.get(ANDROID + "roundIcon") is not None:
        require(app.get(ANDROID + "roundIcon") == "@mipmap/ic_launcher_round",
                "APK manifest has unverified round launcher")
    required = set()
    for density in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
        for name in ("ic_launcher", "ic_launcher_round", "ic_launcher_foreground"):
            required.add((density, name))
    found = set()
    adaptive = set()
    for directory in (tree / "res").glob("mipmap*"):
        qualifiers = directory.name.split("-")[1:]
        for file in directory.iterdir():
            if file.name.split(".")[0] not in ("ic_launcher", "ic_launcher_round", "ic_launcher_foreground"):
                continue
            require(file.name in ("ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png",
                                  "ic_launcher.xml", "ic_launcher_round.xml", "ic_launcher_foreground.xml"),
                    f"Unverified APK launcher format: {file}")
            if file.suffix == ".png":
                density = next((q for q in qualifiers if q in {key[0] for key in required}), None)
                require(density is not None and all(q in (density, "v4") for q in qualifiers),
                        f"Unverified APK density override: {file}")
                compare_png(file, icons / f"mipmap-{density}" / file.name)
                found.add((density, file.stem))
            elif file.suffix == ".xml":
                require(directory.name == "mipmap-anydpi-v26" and file.stem != "ic_launcher_foreground",
                        f"Unverified APK adaptive override: {file}")
                root = ET.parse(file).getroot()
                require(root.tag == "adaptive-icon" and len(root) == 2, f"Invalid adaptive icon: {file}")
                require(root.find("foreground") is not None and
                        root.find("foreground").get(ANDROID + "drawable") == "@mipmap/ic_launcher_foreground",
                        f"Default Tauri or incorrect APK adaptive foreground: {file}")
                require(root.find("background") is not None and
                        root.find("background").get(ANDROID + "drawable") == "@color/ic_launcher_background",
                        f"Incorrect APK adaptive background: {file}")
                adaptive.add(file.stem)
            else:
                raise ValueError(f"Unverified APK launcher format: {file}")
    require(found == required, f"Missing APK density artwork: {sorted(required - found)}")
    require(adaptive == {"ic_launcher", "ic_launcher_round"}, "Missing APK adaptive launcher")
    colours = []
    for file in (tree / "res").glob("values*/*.xml"):
        for item in ET.parse(file).getroot():
            if item.get("name") == "ic_launcher_background":
                require(file.parent.name == "values", f"Unverified APK background override: {file}")
                colours.append((item.text or "").lower())
    require(len(colours) == 1 and colours[0] in ("#fff", "#ffffff", "#ffffffff"),
            "Incorrect APK launcher background")
    return ["APK manifest", "all density/round/foreground artwork", "adaptive launcher/background"]


def verify_android(package, temp):
    decoded = temp / "decoded"
    run("apktool", "decode", "--no-src", "--force", "--output", decoded, package)
    return verify_android_tree(decoded)


def inspect_packages(platform, package_root, output):
    require(sha(ROOT / "pos-app/src-tauri/app-icon.png") == PRODUCT_HASH, "Unapproved product mark")
    suffixes = {"windows": (".exe", ".msi"), "macos": (".dmg",),
                "linux": (".deb", ".AppImage"), "android": (".apk",)}[platform]
    packages = sorted(file.resolve() for file in package_root.rglob("*") if file.is_file() and file.suffix in suffixes)
    for suffix in suffixes:
        require(any(file.suffix == suffix for file in packages), f"Missing {platform} package type {suffix}")
    if platform == "android":
        require(all(file.name.endswith("-signed.apk") for file in packages), "Unverified unsigned APK output")
    inspect = {"windows": verify_windows, "macos": verify_macos,
               "linux": verify_linux, "android": verify_android}[platform]
    rows = []
    for package in packages:
        with tempfile.TemporaryDirectory(prefix="globipos-package-") as directory:
            surfaces = inspect(package, Path(directory))
        rows.append({"name": package.name, "sha256": sha(package), "surfaces": surfaces})
        print(f"Verified packaged GlobiPOS branding: {package.name}", flush=True)
    require(len({row["name"] for row in rows}) == len(rows), "Ambiguous package filenames")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"schema": 1, "platform": platform,
                                 "productMarkSha256": PRODUCT_HASH, "packages": rows}, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("platform", choices=("windows", "macos", "linux", "android"))
    parser.add_argument("package_root", type=Path)
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    # Never leave a stale success report after a failed re-check.
    args.report.unlink(missing_ok=True)
    inspect_packages(args.platform, args.package_root, args.report)