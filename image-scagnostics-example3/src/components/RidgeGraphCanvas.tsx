"use client"

import { useEffect, useRef } from "react"

interface Point {
    x: number
    y: number
}

interface RidgeNode {
    id: number
    position: Point
    value: number
}

interface RidgeEdge {
    from: number
    to: number
    path: Point[]
    length: number
    weight: number
}

interface RidgeGraph {
    nodes: RidgeNode[]
    edges: RidgeEdge[]
    totalLength: number
    longestPath: number
}

interface RidgeGraphCanvasProps {
    grid: number[][]
    ridgeGraph: RidgeGraph
    gridSize: number
    label?: string
}

export default function RidgeGraphCanvas({
    grid,
    ridgeGraph,
    gridSize,
    label = ""
}: RidgeGraphCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const width = canvas.width
        const height = canvas.height
        const cellW = width / gridSize
        const cellH = height / gridSize

        // Clear canvas
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, width, height)

        // Draw density field as background
        if (grid.length > 0) {
            let maxVal = 0
            for (const row of grid) {
                for (const val of row) {
                    if (val > maxVal) maxVal = val
                }
            }

            for (let y = 0; y < gridSize && y < grid.length; y++) {
                for (let x = 0; x < gridSize && x < grid[y].length; x++) {
                    const v = grid[y][x] / (maxVal || 1)
                    // Viridis-like colormap
                    const r = Math.floor(68 + v * 180)
                    const g = Math.floor(1 + v * 200)
                    const b = Math.floor(84 + v * 100)
                    ctx.fillStyle = `rgb(${Math.min(255, r)}, ${Math.min(255, g)}, ${Math.min(255, b)})`
                    ctx.fillRect(x * cellW, y * cellH, cellW + 1, cellH + 1)
                }
            }
        }

        // Draw edges (ridge lines)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.8)"
        ctx.lineWidth = 2
        for (const edge of ridgeGraph.edges) {
            if (edge.path.length < 2) continue

            ctx.beginPath()
            ctx.moveTo(edge.path[0].x * cellW + cellW / 2, edge.path[0].y * cellH + cellH / 2)
            for (let i = 1; i < edge.path.length; i++) {
                ctx.lineTo(edge.path[i].x * cellW + cellW / 2, edge.path[i].y * cellH + cellH / 2)
            }
            ctx.stroke()
        }

        // Draw nodes (local maxima)
        for (const node of ridgeGraph.nodes) {
            const cx = node.position.x * cellW + cellW / 2
            const cy = node.position.y * cellH + cellH / 2

            // Draw circle
            ctx.beginPath()
            ctx.arc(cx, cy, 6, 0, Math.PI * 2)
            ctx.fillStyle = "#ffd700"  // Gold/yellow
            ctx.fill()
            ctx.strokeStyle = "#fff"
            ctx.lineWidth = 1.5
            ctx.stroke()
        }

        // Draw label if provided
        if (label) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.6)"
            ctx.fillRect(4, 4, ctx.measureText(label).width + 12, 20)
            ctx.fillStyle = "#fff"
            ctx.font = "12px monospace"
            ctx.fillText(label, 10, 18)
        }
    }, [grid, ridgeGraph, gridSize, label])

    return (
        <canvas
            ref={canvasRef}
            width={512}
            height={512}
            className="w-full h-full"
        />
    )
}
