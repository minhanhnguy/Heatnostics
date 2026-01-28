"use client"

import { useEffect, useRef } from "react"

interface FloatGridProps {
    grid: number[][]  // 2D array of floats [0, 1]
    colorMap?: "grayscale" | "viridis" | "plasma" | "heat"
    showStats?: boolean
    label?: string
}

// Color maps
const colorMaps = {
    grayscale: (t: number): [number, number, number] => {
        const v = Math.floor(t * 255)
        return [v, v, v]
    },
    viridis: (t: number): [number, number, number] => {
        // Simplified viridis approximation
        const r = Math.floor(255 * (0.267 + t * (0.329 + t * (-1.177 + t * 1.581))))
        const g = Math.floor(255 * (0.004 + t * (1.016 + t * (-0.564 + t * 0.328))))
        const b = Math.floor(255 * (0.329 + t * (1.424 + t * (-2.086 + t * 1.060))))
        return [
            Math.max(0, Math.min(255, r)),
            Math.max(0, Math.min(255, g)),
            Math.max(0, Math.min(255, b))
        ]
    },
    plasma: (t: number): [number, number, number] => {
        // Simplified plasma approximation
        const r = Math.floor(255 * (0.050 + t * (2.810 + t * (-2.420 + t * 0.560))))
        const g = Math.floor(255 * (0.030 + t * (0.090 + t * (2.090 + t * (-1.190)))))
        const b = Math.floor(255 * (0.530 + t * (1.400 + t * (-3.860 + t * 2.930))))
        return [
            Math.max(0, Math.min(255, r)),
            Math.max(0, Math.min(255, g)),
            Math.max(0, Math.min(255, b))
        ]
    },
    heat: (t: number): [number, number, number] => {
        // Black -> Red -> Yellow -> White
        if (t < 0.33) {
            return [Math.floor(t * 3 * 255), 0, 0]
        } else if (t < 0.66) {
            return [255, Math.floor((t - 0.33) * 3 * 255), 0]
        } else {
            return [255, 255, Math.floor((t - 0.66) * 3 * 255)]
        }
    }
}

export default function FloatGrid({
    grid,
    colorMap = "grayscale",
    showStats = true,
    label
}: FloatGridProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container || !grid.length) return

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const rows = grid.length
        const cols = grid[0]?.length || 0

        // Get container dimensions
        const containerWidth = container.clientWidth
        const containerHeight = container.clientHeight
        const displaySize = Math.min(containerWidth, containerHeight)

        // Set canvas size
        canvas.width = displaySize
        canvas.height = displaySize

        // Create image data
        const imageData = ctx.createImageData(cols, rows)
        const getColor = colorMaps[colorMap]

        // Find min/max for normalization
        let min = Infinity
        let max = -Infinity
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const val = grid[y][x]
                min = Math.min(min, val)
                max = Math.max(max, val)
            }
        }

        const range = max - min || 1

        // Fill image data
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const idx = (y * cols + x) * 4
                const normalized = (grid[y][x] - min) / range
                const [r, g, b] = getColor(normalized)
                imageData.data[idx] = r
                imageData.data[idx + 1] = g
                imageData.data[idx + 2] = b
                imageData.data[idx + 3] = 255
            }
        }

        // Draw to offscreen canvas at original size
        const offscreen = document.createElement("canvas")
        offscreen.width = cols
        offscreen.height = rows
        const offCtx = offscreen.getContext("2d")
        if (offCtx) {
            offCtx.putImageData(imageData, 0, 0)

            // Scale to display size with nearest neighbor for crisp pixels
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(offscreen, 0, 0, displaySize, displaySize)
        }

    }, [grid, colorMap])

    // Calculate stats
    let min = Infinity
    let max = -Infinity
    let sum = 0
    let nonZeroCount = 0

    for (const row of grid) {
        for (const val of row) {
            min = Math.min(min, val)
            max = Math.max(max, val)
            sum += val
            if (val > 0) nonZeroCount++
        }
    }

    const rows = grid.length
    const cols = grid[0]?.length || 0
    const mean = (rows * cols) > 0 ? sum / (rows * cols) : 0

    return (
        <div ref={containerRef} className="w-full h-full flex flex-col items-center justify-center">
            <div className="relative flex-1 w-full flex items-center justify-center">
                <canvas
                    ref={canvasRef}
                    style={{ imageRendering: "pixelated" }}
                />
                {label && (
                    <div className="absolute top-1 left-1 text-[10px] font-medium text-white bg-black/50 px-1.5 py-0.5">
                        {label}
                    </div>
                )}
            </div>
            {showStats && (
                <div className="w-full text-center text-xs text-gray-600 mt-3 py-2 font-mono leading-relaxed bg-gray-50 border border-gray-200">
                    {cols}×{rows} | range: [{min.toFixed(2)}, {max.toFixed(2)}]
                </div>
            )}
        </div>
    )
}
