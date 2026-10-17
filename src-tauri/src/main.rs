// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsStr;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

/// The Node bridge process that holds the OpenClaw Gateway connection.
struct Bridge(Mutex<Option<Child>>);

fn node(program: impl AsRef<OsStr>, script: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    cmd.arg(script);
    cmd
}

/// `ENE_BRIDGE_SCRIPT` runs that script with the `node` on PATH. Otherwise `tauri dev` runs
/// bridge/ene-bridge.mjs from the source tree, and release builds run the bridge/ folder that
/// `npm run build:exe` puts next to the exe: the bundled bridge with its own Node.js, so they
/// need neither this checkout nor an installed Node.js.
fn bridge_command() -> std::io::Result<Command> {
    if let Some(script) = std::env::var_os("ENE_BRIDGE_SCRIPT") {
        return Ok(node("node", script));
    }
    if cfg!(debug_assertions) {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../bridge/ene-bridge.mjs");
        return Ok(node("node", script));
    }
    let dir = std::env::current_exe()?.with_file_name("bridge");
    let mut cmd = node(
        dir.join(format!("node{}", std::env::consts::EXE_SUFFIX)),
        dir.join("ene-bridge.cjs"),
    );
    // Options set for the user's own Node.js are not meant for this one.
    cmd.env_remove("NODE_OPTIONS");
    Ok(cmd)
}

fn spawn_bridge() -> Option<Child> {
    let mut cmd = bridge_command()
        .map_err(|err| eprintln!("failed to locate ENE bridge: {err}"))
        .ok()?;
    // The bridge exits when our end of its stdin closes, even if we crash.
    cmd.env("ENE_EXIT_ON_STDIN_CLOSE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    match cmd.spawn() {
        Ok(child) => Some(child),
        Err(err) => {
            // Not fatal: a bridge started by hand (`npm run bridge`) works too.
            eprintln!("failed to start ENE bridge {cmd:?}: {err}");
            None
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Bridge(Mutex::new(spawn_bridge())))
        .build(tauri::generate_context!())
        .expect("error while building ENE")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.state::<Bridge>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
