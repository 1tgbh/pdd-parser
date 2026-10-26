"""Build a source + frontend release from an allowlist, excluding all runtime data."""

import argparse
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]


def release_files(root=ROOT):
    patterns = [
        "README.md", ".gitignore", "start.bat", "init_venv.ps1", "install_cert.*",
        "pdd_proxy/[!_]*.py", "pdd_proxy/requirements*.txt", "pdd_proxy/web/*.py", "pdd_proxy/web/*.html",
        "pdd_proxy/tests/*.py", "pdd_proxy/frontend/dist/**/*",
        "pdd_proxy/data/wechat_categories.json", "pdd_proxy/data/forbidden_words.json",
        "extension/*.js", "extension/*.json", "extension/*.html", "extension/icons/*.png", "extension/tests/*.cjs",
        "frontend/src/**/*", "frontend/public/**/*", "frontend/package*.json", "frontend/tsconfig*.json",
        "frontend/vite.config.ts", "frontend/eslint.config.js", "frontend/index.html", "frontend/.gitignore",
        "tools/package_release.py", ".github/workflows/ci.yml",
    ]
    files = {p for pattern in patterns for p in root.glob(pattern) if p.is_file() and "__pycache__" not in p.parts}
    return sorted(files)


def package(output, root=ROOT):
    output = Path(output).resolve()
    if not output.parent.is_dir():
        raise ValueError("输出目录不存在")
    files = release_files(root)
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for file in files:
            archive.write(file, file.relative_to(root).as_posix())
    return len(files)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    count = package(args.output)
    print(f"Release package: {args.output} ({count} files; runtime data excluded)")
