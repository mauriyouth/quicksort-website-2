import React from "react";

interface SectionGridOverlayProps {
    showCenterLine?: boolean;
}

export const SectionGridOverlay = ({ showCenterLine = true }: SectionGridOverlayProps) => {
    return (
        <div className="absolute inset-0 pointer-events-none z-[0] flex justify-center">
            <div className="w-full max-w-screen-xl h-full border-x border-white/40 relative">
                {showCenterLine && (
                    <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-white/40 -translate-x-1/2"></div>
                )}
            </div>
        </div>
    );
};
