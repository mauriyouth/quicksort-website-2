import { useLocale } from '@lib/i18n';
interface VoiceAiVisualProps {
  className?: string;
}

const waveformBars = [34, 58, 82, 48, 100, 66, 42, 76, 54, 30];

export const VoiceAiVisual = ({ className = "" }: VoiceAiVisualProps) => {
  const { t, localize } = useLocale();
 return (
  <div
    className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-full border border-cat-violet/30 bg-surface-raised ${className}`}
    aria-hidden="true"
  >
    <div className="absolute inset-[9%] rounded-full border border-line-faint" />
    <div className="absolute inset-[21%] rounded-full border border-cat-violet/20" />
    <div className="absolute h-[64%] w-[64%] rounded-full bg-cat-violet/10 blur-3xl" />

    <div className="relative flex h-[44%] w-[72%] items-center justify-center gap-[3%]">
      {waveformBars.map((height, index) => (
        <span
          key={index}
          className="block w-[6%] rounded-full bg-cat-violet shadow-[0_0_24px_rgba(155,92,255,0.38)]"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>

    <div className="absolute bottom-[11%] rounded-full border border-line-faint bg-line-faint px-4 py-2 text-xs font-semibold tracking-[0.16em] text-ink-2 sm:text-sm">{t("\n      LISTEN Â· UNDERSTAND Â· ACT\n    ")}</div>
  </div>
);
};
