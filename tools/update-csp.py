#!/usr/bin/env python3
"""Recomputes the Content-Security-Policy script hashes in page-aura.html (and page-orbit.html).

The pages only run inline scripts whose SHA-256 hash is listed in their CSP.
Run this after editing any inline <script>:

    python3 tools/update-csp.py              # both pages
    python3 tools/update-csp.py page-orbit.html
"""
import base64, hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def update(page):
    html = page.read_text(encoding="utf-8")

    hashes = []
    for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, flags=re.S):
        digest = base64.b64encode(hashlib.sha256(m.group(1).encode("utf-8")).digest()).decode()
        hashes.append(f"'sha256-{digest}'")

    meta = re.search(r'(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")', html)
    if not meta:
        sys.exit(f"{page.name}: CSP meta tag not found")
    directives = [d.strip() for d in meta.group(2).split(";") if d.strip()]
    out = []
    for d in directives:
        if d.startswith("script-src"):
            urls = [t for t in d.split()[1:] if not t.startswith("'sha256-")]
            d = " ".join(["script-src", *hashes, *urls])
        out.append(d)
    html = html[:meta.start(2)] + "; ".join(out) + html[meta.end(2):]
    page.write_text(html, encoding="utf-8")
    print(f"{page.name}: CSP updated with {len(hashes)} inline script hash(es)")


if __name__ == "__main__":
    names = sys.argv[1:] or ["page-aura.html", "page-orbit.html"]
    for n in names:
        p = ROOT / n
        if p.exists():
            update(p)
