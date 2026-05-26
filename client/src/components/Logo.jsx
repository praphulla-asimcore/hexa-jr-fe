import React from 'react';

export default function Logo({ size = 32 }) {
  const id = 'hexa-grad';
  return (
    <svg
      width={size * 4.2}
      height={size}
      viewBox="0 0 168 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Hexa"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="168" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#d946ef" />
          <stop offset="45%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>

      {/* H */}
      <rect x="0" y="2" width="7" height="36" rx="2" fill={`url(#${id})`} />
      <rect x="0" y="17" width="22" height="6" rx="2" fill={`url(#${id})`} />
      <rect x="15" y="2" width="7" height="36" rx="2" fill={`url(#${id})`} />

      {/* E */}
      <rect x="28" y="2" width="7" height="36" rx="2" fill={`url(#${id})`} />
      <rect x="28" y="2" width="20" height="6" rx="2" fill={`url(#${id})`} />
      <rect x="28" y="17" width="16" height="6" rx="2" fill={`url(#${id})`} />
      <rect x="28" y="32" width="20" height="6" rx="2" fill={`url(#${id})`} />

      {/* X */}
      <rect x="58" y="2" width="7" height="36" rx="2" transform="rotate(0 58 2)" fill={`url(#${id})`} />
      <rect x="55" y="0" width="7" height="42" rx="2" transform="rotate(45 66 20)" fill={`url(#${id})`} />
      <rect x="55" y="0" width="7" height="42" rx="2" transform="rotate(-45 66 20)" fill={`url(#${id})`} />

      {/* A */}
      <rect x="100" y="2" width="7" height="36" rx="2" transform="rotate(-12 103 20)" fill={`url(#${id})`} />
      <rect x="114" y="2" width="7" height="36" rx="2" transform="rotate(12 117 20)" fill={`url(#${id})`} />
      <rect x="100" y="16" width="24" height="6" rx="2" fill={`url(#${id})`} />

      {/* TM */}
      <text x="137" y="8" fontSize="8" fontWeight="700" fill={`url(#${id})`} fontFamily="Inter, sans-serif">TM</text>
    </svg>
  );
}
