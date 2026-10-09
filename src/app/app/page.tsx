import type { Metadata } from "next";
import AppShell from "@/components/setsuna/AppShell";

export const metadata: Metadata = { title: "App · Setsuna" };

export default function Page() {
  return <AppShell />;
}
