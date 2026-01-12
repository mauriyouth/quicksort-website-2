import React, { useState, useCallback, useRef, useEffect } from 'react';

interface GameOfLifeCanvasProps {
    className?: string;
    gridSize?: number;
}

const operations = [
    [0, 1], [0, -1], [1, -1], [-1, 1],
    [1, 1], [-1, -1], [1, 0], [-1, 0]
];

const GameOfLifeCanvas: React.FC<GameOfLifeCanvasProps> = ({
    className = '',
    gridSize = 35
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [grid, setGrid] = useState(() => generateEmptyGrid(gridSize));
    const speedRef = useRef(500);
    const runningRef = useRef(true);

    function generateEmptyGrid(size: number) {
        return Array.from({ length: size }, () => Array(size).fill(0));
    }

    const seedGrid = useCallback(() => {
        const newGrid = generateEmptyGrid(gridSize);
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if (Math.random() > 0.85) newGrid[i][j] = 1;
            }
        }
        setGrid(newGrid);
    }, [gridSize]);

    useEffect(() => {
        seedGrid();
    }, [seedGrid]);

    const runSimulation = useCallback(() => {
        if (!runningRef.current) return;

        setGrid((g) => {
            let activeCells = 0;
            const next = g.map((row, i) => {
                return row.map((col, j) => {
                    let neighbors = 0;
                    operations.forEach(([x, y]) => {
                        const newI = (i + x + gridSize) % gridSize;
                        const newJ = (j + y + gridSize) % gridSize;
                        neighbors += g[newI][newJ];
                    });

                    if (neighbors < 2 || neighbors > 3) {
                        return 0;
                    } else if (g[i][j] === 0 && neighbors === 3) {
                        activeCells++;
                        return 1;
                    }
                    if (g[i][j] === 1) activeCells++;
                    return g[i][j];
                });
            });

            if (activeCells < 10) {
                setTimeout(() => seedGrid(), 1000);
                return g;
            }

            return next;
        });

        setTimeout(runSimulation, speedRef.current);
    }, [seedGrid, gridSize]);

    useEffect(() => {
        runningRef.current = true;
        const timeout = setTimeout(runSimulation, speedRef.current);
        return () => {
            runningRef.current = false;
            clearTimeout(timeout);
        };
    }, [runSimulation]);

    const interpolate = (ratio: number, start: number[], end: number[]) => {
        const r = Math.round(start[0] + (end[0] - start[0]) * ratio);
        const g = Math.round(start[1] + (end[1] - start[1]) * ratio);
        const b = Math.round(start[2] + (end[2] - start[2]) * ratio);
        return `rgb(${r}, ${g}, ${b})`;
    };

    const getCellColor = (i: number, j: number, isActive: boolean) => {
        const maxIndexSum = (gridSize - 1) * 2;
        const ratio = (i + j) / maxIndexSum;

        if (isActive) {
            return interpolate(ratio, [58, 225, 101], [29, 113, 51]);
        } else {
            return interpolate(ratio, [51, 51, 51], [20, 20, 20]);
        }
    };

    return (
        <div
            ref={containerRef}
            className={`w-full max-w-[430px] ${className}`}
            style={{
                width: '100%',
                maxWidth: '430px',
                height: 'auto',
            }}
        >
            <div
                className="bg-[#141414] border border-[#1a1a1a] rounded overflow-hidden shadow-2xl"
                style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
                    gap: '1px',
                    width: '100%',
                    aspectRatio: '1 / 1',
                }}
            >
                {grid.map((rows, i) =>
                    rows.map((col, j) => (
                        <div
                            key={`${i}-${j}`}
                            style={{
                                aspectRatio: '1 / 1',
                                borderRadius: '1px',
                                backgroundColor: getCellColor(i, j, grid[i][j] === 1),
                                transition: 'background-color 0.6s ease'
                            }}
                        />
                    ))
                )}
            </div>
        </div>
    );
};

export default GameOfLifeCanvas;