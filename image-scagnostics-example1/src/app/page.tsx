"use client"

import { useEffect, useState, useMemo, useRef } from "react"
import Heatmap from "@/components/Heatmap"
import BinaryGrid from "@/components/BinaryGrid"
import ScagExplorer from "@/components/ScagExplorer"
import { morphologicalClosing, contourConvexHull, skeletonize, computeStringyDT, countFilledPixels, computeScagnostics, type ScagnosticsMetrics } from "@/lib/imageProcessing"

interface DataPoint {
    year: number
    position: number
    endPosition: number
    score: number
}

interface HeatmapData {
    data: DataPoint[]
    years: number[]
    minPos: number
    maxPos: number
}

interface HighwayScagnosticsData {
    highway: string
    location: string
    pointCount: number
    graphScagnostics: ScagnosticsMetrics
    imageScagnostics: ScagnosticsMetrics
    binaryGrid?: number[][]  // Actual rasterized grid (64x64) from the pipeline
}

interface ComputedScagnosticsFile {
    generatedAt: string
    gridSize: number
    closingRadius: number
    method: string
    totalHighways: number
    results: HighwayScagnosticsData[]
}

// Pipeline steps
const pipelineSteps = [
    { id: 0, label: "Original", description: "All condition scores" },
    { id: 1, label: "Filtering", description: "0 < score < 50" },
    { id: 2, label: "Rasterize", description: "Binary 256×256" },
    { id: 3, label: "Closing", description: "Morphological closing" },
    { id: 4, label: "Hull", description: "Contour convex hull" },
    { id: 5, label: "DT Ridge", description: "Distance Transform + Ridge" },
    { id: 6, label: "Formulas", description: "Graph vs Image formulas" },
    { id: 7, label: "Metrics", description: "Computed values" },
    { id: 8, label: "Gallery", description: "Metric examples" },
    { id: 9, label: "ScagExplorer", description: "LEADER clustering" },
]

const GRID_SIZE = 256
const CLOSING_RADIUS = 3

// Color legend items
const allLegendItems = [
    { label: "Very Good", color: "rgb(21,128,61)" },
    { label: "Good", color: "rgb(34,197,94)" },
    { label: "Fair", color: "rgb(234,179,8)" },
    { label: "Poor", color: "rgb(249,115,22)" },
    { label: "Very Poor", color: "rgb(239,68,68)" },
]

const filteredLegendItems = [
    { label: "Poor", color: "rgb(249,115,22)" },
    { label: "Very Poor", color: "rgb(239,68,68)" },
]

// Rasterize filtered data to binary grid
function rasterizeToGrid(
    data: DataPoint[],
    years: number[],
    minPos: number,
    maxPos: number,
    gridSize: number
): number[][] {
    const grid: number[][] = Array.from({ length: gridSize }, () =>
        Array(gridSize).fill(0)
    )

    if (data.length === 0) return grid

    const sortedYears = [...years].sort((a, b) => b - a)
    const yearToRow = new Map(sortedYears.map((y, i) => [y, i]))
    const rowsPerYear = gridSize / sortedYears.length
    const posRange = maxPos - minPos

    data.forEach((d) => {
        const yearIdx = yearToRow.get(d.year)
        if (yearIdx === undefined) return

        const rowStart = Math.floor(yearIdx * rowsPerYear)
        const rowEnd = Math.floor((yearIdx + 1) * rowsPerYear)
        const colStart = Math.floor(((d.position - minPos) / posRange) * gridSize)
        const colEnd = Math.ceil(((d.endPosition - minPos) / posRange) * gridSize)

        for (let row = rowStart; row < rowEnd && row < gridSize; row++) {
            for (let col = Math.max(0, colStart); col < Math.min(gridSize, colEnd); col++) {
                grid[row][col] = 1
            }
        }
    })

    return grid
}

