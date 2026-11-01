import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/platform/ipc";
import { type DiagnosticLabel, type TerminalDiagnostic } from "./diagnostic";
import type { DiagnosticTarget } from "./diagnosticEarly";
import { saveDiagnosticLocally } from "./diagnosticExport";
import styles from "./Terminal.module.css";

const TARGETS: [DiagnosticTarget, string][] = [
  ["plain-input", "1 普通输入框"],
  ["plain-textarea", "2 普通多行框"],
  ["styled-textarea", "3 终端样式框（透明）"],
  ["terminal", "4 实际终端"],
];
export function DiagnosticControls({ diagnostic }: { diagnostic: TerminalDiagnostic }) {
  const state = useSyncExternalStore(diagnostic.subscribe, diagnostic.snapshot);
  const [label, setLabel] = useState<DiagnosticLabel>("builtin-chinese");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const styled = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState<DiagnosticTarget | null>(null);
  const [discard, setDiscard] = useState<"start" | "clear" | null>(null);
  useEffect(() => {
    const undo = [
      diagnostic.registerControl("plain-input", input.current!),
      diagnostic.registerControl("plain-textarea", textarea.current!),
      diagnostic.registerControl("styled-textarea", styled.current!),
    ];
    const focus = () => setFocused(diagnostic.focusedTarget());
    window.addEventListener("focusin", focus);
    return () => {
      undo.forEach((fn) => fn());
      window.removeEventListener("focusin", focus);
    };
  }, [diagnostic]);
  useEffect(() => {
    const element = panel.current;
    if (!element || !state.active) return;
    const observer = new ResizeObserver(() => {
      if (!element.getClientRects().length) diagnostic.stop("view-hidden");
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [diagnostic, state.active]);
  const begin = () => {
    setMessage("");
    setDiscard(null);
    diagnostic.start(label);
  };
  const clear = () => {
    diagnostic.clear();
    setDiscard(null);
    setMessage("");
  };
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
    <div ref={panel} className={styles.diagnostic} aria-label="终端输入法诊断">
      <strong>诊断 v2 · 原版 f48cd85d</strong>
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
          if (state.count) setDiscard("start");
          else begin();
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
      <button
        disabled={busy}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          diagnostic.stop();
          setDiscard("clear");
        }}
      >
        清除
      </button>
      <div className={styles.diagnosticGuide}>
        <small>
          手动切换到上面选择的输入法（本程序不会检测或切换）→ 开始新采样 → 依次点击 1、2、3、4，每次按下并松开左
          Shift。如需试右 Shift，请间隔至少 1 秒，避免触发双 Shift 搜索。第 4 项可先上滚，再按 Shift。最后停止并导出。
        </small>
        <div className={styles.diagnosticTargets}>
          {TARGETS.map(([target, title]) => (
            <button
              key={target}
              disabled={busy}
              onClick={() => {
                const ok = diagnostic.focusTarget(target);
                setFocused(diagnostic.focusedTarget());
                setMessage(ok ? "已聚焦，请按下并松开左 Shift" : "聚焦失败，请重新打开终端");
              }}
            >
              聚焦 {title}
            </button>
          ))}
        </div>
        <span role="status">
          当前焦点：{TARGETS.find(([target]) => target === focused)?.[1] ?? "面板按钮或其他位置"}
        </span>
        <div className={styles.diagnosticFields}>
          <label>
            1 普通输入框 <input ref={input} aria-label="普通输入框对照" />
          </label>
          <label>
            2 普通多行框 <textarea ref={textarea} aria-label="普通多行框对照" rows={1} />
          </label>
          <div className={styles.diagnosticStyled}>
            <span>3 为透明框；请用“聚焦 3”按钮，按键后无需输入文字。</span>
            <textarea
              ref={styled}
              aria-label="终端样式框对照"
              tabIndex={0}
              style={{ position: "absolute", opacity: 0, zIndex: -5, width: 1, height: 1 }}
            />
          </div>
        </div>
        <small>
          四组均在本窗口内。3 复制终端相关属性与当前单元格尺寸，但位置不同且没有 xterm 处理器；4
          保留终端原有内容、选择和滚动状态。只采集事件、状态与长度，不记录文字、不上传。停止后仍可用按钮做不采集的对照。
        </small>
      </div>
      {discard && (
        <div role="alert" className={styles.diagnosticGuide}>
          当前记录会被清除。可先点“停止并导出”保留记录。
          <button onClick={() => (discard === "start" ? begin() : clear())}>
            确认丢弃并{discard === "start" ? "开始" : "清除"}
          </button>
          <button onClick={() => setDiscard(null)}>取消丢弃</button>
        </div>
      )}
      {message && <small role="status">{message}</small>}
    </div>
  );
}
