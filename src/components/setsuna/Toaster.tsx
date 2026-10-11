"use client";
import { useEffect, useState } from "react";

type Toast = { id: number; text: string };
const listeners = new Set<(t: Toast) => void>();
let next = 0;

/** Shows a transient confirmation in the corner, wherever the user is looking. */
export function toast(text: string) {
  const t = { id: ++next, text };
  listeners.forEach((l) => l(t));
}

/** Raises a toast each time a component's confirmation notice changes. */
export function useNoticeToast(notice?: string) {
  useEffect(() => {
    if (notice) toast(notice);
  }, [notice]);
}

export default function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const add = (t: Toast) => {
      setItems((list) => [...list.slice(-2), t]);
      setTimeout(
        () => setItems((list) => list.filter((x) => x.id !== t.id)),
        7000,
      );
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);
  return (
    <div className="s-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <button
          key={t.id}
          className="s-toast"
          onClick={() => setItems((list) => list.filter((x) => x.id !== t.id))}
        >
          <i aria-hidden="true">✓</i>
          <span>{t.text}</span>
        </button>
      ))}
    </div>
  );
}
