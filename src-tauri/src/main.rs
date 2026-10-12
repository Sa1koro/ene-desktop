// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

/// The Node bridge process that holds the OpenClaw Gateway connection.
struct Bridge(Mutex<Option<Child>>);

fn bridge_script() -> PathBuf {
    std::env::var_os("ENE_BRIDGE_SCRIPT")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../bridge/ene-bridge.mjs"))
}

fn spawn_bridge() -> Option<Child> {
    let script = bridge_script();
    let mut cmd = Command::new("node");
    cmd.arg(&script)
        // The bridge exits when our end of its stdin closes, even if we crash.
        .env("ENE_EXIT_ON_STDIN_CLOSE", "1")
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
            eprintln!("failed to start ENE bridge {}: {err}", script.display());
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
