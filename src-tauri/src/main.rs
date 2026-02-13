#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, RunEvent};

const LOCAL_API_PORT: &str = "46123";

#[derive(Default)]
struct LocalApiState {
    child: Mutex<Option<Child>>,
}

fn local_api_paths(app: &AppHandle) -> (PathBuf, PathBuf) {
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    let sidecar_script = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar/local-api-server.mjs")
    } else {
        resource_dir.join("sidecar/local-api-server.mjs")
    };

    let api_dir_root = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    } else {
        resource_dir
    };

    (sidecar_script, api_dir_root)
}

fn start_local_api(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<LocalApiState>();
    let mut slot = state
        .child
        .lock()
        .map_err(|_| "Failed to lock local API state".to_string())?;
    if slot.is_some() {
        return Ok(());
    }

    let (script, resource_root) = local_api_paths(app);
    if !script.exists() {
        return Err(format!(
            "Local API sidecar script missing at {}",
            script.display()
        ));
    }

    let mut cmd = Command::new("node");
    cmd.arg(&script)
        .env("LOCAL_API_PORT", LOCAL_API_PORT)
        .env("LOCAL_API_RESOURCE_DIR", resource_root)
        .env("LOCAL_API_MODE", "tauri-sidecar")
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch local API: {e}"))?;
    *slot = Some(child);
    Ok(())
}

fn stop_local_api(app: &AppHandle) {
    if let Ok(state) = app.try_state::<LocalApiState>().ok_or(()) {
        if let Ok(mut slot) = state.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.kill();
            }
        }
    }
}

fn main() {
    tauri::Builder::default()
        .manage(LocalApiState::default())
        .setup(|app| {
            if let Err(err) = start_local_api(&app.handle()) {
                eprintln!("[tauri] local API sidecar failed to start: {err}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running world-monitor tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                stop_local_api(&app);
            }
        });
}
