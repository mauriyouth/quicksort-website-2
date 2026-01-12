import { useEffect, useRef, useCallback } from 'react';

interface GameOfLifeCanvasProps {
    cols?: number;
    rows?: number;
    cellSize?: number;
    className?: string;
}

export const GameOfLifeCanvas = ({
    cols = 26,
    rows = 26,
    cellSize = 16,
    className = '',
}: GameOfLifeCanvasProps): JSX.Element => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gridRef = useRef<boolean[][]>([]);
    const animationRef = useRef<number | null>(null);
    const lastUpdateRef = useRef<number>(0);

    // Calculate exact canvas dimensions based on grid
    const width = cols * cellSize;
    const height = rows * cellSize;

    // Initialize grid with random values
    const initializeGrid = useCallback(() => {
        const grid: boolean[][] = [];
        for (let i = 0; i < rows; i++) {
            grid[i] = [];
            for (let j = 0; j < cols; j++) {
                // 30% chance of being alive
                grid[i][j] = Math.random() < 0.3;
            }
        }
        return grid;
    }, [rows, cols]);

    // Count live neighbors for a cell
    const countNeighbors = useCallback((grid: boolean[][], row: number, col: number) => {
        let count = 0;
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                if (i === 0 && j === 0) continue;
                const newRow = (row + i + rows) % rows;
                const newCol = (col + j + cols) % cols;
                if (grid[newRow][newCol]) count++;
            }
        }
        return count;
    }, [rows, cols]);

    // Compute next generation
    const nextGeneration = useCallback((grid: boolean[][]) => {
        const newGrid: boolean[][] = [];
        for (let i = 0; i < rows; i++) {
            newGrid[i] = [];
            for (let j = 0; j < cols; j++) {
                const neighbors = countNeighbors(grid, i, j);
                if (grid[i][j]) {
                    // Alive cell survives with 2 or 3 neighbors
                    newGrid[i][j] = neighbors === 2 || neighbors === 3;
                } else {
                    // Dead cell becomes alive with exactly 3 neighbors
                    newGrid[i][j] = neighbors === 3;
                }
            }
        }
        return newGrid;
    }, [rows, countNeighbors]);

    // Draw the grid on canvas
    const drawGrid = useCallback((ctx: CanvasRenderingContext2D, grid: boolean[][]) => {
        // Clear with transparent background
        ctx.clearRect(0, 0, width, height);

        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const x = j * cellSize;
                const y = i * cellSize;

                if (grid[i][j]) {
                    // Alive cell - green
                    ctx.fillStyle = '#ccff00';
                } else {
                    // Dead cell - dark
                    ctx.fillStyle = '#1a1a1a';
                }

                // Fill cells edge-to-edge with 1px gap
                ctx.fillRect(x, y, cellSize - 1, cellSize - 1);
            }
        }
    }, [width, height, rows, cols, cellSize]);

    // Animation loop
    const animate = useCallback((timestamp: number) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Update every 200ms
        if (timestamp - lastUpdateRef.current > 200) {
            gridRef.current = nextGeneration(gridRef.current);
            drawGrid(ctx, gridRef.current);
            lastUpdateRef.current = timestamp;
        }

        animationRef.current = requestAnimationFrame(animate);
    }, [nextGeneration, drawGrid]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Initialize and draw
        gridRef.current = initializeGrid();
        drawGrid(ctx, gridRef.current);

        // Start animation
        animationRef.current = requestAnimationFrame(animate);

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [initializeGrid, drawGrid, animate]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className={className}
            style={{ imageRendering: 'pixelated' }}
        />
    );
};
