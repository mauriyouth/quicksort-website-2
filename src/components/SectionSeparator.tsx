import React from "react";

export const SectionSeparator = () => {
    return (
        <div className="relative w-full max-w-screen-xl flex items-center z-[2] overflow-visible">
            <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/70 z-10">
                <svg
                    width="15"
                    height="15"
                    viewBox="0 0 15 15"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path d="M7.5 0V15M0 7.5H15" stroke="currentColor" />
                </svg>
            </div>
            <div className="absolute left-[-7.5px] right-[-7.5px] top-1/2 -translate-y-1/2 h-[1px] bg-white/40" />
            <div className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 text-white/70 z-10">
                <svg
                    width="15"
                    height="15"
                    viewBox="0 0 15 15"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path d="M7.5 0V15M0 7.5H15" stroke="currentColor" />
                </svg>
            </div>
        </div>
    );
};
