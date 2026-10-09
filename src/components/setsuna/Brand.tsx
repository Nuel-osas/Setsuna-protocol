/** Wave Lift: a disc cut by a wave, the right half lifted. */
const L = "M32 8 A24 24 0 0 0 32 56 C24 44 40 20 32 8 Z";
const R = "M32 8 C40 20 24 44 32 56 A24 24 0 0 0 32 8 Z";

export function Mark({ size = 28, color = "currentColor", className = "" }: { size?: number; color?: string; className?: string }) {
  return (
    <svg className={`s-mark ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <g transform="translate(0 3)">
        <path d={L} transform="translate(-1.7 0)" fill={color} />
        <path d={R} transform="translate(1.7 -6)" fill={color} />
      </g>
    </svg>
  );
}

export default function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="s-brand">
      <Mark size={30} color="var(--tide)" />
      {!compact && <span className="s-wordmark">setsuna</span>}
    </span>
  );
}
