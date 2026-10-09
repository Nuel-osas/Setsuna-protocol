/**
 * "Step in" presets. Buffers are basis points above maintenance margin, as the
 * contract expects (triggerBufferBps / targetBufferBps). Target must exceed
 * trigger and stay within uint16 (≤ 65535).
 */
export type StepIn = "early" | "normal" | "late";

export const stepIn: Record<
  StepIn,
  { label: string; blurb: string; trigger: number; target: number }
> = {
  early: {
    label: "Early",
    blurb: "Acts well before danger. Uses more budget, sleeps better.",
    trigger: 6000,
    target: 12000,
  },
  normal: {
    label: "Balanced",
    blurb: "Acts with room to spare. The sensible default.",
    trigger: 3000,
    target: 7000,
  },
  late: {
    label: "Late",
    blurb: "Acts close to the line. Spends least, cuts it finest.",
    trigger: 1200,
    target: 3500,
  },
};

export const advancedDefaults = {
  minTopUp: "1",
  feePct: "1",
  feeMax: "1",
  markAge: "60",
};
