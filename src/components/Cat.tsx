/** 应用里的猫元素：品牌标记用简化猫头，空状态用完整猫脸。全部用 currentColor 描边。 */

export function CatMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.6 9.4 4 4.2l4.7 2.6" />
      <path d="M19.4 9.4 20 4.2l-4.7 2.6" />
      <path d="M12 6.6c4.3 0 7.2 2.9 7.2 7 0 3.9-3.2 6.6-7.2 6.6s-7.2-2.7-7.2-6.6c0-4.1 2.9-7 7.2-7Z" />
      <path d="M9.4 12.4h.01M14.6 12.4h.01" strokeWidth="2.6" />
      <path d="M12 15.1v1.1M10.6 16.4h2.8" />
    </svg>
  );
}

export function CatMascot({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 23 10.6 8.5 24 14.8" />
      <path d="M50 23 53.4 8.5 40 14.8" />
      <path d="M32 14.5c10.6 0 18 7.6 18 17.4S42.6 49 32 49 14 41.9 14 31.9s7.4-17.4 18-17.4Z" />
      <path d="M24 30.5h.01M40 30.5h.01" strokeWidth="3.6" />
      <path d="M32 36.2l-2.4 2.1h4.8L32 36.2Z" />
      <path d="M32 38.3v2.6M32 40.9c-1.7 0-3.1-1-3.6-2.4M32 40.9c1.7 0 3.1-1 3.6-2.4" />
      <path d="M10.5 33.5h6M47.5 33.5h6M11.5 40l5-1.7M52.5 40l-5-1.7" />
      <path d="M22 12.5c2.6-1.9 6.4-2.9 10-2.9s7.4 1 10 2.9" strokeOpacity="0.45" />
    </svg>
  );
}
