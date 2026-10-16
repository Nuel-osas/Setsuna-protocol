/**
 * What the server sends while the app loads in the browser. The app reads the
 * URL's search params, so it renders client-side; this keeps a real heading and
 * a line of description in the HTML for crawlers that do not run JavaScript.
 */
export default function AppFallback({ title, text }: { title: string; text: string }) {
  return (
    <main id="main" className="s-app s-app-fallback" aria-busy="true">
      <h1>{title}</h1>
      <p>{text}</p>
      <p className="s-app-fallback-status">Loading live data…</p>
    </main>
  );
}
