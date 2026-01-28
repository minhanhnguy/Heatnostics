"use client"

import { useEffect, useState, useMemo, useRef } from "react"
import BinaryGrid from "@/components/BinaryGrid"
import ScagExplorer from "@/components/ScagExplorer"
import MiniGrid from "@/components/MiniGrid"
import { adaptiveMorphologicalClosing, morphologicalClosing, fillInteriorHoles, contourConvexHull, computeStringyDT, countFilledPixels, computeScagnostics, type ScagnosticsMetrics } from "@/lib/imageProcessing"

interface ScatterplotScagnosticsData {
    col_x: number
    col_y: number
    pointCount: number
    scagnostics: ScagnosticsMetrics
    binaryGrid: number[][]
    name?: string
    category?: string
    description?: string
}

// Validation dataset structure
interface ValidationScatterplot {
    name: string
    category: string
    description: string
    expected_high: string[]
    expected_low: string[]
    n_points: number
    points: [number, number][]
}

interface ValidationDataset {
    name: string
    description: string
    version: string
    grid_size: number
    metrics: string[]
    categories: string[]
    total_scatterplots: number
    validation_notes: Record<string, string>
    scatterplots: ValidationScatterplot[]
}

// Pipeline steps
const pipelineSteps = [
    { id: 0, label: "Overview", description: "Validation Dataset" },
    { id: 1, label: "Select", description: "Choose scatterplot" },
    { id: 2, label: "Rasterize", description: "Binary 64x64" },
    { id: 3, label: "Closing", description: "Morphological closing" },
    { id: 4, label: "Hull", description: "Contour convex hull" },
    { id: 5, label: "DT Ridge", description: "Distance Transform + Ridge" },
    { id: 6, label: "Metrics", description: "Computed values" },
    { id: 7, label: "Gallery", description: "Metric examples" },
    { id: 8, label: "ScagExplorer", description: "LEADER clustering" },
]

const GRID_SIZE = 256
const CLOSING_RADIUS = 4

// Rasterize points to binary grid (validation dataset format)
function rasterizePoints(
    points: [number, number][],
    sourceGridSize: number,
    targetGridSize: number
): number[][] {
    const grid: number[][] = Array.from({ length: targetGridSize }, () =>
        Array(targetGridSize).fill(0)
    )

    const scale = targetGridSize / sourceGridSize

    for (const [x, y] of points) {
        const gx = Math.floor(x * scale)
        const gy = targetGridSize - 1 - Math.floor(y * scale)  // Flip Y axis
        const clampedX = Math.max(0, Math.min(targetGridSize - 1, gx))
        const clampedY = Math.max(0, Math.min(targetGridSize - 1, gy))
        grid[clampedY][clampedX] = 1
    }

    return grid
}

