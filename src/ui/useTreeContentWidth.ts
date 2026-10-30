import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

export type MeasureTreeText = (text: string, bold?: boolean) => number;

interface WidthRow<T> {
  key: string;
  node: T;
  depth: number;
  loading?: boolean;
}

/** Width belongs to the loaded/expanded model, not just the virtualizer's mounted rows. */
export function useTreeContentWidth<T>(
  enabled: boolean,
  scrollRef: RefObject<HTMLDivElement | null>,
  rows: readonly WidthRow<T>[],
  indent: number,
  getLabel: (node: T) => string,
  getContentWidth?: (node: T, measure: MeasureTreeText) => number,
) {
  const [font, setFont] = useState({ css: "", bold: "", spacing: "", revision: 0 });
  const [width, setWidth] = useState<number>();
  const measured = useRef(new Map<string, { node: T; estimate: number; width: number }>());

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el) return;
    const readFont = () => {
      const style = getComputedStyle(el);
      const css = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const bold = `${style.fontStyle} 600 ${style.fontSize} ${style.fontFamily}`;
      setFont((old) =>
        old.css === css && old.bold === bold && old.spacing === style.letterSpacing
          ? old
          : { css, bold, spacing: style.letterSpacing, revision: old.revision + 1 },
      );
    };
    const loaded = () => setFont((old) => ({ ...old, revision: old.revision + 1 }));
    readFont();
    const observer = new MutationObserver(readFont);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    document.fonts?.addEventListener("loadingdone", loaded);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", loaded);
    };
  }, [enabled, scrollRef]);

  const estimates = useMemo(() => {
    if (!enabled) return [];
    // No layout is needed for offscreen labels. DOM measurements below correct
    // custom renderers, badges and browser font shaping when they are mounted.
    const context =
      typeof CanvasRenderingContext2D === "undefined" ? null : document.createElement("canvas").getContext("2d");
    const cache = new Map<string, number>();
    const measure: MeasureTreeText = (text, bold = false) => {
      const key = `${bold}:${text}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      if (context) context.font = bold ? font.bold : font.css;
      const spacing = Number.parseFloat(font.spacing) || 0;
      const result = (context?.measureText(text).width ?? text.length * 8) + Math.max(0, text.length - 1) * spacing;
      cache.set(key, result);
      return result;
    };
    return rows.map((row) => ({
      row,
      // Left indentation, chevron (16), gap (4), right padding (8).
      width: Math.ceil(
        4 +
          row.depth * indent +
          16 +
          4 +
          8 +
          (row.loading ? 80 : (getContentWidth?.(row.node, measure) ?? measure(getLabel(row.node)))),
      ),
    }));
  }, [enabled, rows, indent, getLabel, getContentWidth, font]);

  const model = useMemo(
    () => ({
      byKey: new Map(estimates.map((entry) => [entry.row.key, entry])),
      width: estimates.reduce((max, entry) => Math.max(max, entry.width), 0),
    }),
    [estimates],
  );
  const measuredMax = useRef(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observed = useRef(new Set<Element>());
  const measureRef = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    measured.current.clear();
    measuredMax.current = 0;
  }, [font]);

  // Reconcile only when the model/estimates change, never on vertical scroll.
  useLayoutEffect(() => {
    for (const [key, old] of measured.current) {
      const entry = model.byKey.get(key);
      if (!entry || entry.row.node !== old.node || entry.width !== old.estimate) measured.current.delete(key);
    }
    measuredMax.current = [...measured.current.values()].reduce((max, entry) => Math.max(max, entry.width), 0);
  }, [model]);

  useLayoutEffect(() => {
    if (!enabled || !scrollRef.current) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measureRef.current());
    });
    observerRef.current = observer;
    observer.observe(scrollRef.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      observerRef.current = null;
      observed.current.clear();
    };
  }, [enabled, scrollRef]);

  // Each virtual range commit measures only mounted content. Project keeps its
  // hit target stretched, with a separate natural-width child for measurement.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el) return;
    const contents = [...el.querySelectorAll<HTMLElement>("[data-tree-content]")];
    const measure = () => {
      let maxMayShrink = false;
      for (const content of contents) {
        const rowEl = content.parentElement!;
        const entry = estimates[Number(rowEl.dataset.row)];
        if (!entry) continue;
        const style = getComputedStyle(rowEl);
        const children = [...content.children] as HTMLElement[];
        const gap = parseFloat(getComputedStyle(content).columnGap) || 0;
        const natural = Math.ceil(
          children.reduce(
            (sum, child) =>
              sum + (child.querySelector<HTMLElement>("[data-tree-intrinsic]") ?? child).getBoundingClientRect().width,
            0,
          ) +
            Math.max(0, children.length - 1) * gap +
            (parseFloat(style.paddingLeft) || 0) +
            (parseFloat(style.paddingRight) || 0),
        );
        const old = measured.current.get(entry.row.key);
        const next = content.querySelector("input") ? Math.max(old?.width ?? 0, natural) : natural;
        if (old?.width === measuredMax.current && next < old.width) maxMayShrink = true;
        measured.current.set(entry.row.key, { node: entry.row.node, estimate: entry.width, width: next });
        measuredMax.current = Math.max(measuredMax.current, next);
      }
      if (maxMayShrink)
        measuredMax.current = [...measured.current.values()].reduce((max, entry) => Math.max(max, entry.width), 0);
      const style = getComputedStyle(el);
      const viewport = el.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      setWidth(Math.ceil(Math.max(viewport, model.width, measuredMax.current)));
    };
    measureRef.current = measure;
    const targets = new Set<Element>([...contents, ...el.querySelectorAll("[data-tree-intrinsic]")]);
    for (const old of observed.current) if (!targets.has(old)) observerRef.current?.unobserve(old);
    for (const target of targets) if (!observed.current.has(target)) observerRef.current?.observe(target);
    observed.current = targets;
    measure();
  });

  return enabled ? width : undefined;
}
