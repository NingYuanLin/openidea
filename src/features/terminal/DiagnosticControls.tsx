import { useEffect, useState, useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/platform/ipc";
import { type DiagnosticLabel, type TerminalDiagnostic } from "./diagnostic";
import { saveDiagnosticLocally } from "./diagnosticExport";
import styles from "./Terminal.module.css";

export function DiagnosticControls({ diagnostic }: { diagnostic: TerminalDiagnostic }) {
  const state = useSyncExternalStore(diagnostic.subscribe, diagnostic.snapshot);
  const [label, setLabel] = useState<DiagnosticLabel>("builtin-chinese");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let ended = false;
    let release: (() => void) | undefined;
    if (isTauri())
      void getCurrentWindow()
        .onCloseRequested(() => diagnostic.stop("window-close"))
        .then((fn) => {
          if (ended) fn();
          else release = fn;
        })
        .catch(() => diagnostic.stop("window-hook-unavailable"));
    return () => {
      ended = true;
      release?.();
      diagnostic.stop("view-hidden");
    };
  }, [diagnostic]);
  const download = async () => {
    diagnostic.stop();
    setBusy(true);
    setMessage("");
    try {
      const saved = await saveDiagnosticLocally(diagnostic.exportJson(), label);
      setMessage(saved ? "已导出到本机" : "已取消，未写入文件");
    } catch {
      setMessage("导出失败，记录仍保留；可重试");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.diagnostic} aria-label="终端输入法诊断">
      <strong>诊断版 · 原版 f48cd85d</strong>
      <span role="status">
        {state.active ? "● 正在采集（仅内存）" : `○ 已停止 · ${state.count} 条 · ${state.reason}`}
      </span>
      <select
        aria-label="采样输入法"
        value={label}
        disabled={state.active || busy}
        onChange={(e) => setLabel(e.target.value as DiagnosticLabel)}
      >
        <option value="builtin-chinese">系统中文输入法</option>
        <option value="sogou-chinese">搜狗中文</option>
        <option value="sogou-english">搜狗英文模式</option>
        <option value="abc">ABC</option>
      </select>
      <button
        disabled={state.active || busy}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setMessage("");
          diagnostic.start(label);
        }}
      >
        开始新采样
      </button>
      <button disabled={!state.active} onMouseDown={(e) => e.preventDefault()} onClick={() => diagnostic.stop()}>
        停止
      </button>
      <button
        disabled={busy || (!state.active && !state.count)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void download()}
      >
        停止并导出
      </button>
      <button disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => diagnostic.clear()}>
        清除
      </button>
      <small>
        切换所选输入法 → 开始 → 选中文字、上滚、按 Shift →
        停止并导出。仅记录事件与长度，不记录文字、不上传。新采样会清除上一份。
      </small>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
