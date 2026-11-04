import type { Terminal } from "@xterm/xterm";

type ScrollTerminal = Pick<Terminal, "options">;

/**
 * xterm 6 treats CompositionHelper's false return as input even for a Shift-only
 * IME key (229). Keep its IME handling intact, suppressing only synchronous
 * scroll-on-input until the current key handler has finished.
 *
 * Application option updates must call beforeOptionsChange first: xterm's
 * public API cannot distinguish a new write of false from our temporary false.
 */
export class ShiftScrollGuard {
  private pending: { value: boolean | undefined } | undefined;
  private disposed = false;

  constructor(private readonly term: ScrollTerminal) {}

  beforeKey(event: Pick<KeyboardEvent, "type" | "keyCode" | "code">): void {
    if (this.disposed) return;
    if (event.type !== "keydown" || event.keyCode !== 229 || !["ShiftLeft", "ShiftRight"].includes(event.code)) {
      // Also preserve normal input from synchronously dispatched/reentrant keys.
      this.restore();
      return;
    }
    if (this.pending && this.term.options.scrollOnUserInput === false) return;
    this.restore();
    const value = this.term.options.scrollOnUserInput;
    if (!value) return;
    const pending = (this.pending = { value });
    this.term.options.scrollOnUserInput = false;
    queueMicrotask(() => {
      if (!this.disposed && this.pending === pending) this.restore();
    });
  }

  /** End the temporary override before applying a newer application setting. */
  beforeOptionsChange(): void {
    if (!this.disposed) this.restore();
  }

  dispose(): void {
    if (this.disposed) return;
    this.restore();
    this.disposed = true;
  }

  private restore(): void {
    const pending = this.pending;
    this.pending = undefined;
    // A different visible value belongs to a newer writer, not this override.
    if (pending && this.term.options.scrollOnUserInput === false) {
      this.term.options.scrollOnUserInput = pending.value;
    }
  }
}
