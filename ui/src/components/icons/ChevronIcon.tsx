import React from "react";

export default function ChevronIcon({
  size = 18,
  className = "",
  direction = "down"
}: {
  size?: number;
  className?: string;
  direction?: "up" | "down" | "left" | "right";
}) {
  const rotations = {
    down: 0,
    up: 180,
    left: 90,
    right: -90,
  };

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ transform: `rotate(${rotations[direction]}deg)`, transition: "transform 0.2s ease" }}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