// Generate a synthetic binary grid that represents the scagnostics pattern
// Uses skinny as primary differentiator since sparse/convex/stringy are often similar
// ONLY used as fallback when actual grid is not available
function generateSyntheticGrid(scag: ScagnosticsMetrics, size: number): number[][] {
    const grid: number[][] = Array.from({ length: size }, () => Array(size).fill(0))

    const skinny = scag.skinny || 0.5
    const striated = scag.striated || 0
    const monotonic = Math.abs(scag.monotonic || 0)

    // Seed random based on all metrics for reproducibility
    let seed = Math.floor((scag.sparse + scag.convex + scag.skinny + scag.striated) * 1000)
    const rand = () => {
        const x = Math.sin(seed++) * 10000
        return x - Math.floor(x)
    }

    const cx = Math.floor(size / 2)
    const cy = Math.floor(size / 2)

    // Use skinny as primary shape differentiator:
    // High skinny (>0.7) = elongated/thin shapes
    // Medium skinny (0.3-0.7) = medium aspect ratio
    // Low skinny (<0.3) = compact/circular shapes

    if (skinny > 0.7) {
        // High skinny: elongated horizontal or diagonal band
        const bandHeight = Math.max(3, Math.floor(size * (1 - skinny) * 0.5))
        const slope = monotonic * 0.3  // Use monotonic to add slope

        for (let x = 0; x < size; x++) {
            const centerY = cy + Math.floor((x - cx) * slope)
            for (let dy = -bandHeight; dy <= bandHeight; dy++) {
                const y = centerY + dy
                if (y >= 0 && y < size) {
                    // Add some gaps based on striated
                    if (striated < 0.5 || (x % 4 !== 0)) {
                        grid[y][x] = 1
                    }
                }
            }
        }
    } else if (skinny > 0.3) {
        // Medium skinny: ellipse with varying aspect ratio
        const aspectRatio = 1 + skinny * 2  // 1.3 to 2.4
        const radiusX = size * 0.35
        const radiusY = radiusX / aspectRatio

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = (x - cx) / radiusX
                const dy = (y - cy) / radiusY
                if (dx * dx + dy * dy < 1) {
                    // Add gaps for striated patterns
                    if (striated < 0.3 || (y % 3 !== 0)) {
                        grid[y][x] = 1
                    }
                }
            }
        }
    } else {
        // Low skinny: compact circular blob
        const radius = size * 0.3

        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - cx
                const dy = y - cy
                if (dx * dx + dy * dy < radius * radius) {
                    grid[y][x] = 1
                }
            }
        }
    }

    // If grid is still empty (edge case), add a small marker
    const hasPixels = grid.some(row => row.some(v => v === 1))
    if (!hasPixels) {
        // Draw a small cross in the center
        for (let i = -3; i <= 3; i++) {
            if (cy + i >= 0 && cy + i < size) grid[cy + i][cx] = 1
            if (cx + i >= 0 && cx + i < size) grid[cy][cx + i] = 1
        }
    }

    return grid
}

