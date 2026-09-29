"use client";

/** Inline Pi logo (same path as public/pi-original.svg). The source uses
 *  fill="currentColor", so the accent/title-bar color comes from the parent. */
export function PiLogo({ size = 16 }: { size?: number }) {
  return (
    <svg
      fill="currentColor"
      fillRule="evenodd"
      height={size}
      viewBox="0 0 256 256"
      width={size}
      style={{ flex: "none", lineHeight: 1 }}
      aria-hidden="true"
    >
      <path d="M53 70h44c31 0 42 32 24 49 25 17 13 57-21 57H53V70zm23 21v20h20c15 0 15-20 0-20H76zm0 40v24h23c17 0 17-24 0-24H76zm62-61h72v23h-24v83h-24V93h-24V70z" />
    </svg>
  );
}
