import React, { useState, useEffect, useRef } from 'react';

const AiForBusinessIcon: React.FC<{ className?: string }> = ({ className }) => {
  // Track which layer should be blue (0 = top, 1 = middle, 2 = bottom)
  const [blueLayer, setBlueLayer] = useState(() => Math.floor(Math.random() * 3));
  const [animationKey, setAnimationKey] = useState(0);

  // Animation duration in ms (matches CSS --total-duration)
  const animationDuration = 24000;
  const isFirstMount = useRef(true);

  // Randomly select a new layer to be blue each animation cycle
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
    }

    const interval = setInterval(() => {
      setBlueLayer(Math.floor(Math.random() * 3));
      setAnimationKey(prev => prev + 1);
    }, animationDuration);

    return () => clearInterval(interval);
  }, [animationDuration]);

  return (
    <div className={`ai-business-icon-stage ${className || ''}`}>
      <svg
        key={animationKey}
        width="328"
        height="450"
        viewBox="0 0 328 450"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="ai-business-svg"
      >
        {/* Central axis */}
        <line
          className="central-axis"
          x1="168.962"
          y1="50"
          x2="168.962"
          y2="410"
          stroke="#309EFF"
          strokeWidth="2"
          strokeDasharray="8 8"
          opacity="0.7"
        />

        {/* Layer: Bottom */}
        <g id="layer-bottom" className={`layer-group layer-bottom ${blueLayer === 2 ? 'layer-blue' : ''}`}>
          <path d="M321.381 355.467L169.304 405.408L2.65125 361.313L169.233 313.264L321.381 355.467Z" />
        </g>

        {/* Layer: Middle */}
        <g id="layer-middle" className={`layer-group layer-middle ${blueLayer === 1 ? 'layer-blue' : ''}`}>
          <path d="M321.381 326.607L169.304 376.548L2.65125 332.454L169.233 284.404L321.381 326.607Z" />
        </g>

        {/* Layer: Top */}
        <g id="layer-top" className={`layer-group layer-top ${blueLayer === 0 ? 'layer-blue' : ''}`}>
          <path d="M321.381 300.963L169.304 350.904L2.65115 306.809L169.233 258.76L321.381 300.963Z" />
        </g>
      </svg>

      <style>{`
        .ai-business-icon-stage {
          --blue-accent: #309EFF;
          --total-duration: 24s;
          --bg-color: transparent;
          --shape-color: #ffffff;
          --travel-dist: -200px;
          
          position: relative;
          width: 100%;
          max-width: 500px;
          aspect-ratio: 328 / 450;
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .ai-business-svg {
          width: 80%;
          height: auto;
        }

        .layer-group {
          opacity: 0.8;
          transition: opacity 0.5s ease;
        }

        .layer-group path {
          stroke: var(--shape-color);
          fill: rgba(255, 255, 255, 0.05);
          stroke-width: 2.5;
        }

        .layer-group:hover {
          opacity: 1;
        }

        /* LAYER TOP ANIMATION - all three phases */
        @keyframes topSequence {
          /* Phase 1 */
          0%, 2% { transform: translateY(0); }
          12%, 22% { transform: translateY(var(--travel-dist)); }
          30%, 33.3% { transform: translateY(0); }
          /* Phase 2 */
          38%, 40% { transform: translateY(0); }
          50%, 60% { transform: translateY(var(--travel-dist)); }
          66.6% { transform: translateY(0); }
          /* Phase 3 */
          70%, 72% { transform: translateY(0); }
          80%, 88% { transform: translateY(var(--travel-dist)); }
          94%, 100% { transform: translateY(0); }
        }

        /* LAYER TOP COLOR ANIMATION - turns blue when up */
        @keyframes topColorSequence {
          /* Phase 1 */
          0%, 2% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          10%, 24% { stroke: var(--blue-accent); fill: rgba(48, 158, 255, 0.15); }
          30%, 33.3% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          /* Phase 2 */
          38%, 40% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          48%, 62% { stroke: var(--blue-accent); fill: rgba(48, 158, 255, 0.15); }
          66.6% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          /* Phase 3 */
          70%, 72% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          78%, 90% { stroke: var(--blue-accent); fill: rgba(48, 158, 255, 0.15); }
          94%, 100% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
        }

        /* LAYER MIDDLE ANIMATION - all three phases with cascade delay */
        @keyframes middleSequence {
          /* Phase 1 */
          0%, 4% { transform: translateY(0); }
          14%, 24% { transform: translateY(var(--travel-dist)); }
          32%, 33.3% { transform: translateY(0); }
          /* Phase 2 - now moves with cascade */
          38%, 42% { transform: translateY(0); }
          52%, 62% { transform: translateY(var(--travel-dist)); }
          66.6% { transform: translateY(0); }
          /* Phase 3 */
          70%, 76% { transform: translateY(0); }
          84%, 90% { transform: translateY(var(--travel-dist)); }
          96%, 100% { transform: translateY(0); }
        }

        /* LAYER MIDDLE COLOR ANIMATION - turns blue when up */
        @keyframes middleColorSequence {
          /* Phase 1 */
          0%, 4% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          12%, 26% { stroke: var(--blue-accent); fill: rgba(48, 158, 255, 0.15); }
          32%, 33.3% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          /* Phase 2 */
          38%, 42% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          50%, 64% { stroke: var(--blue-accent); fill: rgba(48, 158, 255, 0.15); }
          66.6% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          /* Phase 3 */
          70%, 76% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          82%, 92% { stroke: var(--blue-accent); fill: rgba(48, 158, 255, 0.15); }
          96%, 100% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
        }

        /* LAYER BOTTOM ANIMATION - all three phases with cascade delay */
        @keyframes bottomSequence {
          /* Phase 1 */
          0%, 6% { transform: translateY(0); }
          16%, 26% { transform: translateY(var(--travel-dist)); }
          33.3% { transform: translateY(0); }
          /* Phase 2 - now moves with cascade */
          38%, 44% { transform: translateY(0); }
          54%, 64% { transform: translateY(var(--travel-dist)); }
          66.6% { transform: translateY(0); }
          /* Phase 3 */
          70%, 80% { transform: translateY(0); }
          88%, 92% { transform: translateY(var(--travel-dist)); }
          98%, 100% { transform: translateY(0); }
        }

        /* LAYER BOTTOM COLOR ANIMATION - turns blue when up */
        @keyframes bottomColorSequence {
          /* Phase 1 */
          0%, 6% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          14%, 28% { stroke: var(--blue-accent); fill: rgba(48, 158, 255, 0.15); }
          33.3% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          /* Phase 2 */
          38%, 44% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          52%, 66% { stroke: var(--blue-accent); fill: rgba(48, 158, 255, 0.15); }
          66.6% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          /* Phase 3 */
          70%, 80% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
          86%, 94% { stroke: var(--blue-accent); fill: rgba(48, 158, 255, 0.15); }
          98%, 100% { stroke: var(--shape-color); fill: rgba(255, 255, 255, 0.05); }
        }

        .layer-top {
          animation: topSequence var(--total-duration) cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .layer-top.layer-blue path {
          animation: topColorSequence var(--total-duration) cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .layer-middle {
          animation: middleSequence var(--total-duration) cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .layer-middle.layer-blue path {
          animation: middleColorSequence var(--total-duration) cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .layer-bottom {
          animation: bottomSequence var(--total-duration) cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .layer-bottom.layer-blue path {
          animation: bottomColorSequence var(--total-duration) cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>
    </div>
  );
};

export default AiForBusinessIcon;
