import { forwardRef, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';

export interface GalleryItem {
  title: string;
  date: string;
  dateLabel: string;
  location: string;
  href: string;
  image: string;
}

interface CircularGalleryProps extends HTMLAttributes<HTMLDivElement> {
  items: GalleryItem[];
  radius?: number;
  /** Degrees per second. */
  autoRotateSpeed?: number;
  labels: { gallery: string; previous: string; next: string; view: string };
}

export const CircularGallery = forwardRef<HTMLDivElement, CircularGalleryProps>(
  ({ items, radius = 195, autoRotateSpeed = 5, labels, className = '', ...props }, ref) => {
    const stageRef = useRef<HTMLDivElement>(null);
    const [rotation, setRotation] = useState(-60);
    const [availableWidth, setAvailableWidth] = useState(760);
    const [reducedMotion, setReducedMotion] = useState(false);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
      const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      const updateMotion = () => setReducedMotion(motion.matches);
      updateMotion();
      motion.addEventListener('change', updateMotion);
      const stage = stageRef.current;
      const resize = new ResizeObserver(entries => setAvailableWidth(entries[0].contentRect.width));
      const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting));
      if (stage) { resize.observe(stage); observer.observe(stage); }
      return () => { motion.removeEventListener('change', updateMotion); resize.disconnect(); observer.disconnect(); };
    }, []);

    const running = !reducedMotion && visible && items.length > 1;
    useEffect(() => {
      if (!running) return;
      let frame: number;
      let lastTime = 0;
      let lastScroll = window.scrollY;
      const animate = (time: number) => {
        if (lastTime) setRotation(value => (value + Math.min(time - lastTime, 50) * autoRotateSpeed / 1000) % 360);
        lastTime = time;
        frame = requestAnimationFrame(animate);
      };
      const onScroll = () => {
        const delta = window.scrollY - lastScroll;
        lastScroll = window.scrollY;
        setRotation(value => (value + delta * 0.08) % 360);
      };
      frame = requestAnimationFrame(animate);
      window.addEventListener('scroll', onScroll, { passive: true });
      return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); };
    }, [running, autoRotateSpeed]);

    const step = items.length ? 360 / items.length : 0;
    const orbitRadius = items.length < 2 ? 0 : Math.max(0, Math.min(radius, (availableWidth - 246) / 2));
    const move = (direction: number) => {
      setRotation(value => Math.round(value / step) * step + direction * step);
    };
    const controlClass = 'inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink hover:bg-surface-sunken focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal';

    return (
      <div ref={ref} role="region" aria-label={labels.gallery} className={`w-full ${className}`} {...props}>
        <div
          ref={stageRef}
          className={reducedMotion ? 'flex flex-wrap justify-center gap-6 py-8' : 'relative h-[400px] sm:h-[420px]'}
          style={{ perspective: '1400px' }}
        >
          {items.map((item, index) => {
            const angle = index * step + rotation;
            const depth = Math.cos(angle * Math.PI / 180);
            return (
              <article
                key={item.href}
                onFocusCapture={event => { if (!reducedMotion && event.target.matches(':focus-visible')) setRotation(-index * step); }}
                className={reducedMotion ? 'w-[220px]' : 'absolute left-1/2 top-1/2 w-[220px] -ml-[110px] -mt-[173px]'}
                style={reducedMotion ? undefined : {
                  // Counter-rotation keeps the banners readable on the back of the circle, too.
                  transform: `rotateY(${angle}deg) translateZ(${orbitRadius}px) rotateY(${-angle}deg)`,
                  zIndex: Math.round((depth + 1) * 100),
                  filter: `brightness(${0.82 + (depth + 1) * 0.09})`,
                }}
              >
                <a href={item.href} target="_blank" rel="noopener noreferrer" className="flex h-[354px] flex-col overflow-hidden rounded-xl border border-line bg-surface-raised shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal hover:border-signal">
                  <img src={item.image} alt={item.title} width={220} height={220} className="aspect-square w-full object-contain" />
                  <div className="flex flex-1 flex-col gap-2 p-3.5">
                    <p className="text-[11px] text-ink-muted"><time dateTime={item.date}>{item.dateLabel}</time><span className="mx-1.5" aria-hidden="true">·</span>{item.location}</p>
                    <h2 className="font-qs-sans text-sm font-semibold leading-snug text-ink line-clamp-3">{item.title}</h2>
                    <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-xs font-semibold text-signal-text">{labels.view}<ArrowUpRight size={14} aria-hidden="true" /></span>
                  </div>
                </a>
              </article>
            );
          })}
        </div>
        {!reducedMotion && items.length > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button type="button" className={controlClass} aria-label={labels.previous} onClick={() => move(1)}><ArrowLeft size={16} aria-hidden="true" /></button>
            <button type="button" className={controlClass} aria-label={labels.next} onClick={() => move(-1)}><ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        )}
      </div>
    );
  },
);
CircularGallery.displayName = 'CircularGallery';
