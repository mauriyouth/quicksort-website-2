interface VoiceAiVisualProps {
  className?: string;
}

const waveformBars = [34, 58, 82, 48, 100, 66, 42, 76, 54, 30];

export const VoiceAiVisual = ({ className = "" }: VoiceAiVisualProps) => (
  <div
    className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-full border border-[#9B5CFF]/30 bg-[#101010] ${className}`}
    aria-hidden="true"
  >
    <div className="absolute inset-[9%] rounded-full border border-white/10" />
    <div className="absolute inset-[21%] rounded-full border border-[#9B5CFF]/20" />
    <div className="absolute h-[64%] w-[64%] rounded-full bg-[#9B5CFF]/10 blur-3xl" />

    <div className="relative flex h-[44%] w-[72%] items-center justify-center gap-[3%]">
      {waveformBars.map((height, index) => (
        <span
          key={index}
          className="block w-[6%] rounded-full bg-[#9B5CFF] shadow-[0_0_24px_rgba(155,92,255,0.38)]"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>

    <div className="absolute bottom-[11%] rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold tracking-[0.16em] text-[#cecfd2] sm:text-sm">
      LISTEN · UNDERSTAND · ACT
    </div>
  </div>
);
