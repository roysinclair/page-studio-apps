#!/usr/bin/env python3
"""Builds page-orbit.html from orbit/src.

Page Orbit is written as a few source files (orbit/src/*.css, *.js and shell.html) and shipped,
like Page Aura, as one self-contained HTML file. This script:

  1. joins the CSS and JavaScript sources (in the order listed below) into the shell;
  2. copies the embedded, SRI-verified libraries (marked, DOMPurify, highlight.js and the
     Anthropic SDK) out of page-aura.html, so both apps ship exactly the same copies;
  3. writes the Content-Security-Policy hashes for every inline script.

Usage:  python3 tools/build-orbit.py
"""
import pathlib, re, sys
sys.dont_write_bytecode = True

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "orbit" / "src"
CSS = ["base.css", "style.css"]
JS = ["core.js", "agents.js", "sessions.js", "diagnose.js", "resources.js", "app.js"]

aura = (ROOT / "page-aura.html").read_text(encoding="utf-8")


def block(tag, el_id):
    m = re.search(rf'<{tag} id="{el_id}">.*?</{tag}>', aura, re.S)
    if not m:
        sys.exit(f"page-aura.html: <{tag} id={el_id}> not found (run tools/vendor-libs.py / build-sdk.sh first)")
    return m.group(0)


def read(name):
    text = (SRC / name).read_text(encoding="utf-8")
    if "</script" in text.lower() or "</style" in text.lower():
        sys.exit(f"{name}: contains a closing </script> or </style> tag")
    return text


html = (SRC / "shell.html").read_text(encoding="utf-8")
parts = {
    "<!--@VENDOR-CSS-->": block("style", "vendor-hljs-css"),
    "/*@CSS*/": "\n".join(f"/* ---- {n} ---- */\n{read(n)}" for n in CSS),
    "<!--@VENDOR-JS-->": "\n".join(block("script", i) for i in ("vendor-marked", "vendor-dompurify", "vendor-hljs")),
    "<!--@VENDOR-SDK-->": block("script", "vendor-anthropic-sdk"),
    "/*@JS*/": "\n".join(f"/* ================= {n} ================= */\n{read(n)}" for n in JS),
}
for marker, text in parts.items():
    if html.count(marker) != 1:
        sys.exit(f"shell.html: expected one {marker}")
    html = html.replace(marker, text)

out = ROOT / "page-orbit.html"
out.write_text(html, encoding="utf-8")
print(f"Built page-orbit.html ({len(html)//1024} KB)")

sys.path.insert(0, str(ROOT / "tools"))
import importlib.util
spec = importlib.util.spec_from_file_location("update_csp", ROOT / "tools" / "update-csp.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.update(out)
