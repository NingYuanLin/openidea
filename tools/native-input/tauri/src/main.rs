use tauri::Manager;
unsafe extern "C" {
    fn oi_attach(webview: *mut std::ffi::c_void);
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("main").expect("diagnostic window");
            window.with_webview(|webview| unsafe {
                oi_attach(webview.inner() as *mut std::ffi::c_void);
            })?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("diagnostic runtime");
}
