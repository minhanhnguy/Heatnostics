"use client"

import { useEffect, useRef, memo } from "react"

interface MiniGridProps {
    grid: number[][]
    size: number
}

// Memoized canvas-based mini grid for efficient rendering
function MiniGridComponent({ grid, size }: MiniGridProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !grid.length) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const gridSize = grid.length
        const scale = size / gridSize

        ctx.fillStyle = '#f3f4f6'
        ctx.fillRect(0, 0, size, size)

        ctx.fillStyle = '#1f2937'
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                if (grid[y]?.[x] === 1) {
                    ctx.fillRect(x * scale, y * scale, Math.ceil(scale), Math.ceil(scale))
                }
            }
        }
    }, [grid, size])

    return (
        <canvas
            ref={canvasRef}
            width={size}
            height={size}
            className="w-full h-full"
            style={{ imageRendering: 'pixelated' }}
        />
    )
}

// Memoize to prevent re-renders when parent updates
export default memo(MiniGridComponent, (prev, next) => {
    // Only re-render if grid or size actually changed
    return prev.size === next.size && prev.grid === next.grid
})
