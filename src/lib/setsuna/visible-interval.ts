/**
 * Runs `fn` every `ms` while the page is visible, and once as soon as a hidden tab is shown again.
 * A tab left open in the background otherwise keeps calling the server all day. Returns a stop function.
 */
export function whileVisible(fn: () => void, ms: number): () => void {
  const tick = () => {
    if (document.visibilityState === "visible") fn();
  };
  const timer = setInterval(tick, ms);
  document.addEventListener("visibilitychange", tick);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", tick);
  };
}
