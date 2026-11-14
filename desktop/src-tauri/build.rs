use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    // Voice input on the Mac is Swift (SpeechAnalyzer, SFSpeechRecognizer), linked in as a static library.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_swift("src/dictation_macos.swift");
    }
    tauri_build::build()
}

/// Compiles one Swift file with `swiftc`, for the arch cargo is building (the universal CI build runs cargo once per
/// arch), into `libpage_dictation_mac.a` in `OUT_DIR`, and tells cargo how to link it.
fn build_swift(source: &str) {
    println!("cargo:rerun-if-changed={source}");
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
    println!("cargo:rerun-if-env-changed=SDKROOT");

    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        other => panic!("voice input: no Swift target for macOS arch {other:?}"),
    };
    // Tauri's CLI sets MACOSX_DEPLOYMENT_TARGET from bundle.macOS.minimumSystemVersion (12.0). A plain `cargo build`
    // does not, so say 12.0 for rustc too: the Swift code needs the concurrency runtime that ships with macOS 12, and
    // otherwise the linker warns that this object is newer than the 11.0 it is linking.
    let deployment = match std::env::var("MACOSX_DEPLOYMENT_TARGET") {
        Ok(v) if !v.trim().is_empty() => v,
        _ => {
            println!("cargo:rustc-env=MACOSX_DEPLOYMENT_TARGET=12.0");
            "12.0".to_string()
        }
    };
    let target = format!("{arch}-apple-macos{deployment}");

    let sdk = match std::env::var("SDKROOT") {
        Ok(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => xcrun(&["--sdk", "macosx", "--show-sdk-path"]),
    };
    let swiftc = xcrun(&["--find", "swiftc"]);
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let lib = out_dir.join("libpage_dictation_mac.a");
    let debug = std::env::var("PROFILE").as_deref() != Ok("release");

    let status = Command::new(&swiftc)
        .args(["-parse-as-library", "-emit-library", "-static", "-module-name", "PageDictationMac"])
        .args(["-target", &target, "-sdk", &sdk, "-swift-version", "5", "-g"])
        .arg(if debug { "-Onone" } else { "-O" })
        .arg("-o")
        .arg(&lib)
        .arg(source)
        .status()
        .unwrap_or_else(|e| panic!("voice input: could not run swiftc ({swiftc}): {e}. Install Xcode or the Xcode command line tools."));
    assert!(status.success(), "voice input: swiftc failed on {source} (target {target})");

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=page_dictation_mac");
    for framework in ["Speech", "AVFoundation", "Foundation"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    // The Swift runtime: its autolink entries (-lswiftCore, the overlays, the back-deployment libraries) are found in
    // the SDK's stubs and the toolchain's static compatibility libraries; the dylibs themselves live in the OS.
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    if let Some(toolchain_lib) = Path::new(&swiftc).parent().and_then(Path::parent).map(|p| p.join("lib/swift/macosx")) {
        if toolchain_lib.is_dir() {
            println!("cargo:rustc-link-search=native={}", toolchain_lib.display());
        }
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}

/// stdout of `xcrun <args>`, trimmed.
fn xcrun(args: &[&str]) -> String {
    let out = Command::new("xcrun")
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("voice input: could not run xcrun: {e}. Install Xcode or the Xcode command line tools."));
    assert!(out.status.success(), "voice input: `xcrun {}` failed", args.join(" "));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}
