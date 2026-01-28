"use client"

import React, { useMemo, useState } from "react"
import * as d3 from "d3"
import {
    buildHeatmapGrid,
    computeGridSupport,
    computeMorseSmale,
    computeEMDTransition,
    type GridSupportResult,
    type MorseSmaleResult,
    type EMDResult,
    type HeatmapGrid
} from "@/lib/heatnosticsUtils"

interface PMISFeature {
    properties: Record<string, any>
}

interface HeatnosticsPanelProps {
    data: PMISFeature[]
}

// Color constants
const COLORS = {
    valid: "#22c55e",
    empty: "#f3f4f6",
    boundary: "#1f2937",
    maximum: "#ef4444",
    minimum: "#3b82f6",
    saddle: "#f59e0b",
    flux: ["#10b981", "#f59e0b", "#ef4444"]
}

// ============================================================
// Grid Support Chart - with Alpha Shape Polygon
// ============================================================

// Generate polygon path around valid cells (marching squares style)
function generateAlphaPolygon(
    grid: HeatmapGrid,
    cellWidth: number,
    cellHeight: number,
    flipY: boolean = false
): string {
    if (grid.rows === 0 || grid.cols === 0) return ""

    // For each valid cell, we trace its edges that border invalid cells
    const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = []

    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            if (!grid.cells[row][col].isValid) continue

            const x = col * cellWidth
            // Flip Y if requested (so 2024 is at top)
            const displayRow = flipY ? (grid.rows - 1 - row) : row
            const y = displayRow * cellHeight

            // Check each neighbor - if invalid or out of bounds, add edge
            // Top edge (in original grid coords)
            if (row === 0 || !grid.cells[row - 1][col].isValid) {
                const edgeY = flipY ? y + cellHeight : y
                edges.push({ x1: x, y1: edgeY, x2: x + cellWidth, y2: edgeY })
            }
            // Bottom edge
            if (row === grid.rows - 1 || !grid.cells[row + 1][col].isValid) {
                const edgeY = flipY ? y : y + cellHeight
                edges.push({ x1: x, y1: edgeY, x2: x + cellWidth, y2: edgeY })
            }
            // Left edge
            if (col === 0 || !grid.cells[row][col - 1].isValid) {
                edges.push({ x1: x, y1: y, x2: x, y2: y + cellHeight })
            }
            // Right edge
            if (col === grid.cols - 1 || !grid.cells[row][col + 1].isValid) {
                edges.push({ x1: x + cellWidth, y1: y, x2: x + cellWidth, y2: y + cellHeight })
            }
        }
    }

    if (edges.length === 0) return ""

    // Convert edges to SVG path
    return edges.map(e => `M${e.x1},${e.y1} L${e.x2},${e.y2}`).join(" ")
}

