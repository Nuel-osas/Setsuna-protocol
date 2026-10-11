"use client";
export default function OrderTypeSwitch({
  value,
  onChange,
  disabled,
  label,
}: {
  value: "market" | "limit";
  onChange: (value: "market" | "limit") => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="t-order-kind" role="group" aria-label={label}>
      {(["market", "limit"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={disabled}
          aria-pressed={value === kind}
          onClick={() => onChange(kind)}
        >
          {kind === "market" ? "Market" : "Limit"}
        </button>
      ))}
    </div>
  );
}
