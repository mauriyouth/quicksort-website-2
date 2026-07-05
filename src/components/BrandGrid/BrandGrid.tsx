interface BrandGridProps {
  variant?: "dark" | "light";
  className?: string;
}

export const BrandGrid = ({ variant = "dark", className = "" }: BrandGridProps): JSX.Element => {
  const line = variant === "dark" ? "rgba(250,250,250,0.05)" : "rgba(0,7,14,0.06)";
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 z-0 ${className}`}
      style={{
        backgroundImage: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
        backgroundSize: "96px 96px",
        WebkitMaskImage: "radial-gradient(ellipse 70% 70% at 50% 38%, black 0%, transparent 92%)",
        maskImage: "radial-gradient(ellipse 70% 70% at 50% 38%, black 0%, transparent 92%)",
      }}
    />
  );
};