const GridSupportChart: React.FC<{
    grid: HeatmapGrid
    result: GridSupportResult
    width: number
    height: number
}> = ({ grid, result, width, height }) => {
    if (grid.rows === 0 || grid.cols === 0) {
        return <div className="text-gray-400 text-sm text-center py-4">No data</div>
    }

    // Add margin to prevent clipping of boundary strokes
    const margin = 4
    const chartWidth = width - 2 * margin
    const chartHeight = height - 2 * margin

    // Use actual position ranges for X scaling
    const posRange = grid.maxPosition - grid.minPosition
    const xScale = (pos: number) => margin + ((pos - grid.minPosition) / posRange) * chartWidth
    const cellHeight = chartHeight / grid.rows

    // Compute row extents for alpha shape (for hole detection)
    const rowExtents = new Map<number, { minCol: number; maxCol: number }>()
    for (let row = 0; row < grid.rows; row++) {
        let minCol = -1
        let maxCol = -1
        for (let col = 0; col < grid.cols; col++) {
            if (grid.cells[row][col].isValid) {
                if (minCol === -1) minCol = col
                maxCol = col
            }
        }
        if (minCol !== -1) {
            rowExtents.set(row, { minCol, maxCol })
        }
    }

    // Build SVG path for alpha shape polygon
    const buildAlphaShapePath = (): string => {
        if (result.alphaShape.length === 0) return ""

        const sortedRows = [...rowExtents.keys()].sort((a, b) => a - b)
        if (sortedRows.length === 0) return ""

        // Build path points: left edge down, right edge up (with flipped Y)
        const pathPoints: string[] = []

        // Left edge (top to bottom in screen coords = oldest to newest year)
        for (let i = sortedRows.length - 1; i >= 0; i--) {
            const row = sortedRows[i]
            const extent = rowExtents.get(row)!
            const x = xScale(grid.positions[extent.minCol])
            const y = margin + (grid.rows - 1 - row) * cellHeight
            pathPoints.push(`${pathPoints.length === 0 ? 'M' : 'L'}${x},${y}`)
            pathPoints.push(`L${x},${y + cellHeight}`)
        }

        // Right edge (bottom to top)
        for (const row of sortedRows) {
            const extent = rowExtents.get(row)!
            const x = xScale(grid.positionEnds[extent.maxCol])
            const y = margin + (grid.rows - 1 - row) * cellHeight
            pathPoints.push(`L${x},${y + cellHeight}`)
            pathPoints.push(`L${x},${y}`)
        }

        pathPoints.push('Z')
        return pathPoints.join(' ')
    }

    const alphaPath = buildAlphaShapePath()

    return (
        <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Grid Support (Alpha Shape)</h3>
            <svg width={width} height={height} className="border rounded bg-gray-50">
                <g>
                    {/* First: Fill the entire alpha shape area as light red (potential hole area) */}
                    <path
                        d={alphaPath}
                        fill="#fca5a5"
                        fillOpacity={0.6}
                        stroke="none"
                    />
                    {/* Second: Overlay valid cells (data) as green on top */}
                    {grid.cells.map((row, rowIdx) =>
                        row.map((cell, colIdx) => {
                            if (!cell.isValid) return null
                            const x = xScale(grid.positions[colIdx])
                            // Use actual segment length for true geometry (matching main heatmap)
                            const segmentEnd = grid.positions[colIdx] + cell.length
                            const w = xScale(segmentEnd) - x
                            return (
                                <rect
                                    key={`${rowIdx}-${colIdx}`}
                                    x={x}
                                    y={margin + (grid.rows - 1 - rowIdx) * cellHeight}
                                    width={Math.max(w, 1)}
                                    height={cellHeight}
                                    fill={COLORS.valid}
                                    opacity={1}
                                />
                            )
                        })
                    )}
                    {/* Third: Alpha Shape polygon boundary stroke */}
                    <path
                        d={alphaPath}
                        fill="none"
                        stroke="#6366f1"
                        strokeWidth={2}
                        strokeLinejoin="round"
                    />
                </g>
            </svg>
            <div className="grid grid-cols-3 text-xs text-gray-600 mt-1 gap-1">
                <span>Porosity: {(result.porosity * 100).toFixed(1)}%</span>
                <span>Fragments: {result.fragmentation}</span>
                <span>χ: {result.eulerCharacteristic}</span>
            </div>
        </div>
    )
}

