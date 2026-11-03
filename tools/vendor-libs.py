#!/usr/bin/env python3
"""Embeds Page Aura's three small UI libraries into page-aura.html.

marked (Markdown), DOMPurify (sanitising) and highlight.js (code colours) used to load from
cdnjs at runtime. They are now embedded in the page, like the Anthropic SDK, so no
third-party code is fetched when Page Aura runs. This script downloads the pinned versions,
checks each file against its published SHA-512 (Subresource Integrity) hash, strips the
source-map comment, and embeds the result.

Usage:  python3 tools/vendor-libs.py && python3 tools/update-csp.py
"""
import base64, hashlib, pathlib, re, sys, urllib.request

CDN = "https://cdnjs.cloudflare.com/ajax/libs/"
LIBS = [  # (element id, path on cdnjs, expected SRI sha512, kind)
    ("vendor-marked", "marked/12.0.2/marked.min.js",
     "xeUh+KxNyTufZOje++oQHstlMQ8/rpyzPuM+gjMFYK3z5ILJGE7l2NvYL+XfliKURMpBIKKp1XoPN/qswlSMFA==", "js"),
    ("vendor-dompurify", "dompurify/3.1.6/purify.min.js",
     "jB0TkTBeQC9ZSkBqDhdmfTv1qdfbWpGE72yJ/01Srq6hEzZIz2xkz1e57p9ai7IeHMwEG7HpzG6NdptChif5Pg==", "js"),
    ("vendor-hljs", "highlight.js/11.9.0/highlight.min.js",
     "D9gUyxqja7hBtkWpPWGt9wfbfaMGVt9gnyCvYa+jojwwPHLCzUm5i8rpk7vD7wNee9bA35eYIjobYPaQuKS1MQ==", "js"),
    ("vendor-hljs-css", "highlight.js/11.9.0/styles/github-dark.min.css",
     "rO+olRTkcf304DQBxSWxln8JXCzTHlKnIdnMUwYvQa9/Jd4cQaNkItIUj6Z4nvW1dqK0SKXLbn9h4KwZTNtAyw==", "css"),
]

page = pathlib.Path(__file__).resolve().parent.parent / "page-aura.html"
html = page.read_text(encoding="utf-8")

for el_id, path, sri, kind in LIBS:
    raw = urllib.request.urlopen(CDN + path, timeout=60).read()
    got = base64.b64encode(hashlib.sha512(raw).digest()).decode()
    if got != sri:
        sys.exit(f"{path}: SHA-512 mismatch — refusing to embed (got {got})")
    text = raw.decode("utf-8")
    text = re.sub(r"\n?/[/*][#@] sourceMappingURL=[^\n]*?(\*/)?\s*$", "", text.rstrip())
    if "</script" in text.lower() or "</style" in text.lower():
        sys.exit(f"{path}: contains a closing tag; can't embed safely")
    tag = "script" if kind == "js" else "style"
    block = f'<{tag} id="{el_id}">/* {path} (sha512-{sri}) — embedded by tools/vendor-libs.py */\n{text}\n</{tag}>'
    # replace an existing embedded copy, or the old CDN tag
    existing = re.compile(rf'<{tag} id="{el_id}">.*?</{tag}>', re.S)
    cdn_tag = re.compile(rf'<(script|link)[^>]*{re.escape(CDN + path)}[^>]*>(</script>)?')
    if existing.search(html):
        html = existing.sub(lambda m: block, html, count=1)
    elif cdn_tag.search(html):
        html = cdn_tag.sub(lambda m: block, html, count=1)
    else:
        sys.exit(f"{path}: no place to embed it")
    print(f"embedded {path} ({len(text)//1024} KB, SRI verified)")

# the CSP no longer needs cdnjs
html = re.sub(r" https://cdnjs\.cloudflare\.com/[^\s;\"]+", "", html)
page.write_text(html, encoding="utf-8")
