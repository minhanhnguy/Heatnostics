"use client"

import { useEffect, useRef } from "react"
import type { BinaryGrid, Point } from "@/lib/types"

interface SkeletonCanvasProps {
    binaryGrid: BinaryGrid           // Binary mask as background
    skeleton: BinaryGrid             // Skeleton (binary)
    endpoints?: Point[]              // Skeleton endpoints (green dots)
    longestPathPoints?: Point[]      // Longest path (blue pixels)
    gridSize: number
    showSkeleton?: boolean
    showEndpoints?: boolean
    showLongestPath?: boolean
    label?: string
}

export default function SkeletonCanvas({
    binaryGrid,
    skeleton,
    endpoints = [],
    longestPathPoints = [],
    gridSize,
    showSkeleton = true,
    showEndpoints = true,
    showLongestPath = true,
    label
}: SkeletonCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container || !binaryGrid.length) return

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const rows = binaryGrid.length
        const cols = binaryGrid[0]?.length || 0

        // Get container size
        const containerWidth = container.clientWidth
        const containerHeight = container.clientHeight
        const displaySize = Math.min(containerWidth, containerHeight)

        canvas.width = displaySize
        canvas.height = displaySize

        const scale = displaySize / gridSize

        // Create a set of longest path pixels for fast lookup
        const longestPathSet = new Set<string>()
        if (showLongestPath && longestPathPoints) {
            for (const p of longestPathPoints) {
                longestPathSet.add(`${p.x},${p.y}`)
            }
        }

        // Create a set of endpoint pixels for fast lookup
        const endpointSet = new Set<string>()
        if (showEndpoints && endpoints) {
            for (const p of endpoints) {
                endpointSet.add(`${p.x},${p.y}`)
            }
        }

        // Draw everything as pixels in the imageData
        const imageData = ctx.createImageData(cols, rows)
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const idx = (y * cols + x) * 4
                const key = `${x},${y}`

                // Priority: endpoints (green) > longest path (blue) > skeleton (white) > binary mask (gray) > background (black)
                if (endpointSet.has(key)) {
                    // Green for endpoints
                    imageData.data[idx] = 0
                    imageData.data[idx + 1] = 252
                    imageData.data[idx + 2] = 67
                }
                else if (longestPathSet.has(key)) {
                    // Blue for longest path
                    imageData.data[idx] = 59
                    imageData.data[idx + 1] = 130
                    imageData.data[idx + 2] = 246
                }
                else if (showSkeleton && skeleton[y]?.[x] === 1) {
                    // White for skeleton
                    imageData.data[idx] = 255
                    imageData.data[idx + 1] = 255
                    imageData.data[idx + 2] = 255
                }
                else if (binaryGrid[y]?.[x] === 1) {
                    // Gray for binary mask foreground
                    imageData.data[idx] = 80
                    imageData.data[idx + 1] = 80
                    imageData.data[idx + 2] = 80
                }
                else {
                    // Black for background
                    imageData.data[idx] = 0
                    imageData.data[idx + 1] = 0
                    imageData.data[idx + 2] = 0
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

    }, [binaryGrid, skeleton, endpoints, longestPathPoints, gridSize, showSkeleton, showEndpoints, showLongestPath])

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