// ============================================================
// Morse-Smale Chart
// ============================================================
const MorseSmaleChart: React.FC<{
    grid: HeatmapGrid
    result: MorseSmaleResult
    width: number
    height: number
}> = ({ grid, result, width, height }) => {
    if (grid.rows === 0 || grid.cols === 0) {
        return <div className="text-gray-400 text-sm text-center py-4">No data</div>
    }

    // Add margin to match GridSupportChart and prevent clipping
    const margin = 4
    const chartWidth = width - 2 * margin
    const chartHeight = height - 2 * margin

    // Use actual position ranges for X scaling
    const posRange = grid.maxPosition - grid.minPosition
    const xScale = (pos: number) => margin + ((pos - grid.minPosition) / posRange) * chartWidth
    const cellHeight = chartHeight / grid.rows

    // Color scale for values
    const colorScale = d3.scaleSequential(d3.interpolateRdYlGn)
        .domain([grid.maxValue, grid.minValue])

    const maxima = result.criticalPoints.filter(p => p.type === "maximum")
    const minima = result.criticalPoints.filter(p => p.type === "minimum")

    return (
        <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Morse-Smale Complex</h3>
            <svg width={width} height={height} className="border rounded">
                <g>
                    {/* Value heatmap with per-cell segment widths - flip Y so 2024 is at top */}
                    {grid.cells.map((row, rowIdx) =>
                        row.map((cell, colIdx) => {
                            const x = xScale(grid.positions[colIdx])
                            // Use per-cell length if valid, otherwise fall back to column default
                            const cellLength = cell.isValid && cell.length > 0 ? cell.length : (grid.positionEnds[colIdx] - grid.positions[colIdx])
                            const w = xScale(grid.positions[colIdx] + cellLength) - x
                            return (
                                <rect
                                    key={`${rowIdx}-${colIdx}`}
                                    x={x}
                                    y={margin + (grid.rows - 1 - rowIdx) * cellHeight}
                                    width={w}
                                    height={cellHeight}
                                    fill={cell.isValid ? colorScale(cell.value) : "#f3f4f6"}
                                    opacity={cell.isValid ? 0.8 : 0.2}
                                />
                            )
                        })
                    )}
                    {/* Critical points - flip Y, use per-cell lengths */}
                    {maxima.map((p, i) => {
                        const x = xScale(grid.positions[p.col])
                        const cell = grid.cells[p.row][p.col]
                        const cellLength = cell.length > 0 ? cell.length : 0.5
                        const w = xScale(grid.positions[p.col] + cellLength) - x
                        return (
                            <circle
                                key={`max-${i}`}
                                cx={x + w / 2}
                                cy={margin + (grid.rows - 1 - p.row + 0.5) * cellHeight}
                                r={Math.min(w, cellHeight) * 0.4}
                                fill={COLORS.maximum}
                                opacity={0.9}
                            />
                        )
                    })}
                    {minima.map((p, i) => {
                        const x = xScale(grid.positions[p.col])
                        const cell = grid.cells[p.row][p.col]
                        const cellLength = cell.length > 0 ? cell.length : 0.5
                        const w = xScale(grid.positions[p.col] + cellLength) - x
                        return (
                            <circle
                                key={`min-${i}`}
                                cx={x + w / 2}
                                cy={margin + (grid.rows - 1 - p.row + 0.5) * cellHeight}
                                r={Math.min(w, cellHeight) * 0.4}
                                fill={COLORS.minimum}
                                opacity={0.9}
                            />
                        )
                    })}
                </g>
            </svg>
            <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                    Peaks: {maxima.length}
                </span>
                <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    Valleys: {minima.length}
                </span>
            </div>
        </div>
    )
}

// ============================================================
// EMD Flow Chart
// ============================================================
const EMDFlowChart: React.FC<{
    grid: HeatmapGrid
    result: EMDResult
    width: number
    height: number
}> = ({ grid, result, width, height }) => {
    if (result.yearPairFluxes.length === 0) {
        return <div className="text-gray-400 text-sm text-center py-4">No temporal data</div>
    }

    const margin = { top: 10, right: 10, bottom: 20, left: 50 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const barHeight = Math.max(4, Math.min(16, (innerHeight / result.yearPairFluxes.length) - 2))
    const maxFlux = Math.max(...result.yearPairFluxes.map(f => f.flux)) || 1

    const fluxColorScale = d3.scaleLinear<string>()
        .domain([0, maxFlux * 0.5, maxFlux])
        .range(COLORS.flux)

    return (
        <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">EMD Temporal Flow</h3>
            <svg width={width} height={height} className="border rounded">
                <g transform={`translate(${margin.left},${margin.top})`}>
                    {result.yearPairFluxes.map((pair, idx) => {
                        const y = idx * (barHeight + 2)
                        const barWidth = (pair.flux / maxFlux) * innerWidth

                        return (
                            <g key={`pair-${idx}`} transform={`translate(0,${y})`}>
                                <text x={-5} y={barHeight / 2 + 3} textAnchor="end" fontSize={8} fill="#374151">
                                    {pair.year1}→{pair.year2}
                                </text>
                                <rect
                                    x={0}
                                    y={0}
                                    width={Math.max(0, barWidth)}
                                    height={barHeight}
                                    fill={fluxColorScale(pair.flux)}
                                    rx={2}
                                />
                            </g>
                        )
                    })}
                </g>
            </svg>
            <div className="text-xs text-gray-600 mt-1 text-center">
                Avg Flux: {(result.totalFlux * 100).toFixed(1)}%
            </div>
        </div>
    )
}

// ============================================================
// Modal Component
// ============================================================
const ChartModal: React.FC<{
    isOpen: boolean
    onClose: () => void
    title: string
    children: React.ReactNode
}> = ({ isOpen, onClose, title, children }) => {
    if (!isOpen) return null

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-2xl p-6"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-800">{title}</h2>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700 text-2xl font-bold w-8 h-8 flex items-center justify-center"
                    >
                        ×
                    </button>
                </div>
                {children}
            </div>
        </div>
    )
}

