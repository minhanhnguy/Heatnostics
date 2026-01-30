"use client"

import { useEffect, useRef } from "react"
import type { Point, FloatGrid, Polyline } from "@/lib/types"

interface ContourCanvasProps {
    grid: FloatGrid           // Background grid (float or binary)
    contours: Polyline[]       // Marching squares contours
    convexHull?: Polyline      // Optional convex hull overlay
    gridSize: number
    showContours?: boolean
    showHull?: boolean
    colorMap?: "grayscale" | "viridis"
    label?: string
}

// Viridis colormap approximation
function viridis(t: number): [number, number, number] {
    const r = Math.floor(255 * Math.max(0, Math.min(1, 0.267 + t * (0.329 + t * (-1.177 + t * 1.581)))))
    const g = Math.floor(255 * Math.max(0, Math.min(1, 0.004 + t * (1.016 + t * (-0.564 + t * 0.328)))))
    const b = Math.floor(255 * Math.max(0, Math.min(1, 0.329 + t * (1.424 + t * (-2.086 + t * 1.060)))))
    return [r, g, b]
}

export default function ContourCanvas({
    grid,
    contours,
    convexHull,
    gridSize,
    showContours = true,
    showHull = true,
    colorMap = "viridis",
    label
}: ContourCanvasProps) {
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

        // Get container size
        const containerWidth = container.clientWidth
        const containerHeight = container.clientHeight
        const displaySize = Math.min(containerWidth, containerHeight)

        canvas.width = displaySize
        canvas.height = displaySize

        const scale = displaySize / gridSize

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

        // Draw background grid
        const imageData = ctx.createImageData(cols, rows)
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const idx = (y * cols + x) * 4
                const normalized = (grid[y][x] - min) / range

                if (colorMap === "viridis") {
                    const [r, g, b] = viridis(normalized)
                    imageData.data[idx] = r
                    imageData.data[idx + 1] = g
                    imageData.data[idx + 2] = b
                } else {
                    const v = Math.floor(normalized * 255)
                    imageData.data[idx] = v
                    imageData.data[idx + 1] = v
                    imageData.data[idx + 2] = v
                }
                imageData.data[idx + 3] = 255
            }
        }

        // Draw to offscreen canvas then scale
        const offscreen = document.createElement("canvas")
        offscreen.width = cols
        offscreen.height = rows
        const offCtx = offscreen.getContext("2d")
        if (offCtx) {
            offCtx.putImageData(imageData, 0, 0)
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(offscreen, 0, 0, displaySize, displaySize)
        }

        // Draw contours (thin lines for larger images)
        if (showContours && contours.length > 0) {
            ctx.strokeStyle = "#ffffff"
            ctx.lineWidth = 0.75
            ctx.lineCap = "round"
            ctx.lineJoin = "round"

            for (const contour of contours) {
                if (contour.length < 2) continue

                ctx.beginPath()
                ctx.moveTo(contour[0].x * scale, contour[0].y * scale)

                for (let i = 1; i < contour.length; i++) {
                    ctx.lineTo(contour[i].x * scale, contour[i].y * scale)
                }

                // Close if endpoints are close
                const first = contour[0]
                const last = contour[contour.length - 1]
                const dist = Math.sqrt((first.x - last.x) ** 2 + (first.y - last.y) ** 2)
                if (dist < 2) {
                    ctx.closePath()
                }

                ctx.stroke()
            }
        }

        // Draw convex hull (thin dashed line)
        if (showHull && convexHull && convexHull.length >= 3) {
            ctx.strokeStyle = "#ef4444"
            ctx.lineWidth = 1
            ctx.setLineDash([4, 2])

            ctx.beginPath()
            ctx.moveTo(convexHull[0].x * scale, convexHull[0].y * scale)

            for (let i = 1; i < convexHull.length; i++) {
                ctx.lineTo(convexHull[i].x * scale, convexHull[i].y * scale)
            }
            ctx.closePath()
            ctx.stroke()
            ctx.setLineDash([])
        }

    }, [grid, contours, convexHull, gridSize, showContours, showHull, colorMap])

    return (
        <div ref={containerRef} className="w-full h-full flex flex-col items-center justify-center">
            <div className="relative flex-1 w-full flex items-center justify-center">
                <canvas
                    ref={canvasRef}
                    style={{ imageRendering: "auto" }}
                />
                {label && (
                    <div className="absolute top-1 left-1 text-[10px] font-medium text-white bg-black/50 px-1.5 py-0.5">
                        {label}
                    </div>
                )}
            </div>
        </div>
    )
}
