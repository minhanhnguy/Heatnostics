"use client"

import { useEffect, useRef } from "react"

interface BinaryGridProps {
    grid: number[][]  // 2D array of 0s and 1s
    size: number      // Grid dimension (e.g., 256)
}

export default function BinaryGrid({ grid, size }: BinaryGridProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container || !grid.length) return

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        // Get container dimensions
        const containerWidth = container.clientWidth
        const containerHeight = container.clientHeight
        const displaySize = Math.min(containerWidth, containerHeight)

        // Set canvas size
        canvas.width = displaySize
        canvas.height = displaySize

        // Calculate cell size
        const cellSize = displaySize / size

        // Clear canvas
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, displaySize, displaySize)

        // Draw grid cells - pure black for 1s
        ctx.fillStyle = "#000000"
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (grid[row] && grid[row][col] === 1) {
                    ctx.fillRect(
                        Math.floor(col * cellSize),
                        Math.floor(row * cellSize),
                        Math.ceil(cellSize),
                        Math.ceil(cellSize)
                    )
                }
            }
        }

    }, [grid, size])

    // Count filled cells
    const filledCount = grid.reduce((sum, row) =>
        sum + row.reduce((rowSum, cell) => rowSum + cell, 0), 0
    )
    const totalCells = size * size
    const fillPercent = ((filledCount / totalCells) * 100).toFixed(2)

    return (
        <div ref={containerRef} className="relative w-full h-full flex flex-col items-center justify-center">
            <canvas
                ref={canvasRef}
                className="border border-gray-300"
                style={{ imageRendering: "pixelated" }}
            />
            <div className="absolute bottom-2 left-2 text-xs text-gray-500 bg-white/80 px-2 py-1 rounded">
                {size}×{size} • {filledCount.toLocaleString()} filled ({fillPercent}%)
            </div>
        </div>
    )
}