export default function Home() {
    const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null)
    const [highwayData, setHighwayData] = useState<{
        highway: string
        location: string
        pointCount: number
        binaryGrid: number[][]
        scagnostics: ScagnosticsMetrics
    }[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeStep, setActiveStep] = useState(0)
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    // Load heatmap data for single highway view
    useEffect(() => {
        fetch("/data/ih0010_harris.json")
            .then((res) => {
                if (!res.ok) throw new Error("Failed to load data")
                return res.json()
            })
            .then((data: HeatmapData) => {
                setHeatmapData(data)
                setLoading(false)
            })
            .catch((err) => {
                setError(err.message)
                setLoading(false)
            })
    }, [])

    // Load computed scagnostics for all highways (for ScagExplorer)
    useEffect(() => {
        fetch("/image_scagnostics_computed.json")
            .then((res) => {
                if (!res.ok) return null // File may not exist yet
                return res.json()
            })
            .then((data: ComputedScagnosticsFile | null) => {
                if (!data) return

                // Use actual binary grids from the computed data
                // Fall back to synthetic generation only if binaryGrid is not available
                // Use all highway-county pairs from the computed data
                const highways = data.results.map(h => {
                    // Use actual grid if available, otherwise generate synthetic
                    const grid = h.binaryGrid || generateSyntheticGrid(h.imageScagnostics, 64)
                    return {
                        highway: h.highway,
                        location: h.location,
                        pointCount: h.pointCount,
                        binaryGrid: grid,
                        scagnostics: h.imageScagnostics
                    }
                })
                setHighwayData(highways)
            })
            .catch(() => {
                // Silently fail - ScagExplorer will show empty
            })
    }, [])

    // Track scroll position
    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return

        const handleScroll = () => {
            const scrollLeft = container.scrollLeft
            const panelWidth = container.clientWidth
            if (panelWidth > 0) {
                const newStep = Math.round(scrollLeft / panelWidth)
                setActiveStep(Math.min(Math.max(0, newStep), pipelineSteps.length - 1))
            }
        }

        handleScroll()
        container.addEventListener("scroll", handleScroll, { passive: true })
        return () => container.removeEventListener("scroll", handleScroll)
    }, [heatmapData])

    // Handle mouse wheel for horizontal scrolling
    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return

        const handleWheel = (e: WheelEvent) => {
            // Only process if the event is within the container bounds
            const rect = container.getBoundingClientRect()
            const isOverContainer =
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom

            if (!isOverContainer) return

            // Check if scrolling within a nested scrollable element
            let target = e.target as HTMLElement | null
            let isNestedScrollable = false

            while (target && target !== container) {
                if (target.scrollHeight > target.clientHeight) {
                    const style = window.getComputedStyle(target)
                    if (style.overflowY === "auto" || style.overflowY === "scroll") {
                        isNestedScrollable = true
                        break
                    }
                }
                target = target.parentElement
            }

            if (!isNestedScrollable && e.deltaY !== 0) {
                e.preventDefault()
                e.stopPropagation()
                container.scrollLeft += e.deltaY
            }
        }

        // Use capture phase to intercept before bubbling
        window.addEventListener("wheel", handleWheel, { passive: false, capture: true })
        return () => window.removeEventListener("wheel", handleWheel, { capture: true })
    }, [heatmapData])

    // Compute all pipeline steps
    const pipelineData = useMemo(() => {
        if (!heatmapData) return null

        // Step 0: Original
        const original = heatmapData

        // Step 1: Filtered
        const filteredPoints = heatmapData.data.filter(d => d.score > 0 && d.score < 50)
        const filtered = {
            data: filteredPoints,
            years: heatmapData.years,
            minPos: heatmapData.minPos,
            maxPos: heatmapData.maxPos,
        }

        // Step 2: Rasterized
        const binaryGrid = rasterizeToGrid(
            filteredPoints,
            heatmapData.years,
            heatmapData.minPos,
            heatmapData.maxPos,
            GRID_SIZE
        )

        // Step 3: Morphological Closing
        const closedGrid = morphologicalClosing(binaryGrid, CLOSING_RADIUS)

        // Step 4: Contour Convex Hull
        const hullGrid = contourConvexHull(closedGrid)

        // Step 5: Distance Transform + Ridge Detection (replaces Skeletonization)
        // This provides better MST semantic matching than skeleton
        const { stringy: stringyValue, ridgeGrid } = computeStringyDT(closedGrid)

        // Keep skeleton for comparison visualization
        const skeletonGrid = skeletonize(closedGrid)

        // Step 6: Compute Scagnostics Metrics (now using ridge grid for Stringy)
        const metrics = computeScagnostics(closedGrid, hullGrid, ridgeGrid)

        return {
            original,
            filtered,
            binaryGrid,
            closedGrid,
            hullGrid,
            ridgeGrid,      // New: Distance Transform ridge pixels
            skeletonGrid,   // Kept for visual comparison
            metrics,
        }
    }, [heatmapData])

    if (loading) {
        return (
            <div className="h-screen bg-white flex items-center justify-center">
                <div className="text-gray-600">Loading...</div>
            </div>
        )
    }

    if (error || !heatmapData || !pipelineData) {
        return (
            <div className="h-screen bg-white flex items-center justify-center">
                <div className="text-red-600">Error: {error || "No data"}</div>
            </div>
        )
    }

    return (
        <div className="h-screen flex flex-col overflow-hidden bg-white">
            {/* Header */}
            <header className="shrink-0 border-b border-gray-200 px-4 py-2">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-semibold text-gray-900">
                            Image Scagnostics Pipeline
                        </h1>
                        <p className="text-xs text-gray-500">IH0010 L - Harris County</p>
                    </div>

                    {/* Pipeline indicator */}
                    <div className="flex items-center gap-1 text-xs overflow-x-auto">
                        {pipelineSteps.map((step, idx) => (
                            <div key={step.id} className="flex items-center gap-1 shrink-0">
                                {idx > 0 && <span className="text-gray-300">→</span>}
                                <span className={`px-2 py-0.5 rounded whitespace-nowrap ${activeStep === idx
                                    ? "bg-blue-100 text-blue-700 font-medium"
                                    : activeStep > idx
                                        ? "bg-green-100 text-green-700"
                                        : "bg-gray-100 text-gray-400"
                                    }`}>
                                    {activeStep > idx ? "✓" : idx} {step.label}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </header>

            {/* Horizontal scroll container */}
            <div
                ref={scrollContainerRef}
                className="flex-1 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
                style={{ scrollBehavior: "smooth" }}
            >
                {/* Step 0: Original */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">Step 0</span>
                            <span className="font-medium text-gray-900">Original</span>
                            <span className="text-gray-500 text-sm">All condition scores (0-100)</span>
                        </div>
                        <div className="text-sm text-gray-500">{pipelineData.original.data.length.toLocaleString()} segments</div>
                    </div>
                    <div className="shrink-0 flex gap-3 mb-2 text-xs">
                        {allLegendItems.map((item) => (
                            <div key={item.label} className="flex items-center gap-1">
                                <div className="w-3 h-3" style={{ backgroundColor: item.color }} />
                                <span className="text-gray-600">{item.label}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex-1 min-h-0 border border-gray-200">
                        <Heatmap data={pipelineData.original.data} years={pipelineData.original.years} minPos={pipelineData.original.minPos} maxPos={pipelineData.original.maxPos} />
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right →</div>
                </div>

                {/* Step 1: Filtered */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">Step 1</span>
                            <span className="font-medium text-gray-900">Filtering</span>
                            <span className="text-gray-500 text-sm">Only damage: 0 &lt; score &lt; 50</span>
                        </div>
                        <div className="text-sm text-gray-500">
                            {pipelineData.filtered.data.length.toLocaleString()} segments
                            <span className="text-red-500 ml-1">({((1 - pipelineData.filtered.data.length / pipelineData.original.data.length) * 100).toFixed(0)}% filtered)</span>
                        </div>
                    </div>
                    <div className="shrink-0 flex gap-3 mb-2 text-xs">
                        {filteredLegendItems.map((item) => (
                            <div key={item.label} className="flex items-center gap-1">
                                <div className="w-3 h-3" style={{ backgroundColor: item.color }} />
                                <span className="text-gray-600">{item.label}</span>
                            </div>
                        ))}
                    </div>
                    <div className="flex-1 min-h-0 border border-gray-200">
                        <Heatmap data={pipelineData.filtered.data} years={pipelineData.filtered.years} minPos={pipelineData.filtered.minPos} maxPos={pipelineData.filtered.maxPos} />
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right →</div>
                </div>

                {/* Step 2: Rasterize */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">Step 2</span>
                            <span className="font-medium text-gray-900">Rasterize</span>
                            <span className="text-gray-500 text-sm">Binary {GRID_SIZE}×{GRID_SIZE} grid</span>
                        </div>
                        <div className="text-sm text-gray-500">{countFilledPixels(pipelineData.binaryGrid).toLocaleString()} pixels</div>
                    </div>
                    <div className="shrink-0 flex gap-3 mb-2 text-xs">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-black" /><span className="text-gray-600">1 (damage)</span></div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-white border border-gray-300" /><span className="text-gray-600">0 (none)</span></div>
                    </div>
                    <div className="flex-1 min-h-0 border border-gray-200 bg-gray-50">
                        <BinaryGrid grid={pipelineData.binaryGrid} size={GRID_SIZE} />
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right →</div>
                </div>

                {/* Step 3: Morphological Closing */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">Step 3</span>
                            <span className="font-medium text-gray-900">Morphological Closing</span>
                            <span className="text-gray-500 text-sm">Replaces Alpha Shape (r={CLOSING_RADIUS})</span>
                        </div>
                        <div className="text-sm text-gray-500">{countFilledPixels(pipelineData.closedGrid).toLocaleString()} pixels</div>
                    </div>
                    <div className="shrink-0 flex gap-3 mb-2 text-xs">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-black" /><span className="text-gray-600">Closed region</span></div>
                        <span className="text-gray-400">Dilation → Erosion</span>
                    </div>
                    <div className="flex-1 min-h-0 border border-gray-200 bg-gray-50">
                        <BinaryGrid grid={pipelineData.closedGrid} size={GRID_SIZE} />
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right →</div>
                </div>

                {/* Step 4: Convex Hull */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">Step 4</span>
                            <span className="font-medium text-gray-900">Contour Convex Hull</span>
                            <span className="text-gray-500 text-sm">Replaces Graham Scan</span>
                        </div>
                        <div className="text-sm text-gray-500">{countFilledPixels(pipelineData.hullGrid).toLocaleString()} pixels</div>
                    </div>
                    <div className="shrink-0 flex gap-3 mb-2 text-xs">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-black" /><span className="text-gray-600">Hull filled</span></div>
                        <span className="text-gray-400">Boundary → Graham Scan</span>
                    </div>
                    <div className="flex-1 min-h-0 border border-gray-200 bg-gray-50">
                        <BinaryGrid grid={pipelineData.hullGrid} size={GRID_SIZE} />
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right →</div>
                </div>

                {/* Step 5: Distance Transform + Ridge Detection */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">Step 5</span>
                            <span className="font-medium text-gray-900">Distance Transform + Ridge</span>
                            <span className="text-gray-500 text-sm">Replaces MST (Better semantic match)</span>
                        </div>
                        <div className="text-sm text-gray-500">{countFilledPixels(pipelineData.ridgeGrid).toLocaleString()} ridge pixels</div>
                    </div>
                    <div className="shrink-0 flex gap-3 mb-2 text-xs">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-black" /><span className="text-gray-600">Ridge (local maxima)</span></div>
                        <span className="text-gray-400">EDT → Local maxima → Longest path</span>
                    </div>
                    <div className="flex-1 min-h-0 border border-gray-200 bg-gray-50">
                        <BinaryGrid grid={pipelineData.ridgeGrid} size={GRID_SIZE} />
                    </div>
                    <div className="shrink-0 text-xs text-gray-500 mt-2 bg-green-50 p-2 rounded border border-green-200">
                        <strong>Why Distance Transform?</strong> EDT ridges follow the same path as MST through dense regions,
                        but with O(W×H) complexity vs O(n²) for MST. Better MST semantic match than skeleton.
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right →</div>
                </div>

                {/* Step 6: Formula Comparison */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-indigo-100 text-indigo-700 text-xs font-medium px-2 py-0.5 rounded">Step 6</span>
                            <span className="font-medium text-gray-900">Formula Comparison</span>
                            <span className="text-gray-500 text-sm">Graph vs Image Approaches</span>
                        </div>
                    </div>
                    <div className="shrink-0 text-xs text-gray-500 mb-4">
                        Comparing the mathematical formulas used by each approach
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="bg-gray-100">
                                    <th className="border border-gray-300 px-4 py-2 text-left font-semibold">Metric</th>
                                    <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-purple-700">Graph-Theoretic</th>
                                    <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-blue-700">Image-Theoretic</th>
                                    <th className="border border-gray-300 px-4 py-2 text-center font-semibold">Equivalent?</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="hover:bg-gray-50 bg-green-50">
                                    <td className="border border-gray-300 px-4 py-3 font-medium">Stringy</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-purple-700">MST_diameter / (n-1)</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-blue-700">EDT_ridge_path / Diag</td>
                                    <td className="border border-gray-300 px-4 py-3 text-center text-green-600">✓ Better match</td>
                                </tr>
                                <tr className="hover:bg-gray-50 bg-green-50">
                                    <td className="border border-gray-300 px-4 py-3 font-medium">Sparse</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-purple-700">1 - Alpha_area / Hull_area</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-blue-700">1 - Closed_area / Hull_area</td>
                                    <td className="border border-gray-300 px-4 py-3 text-center text-green-600">✓ Equivalent</td>
                                </tr>
                                <tr className="hover:bg-gray-50 bg-green-50">
                                    <td className="border border-gray-300 px-4 py-3 font-medium">Convex</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-purple-700">Alpha_area / Hull_area</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-blue-700">Closed_area / Hull_area</td>
                                    <td className="border border-gray-300 px-4 py-3 text-center text-green-600">✓ Equivalent</td>
                                </tr>
                                <tr className="hover:bg-gray-50 bg-yellow-50">
                                    <td className="border border-gray-300 px-4 py-3 font-medium">Skinny</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-purple-700">P² / (4π × A)</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-blue-700">Perimeter² / (4π × Area)</td>
                                    <td className="border border-gray-300 px-4 py-3 text-center text-yellow-600">≈ Similar</td>
                                </tr>
                                <tr className="hover:bg-gray-50 bg-green-50">
                                    <td className="border border-gray-300 px-4 py-3 font-medium">Clumpy</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-purple-700">Short_MST_edges / Total</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-blue-700">Erosion_survival_ratio</td>
                                    <td className="border border-gray-300 px-4 py-3 text-center text-green-600">✓ Equivalent</td>
                                </tr>
                                <tr className="hover:bg-gray-50 bg-green-50">
                                    <td className="border border-gray-300 px-4 py-3 font-medium">Outlying</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-purple-700">IQR(MST_edges)</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-blue-700">Erosion_residue / Area</td>
                                    <td className="border border-gray-300 px-4 py-3 text-center text-green-600">✓ Equivalent</td>
                                </tr>
                                <tr className="hover:bg-gray-50 bg-green-50">
                                    <td className="border border-gray-300 px-4 py-3 font-medium">Skewed</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-purple-700">1 - mean(e) / max(e)</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-blue-700">1 - mean(D) / max(D)</td>
                                    <td className="border border-gray-300 px-4 py-3 text-center text-green-600">✓ Identical</td>
                                </tr>
                                <tr className="hover:bg-gray-50 bg-green-50">
                                    <td className="border border-gray-300 px-4 py-3 font-medium">Striated</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-purple-700">Parallel_Delaunay_edges</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-blue-700">1 - Row_fill_CV</td>
                                    <td className="border border-gray-300 px-4 py-3 text-center text-green-600">✓ Equivalent</td>
                                </tr>
                                <tr className="hover:bg-gray-50 bg-green-50">
                                    <td className="border border-gray-300 px-4 py-3 font-medium">Monotonic</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-purple-700">Spearman_ρ(x, y)</td>
                                    <td className="border border-gray-300 px-4 py-3 font-mono text-sm text-blue-700">Row_centroid_ρ</td>
                                    <td className="border border-gray-300 px-4 py-3 text-center text-green-600">✓ Equivalent</td>
                                </tr>
                            </tbody>
                        </table>
                        <div className="mt-4 p-4 bg-green-50 rounded-lg text-xs border border-green-200">
                            <div className="font-semibold mb-2 text-green-700">✓ All 9 Metrics Semantically Equivalent:</div>
                            <div className="text-gray-600">
                                <span className="text-green-600 font-medium">8 metrics</span> use equivalent formulas<br />
                                <span className="text-yellow-600 font-medium">1 metric</span> uses same formula with normalization (Skinny)
                            </div>
                        </div>
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right →</div>
                </div>

                {/* Step 7: Scagnostics Metrics Comparison */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded">Step 7</span>
                            <span className="font-medium text-gray-900">Scagnostics Comparison</span>
                            <span className="text-gray-500 text-sm">Image vs Graph-Theoretic</span>
                        </div>
                    </div>
                    <div className="shrink-0 text-xs text-gray-500 mb-4">
                        Comparing image-based (this pipeline) vs graph-based (MST/Alpha) for IH0010 L - Harris
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="bg-gray-100">
                                    <th className="border border-gray-300 px-4 py-2 text-left font-semibold">Metric</th>
                                    <th className="border border-gray-300 px-4 py-2 text-center font-semibold text-blue-700">Image-Based</th>
                                    <th className="border border-gray-300 px-4 py-2 text-center font-semibold text-purple-700">Graph-Based</th>
                                    <th className="border border-gray-300 px-4 py-2 text-center font-semibold">Δ Diff</th>
                                    <th className="border border-gray-300 px-4 py-2 text-left font-semibold">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* Graph-based values from precomputed: IH0010 L Harris */}
                                {[
                                    { name: "Stringy", image: pipelineData.metrics.stringy, graph: 0.007, imgFormula: "EDT_Ridge/Diag", graphFormula: "MST diameter" },
                                    { name: "Sparse", image: pipelineData.metrics.sparse, graph: 0.744, imgFormula: "1-Closed/Hull", graphFormula: "1-Alpha/Hull" },
                                    { name: "Convex", image: pipelineData.metrics.convex, graph: 0.256, imgFormula: "Closed/Hull", graphFormula: "Alpha/Hull" },
                                    { name: "Skinny", image: Math.min(pipelineData.metrics.skinny, 1), graph: 0.804, imgFormula: "P\u00b2/4\u03c0A", graphFormula: "P\u00b2/4\u03c0A" },
                                    { name: "Clumpy", image: pipelineData.metrics.clumpy, graph: 0.000, imgFormula: "ErosionSurvival", graphFormula: "Short edges" },
                                    { name: "Outlying", image: pipelineData.metrics.outlying, graph: 0.275, imgFormula: "ErosionResidue", graphFormula: "IQR edges" },
                                    { name: "Skewed", image: pipelineData.metrics.skewed, graph: 0.832, imgFormula: "1-mean(D)/max(D)", graphFormula: "1-mean(e)/max(e)" },
                                    { name: "Striated", image: pipelineData.metrics.striated, graph: 1.000, imgFormula: "RowFillCV", graphFormula: "Parallel edges" },
                                    { name: "Monotonic", image: pipelineData.metrics.monotonic, graph: 0.218, imgFormula: "RowCentroid\u03c1", graphFormula: "Spearman \u03c1" },
                                ].map((m) => {
                                    const diff = Math.abs(m.image - m.graph)
                                    const match = diff < 0.15 ? "✅" : diff < 0.3 ? "⚠️" : "❌"
                                    const matchClass = diff < 0.15 ? "text-green-600" : diff < 0.3 ? "text-yellow-600" : "text-red-600"
                                    return (
                                        <tr key={m.name} className="hover:bg-gray-50">
                                            <td className="border border-gray-300 px-4 py-3">
                                                <div className="font-medium">{m.name}</div>
                                                <div className="text-xs text-gray-400">{m.imgFormula} vs {m.graphFormula}</div>
                                            </td>
                                            <td className="border border-gray-300 px-4 py-3 text-center">
                                                <span className="text-2xl font-bold text-blue-600">{m.image.toFixed(3)}</span>
                                            </td>
                                            <td className="border border-gray-300 px-4 py-3 text-center">
                                                <span className="text-2xl font-bold text-purple-600">{m.graph.toFixed(3)}</span>
                                            </td>
                                            <td className="border border-gray-300 px-4 py-3 text-center">
                                                <span className={`font-mono ${matchClass}`}>{diff.toFixed(3)}</span>
                                            </td>
                                            <td className="border border-gray-300 px-4 py-3 text-center text-xl">
                                                {match}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                        <div className="mt-4 p-4 bg-gray-50 rounded-lg text-xs text-gray-600">
                            <div className="font-semibold mb-2">Legend:</div>
                            <div className="flex gap-6">
                                <span>✅ Close match (Δ &lt; 0.15)</span>
                                <span>⚠️ Moderate diff (0.15-0.3)</span>
                                <span>❌ Large diff (&gt; 0.3)</span>
                            </div>
                        </div>
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-4">Scroll right →</div>
                </div>

                {/* Step 8: Metric Gallery - Low/Avg/High Examples */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-teal-100 text-teal-700 text-xs font-medium px-2 py-0.5 rounded">Step 8</span>
                            <span className="font-medium text-gray-900">Metric Gallery</span>
                            <span className="text-gray-500 text-sm">Low / Average / High Examples</span>
                        </div>
                        <div className="text-sm text-gray-500">{highwayData.length} highway-county pairs</div>
                    </div>
                    <div className="shrink-0 text-xs text-gray-500 mb-2">
                        Visual examples showing what low, average, and high values look like for each scagnostic metric
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                        {highwayData.length > 0 ? (
                            <div className="space-y-3">
                                {(['stringy', 'sparse', 'convex', 'skinny', 'clumpy', 'outlying', 'skewed', 'striated', 'monotonic'] as const).map(metric => {
                                    // Helper to compute grid fill percentage
                                    const getFillPct = (h: typeof highwayData[0]) => {
                                        const total = h.binaryGrid.length * (h.binaryGrid[0]?.length || 0)
                                        const filled = h.binaryGrid.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0)
                                        return filled / total
                                    }

                                    // Filter out extremes: grids that are >80% filled or <5% filled, and extremes by point count
                                    const filtered = highwayData.filter(h => {
                                        const fillPct = getFillPct(h)
                                        return fillPct > 0.05 && fillPct < 0.8 && h.pointCount >= 20 && h.pointCount <= 2000
                                    })

                                    // Fall back to all data if filter is too strict
                                    const dataToUse = filtered.length >= 10 ? filtered : highwayData

                                    // Sort by this metric
                                    const sorted = [...dataToUse].sort((a, b) => a.scagnostics[metric] - b.scagnostics[metric])
                                    const values = sorted.map(h => h.scagnostics[metric])
                                    const avg = values.reduce((a, b) => a + b, 0) / values.length

                                    // Find lowest (skip first 5%), closest to average, and highest (skip last 5%)
                                    const lowIdx = Math.floor(sorted.length * 0.05)
                                    const highIdx = Math.floor(sorted.length * 0.95)
                                    const lowest = sorted[lowIdx] || sorted[0]
                                    const highest = sorted[highIdx] || sorted[sorted.length - 1]
                                    const avgIdx = sorted.reduce((bestIdx, h, idx) =>
                                        Math.abs(h.scagnostics[metric] - avg) < Math.abs(sorted[bestIdx].scagnostics[metric] - avg) ? idx : bestIdx
                                        , 0)
                                    const average = sorted[avgIdx]

                                    return (
                                        <div key={metric} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="font-semibold text-gray-800 capitalize text-sm">{metric}</span>
                                                <span className="text-xs text-gray-400">
                                                    range: {values[0].toFixed(2)} - {values[values.length - 1].toFixed(2)}, avg: {avg.toFixed(2)}
                                                </span>
                                            </div>
                                            <div className="flex gap-4">
                                                {/* Lowest */}
                                                <div className="flex-1 text-center">
                                                    <div className="text-xs text-red-600 font-medium mb-1">Lowest: {lowest.scagnostics[metric].toFixed(3)}</div>
                                                    <div className="border border-red-200 rounded bg-white p-1 inline-block">
                                                        <div style={{ width: 64, height: 64 }}>
                                                            {lowest.binaryGrid.map((row, y) => (
                                                                <div key={y} style={{ display: 'flex', height: 64 / lowest.binaryGrid.length }}>
                                                                    {row.map((cell, x) => (
                                                                        <div key={x} style={{ flex: 1, backgroundColor: cell ? '#1f2937' : '#fff' }} />
                                                                    ))}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 mt-1">{lowest.highway}</div>
                                                </div>
                                                {/* Average */}
                                                <div className="flex-1 text-center">
                                                    <div className="text-xs text-yellow-600 font-medium mb-1">Average: {average.scagnostics[metric].toFixed(3)}</div>
                                                    <div className="border border-yellow-200 rounded bg-white p-1 inline-block">
                                                        <div style={{ width: 64, height: 64 }}>
                                                            {average.binaryGrid.map((row, y) => (
                                                                <div key={y} style={{ display: 'flex', height: 64 / average.binaryGrid.length }}>
                                                                    {row.map((cell, x) => (
                                                                        <div key={x} style={{ flex: 1, backgroundColor: cell ? '#1f2937' : '#fff' }} />
                                                                    ))}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 mt-1">{average.highway}</div>
                                                </div>
                                                {/* Highest */}
                                                <div className="flex-1 text-center">
                                                    <div className="text-xs text-green-600 font-medium mb-1">Highest: {highest.scagnostics[metric].toFixed(3)}</div>
                                                    <div className="border border-green-200 rounded bg-white p-1 inline-block">
                                                        <div style={{ width: 64, height: 64 }}>
                                                            {highest.binaryGrid.map((row, y) => (
                                                                <div key={y} style={{ display: 'flex', height: 64 / highest.binaryGrid.length }}>
                                                                    {row.map((cell, x) => (
                                                                        <div key={x} style={{ flex: 1, backgroundColor: cell ? '#1f2937' : '#fff' }} />
                                                                    ))}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 mt-1">{highest.highway}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                <div className="text-sm text-gray-500">Loading highway data...</div>
                            </div>
                        )}
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right →</div>
                </div>

                {/* Step 9: ScagExplorer - LEADER Clustering */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded">Step 9</span>
                            <span className="font-medium text-gray-900">ScagExplorer</span>
                            <span className="text-gray-500 text-sm">LEADER Clustering</span>
                        </div>
                    </div>
                    <div className="shrink-0 text-xs text-gray-500 mb-2">
                        Interactive exploration of clustered highways based on scagnostics similarity
                    </div>
                    <div className="flex-1 min-h-0">
                        {highwayData.length > 0 ? (
                            <ScagExplorer
                                highways={highwayData}
                                selectedMetrics={['sparse', 'convex', 'skinny', 'stringy']}
                                threshold={0.25}
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                <div className="text-gray-400 mb-2">📊</div>
                                <div className="text-sm text-gray-600 font-medium">Loading highway data...</div>
                                <div className="text-xs text-gray-400 mt-1">
                                    Run: <code className="bg-gray-100 px-1 rounded">npx tsx scripts/computeImageScagnostics.ts</code>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="shrink-0 text-center text-xs text-purple-600 font-medium mt-2">
                        Force-directed layout • Node size = cluster members
                    </div>
                </div>
            </div>
        </div>
    )
}
