import React from 'react';

const AiForBusinessIcon: React.FC<{ className?: string }> = ({ className }) => {
    return (
        <div className={`ai-business-icon-stage ${className || ''}`}>
            <svg
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
                <g id="layer-bottom" className="layer-group layer-bottom">
                    <path d="M321.381 355.467L169.304 405.408L2.65125 361.313L169.233 313.264L321.381 355.467Z" />
                </g>

                {/* Layer: Middle */}
                <g id="layer-middle" className="layer-group layer-middle">
                    <path d="M321.381 326.607L169.304 376.548L2.65125 332.454L169.233 284.404L321.381 326.607Z" />
                </g>

                {/* Layer: Top */}
                <g id="layer-top" className="layer-group layer-top">
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

        /* LAYER TOP ANIMATION */
        @keyframes topSequence {
          /* Phase 1: Slight offset */
          0%, 2% { transform: translateY(0); }
          12%, 22% { transform: translateY(var(--travel-dist)); }
          30%, 33.3% { transform: translateY(0); }
          /* Phase 2: Solo */
          38%, 40% { transform: translateY(0); }
          50%, 60% { transform: translateY(var(--travel-dist)); }
          66.6% { transform: translateY(0); }
          /* Phase 3: Accentuated cascade */
          70%, 72% { transform: translateY(0); }
          80%, 88% { transform: translateY(var(--travel-dist)); }
          94%, 100% { transform: translateY(0); }
        }

        /* LAYER MIDDLE ANIMATION */
        @keyframes middleSequence {
          /* Phase 1: Follows top with 2% delay */
          0%, 4% { transform: translateY(0); }
          14%, 24% { transform: translateY(var(--travel-dist)); }
          32%, 33.3% { transform: translateY(0); }
          /* Phase 2: REST AT BASE */
          33.3%, 66.6% { transform: translateY(0); }
          /* Phase 3: Accentuated cascade */
          66.6%, 76% { transform: translateY(0); }
          84%, 90% { transform: translateY(var(--travel-dist)); }
          96%, 100% { transform: translateY(0); }
        }

        /* LAYER BOTTOM ANIMATION */
        @keyframes bottomSequence {
          /* Phase 1: Follows middle with 2% delay */
          0%, 6% { transform: translateY(0); }
          16%, 26% { transform: translateY(var(--travel-dist)); }
          33.3% { transform: translateY(0); }
          /* Phase 2: REST AT BASE */
          33.3%, 66.6% { transform: translateY(0); }
          /* Phase 3: Accentuated cascade */
          66.6%, 80% { transform: translateY(0); }
          88%, 92% { transform: translateY(var(--travel-dist)); }
          98%, 100% { transform: translateY(0); }
        }

        .layer-top {
          animation: topSequence var(--total-duration) cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .layer-middle {
          animation: middleSequence var(--total-duration) cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }

        .layer-bottom {
          animation: bottomSequence var(--total-duration) cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>
        </div>
    );
};

export default AiForBusinessIcon;
