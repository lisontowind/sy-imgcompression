"""Export generated artwork at the marketplace's required sizes; preserve icon alpha."""
import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "assets" / "branding"

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--pngquant", default="pngquant", help="Path to the pngquant executable")
args = parser.parse_args()
pngquant = shutil.which(args.pngquant)
if not pngquant:
    parser.error("pngquant is required for the compact preview; install it or pass --pngquant PATH")

def export(source, destination, size, limit=None, compact=False):
    image = Image.open(BRAND / source)
    image = image.resize(size, Image.Resampling.LANCZOS)
    destination = ROOT / destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        # Quantize from the full-colour master, never from an already reduced palette.
        with tempfile.TemporaryDirectory(prefix="syic-preview-") as temporary:
            input_path = Path(temporary) / "preview-rgb.png"
            output_path = Path(temporary) / "preview.png"
            image.convert("RGB").save(input_path)
            subprocess.run([pngquant, "--quality=75-85", "--speed=1", "--strip",
                            "--output", str(output_path), "--", str(input_path)], check=True)
            if limit:
                assert output_path.stat().st_size <= limit, "Compact preview exceeds size limit"
            shutil.copyfile(output_path, destination)
    else:
        image.save(destination, optimize=True)
    if not compact and limit and destination.stat().st_size > limit:
        # Export optimisation only. Master illustrations remain unchanged.
        for colors in [256, 192, 128]:
            image.convert("RGB").quantize(colors=colors, method=Image.Quantize.MEDIANCUT).save(destination, optimize=True)
            if destination.stat().st_size <= limit:
                break
    if limit:
        assert destination.stat().st_size <= limit, f"{destination.name} exceeds size limit"
    return {"path": str(destination.relative_to(ROOT)), "width": size[0], "height": size[1], "bytes": destination.stat().st_size}

results = [
    export("icon-source.png", "icon.png", (160, 160), 64 * 1024),
    export("icon-source.png", "assets/branding/icon-512.png", (512, 512)),
    export("preview-source.png", "preview.png", (1024, 768), 256 * 1024, compact=True),
    export("header-source.png", "assets/marketing/header.png", (1600, 600)),
]
icon = Image.open(ROOT / "icon.png")
assert icon.mode == "RGBA" and icon.getchannel("A").getextrema() == (0, 255)
assert icon.getpixel((0, 0))[3] == 0
(BRAND / "exports.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(results, ensure_ascii=False, indent=2))
