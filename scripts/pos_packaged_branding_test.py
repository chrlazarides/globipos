"""Synthetic binary/resource fixtures exercise extraction; not new release proof."""
import io
import json
from pathlib import Path
import plistlib
import shutil
import struct
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image
import pos_packaged_branding as branding


def pe_fixture(ico):
    """Construct a PE with real ICO image bytes and a Windows resource tree."""
    count = struct.unpack_from("<H", ico, 4)[0]
    images = []
    group = bytearray(struct.pack("<HHH", 0, 1, count))
    for i in range(count):
        entry = ico[6 + i * 16:22 + i * 16]
        size, offset = struct.unpack_from("<II", entry, 8)
        images.append(ico[offset:offset + size])
        group.extend(entry[:12] + struct.pack("<H", i + 1))
    nodes = {3: {i + 1: {1033: frame} for i, frame in enumerate(images)}, 14: {101: {1033: bytes(group)}}}
    tree = bytearray()

    def allocate(size):
        offset = len(tree)
        tree.extend(b"\0" * size)
        return offset

    def directory(entries):
        offset = allocate(16 + len(entries) * 8)
        struct.pack_into("<H", tree, offset + 14, len(entries))
        for i, (key, value) in enumerate(entries.items()):
            if isinstance(value, dict):
                child = directory(value) | 0x80000000
            else:
                child = allocate(16)
                blob = allocate(len(value))
                tree[blob:blob + len(value)] = value
                struct.pack_into("<II", tree, child, 0x1000 + blob, len(value))
            struct.pack_into("<II", tree, offset + 16 + i * 8, key, child)
        return offset
    directory(nodes)
    data = bytearray(0x200)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 0x3c, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<H", data, 0x86, 1)
    struct.pack_into("<H", data, 0x94, 224)
    struct.pack_into("<H", data, 0x98, 0x10b)
    struct.pack_into("<II", data, 0x98 + 96 + 16, 0x1000, len(tree))
    struct.pack_into("<IIII", data, 0x98 + 224 + 8, len(tree), 0x1000, len(tree), 0x200)
    return bytes(data + tree)


class PackagedBrandingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def android(self):
        shutil.copytree(branding.ICONS / "android", self.root / "res")
        res = self.root / "res"
        shutil.copy(res / "mipmap-anydpi-v26/ic_launcher.xml", res / "mipmap-anydpi-v26/ic_launcher_round.xml")
        (self.root / "AndroidManifest.xml").write_text(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android">'
            '<application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round"/>'
            '</manifest>')
        # apktool adds v4 qualifiers and may recompress PNGs.
        for density in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
            (res / f"mipmap-{density}").rename(res / f"mipmap-{density}-v4")
        return self.root

    def test_windows_pe_extracts_every_group_frame(self):
        file = self.root / "setup.exe"
        file.write_bytes(pe_fixture((branding.ICONS / "icon.ico").read_bytes()))
        branding.verify_pe(file)

    def test_generic_nsis_icon_regression(self):
        generic = io.BytesIO()
        Image.new("RGBA", (32, 32), "#888888").save(generic, format="ICO")
        file = self.root / "generic-nsis-setup.exe"
        file.write_bytes(pe_fixture(generic.getvalue()))
        with self.assertRaisesRegex(ValueError, "generic NSIS"):
            branding.verify_pe(file)

    def test_corrupt_pe_is_not_verified(self):
        file = self.root / "broken.exe"
        file.write_bytes(b"MZ")
        with self.assertRaises((ValueError, struct.error)):
            branding.verify_pe(file)

    def test_windows_installed_app_and_uninstaller_are_both_inspected(self):
        package = self.root / "setup.exe"
        package.write_bytes(pe_fixture((branding.ICONS / "icon.ico").read_bytes()))
        installed = self.root / "installed"
        installed.mkdir()
        def install(*args):
            if str(args[0]) == str(package):
                shutil.copy(package, installed / "globipos-terminal.exe")
                (installed / "uninstall.exe").write_bytes(b"generic uninstaller")
        with patch.object(branding, "run", side_effect=install):
            with self.assertRaisesRegex(ValueError, "Not a Windows PE"):
                branding.verify_windows(package, installed)

    def test_android_all_densities_and_adaptive_resources_pass(self):
        tree = self.android()
        file = tree / "res/mipmap-mdpi-v4/ic_launcher.png"
        with Image.open(file) as image:
            image.save(file, compress_level=0)
        branding.verify_android_tree(tree)

    def test_default_tauri_android_artwork_regression(self):
        tree = self.android()
        image = tree / "res/mipmap-xxxhdpi-v4/ic_launcher.png"
        with Image.open(image) as original:
            Image.new("RGBA", original.size, "#ff8800").save(image)
        with self.assertRaisesRegex(ValueError, "Wrong GlobiPOS artwork"):
            branding.verify_android_tree(tree)

    def test_missing_android_density_and_wrong_manifest_fail(self):
        tree = self.android()
        (tree / "res/mipmap-mdpi-v4/ic_launcher_round.png").unlink()
        with self.assertRaisesRegex(ValueError, "Missing APK density"):
            branding.verify_android_tree(tree)
        (tree / "AndroidManifest.xml").write_text('<manifest><application/></manifest>')
        with self.assertRaisesRegex(ValueError, "manifest"):
            branding.verify_android_tree(tree)

    def test_wrong_adaptive_foreground_and_new_api_overrides_fail(self):
        tree = self.android()
        file = tree / "res/mipmap-anydpi-v26/ic_launcher.xml"
        text = file.read_text()
        file.write_text(text.replace("@mipmap/ic_launcher_foreground", "@drawable/tauri"))
        with self.assertRaisesRegex(ValueError, "incorrect APK adaptive foreground"):
            branding.verify_android_tree(tree)
        file.write_text(text)
        directory = tree / "res/mipmap-anydpi-v33"
        directory.mkdir()
        shutil.copy(file, directory / file.name)
        with self.assertRaisesRegex(ValueError, "adaptive override"):
            branding.verify_android_tree(tree)

    def test_android_background_override_fails(self):
        tree = self.android()
        directory = tree / "res/values-night"
        directory.mkdir()
        (directory / "colors.xml").write_text('<resources><color name="ic_launcher_background">#000</color></resources>')
        with self.assertRaisesRegex(ValueError, "background override"):
            branding.verify_android_tree(tree)

    def test_linux_launcher_selected_artwork_and_svg_override(self):
        (self.root / "globipos.desktop").write_text("[Desktop Entry]\nIcon=globipos-terminal\n")
        shutil.copy(branding.ICONS / "128x128.png", self.root / "globipos-terminal.png")
        branding.verify_linux_tree(self.root)
        (self.root / "globipos-terminal.svg").write_text("<svg/>")
        with self.assertRaisesRegex(ValueError, "SVG"):
            branding.verify_linux_tree(self.root)

    def test_appimage_duplicate_launcher_and_diricon(self):
        (self.root / "globipos.desktop").write_text("[Desktop Entry]\nIcon=globipos-terminal\n")
        directory = self.root / "usr/share/applications"
        directory.mkdir(parents=True)
        shutil.copy(self.root / "globipos.desktop", directory / "globipos.desktop")
        shutil.copy(branding.ICONS / "128x128.png", self.root / "globipos-terminal.png")
        shutil.copy(branding.ICONS / "128x128.png", self.root / ".DirIcon")
        branding.verify_linux_tree(self.root)
        Image.new("RGBA", (128, 128), "red").save(self.root / ".DirIcon", format="PNG")
        with self.assertRaisesRegex(ValueError, "AppImage .DirIcon"):
            branding.verify_linux_tree(self.root)

    def test_android_unsupported_webp_or_ninepatch_launcher_fails(self):
        tree = self.android()
        (tree / "res/mipmap-mdpi-v4/ic_launcher.9.png").write_bytes(b"unverified override")
        with self.assertRaisesRegex(ValueError, "launcher format"):
            branding.verify_android_tree(tree)

    def test_linux_wrong_or_missing_icon_fails(self):
        (self.root / "globipos.desktop").write_text("[Desktop Entry]\nIcon=globipos-terminal\n")
        with self.assertRaisesRegex(ValueError, "No packaged Linux"):
            branding.verify_linux_tree(self.root)
        Image.new("RGBA", (128, 128), "red").save(self.root / "globipos-terminal.png")
        with self.assertRaisesRegex(ValueError, "Wrong GlobiPOS Linux"):
            branding.verify_linux_tree(self.root)

    def test_macos_reads_plist_selected_icns_and_detaches_on_failure(self):
        def mounted(*args):
            if args[1] == "attach":
                contents = self.root / "mount/GlobiPOS Terminal.app/Contents"
                (contents / "Resources").mkdir(parents=True)
                (contents / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIconFile": "icon"}))
                (contents / "Resources/icon.icns").write_bytes(b"wrong icon")
        with patch.object(branding, "run", side_effect=mounted) as command:
            with self.assertRaisesRegex(ValueError, "Wrong GlobiPOS DMG"):
                branding.verify_macos(self.root / "pos.dmg", self.root)
            self.assertEqual(command.call_args.args[:2], ("hdiutil", "detach"))

    def test_missing_packages_never_produce_success_report(self):
        with self.assertRaisesRegex(ValueError, "Missing windows package"):
            branding.inspect_packages("windows", self.root, self.root / "report.json")
        self.assertFalse((self.root / "report.json").exists())

    def test_android_package_is_decoded_not_merely_source_checked(self):
        with patch.object(branding, "run") as command, patch.object(branding, "verify_android_tree", return_value=["APK"]) as verify:
            branding.verify_android(self.root / "signed.apk", self.root)
            self.assertIn("decode", command.call_args.args)
            self.assertEqual(verify.call_args.args[0], self.root / "decoded")


if __name__ == "__main__":
    unittest.main()