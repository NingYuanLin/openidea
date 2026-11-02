fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "macos" {
        let commit = format!("\"{}\"", std::env::var("OI_COMMIT").unwrap());
        let html = format!("\"{}\"", std::env::var("OI_HTML_SHA").unwrap());
        cc::Build::new()
            .file("../shared/Probe.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .define("OI_COMMIT", commit.as_str())
            .define("OI_HTML_SHA", html.as_str())
            .compile("shift_probe");
        println!("cargo:rustc-link-lib=framework=Carbon");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=WebKit");
    }
    println!("cargo:rerun-if-changed=../shared/Probe.m");
    println!("cargo:rerun-if-env-changed=OI_COMMIT");
    println!("cargo:rerun-if-env-changed=OI_HTML_SHA");
}
