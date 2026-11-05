#!/usr/bin/env python3
"""Recomputes the Content-Security-Policy script hashes in page-aura.html (and page-orbit.html).

The pages only run inline scripts whose SHA-256 hash is listed in their CSP.
Run this after editing any inline <script>:

    python3 tools/update-csp.py              # both pages
    python3 tools/update-csp.py page-orbit.html
"""
import base64, hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# The only files this script may rewrite. Anything else is refused.
PAGES = ("page-aura.html", "page-orbit.html")


def safe_page(page):
    """Returns the absolute path of a known page inside ROOT, or exits.

    Accepts a bare page name or a path that resolves to one of the known pages in ROOT.
    The returned path is built from the fixed PAGES names, never from the input itself.
    """
    given = pathlib.Path(page)
    for name in PAGES:
        if given.name == name and (ROOT / given).resolve() == ROOT / name:
            return ROOT / name
    sys.exit(f"refusing {page!r}: only {', '.join(PAGES)} inside {ROOT} can be updated")


def update(page):
    page = safe_page(page)
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
        p = safe_page(n)
        if p.exists():
            update(p)