export default function Home() {
    const [scatterplotData, setScatterplotData] = useState<ScatterplotScagnosticsData[]>([])
    const [validationDataset, setValidationDataset] = useState<ValidationDataset | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeStep, setActiveStep] = useState(0)
    const [selectedIndex, setSelectedIndex] = useState<number>(0)
    const [selectedDatasetPath, setSelectedDatasetPath] = useState<string>("/data/precomputed_scagnostics.json")
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    // Load validation dataset and compute scagnostics
    useEffect(() => {
        setLoading(true)
        fetch(selectedDatasetPath)
            .then((res) => {
                if (!res.ok) throw new Error(`Failed to load ${selectedDatasetPath}`)
                return res.json()
            })
            .then((data: any) => {
                // Check if this is the precomputed dataset (has "results" array) or raw validation dataset
                if (data.results && Array.isArray(data.results)) {
                    // PRECOMPUTED PATH
                    console.log("Loading precomputed scagnostics...")
                    setValidationDataset({
                        name: "Precomputed Validation Dataset",
                        description: "Offline computed scagnostics (256x256, Dual Pipeline)",
                        version: "1.0",
                        grid_size: data.gridSize,
                        metrics: Object.keys(data.results[0].scagnostics),
                        categories: [], // Extract later
                        total_scatterplots: data.results.length,
                        validation_notes: {},
                        scatterplots: [] // Not needed for precomputed
                    })

                    const transformed: ScatterplotScagnosticsData[] = data.results.map((r: any, idx: number) => ({
                        col_x: idx,
                        col_y: 0,
                        pointCount: r.n_points,
                        scagnostics: r.scagnostics,
                        binaryGrid: r.binaryGrid,
                        name: r.name,
                        category: r.category,
                        description: r.description
                    }))

                    setScatterplotData(transformed)
                    setSelectedIndex(0)
                    setLoading(false)
                } else {
                    // RAW DATASET COMPUTE PATH (Legacy)
                    setValidationDataset(data as ValidationDataset)

                    // Transform validation scatterplots to our format
                    const transformed: ScatterplotScagnosticsData[] = (data as ValidationDataset).scatterplots.map((sp, idx) => {
                        // Rasterize points to binary grid
                        const binaryGrid = rasterizePoints(sp.points, data.grid_size, GRID_SIZE)

                        // MULTI-SCALE SCAGNOSTICS AVERAGING
                        // Compute metrics at multiple scales and average them to improve stability
                        const radii = [2, 4, 8]
                        const accumulatedMetrics: Record<string, number> = {
                            stringy: 0, sparse: 0, convex: 0, skinny: 0,
                            clumpy: 0, outlying: 0, skewed: 0, striated: 0, monotonic: 0
                        }

                        radii.forEach(r => {
                            // Apply morphological closing at this radius
                            // Use adaptive closing for r=2 to preserve thin shapes, standard for large r
                            const { closedGrid } = adaptiveMorphologicalClosing(binaryGrid, r)

                            // For r=2 (fine detail), ensure we fill holes for shape metrics
                            // For larger r, holes are naturally closed
                            const refinedGrid = (r <= 2) ? fillInteriorHoles(closedGrid) : closedGrid

                            const hullGrid = contourConvexHull(refinedGrid)
                            const { ridgeGrid } = computeStringyDT(refinedGrid, binaryGrid, sp.n_points)

                            const metrics = computeScagnostics(refinedGrid, hullGrid, ridgeGrid, binaryGrid)

                            // Accumulate
                            Object.entries(metrics).forEach(([key, val]) => {
                                if (key in accumulatedMetrics) { // Filter out any extra keys
                                    accumulatedMetrics[key] += val
                                }
                            })
                        })

                        // Average results
                        const metrics: any = {}
                        Object.keys(accumulatedMetrics).forEach(key => {
                            metrics[key] = accumulatedMetrics[key] / radii.length
                        })

                        return {
                            col_x: idx,
                            col_y: 0,
                            pointCount: sp.n_points,
                            scagnostics: metrics as ScagnosticsMetrics,
                            binaryGrid,
                            name: sp.name,
                            category: sp.category,
                            description: sp.description,
                        }
                    })

                    setScatterplotData(transformed)
                    setSelectedIndex(0)
                    setLoading(false)
                }
            })
            .catch((err) => {
                setError(err.message)
                setLoading(false)
            })
    }, [selectedDatasetPath])

    // Expose data for verification script
    useEffect(() => {
        if (scatterplotData.length > 0) {
            (window as any).scagnosticsData = scatterplotData
            console.log("Verified scagnostics data exposed to window.scagnosticsData")
        }
    }, [scatterplotData])

    // Get selected scatterplot data
    const selectedScatterplot = useMemo(() => {
        if (scatterplotData.length === 0) return null
        return scatterplotData[selectedIndex] || scatterplotData[0]
    }, [selectedIndex, scatterplotData])

    // Compute pipeline data for selected scatterplot
    const pipelineData = useMemo(() => {
        if (!selectedScatterplot) return null

        // Use precomputed binary grid
        const binaryGrid = selectedScatterplot.binaryGrid

        // VISUAL PIPELINE (Display-only)
        // We use Radius 4 as a representative "medium" scale for visualization
        const VISUAL_RADIUS = 4
        const { closedGrid } = adaptiveMorphologicalClosing(binaryGrid, VISUAL_RADIUS)
        const hullGrid = contourConvexHull(closedGrid)
        const { ridgeGrid } = computeStringyDT(closedGrid, binaryGrid, selectedScatterplot.pointCount)

        // METRICS COMPUTATION (Multi-Scale Average)
        // We re-compute the multi-scale average here to ensure the "Metrics" panel 
        // matches the dataset methodology exactly.
        const radii = [2, 4, 8]
        const accumulatedMetrics: Record<string, number> = {
            stringy: 0, sparse: 0, convex: 0, skinny: 0,
            clumpy: 0, outlying: 0, skewed: 0, striated: 0, monotonic: 0
        }

        radii.forEach(r => {
            const { closedGrid: scaleClosed } = adaptiveMorphologicalClosing(binaryGrid, r)
            const scaleRefined = (r <= 2) ? fillInteriorHoles(scaleClosed) : scaleClosed
            const scaleHull = contourConvexHull(scaleRefined)
            const { ridgeGrid: scaleRidge } = computeStringyDT(scaleRefined, binaryGrid, selectedScatterplot.pointCount)
            const scaleMetrics = computeScagnostics(scaleRefined, scaleHull, scaleRidge, binaryGrid)

            Object.entries(scaleMetrics).forEach(([key, val]) => {
                if (key in accumulatedMetrics) {
                    accumulatedMetrics[key] += val
                }
            })
        })

        const averagedMetrics: any = {}
        Object.keys(accumulatedMetrics).forEach(key => {
            averagedMetrics[key] = accumulatedMetrics[key] / radii.length
        })

        return {
            binaryGrid,
            closedGrid,  // Visual representative (r=4)
            hullGrid,    // Visual representative (r=4)
            ridgeGrid,   // Visual representative (r=4)
            metrics: averagedMetrics as ScagnosticsMetrics, // Robust average
        }
    }, [selectedScatterplot])

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
    }, [scatterplotData])

    // Handle mouse wheel for horizontal scrolling
    useEffect(() => {
        const container = scrollContainerRef.current
        if (!container) return

        const handleWheel = (e: WheelEvent) => {
            const rect = container.getBoundingClientRect()
            const isOverContainer =
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom

            if (!isOverContainer) return

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

        window.addEventListener("wheel", handleWheel, { passive: false, capture: true })
        return () => window.removeEventListener("wheel", handleWheel, { capture: true })
    }, [scatterplotData])

    if (loading) {
        return (
            <div className="h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="text-gray-600 mb-2">Loading validation dataset...</div>
                    <div className="text-sm text-gray-400">
                        Computing scagnostics for synthetic scatterplots
                    </div>
                </div>
            </div>
        )
    }

    if (error) {
        return (
            <div className="h-screen bg-white flex items-center justify-center">
                <div className="text-center">
                    <div className="text-red-600 mb-2">Error: {error}</div>
                    <div className="text-sm text-gray-500 mt-4">
                        Make sure validation_dataset.json exists in the public folder
                    </div>
                </div>
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
                            Validation Dataset Scagnostics Pipeline
                        </h1>
                        <div className="flex items-center gap-2 mt-1">
                            <select
                                className="text-xs bg-gray-100 border border-gray-300 rounded px-2 py-1 text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                value={selectedDatasetPath}
                                onChange={(e) => setSelectedDatasetPath(e.target.value)}
                            >
                                <option value="/data/precomputed_scagnostics.json">Precomputed (256x256, Dual)</option>
                                <option value="/validation_dataset_large.json">Realtime Compute (New Dataset)</option>
                                <option value="/validation_dataset_small.json">Realtime Compute (Old Dataset)</option>
                            </select>
                            <span className="text-xs text-gray-500">
                                {validationDataset?.name || 'Validation Dataset'} - {scatterplotData.length} scatterplots
                            </span>
                        </div>
                    </div>

                    {/* Pipeline indicator */}
                    <div className="flex items-center gap-1 text-xs overflow-x-auto">
                        {pipelineSteps.map((step, idx) => (
                            <div key={step.id} className="flex items-center gap-1 shrink-0">
                                {idx > 0 && <span className="text-gray-300">-</span>}
                                <span className={`px-2 py-0.5 rounded whitespace-nowrap ${activeStep === idx
                                    ? "bg-blue-100 text-blue-700 font-medium"
                                    : activeStep > idx
                                        ? "bg-green-100 text-green-700"
                                        : "bg-gray-100 text-gray-400"
                                    }`}>
                                    {activeStep > idx ? "v" : idx} {step.label}
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
                {/* Step 0: Overview */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">Step 0</span>
                            <span className="font-medium text-gray-900">Validation Dataset Overview</span>
                            <span className="text-gray-500 text-sm">Synthetic Scatterplots</span>
                        </div>
                        <div className="text-sm text-gray-500">{scatterplotData.length} scatterplots processed</div>
                    </div>
                    <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
                        {/* Dataset info */}
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                            <h3 className="font-semibold text-gray-800 mb-3">Dataset Information</h3>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Source:</span>
                                    <span className="font-medium">{validationDataset?.name || 'Validation Dataset'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Purpose:</span>
                                    <span className="font-medium">Validate image scagnostics</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Categories:</span>
                                    <span className="font-medium">{validationDataset?.categories?.length || 0} metric types</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Grid Size:</span>
                                    <span className="font-medium">{validationDataset?.grid_size || 256}x{validationDataset?.grid_size || 256} → {GRID_SIZE}x{GRID_SIZE}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Scatterplots:</span>
                                    <span className="font-medium">{scatterplotData.length} synthetic patterns</span>
                                </div>
                            </div>
                            <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-200 text-xs text-blue-800">
                                {validationDataset?.description || 'Synthetic scatterplots designed to validate image-theoretic scagnostics.'}
                            </div>
                        </div>
                        {/* Sample scatterplots preview */}
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 overflow-auto">
                            <h3 className="font-semibold text-gray-800 mb-3">Sample Scatterplots <span className="text-xs text-gray-500 font-normal">(click to select)</span></h3>
                            <div className="grid grid-cols-6 gap-2">
                                {scatterplotData.map((sp, idx) => (
                                    <div
                                        key={idx}
                                        className={`border rounded bg-white cursor-pointer transition-colors ${selectedIndex === idx ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300 hover:border-blue-500'}`}
                                        onClick={() => setSelectedIndex(idx)}
                                    >
                                        <MiniGrid grid={sp.binaryGrid} size={48} />
                                        <div className="text-[8px] text-center text-gray-500 py-0.5 truncate px-0.5">
                                            {sp.name?.replace(/_/g, ' ') || `Plot ${idx}`}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Selected plot scagnostics */}
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 overflow-auto">
                            <h3 className="font-semibold text-gray-800 mb-2">Selected: <span className="text-blue-600">{selectedScatterplot?.name?.replace(/_/g, ' ') || 'None'}</span></h3>
                            {selectedScatterplot && (
                                <div className="space-y-3">
                                    {/* Preview */}
                                    <div className="flex justify-center">
                                        <div className="border border-gray-300 rounded bg-white p-1">
                                            <MiniGrid grid={selectedScatterplot.binaryGrid} size={80} />
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-600 text-center">
                                        {selectedScatterplot.category} • {selectedScatterplot.pointCount} points
                                    </div>
                                    {/* Scagnostics metrics */}
                                    <div className="border-t border-gray-200 pt-2">
                                        <div className="text-xs font-semibold text-gray-700 mb-2">Scagnostics</div>
                                        <div className="grid grid-cols-3 gap-1">
                                            {(['stringy', 'sparse', 'convex', 'skinny', 'clumpy', 'outlying', 'skewed', 'striated', 'monotonic'] as const).map(metric => (
                                                <div key={metric} className="bg-white rounded px-2 py-1 border border-gray-200">
                                                    <div className="text-[9px] text-gray-500 capitalize">{metric}</div>
                                                    <div className="text-sm font-bold text-blue-600">
                                                        {selectedScatterplot.scagnostics[metric].toFixed(2)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right to see the pipeline</div>
                </div>

                {/* Step 1: Select Scatterplot */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">Step 1</span>
                            <span className="font-medium text-gray-900">Select Scatterplot</span>
                            <span className="text-gray-500 text-sm">
                                {selectedScatterplot?.name?.replace(/_/g, ' ') || 'Choose a scatterplot'}
                            </span>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 grid grid-cols-3 gap-4">
                        {/* Scatterplot selector */}
                        <div className="col-span-2 bg-gray-50 rounded-lg p-4 border border-gray-200 overflow-auto">
                            <h3 className="font-semibold text-gray-800 mb-3">Available Scatterplots (click to select) - {scatterplotData.length} total</h3>
                            <div className="grid grid-cols-8 gap-2">
                                {scatterplotData.map((sp, idx) => (
                                    <div
                                        key={idx}
                                        className={`border rounded bg-white cursor-pointer transition-all ${selectedIndex === idx
                                            ? 'border-blue-500 ring-2 ring-blue-200'
                                            : 'border-gray-300 hover:border-blue-400'
                                            }`}
                                        onClick={() => setSelectedIndex(idx)}
                                    >
                                        <MiniGrid grid={sp.binaryGrid} size={56} />
                                        <div className="text-[8px] text-center text-gray-500 py-0.5 truncate px-0.5">
                                            {sp.name?.replace(/_/g, ' ') || `Plot ${idx}`}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Selected preview */}
                        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                            <h3 className="font-semibold text-gray-800 mb-3">Selected</h3>
                            {selectedScatterplot && (
                                <div>
                                    <div className="border border-gray-300 rounded bg-white p-2 mb-3 flex justify-center">
                                        <MiniGrid grid={selectedScatterplot.binaryGrid} size={150} />
                                    </div>
                                    <div className="text-sm space-y-1">
                                        <div>Name: <span className="font-mono text-xs">{selectedScatterplot.name?.replace(/_/g, ' ')}</span></div>
                                        <div>Category: <span className="font-mono">{selectedScatterplot.category}</span></div>
                                        <div>Points: <span className="font-mono">{selectedScatterplot.pointCount}</span></div>
                                        {selectedScatterplot.description && (
                                            <div className="text-xs text-gray-500 mt-2">{selectedScatterplot.description}</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right</div>
                </div>

                {/* Step 2: Rasterize */}
                {pipelineData && (
                    <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                        <div className="shrink-0 flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                                <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">Step 2</span>
                                <span className="font-medium text-gray-900">Rasterize</span>
                                <span className="text-gray-500 text-sm">Binary {GRID_SIZE}x{GRID_SIZE} grid</span>
                            </div>
                            <div className="text-sm text-gray-500">{countFilledPixels(pipelineData.binaryGrid).toLocaleString()} pixels</div>
                        </div>
                        <div className="shrink-0 flex gap-3 mb-2 text-xs">
                            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-black" /><span className="text-gray-600">1 (point present)</span></div>
                            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-white border border-gray-300" /><span className="text-gray-600">0 (empty)</span></div>
                        </div>
                        <div className="flex-1 min-h-0 border border-gray-200 bg-gray-50">
                            <BinaryGrid grid={pipelineData.binaryGrid} size={GRID_SIZE} />
                        </div>
                        <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right</div>
                    </div>
                )}

                {/* Step 3: Morphological Closing */}
                {pipelineData && (
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
                            <span className="text-gray-400">Dilation then Erosion</span>
                        </div>
                        <div className="flex-1 min-h-0 border border-gray-200 bg-gray-50">
                            <BinaryGrid grid={pipelineData.closedGrid} size={GRID_SIZE} />
                        </div>
                        <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right</div>
                    </div>
                )}

                {/* Step 4: Convex Hull */}
                {pipelineData && (
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
                            <span className="text-gray-400">Boundary then Graham Scan</span>
                        </div>
                        <div className="flex-1 min-h-0 border border-gray-200 bg-gray-50">
                            <BinaryGrid grid={pipelineData.hullGrid} size={GRID_SIZE} />
                        </div>
                        <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right</div>
                    </div>
                )}

                {/* Step 5: Distance Transform + Ridge Detection */}
                {pipelineData && (
                    <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                        <div className="shrink-0 flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                                <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">Step 5</span>
                                <span className="font-medium text-gray-900">Distance Transform + Ridge</span>
                                <span className="text-gray-500 text-sm">Replaces MST</span>
                            </div>
                            <div className="text-sm text-gray-500">{countFilledPixels(pipelineData.ridgeGrid).toLocaleString()} ridge pixels</div>
                        </div>
                        <div className="shrink-0 flex gap-3 mb-2 text-xs">
                            <div className="flex items-center gap-1"><div className="w-3 h-3 bg-black" /><span className="text-gray-600">Ridge (local maxima)</span></div>
                            <span className="text-gray-400">EDT then Local maxima then Longest path</span>
                        </div>
                        <div className="flex-1 min-h-0 border border-gray-200 bg-gray-50">
                            <BinaryGrid grid={pipelineData.ridgeGrid} size={GRID_SIZE} />
                        </div>
                        <div className="shrink-0 text-xs text-gray-500 mt-2 bg-green-50 p-2 rounded border border-green-200">
                            <strong>Why Distance Transform?</strong> EDT ridges follow the same path as MST through dense regions,
                            but with O(WxH) complexity vs O(n^2) for MST.
                        </div>
                        <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right</div>
                    </div>
                )}

                {/* Step 6: Scagnostics Metrics */}
                {pipelineData && (
                    <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                        <div className="shrink-0 flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                                <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded">Step 6</span>
                                <span className="font-medium text-gray-900">Scagnostics Metrics</span>
                                <span className="text-gray-500 text-sm">
                                    {selectedScatterplot?.name?.replace(/_/g, ' ') || 'N/A'}
                                </span>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-auto">
                            <div className="grid grid-cols-3 gap-4">
                                {(['stringy', 'sparse', 'convex', 'skinny', 'clumpy', 'outlying', 'skewed', 'striated', 'monotonic'] as const).map(metric => (
                                    <div key={metric} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                                        <div className="text-sm font-semibold text-gray-700 capitalize mb-2">{metric}</div>
                                        <div className="text-3xl font-bold text-blue-600 mb-2">
                                            {pipelineData.metrics[metric].toFixed(3)}
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2">
                                            <div
                                                className="bg-blue-600 h-2 rounded-full"
                                                style={{ width: `${Math.min(100, pipelineData.metrics[metric] * 100)}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="shrink-0 text-center text-xs text-gray-400 mt-4">Scroll right</div>
                    </div>
                )}

                {/* Step 7: Metric Gallery */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-teal-100 text-teal-700 text-xs font-medium px-2 py-0.5 rounded">Step 7</span>
                            <span className="font-medium text-gray-900">Metric Gallery</span>
                            <span className="text-gray-500 text-sm">Low / Average / High Examples</span>
                        </div>
                        <div className="text-sm text-gray-500">{scatterplotData.length} scatterplots</div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                        {scatterplotData.length > 0 ? (
                            <div className="space-y-3">
                                {(['stringy', 'sparse', 'convex', 'skinny', 'clumpy', 'outlying', 'skewed', 'striated', 'monotonic'] as const).map(metric => {
                                    const sorted = [...scatterplotData].sort((a, b) => a.scagnostics[metric] - b.scagnostics[metric])
                                    const values = sorted.map(s => s.scagnostics[metric])
                                    const avg = values.reduce((a, b) => a + b, 0) / values.length

                                    const lowIdx = Math.floor(sorted.length * 0.05)
                                    const highIdx = Math.floor(sorted.length * 0.95)
                                    const lowest = sorted[lowIdx] || sorted[0]
                                    const highest = sorted[highIdx] || sorted[sorted.length - 1]
                                    const avgIdx = sorted.reduce((bestIdx, s, idx) =>
                                        Math.abs(s.scagnostics[metric] - avg) < Math.abs(sorted[bestIdx].scagnostics[metric] - avg) ? idx : bestIdx
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
                                                        <MiniGrid grid={lowest.binaryGrid} size={64} />
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 mt-1">({lowest.col_x},{lowest.col_y})</div>
                                                </div>
                                                {/* Average */}
                                                <div className="flex-1 text-center">
                                                    <div className="text-xs text-yellow-600 font-medium mb-1">Average: {average.scagnostics[metric].toFixed(3)}</div>
                                                    <div className="border border-yellow-200 rounded bg-white p-1 inline-block">
                                                        <MiniGrid grid={average.binaryGrid} size={64} />
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 mt-1">({average.col_x},{average.col_y})</div>
                                                </div>
                                                {/* Highest */}
                                                <div className="flex-1 text-center">
                                                    <div className="text-xs text-green-600 font-medium mb-1">Highest: {highest.scagnostics[metric].toFixed(3)}</div>
                                                    <div className="border border-green-200 rounded bg-white p-1 inline-block">
                                                        <MiniGrid grid={highest.binaryGrid} size={64} />
                                                    </div>
                                                    <div className="text-[10px] text-gray-500 mt-1">({highest.col_x},{highest.col_y})</div>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                <div className="text-sm text-gray-500">Loading scatterplot data...</div>
                            </div>
                        )}
                    </div>
                    <div className="shrink-0 text-center text-xs text-gray-400 mt-2">Scroll right</div>
                </div>

                {/* Step 8: ScagExplorer - LEADER Clustering */}
                <div className="shrink-0 w-full h-full flex flex-col snap-start px-4 py-3">
                    <div className="shrink-0 flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                            <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-0.5 rounded">Step 8</span>
                            <span className="font-medium text-gray-900">ScagExplorer</span>
                            <span className="text-gray-500 text-sm">LEADER Clustering</span>
                        </div>
                    </div>
                    <div className="shrink-0 text-xs text-gray-500 mb-2">
                        Interactive exploration of clustered scatterplots based on scagnostics similarity
                    </div>
                    <div className="flex-1 min-h-0">
                        {scatterplotData.length > 0 ? (
                            <ScagExplorer
                                scatterplots={scatterplotData}
                                selectedMetrics={['stringy', 'sparse', 'convex', 'skinny', 'clumpy', 'outlying', 'skewed', 'striated', 'monotonic']}
                                threshold={0.8}
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                <div className="text-gray-400 mb-2">Loading...</div>
                                <div className="text-sm text-gray-600 font-medium">Loading scatterplot data...</div>
                            </div>
                        )}
                    </div>
                    <div className="shrink-0 text-center text-xs text-purple-600 font-medium mt-2">
                        Force-directed layout - Node size = cluster members
                    </div>
                </div>
            </div>
        </div>
    )
}
