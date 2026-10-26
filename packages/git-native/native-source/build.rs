extern crate napi_build;

fn main() {
  let compile_target = std::env::var("TARGET").unwrap();
  // This fork resolves Node-API dynamically from the running host. GNU builds
  // therefore do not link a separately deployed libnode.dll.
  if compile_target != "x86_64-pc-windows-gnu" {
    napi_build::setup();
  }
  match compile_target.as_str() {
    "aarch64-apple-darwin" => {
      println!("cargo:rustc-link-arg=-Wl,-install_name,@rpath/yugoo_git.darwin-arm64.node");
    }
    "x86_64-unknown-linux-gnu" => {
      println!("cargo:rustc-link-search=/usr/lib");
    }
    "armv7-unknown-linux-gnueabihf" => {
      const CROSS_LIB_PATH: &str = "/usr/lib/gcc-cross/arm-linux-gnueabihf";
      if let Ok(version) = std::process::Command::new("ls")
        .arg(CROSS_LIB_PATH)
        .output()
        .map(|o| String::from_utf8(o.stdout).unwrap().trim().to_string())
      {
        println!("cargo:rustc-link-search={CROSS_LIB_PATH}/{version}");
      };
    }
    _ => {}
  }
}
