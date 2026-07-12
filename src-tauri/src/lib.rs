use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// First non-flag argument ending in `.homeplanr` (argv[0] is the binary),
/// absolutized against `cwd` by a plain join when relative — never
/// fs::canonicalize: on Windows it yields \\?\ UNC paths that break the fs
/// scope's prefix matching.
fn launch_file_from_argv(argv: &[String], cwd: &std::path::Path) -> Option<String> {
  argv.iter().skip(1).find_map(|arg| {
    if arg.starts_with('-') || !arg.ends_with(".homeplanr") {
      return None;
    }
    let path = std::path::Path::new(arg);
    let abs = if path.is_absolute() {
      path.to_path_buf()
    } else {
      cwd.join(path)
    };
    Some(abs.to_string_lossy().into_owned())
  })
}

/// Cold-start `.homeplanr` argv path; the frontend takes it exactly once.
struct LaunchFile(std::sync::Mutex<Option<String>>);

#[tauri::command]
fn take_launch_file(state: tauri::State<'_, LaunchFile>) -> Option<String> {
  state.0.lock().ok().and_then(|mut slot| slot.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let mut builder = tauri::Builder::default();
  // single-instance must be THE FIRST plugin registered: it decides whether
  // this process may run at all — a second launch relays its argv/cwd into
  // this callback and exits before any other plugin or window is set up.
  #[cfg(desktop)]
  {
    use tauri::Emitter;
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
      if let Some(path) = launch_file_from_argv(&argv, std::path::Path::new(&cwd)) {
        // widen the fs scope BEFORE emitting so the frontend read succeeds
        let _ = app.fs_scope().allow_file(&path);
        let _ = app.emit("open-file", path);
      }
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
      }
    }));
  }
  builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    // persisted-scope must come after fs: it re-applies dialog-granted fs
    // scopes on startup so launch-reopen and Recent files work across runs.
    .plugin(tauri_plugin_persisted_scope::init())
    .invoke_handler(tauri::generate_handler![take_launch_file])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // cold start via file association / CLI: scope-allow the file now and
      // park it for the frontend's take_launch_file command.
      let cwd = std::env::current_dir().unwrap_or_default();
      let argv: Vec<String> = std::env::args_os()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
      let launch_file = launch_file_from_argv(&argv, &cwd);
      if let Some(path) = &launch_file {
        let _ = app.fs_scope().allow_file(path);
      }
      app.manage(LaunchFile(std::sync::Mutex::new(launch_file)));
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
