import type { Deployment } from "./types";

let pending: Promise<Deployment> | undefined;
/** Strict Mode/remounts share only an in-flight request; an outage is not cached. */
export function readDeployment() {
  if (!pending) {
    pending = fetch("/api/deployment/", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Deployment unavailable");
        return response.json() as Promise<Deployment>;
      })
      .finally(() => {
        pending = undefined;
      });
  }
  return pending;
}
