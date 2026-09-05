import { useEffect, useRef } from "react";
import { useTheme } from "@lib/theme";

interface AnimatedNoiseProps {
    opacity?: number;
    className?: string;
    /** RGB color tint for the noise, e.g. [204, 255, 0]. Defaults to greyscale. */
    color?: [number, number, number];
}

export function AnimatedNoise({ opacity = 0.05, className, color }: AnimatedNoiseProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const colorRef = useRef(color);
    const { theme } = useTheme();

    // Untinted noise is near-white, which is invisible on a light canvas.
    // Flip it to dark grain so the texture reads in both themes.
    const invert = theme === "light" && !color;
    const invertRef = useRef(invert);

    // Keep the refs in sync so the animation loop sees the latest values
    useEffect(() => {
        colorRef.current = color;
    }, [color]);

    useEffect(() => {
        invertRef.current = invert;
    }, [invert]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        let animationId: number;
        let frame = 0;

        const resize = () => {
            canvas.width = canvas.offsetWidth / 2;
            canvas.height = canvas.offsetHeight / 2;
        };

        const generateNoise = () => {
            const imageData = ctx.createImageData(canvas.width, canvas.height);
            const data = imageData.data;
            const c = colorRef.current;

            for (let i = 0; i < data.length; i += 4) {
                const value = Math.random() * 255;
                if (c) {
                    // Tinted noise: blend the random value with the target color
                    const mix = value / 255;
                    data[i] = Math.round(c[0] * mix);
                    data[i + 1] = Math.round(c[1] * mix);
                    data[i + 2] = Math.round(c[2] * mix);
                } else {
                    const grain = invertRef.current ? 255 - value : value;
                    data[i] = grain;
                    data[i + 1] = grain;
                    data[i + 2] = grain;
                }
                data[i + 3] = 255;
            }

            ctx.putImageData(imageData, 0, 0);
        };

        const animate = () => {
            frame++;
            if (frame % 2 === 0) {
                generateNoise();
            }
            animationId = requestAnimationFrame(animate);
        };

        resize();
        window.addEventListener("resize", resize);
        animate();

        return () => {
            window.removeEventListener("resize", resize);
            cancelAnimationFrame(animationId);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className={className}
            style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                opacity,
                mixBlendMode: "soft-light",
                transition: "opacity 0.4s ease",
            }}
        />
    );
}
