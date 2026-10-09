import { useId } from "react";

/** Original SVG material study of Setsuna's Wave Lift mark; no vendor image/runtime. */
export default function FlowSculpture({
  className = "",
}: {
  className?: string;
}) {
  const id = useId().replaceAll(":", "");
  return (
    <svg
      className={`m-sculpture ${className}`}
      viewBox="0 0 560 500"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}-metal`}
          x1="20"
          y1="8"
          x2="45"
          y2="58"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#f5fffd" />
          <stop offset=".22" stopColor="#a8e7f0" />
          <stop offset=".4" stopColor="#597ac9" />
          <stop offset=".49" stopColor="#cbeaff" />
          <stop offset=".61" stopColor="#eefeff" />
          <stop offset=".77" stopColor="#81a0c9" />
          <stop offset="1" stopColor="#263552" />
        </linearGradient>
        <linearGradient
          id={`${id}-edge`}
          x1="0"
          y1="0"
          x2="40"
          y2="55"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#d1fffb" />
          <stop offset=".35" stopColor="#396b89" />
          <stop offset=".7" stopColor="#112b4d" />
          <stop offset="1" stopColor="#819aca" />
        </linearGradient>
        <linearGradient
          id={`${id}-shine`}
          x1="12"
          y1="20"
          x2="40"
          y2="45"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="white" stopOpacity=".9" />
          <stop offset=".6" stopColor="#c9d7ff" stopOpacity=".1" />
          <stop offset="1" stopColor="white" stopOpacity=".7" />
        </linearGradient>
        <radialGradient id={`${id}-pool`}>
          <stop stopColor="#91d3ff" stopOpacity=".45" />
          <stop offset="1" stopColor="#59d9ef" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-blur`}>
          <feGaussianBlur stdDeviation="13" />
        </filter>
        <filter
          id={`${id}-shadow`}
          x="-40%"
          y="-40%"
          width="180%"
          height="200%"
        >
          <feDropShadow
            dx="0"
            dy="4"
            stdDeviation="2"
            floodColor="#010b14"
            floodOpacity=".4"
          />
        </filter>
      </defs>
      <ellipse
        cx="286"
        cy="422"
        rx="180"
        ry="30"
        fill={`url(#${id}-pool)`}
        filter={`url(#${id}-blur)`}
      />
      <g
        transform="translate(75 33) rotate(-13 204 208) scale(6.45)"
        filter={`url(#${id}-shadow)`}
      >
        <g transform="translate(1.1 1.8)" fill={`url(#${id}-edge)`}>
          <path
            d="M32 8 A24 24 0 0 0 32 56 C24 44 40 20 32 8Z"
            transform="translate(-2 3)"
          />
          <path
            d="M32 8 C40 20 24 44 32 56 A24 24 0 0 0 32 8Z"
            transform="translate(2 -3)"
          />
        </g>
        <g
          fill={`url(#${id}-metal)`}
          stroke={`url(#${id}-shine)`}
          strokeWidth=".25"
        >
          <path
            d="M32 8 A24 24 0 0 0 32 56 C24 44 40 20 32 8Z"
            transform="translate(-2 3)"
          />
          <path
            d="M32 8 C40 20 24 44 32 56 A24 24 0 0 0 32 8Z"
            transform="translate(2 -3)"
          />
        </g>
      </g>
    </svg>
  );
}
