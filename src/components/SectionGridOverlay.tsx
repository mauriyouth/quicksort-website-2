import { BrandGrid } from "@components/BrandGrid";

interface SectionGridOverlayProps {
  showCenterLine?: boolean;
}

export const SectionGridOverlay = ({ showCenterLine = false }: SectionGridOverlayProps): JSX.Element => {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      <div className="relative mx-auto h-full w-full max-w-screen-xl border-x border-border-inv">
        <BrandGrid variant="dark" />
        {showCenterLine && (
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-border-inv" />
        )}
      </div>
    </div>
  );
};
