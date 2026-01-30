"use client"

import { useEffect, useRef } from "react"
import type { Point, FloatGrid, BinaryGrid } from "@/lib/types"

interface SkeletonCanvasProps {
    dtGrid: FloatGrid           // Distance transform (float)
    skeleton: BinaryGrid         // Skeleton (binary)
    endpoints?: Point[]          // Skeleton endpoints
    junctions?: Point[]          // Skeleton junctions
    gridSize: number
    showSkeleton?: boolean
    showEndpoints?: boolean
    showJunctions?: boolean
    longestPathPoints?: Point[]
    label?: string
}

// Plasma colormap for DT
function plasma(t: number): [number, number, number] {
    const r = Math.floor(255 * Math.max(0, Math.min(1, 0.050 + t * (2.810 + t * (-2.420 + t * 0.560)))))
    const g = Math.floor(255 * Math.max(0, Math.min(1, 0.030 + t * (0.090 + t * (2.090 + t * (-1.190))))))
    const b = Math.floor(255 * Math.max(0, Math.min(1, 0.530 + t * (1.400 + t * (-3.860 + t * 2.930)))))
    return [r, g, b]
}

export default function SkeletonCanvas({
    dtGrid,
    skeleton,
    endpoints = [],
    junctions = [],
    gridSize,
    showSkeleton = true,
    showEndpoints = true,
    showJunctions = true,
    longestPathPoints = [],
    label
}: SkeletonCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container || !dtGrid.length) return

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const rows = dtGrid.length
        const cols = dtGrid[0]?.length || 0

        // Get container size
        const containerWidth = container.clientWidth
        const containerHeight = container.clientHeight
        const displaySize = Math.min(containerWidth, containerHeight)

        canvas.width = displaySize
        canvas.height = displaySize

        const scale = displaySize / gridSize

        // Find max DT value for normalization
        let maxDT = 0
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                maxDT = Math.max(maxDT, dtGrid[y][x])
            }
        }

        // Draw DT heatmap
        const imageData = ctx.createImageData(cols, rows)
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const idx = (y * cols + x) * 4
                const normalized = maxDT > 0 ? dtGrid[y][x] / maxDT : 0
                const [r, g, b] = plasma(normalized)

                // Overlay skeleton in white
                if (showSkeleton && skeleton[y]?.[x] === 1) {
                    imageData.data[idx] = 255
                    imageData.data[idx + 1] = 255
                    imageData.data[idx + 2] = 255
                } else {
                    imageData.data[idx] = r
                    imageData.data[idx + 1] = g
                    imageData.data[idx + 2] = b
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

        // Draw longest path (Blue line)
        if (longestPathPoints && longestPathPoints.length > 0) {
            ctx.strokeStyle = "#3b82f6" // Blue-500
            ctx.lineWidth = 2
            ctx.lineJoin = "round"
            ctx.beginPath()

            longestPathPoints.forEach((p, i) => {
                const x = p.x * scale
                const y = p.y * scale
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
            })
            ctx.stroke()
        }

        // Draw junctions (red pixels)
        if (showJunctions && junctions.length > 0) {
            ctx.fillStyle = "#ff0000"

            for (const jp of junctions) {
                ctx.fillRect(
                    Math.floor(jp.x * scale),
                    Math.floor(jp.y * scale),
                    Math.ceil(scale),
                    Math.ceil(scale)
                )
            }
        }

        // Draw endpoints (cyan pixels)
        if (showEndpoints && endpoints.length > 0) {
            ctx.fillStyle = "#00fc43"

            for (const ep of endpoints) {
                const x = ep.x * scale
                const y = ep.y * scale
                ctx.fillRect(x - 2, y - 2, 4, 4)
            }
        }

    }, [dtGrid, skeleton, endpoints, junctions, gridSize, showSkeleton, showEndpoints, showJunctions, longestPathPoints])

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
        </div>
    )
}
