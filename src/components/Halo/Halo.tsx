interface HaloProps {
  tone?: "lime" | "white";
  className?: string;
}

export const Halo = ({ tone = "white", className = "" }: HaloProps): JSX.Element => {
  const isLime = tone === "lime";
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute left-1/2 top-[-260px] z-0 h-[360px] w-[1200px] max-w-[110%] -translate-x-1/2 rounded-full ${className}`}
      style={{
        background: isLime ? "var(--qs-lime)" : "#ffffff",
        opacity: isLime ? 0.42 : 0.1,
        filter: "blur(20px)",
      }}
    />
  );
};