// ============================================================
// Main Panel
// ============================================================
type ChartType = 'grid_support' | 'morse_smale' | 'emd_flow' | null

const HeatnosticsPanel: React.FC<HeatnosticsPanelProps> = ({ data }) => {
    const [expandedChart, setExpandedChart] = useState<ChartType>(null)

    const { grid, gridSupport, morseSmale, emdTransition } = useMemo(() => {
        // Now uses actual segment positions, not bins
        const grid = buildHeatmapGrid(data)
        return {
            grid,
            gridSupport: computeGridSupport(grid),
            morseSmale: computeMorseSmale(grid),
            emdTransition: computeEMDTransition(grid)
        }
    }, [data])

    const smallWidth = 280
    const smallHeight = 180
    const largeWidth = 700
    const largeHeight = 450

    return (
        <>
            <div className="flex flex-col gap-4">
                {/* Grid Support */}
                <div
                    className="bg-white rounded-xl shadow-lg p-4 cursor-pointer hover:shadow-xl transition-shadow"
                    onClick={() => setExpandedChart('grid_support')}
                    title="Click to enlarge"
                >
                    <GridSupportChart
                        grid={grid}
                        result={gridSupport}
                        width={smallWidth}
                        height={smallHeight}
                    />
                </div>

                {/* Morse-Smale */}
                <div
                    className="bg-white rounded-xl shadow-lg p-4 cursor-pointer hover:shadow-xl transition-shadow"
                    onClick={() => setExpandedChart('morse_smale')}
                    title="Click to enlarge"
                >
                    <MorseSmaleChart
                        grid={grid}
                        result={morseSmale}
                        width={smallWidth}
                        height={smallHeight}
                    />
                </div>

                {/* EMD Flow */}
                <div
                    className="bg-white rounded-xl shadow-lg p-4 cursor-pointer hover:shadow-xl transition-shadow"
                    onClick={() => setExpandedChart('emd_flow')}
                    title="Click to enlarge"
                >
                    <EMDFlowChart
                        grid={grid}
                        result={emdTransition}
                        width={smallWidth}
                        height={smallHeight}
                    />
                </div>
            </div>

            {/* Modals */}
            <ChartModal
                isOpen={expandedChart === 'grid_support'}
                onClose={() => setExpandedChart(null)}
                title="Grid Support (Alpha Shape)"
            >
                <GridSupportChart
                    grid={grid}
                    result={gridSupport}
                    width={largeWidth}
                    height={largeHeight}
                />
            </ChartModal>

            <ChartModal
                isOpen={expandedChart === 'morse_smale'}
                onClose={() => setExpandedChart(null)}
                title="Morse-Smale Complex"
            >
                <MorseSmaleChart
                    grid={grid}
                    result={morseSmale}
                    width={largeWidth}
                    height={largeHeight}
                />
            </ChartModal>

            <ChartModal
                isOpen={expandedChart === 'emd_flow'}
                onClose={() => setExpandedChart(null)}
                title="EMD Temporal Flow"
            >
                <EMDFlowChart
                    grid={grid}
                    result={emdTransition}
                    width={largeWidth}
                    height={largeHeight}
                />
            </ChartModal>
        </>
    )
}

export default HeatnosticsPanel
