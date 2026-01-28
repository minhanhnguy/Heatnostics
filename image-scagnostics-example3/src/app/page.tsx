"use client"

import { useState, useEffect, useMemo } from "react"
import BinaryGrid from "@/components/BinaryGrid"
import FloatGrid from "@/components/FloatGrid"
import MiniGrid from "@/components/MiniGrid"
import ContourCanvas from "@/components/ContourCanvas"
import SkeletonCanvas from "@/components/SkeletonCanvas"
import Latex from "@/components/Latex"
import {
    pointsToFloatGrid,
    pointsToBinaryGrid,
    gaussianBlur,
    multiThresholdSegmentation,
    countFilledCells,
    getPercentileValue,
    marchingSquares,
    computeConvexHull,
    computeConvexHullFromBinary,
    computeContinuousArea,
    computeContinuousPerimeter,
    euclideanDistanceTransform,
    zhangSuenThinning,
    getSkeletonEndpoints,
    getSkeletonJunctions,
    computeAllScagnostics,
    type FloatGrid as FloatGridType,
    type BinaryGrid as BinaryGridType,
    type Point,
    type AllScagnostics
} from "@/lib/pipeline2"

// ============================================================================
// Types
// ============================================================================

interface ScatterplotData {
    name: string
    category: string
    description: string
    points: [number, number][]
    n_points: number
    expected_high?: string[]
    expected_low?: string[]
}

interface DatasetInfo {
    name: string
    grid_size: number
    scatterplots: ScatterplotData[]
}

// ============================================================================
// Academic UI Components
// ============================================================================

function SectionHeader({ number, title, subtitle }: { number: string; title: string; subtitle?: string }) {
    return (
        <div className="mb-4 pb-2 border-b border-gray-300">
            <h2 className="text-lg font-serif font-semibold text-gray-900">
                {number}. {title}
            </h2>
            {subtitle && (
                <p className="text-sm text-gray-600 mt-1 italic">{subtitle}</p>
            )}
        </div>
    )
}

function FigureCaption({ number, children }: { number: string; children: React.ReactNode }) {
    return (
        <p className="text-sm text-gray-600 mt-3 py-2 text-center leading-relaxed">
            <span className="font-semibold">Figure {number}.</span> {children}
        </p>
    )
}

function TableCaption({ number, children }: { number: string; children: React.ReactNode }) {
    return (
        <p className="text-xs text-gray-600 mb-2 text-center">
            <span className="font-semibold">Table {number}.</span> {children}
        </p>
    )
}

function Equation({ formula, label }: { formula: string; label?: string }) {
    return (
        <div className="my-4 flex items-center justify-center gap-4 py-2">
            <Latex displayMode>{formula}</Latex>
            {label && <span className="text-sm text-gray-500">({label})</span>}
        </div>
    )
}

// ============================================================================
// Step Components (Academic Style)
// ============================================================================

function DataGallery({
    scatterplots,
    gridSize,
    selectedIndex,
    onSelect
}: {
    scatterplots: ScatterplotData[]
    gridSize: number
    selectedIndex: number | null
    onSelect: (index: number) => void
}) {
    const categories = useMemo(() => {
        const cats: Record<string, { data: ScatterplotData; index: number }[]> = {}
        scatterplots.forEach((sp, idx) => {
            const cat = sp.category || "other"
            if (!cats[cat]) cats[cat] = []
            cats[cat].push({ data: sp, index: idx })
        })
        return cats
    }, [scatterplots])

    const binaryGrids = useMemo(() => {
        return scatterplots.map(sp => pointsToBinaryGrid(sp.points, gridSize))
    }, [scatterplots, gridSize])

    return (
        <section className="bg-white border border-gray-200 p-6">
            <SectionHeader
                number="1"
                title="Test Dataset"
                subtitle="Select a scatterplot pattern for analysis"
            />

            <div className="space-y-4 max-h-[400px] overflow-y-auto">
                {Object.entries(categories).map(([category, items]) => (
                    <div key={category}>
                        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 font-sans">
                            {category} (n={items.length})
                        </h3>
                        <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-14 gap-1">
                            {items.map(({ data, index }) => (
                                <button
                                    key={index}
                                    onClick={() => onSelect(index)}
                                    title={`${data.name} (${data.n_points} points)`}
                                    className={`relative aspect-square border overflow-hidden transition-all ${
                                        selectedIndex === index
                                            ? "border-gray-900 ring-1 ring-gray-900"
                                            : "border-gray-300 hover:border-gray-500"
                                    }`}
                                >
                                    <MiniGrid grid={binaryGrids[index]} size={64} />
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <FigureCaption number="1">
                Synthetic scatterplot patterns organized by expected scagnostic characteristics.
                Each thumbnail represents a {gridSize}x{gridSize} rasterized point distribution.
            </FigureCaption>
        </section>
    )
}

function SelectedPlotPanel({
    plot,
    binaryGrid,
    gridSize
}: {
    plot: ScatterplotData
    binaryGrid: BinaryGridType
    gridSize: number
}) {
    const filledCount = countFilledCells(binaryGrid)

    return (
        <section className="bg-gray-50 border border-gray-200 p-4">
            <div className="flex items-start gap-4">
                <div className="w-16 h-16 border border-gray-400 flex-shrink-0">
                    <BinaryGrid grid={binaryGrid} size={gridSize} />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-serif font-semibold text-gray-900">{plot.name}</h3>
                    <p className="text-sm text-gray-600 mt-1">{plot.description}</p>
                    <div className="mt-2 text-xs text-gray-500 font-mono">
                        n = {plot.n_points} points | {filledCount.toLocaleString()} pixels | category: {plot.category}
                        {plot.expected_high && ` | expected high: ${plot.expected_high.join(", ")}`}
                    </div>
                </div>
            </div>
        </section>
    )
}

function SmoothingSection({
    originalGrid,
    smoothedGrid,
    sigma,
    onSigmaChange
}: {
    originalGrid: FloatGridType
    smoothedGrid: FloatGridType
    sigma: number
    onSigmaChange: (sigma: number) => void
}) {
    return (
        <section className="bg-white border border-gray-200 p-6">
            <SectionHeader
                number="2"
                title="Gaussian Smoothing"
                subtitle="Anti-aliasing for stable contour interpolation"
            />

            <div className="mb-4 flex items-center gap-4 text-sm">
                <label className="text-gray-700">Smoothing parameter:</label>
                <input
                    type="range"
                    min="0"
                    max="5"
                    step="0.5"
                    value={sigma}
                    onChange={(e) => onSigmaChange(parseFloat(e.target.value))}
                    className="w-24 accent-gray-700"
                />
                <span className="font-mono text-gray-900">σ = {sigma.toFixed(1)}</span>
            </div>

            <div className="grid grid-cols-2 gap-6">
                <div>
                    <div className="aspect-square border border-gray-300">
                        <FloatGrid grid={originalGrid} colorMap="viridis" label="" showStats={false} />
                    </div>
                    <FigureCaption number="2a">
                        Input density field I(x,y) from kernel density estimation.
                    </FigureCaption>
                </div>
                <div>
                    <div className="aspect-square border border-gray-300">
                        <FloatGrid grid={smoothedGrid} colorMap="viridis" label="" showStats={false} />
                    </div>
                    <FigureCaption number="2b">
                        Smoothed field I_s after Gaussian convolution with σ={sigma}.
                    </FigureCaption>
                </div>
            </div>

            <Equation
                formula="I_s = G_\sigma * I, \quad \text{where} \quad G_\sigma(x,y) = \frac{1}{2\pi\sigma^2} \exp\left(-\frac{x^2+y^2}{2\sigma^2}\right)"
                label="1"
            />
        </section>
    )
}

function ThresholdSection({
    smoothedGrid,
    thresholds
}: {
    smoothedGrid: FloatGridType
    thresholds: { percentile: number; threshold: number; binary: BinaryGridType }[]
}) {
    const gridSize = smoothedGrid.length

    return (
        <section className="bg-white border border-gray-200 p-6">
            <SectionHeader
                number="3"
                title="Multi-Threshold Segmentation"
                subtitle="Percentile-based binary masks emulating α-shape family"
            />

            <Equation
                formula="M_k(x,y) = \begin{cases} 1 & \text{if } I_s(x,y) \geq T_k \\ 0 & \text{otherwise} \end{cases}"
                label="2"
            />

            <div className="grid grid-cols-4 gap-3">
                {thresholds.map(({ percentile, threshold, binary }) => {
                    const filledCount = countFilledCells(binary)
                    const totalCells = gridSize * gridSize
                    const fillPercent = ((filledCount / totalCells) * 100).toFixed(1)

                    return (
                        <div key={percentile}>
                            <div className="aspect-square border border-gray-300 bg-white">
                                <BinaryGrid grid={binary} size={gridSize} />
                            </div>
                            <div className="mt-1 text-center">
                                <div className="text-xs font-semibold text-gray-700">P{percentile}</div>
                                <div className="text-[10px] text-gray-500 font-mono">
                                    T={threshold.toFixed(3)} | {fillPercent}%
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>

            <FigureCaption number="3">
                Binary masks at percentile thresholds P50, P75, P90, P95. Lower thresholds capture
                broader extent; higher thresholds isolate dense cores.
            </FigureCaption>
        </section>
    )
}

function ContourSection({
    smoothedGrid,
    contours,
    convexHull,
    metrics
}: {
    smoothedGrid: FloatGridType
    contours: Point[][]
    convexHull: Point[]
    metrics: { area: number; perimeter: number; hullArea: number; convex: number; skinny: number }
}) {
    const gridSize = smoothedGrid.length

    return (
        <section className="bg-white border border-gray-200 p-6">
            <SectionHeader
                number="4"
                title="Contour Extraction & Geometry"
                subtitle="Marching squares with subpixel interpolation"
            />

            <div className="grid grid-cols-2 gap-6">
                <div>
                    <div className="aspect-square border border-gray-300">
                        <ContourCanvas
                            grid={smoothedGrid}
                            contours={contours}
                            convexHull={convexHull}
                            gridSize={gridSize}
                            showContours={true}
                            showHull={true}
                            label=""
                        />
                    </div>
                    <FigureCaption number="4">
                        Extracted iso-contour (white) at P75 threshold with convex hull overlay (red dashed).
                    </FigureCaption>
                </div>

                <div>
                    <TableCaption number="1">Continuous geometry metrics computed from subpixel contour.</TableCaption>
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="border-b border-gray-300">
                                <th className="text-left py-2 font-semibold text-gray-700">Metric</th>
                                <th className="text-right py-2 font-semibold text-gray-700">Value</th>
                                <th className="text-left py-2 pl-4 font-semibold text-gray-700">Formula</th>
                            </tr>
                        </thead>
                        <tbody className="font-mono text-xs">
                            <tr className="border-b border-gray-100">
                                <td className="py-2 text-gray-700">Area</td>
                                <td className="py-2 text-right">{metrics.area.toFixed(2)}</td>
                                <td className="py-2 pl-4 text-gray-500">½|Σ(xᵢyᵢ₊₁ - xᵢ₊₁yᵢ)|</td>
                            </tr>
                            <tr className="border-b border-gray-100">
                                <td className="py-2 text-gray-700">Perimeter</td>
                                <td className="py-2 text-right">{metrics.perimeter.toFixed(2)}</td>
                                <td className="py-2 pl-4 text-gray-500">Σ‖pᵢ₊₁ - pᵢ‖</td>
                            </tr>
                            <tr className="border-b border-gray-100">
                                <td className="py-2 text-gray-700">Hull Area</td>
                                <td className="py-2 text-right">{metrics.hullArea.toFixed(2)}</td>
                                <td className="py-2 pl-4 text-gray-500">A(conv(M))</td>
                            </tr>
                            <tr className="border-b border-gray-100">
                                <td className="py-2 text-gray-700">Convexity</td>
                                <td className="py-2 text-right">{metrics.convex.toFixed(4)}</td>
                                <td className="py-2 pl-4 text-gray-500">A / A_hull</td>
                            </tr>
                            <tr>
                                <td className="py-2 text-gray-700">Skinny (IQ)</td>
                                <td className="py-2 text-right">{metrics.skinny.toFixed(4)}</td>
                                <td className="py-2 pl-4 text-gray-500">1 - 4πA/P²</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </section>
    )
}

function SkeletonSection({
    binaryGrid,
    dtGrid,
    skeleton,
    endpoints,
    junctions,
    skeletonStats
}: {
    binaryGrid: BinaryGridType
    dtGrid: FloatGridType
    skeleton: BinaryGridType
    endpoints: Point[]
    junctions: Point[]
    skeletonStats: { pixels: number; longestPath: number }
}) {
    const gridSize = binaryGrid.length

    return (
        <section className="bg-white border border-gray-200 p-6">
            <SectionHeader
                number="5"
                title="Distance Transform & Medial Axis"
                subtitle="Zhang-Suen thinning algorithm for skeleton extraction"
            />

            <Equation
                formula="d(x,y) = \min_{(u,v) \in \text{background}} \|(x,y) - (u,v)\|_2"
                label="3"
            />

            <div className="grid grid-cols-3 gap-3">
                <div>
                    <div className="aspect-square border border-gray-300">
                        <BinaryGrid grid={binaryGrid} size={gridSize} />
                    </div>
                    <FigureCaption number="5a">Binary mask M at P75.</FigureCaption>
                </div>
                <div>
                    <div className="aspect-square border border-gray-300">
                        <FloatGrid grid={dtGrid} colorMap="plasma" label="" showStats={false} />
                    </div>
                    <FigureCaption number="5b">Euclidean distance transform d(x,y).</FigureCaption>
                </div>
                <div>
                    <div className="aspect-square border border-gray-300">
                        <SkeletonCanvas
                            dtGrid={dtGrid}
                            skeleton={skeleton}
                            endpoints={endpoints}
                            junctions={junctions}
                            gridSize={gridSize}
                            label=""
                        />
                    </div>
                    <FigureCaption number="5c">Medial axis S with endpoints (green) and junctions (red).</FigureCaption>
                </div>
            </div>

            <div className="mt-4">
                <TableCaption number="2">Skeleton topology statistics.</TableCaption>
                <table className="w-full text-sm border-collapse max-w-md mx-auto">
                    <tbody className="font-mono text-xs">
                        <tr className="border-b border-gray-200">
                            <td className="py-1.5 text-gray-600">Skeleton pixels</td>
                            <td className="py-1.5 text-right text-gray-900">{skeletonStats.pixels}</td>
                        </tr>
                        <tr className="border-b border-gray-200">
                            <td className="py-1.5 text-gray-600">Endpoints (degree=1)</td>
                            <td className="py-1.5 text-right text-gray-900">{endpoints.length}</td>
                        </tr>
                        <tr className="border-b border-gray-200">
                            <td className="py-1.5 text-gray-600">Junctions (degree≥3)</td>
                            <td className="py-1.5 text-right text-gray-900">{junctions.length}</td>
                        </tr>
                        <tr>
                            <td className="py-1.5 text-gray-600">Longest path</td>
                            <td className="py-1.5 text-right text-gray-900">{skeletonStats.longestPath.toFixed(1)} px</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
    )
}

function ScagnosticsSection({
    scagnostics,
    expectedHigh,
    expectedLow
}: {
    scagnostics: AllScagnostics
    expectedHigh?: string[]
    expectedLow?: string[]
}) {
    const metrics = [
        { key: "stringy", label: "Stringy" },
        { key: "sparse", label: "Sparse" },
        { key: "convex", label: "Convex" },
        { key: "skinny", label: "Skinny" },
        { key: "clumpy", label: "Clumpy" },
        { key: "outlying", label: "Outlying" },
        { key: "skewed", label: "Skewed" },
        { key: "striated", label: "Striated" },
        { key: "monotonic", label: "Monotonic" }
    ]

    return (
        <section className="bg-white border border-gray-200 p-6">
            <SectionHeader
                number="7"
                title="Scagnostics Results"
                subtitle="Computed values for the selected scatterplot pattern"
            />

            <div className="max-w-2xl mx-auto">
                <div className="space-y-2">
                    {metrics.map(({ key, label }) => {
                        const value = scagnostics[key as keyof AllScagnostics]
                        const isHigh = expectedHigh?.includes(key)
                        const isLow = expectedLow?.includes(key)

                        return (
                            <div key={key} className="flex items-center gap-3">
                                <div className="w-24 text-sm text-gray-700 font-medium flex items-center gap-1">
                                    {label}
                                    {isHigh && <span className="text-green-600 text-xs">↑</span>}
                                    {isLow && <span className="text-red-600 text-xs">↓</span>}
                                </div>
                                <div className="flex-1 h-4 bg-gray-100 border border-gray-200">
                                    <div
                                        className="h-full bg-gray-600"
                                        style={{ width: `${Math.max(1, value * 100)}%` }}
                                    />
                                </div>
                                <div className="w-16 text-right text-sm font-mono text-gray-700">
                                    {value.toFixed(4)}
                                </div>
                            </div>
                        )
                    })}
                </div>

                <div className="mt-3 text-xs text-gray-500 text-center">
                    <span className="text-green-600">↑</span> expected high |
                    <span className="text-red-600 ml-2">↓</span> expected low (from ground truth)
                </div>

                <FigureCaption number="7">
                    Computed scagnostic values for the selected pattern. Values range from 0 to 1.
                </FigureCaption>
            </div>
        </section>
    )
}

/**
 * Section 7: Formula Definitions & Semantic Analysis
 */
function FormulasSection() {
    const formulas = [
        {
            metric: "Stringy",
            formula: "\\frac{L_{\\max}}{|S|}",
            description: "Longest path length divided by total skeleton pixels",
            original: "Ratio of path length to α-hull perimeter in MST",
            assessment: "Good",
            notes: "Captures chain-like structure well. Skeleton longest-path approximates MST path ratio. May underestimate for complex branching patterns."
        },
        {
            metric: "Sparse",
            formula: "1 - \\frac{|M|}{A_{\\text{hull}}}",
            description: "One minus filled pixels over convex hull area",
            original: "Ratio of points to α-hull area (inverse density)",
            assessment: "Good",
            notes: "Direct analogue using pixel density instead of point density. Convex hull from binary mask matches α-hull at α→∞."
        },
        {
            metric: "Convex",
            formula: "\\frac{A_{\\text{contour}}}{A_{\\text{hull}}}",
            description: "Contour area divided by convex hull area",
            original: "Ratio of α-hull area to convex hull area",
            assessment: "Excellent",
            notes: "Nearly identical formulation. Marching squares contour area closely approximates α-shape area at equivalent threshold."
        },
        {
            metric: "Skinny",
            formula: "1 - \\frac{4\\pi A}{P^2}",
            description: "Complement of isoperimetric quotient",
            original: "1 - sqrt(4πA/P²) using α-hull perimeter",
            assessment: "Good",
            notes: "Uses same isoperimetric principle. Continuous contour provides smooth perimeter. Original uses sqrt; we use linear form."
        },
        {
            metric: "Clumpy",
            formula: "1 - \\frac{1}{n}",
            description: "One minus inverse of connected component count (n)",
            original: "RUNT statistic on MST edge lengths",
            assessment: "Good",
            notes: "Connected components directly measure cluster separation. n=1 gives 0, n=2 gives 0.5, n=3 gives 0.67. Captures distinct regions well but may miss density-based clusters within one component."
        },
        {
            metric: "Outlying",
            formula: "\\frac{|\\{p : d(p) > \\mu + 2\\sigma\\}|}{|M|}",
            description: "Fraction of pixels beyond 2σ in distance transform",
            original: "Length of outlying MST edges / total edge length",
            assessment: "Moderate",
            notes: "Uses statistical outlier detection on DT instead of graph edges. Captures isolated regions but may miss thin connections."
        },
        {
            metric: "Skewed",
            formula: "\\frac{\\mu - \\tilde{x}}{\\sigma}",
            description: "Standardized skewness of distance transform values",
            original: "Skewness of MST edge length distribution",
            assessment: "Good",
            notes: "DT values correlate with local \"edge lengths\" in the continuous domain. Sign indicates direction of asymmetry."
        },
        {
            metric: "Striated",
            formula: "\\bar{C}_{\\text{coherence}}",
            description: "Mean coherence from structure tensor analysis",
            original: "Measure of parallel lines using angle consistency",
            assessment: "Good",
            notes: "Structure tensor captures local orientation coherence well. High values indicate parallel striations in the density field."
        },
        {
            metric: "Monotonic",
            formula: "|\\rho_{\\text{Spearman}}|",
            description: "Absolute Spearman correlation of row centroids",
            original: "Spearman correlation on point coordinates",
            assessment: "Excellent",
            notes: "Direct analogue using row-wise centroids. Captures monotonic trends regardless of direction (positive or negative)."
        }
    ]

    const getAssessmentColor = (assessment: string) => {
        switch (assessment) {
            case "Excellent": return "text-green-700 bg-green-50"
            case "Good": return "text-blue-700 bg-blue-50"
            case "Moderate": return "text-amber-700 bg-amber-50"
            default: return "text-gray-700 bg-gray-50"
        }
    }

    return (
        <section className="bg-white border border-gray-200 p-6">
            <SectionHeader
                number="6"
                title="Formula Definitions & Semantic Fidelity"
                subtitle="Comparison of image-based formulas to original graph-theoretic scagnostics"
            />

            <TableCaption number="3">
                Formulas used in this pipeline with assessment of semantic alignment to Wilkinson et al. (2005).
            </TableCaption>

            <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                    <thead>
                        <tr className="border-b-2 border-gray-300 bg-gray-50">
                            <th className="text-left py-3 px-2 font-semibold text-gray-700 w-24">Metric</th>
                            <th className="text-left py-3 px-2 font-semibold text-gray-700 w-32">Formula</th>
                            <th className="text-left py-3 px-2 font-semibold text-gray-700">Original Meaning</th>
                            <th className="text-center py-3 px-2 font-semibold text-gray-700 w-24">Fidelity</th>
                            <th className="text-left py-3 px-2 font-semibold text-gray-700">Assessment</th>
                        </tr>
                    </thead>
                    <tbody>
                        {formulas.map(({ metric, formula, original, assessment, notes }, idx) => (
                            <tr key={metric} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                                <td className="py-3 px-2 font-medium text-gray-900 align-top">{metric}</td>
                                <td className="py-3 px-2 font-mono text-xs text-gray-700 align-top">{formula}</td>
                                <td className="py-3 px-2 text-xs text-gray-600 align-top">{original}</td>
                                <td className="py-3 px-2 text-center align-top">
                                    <span className={`text-xs font-medium px-2 py-1 rounded ${getAssessmentColor(assessment)}`}>
                                        {assessment}
                                    </span>
                                </td>
                                <td className="py-3 px-2 text-xs text-gray-600 align-top leading-relaxed">{notes}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-600">
                <p className="mb-2">
                    <span className="font-semibold">Fidelity Legend:</span>
                    <span className="ml-2 px-1.5 py-0.5 rounded text-green-700 bg-green-50">Excellent</span> = nearly identical semantic meaning;
                    <span className="ml-2 px-1.5 py-0.5 rounded text-blue-700 bg-blue-50">Good</span> = captures core concept with minor differences;
                    <span className="ml-2 px-1.5 py-0.5 rounded text-amber-700 bg-amber-50">Moderate</span> = approximates intent but uses different approach.
                </p>
                <p>
                    <span className="font-semibold">Key notation:</span> S = skeleton, M = binary mask, A = area, P = perimeter, L_max = longest skeleton path, d(p) = distance transform value, ρ = correlation coefficient.
                </p>
            </div>
        </section>
    )
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function Pipeline2Page() {
    const [dataset, setDataset] = useState<DatasetInfo | null>(null)
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
    const [smoothingSigma, setSmoothingSigma] = useState(1.5)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetch("/data/validation_dataset_small.json")
            .then(res => res.json())
            .then(data => {
                setDataset(data)
                setLoading(false)
            })
            .catch(err => {
                console.error("Failed to load dataset:", err)
                setLoading(false)
            })
    }, [])

    const selectedPlot = dataset && selectedIndex !== null
        ? dataset.scatterplots[selectedIndex]
        : null

    const gridSize = dataset?.grid_size || 256

    const originalGrid = useMemo(() => {
        if (!selectedPlot) return []
        return pointsToFloatGrid(selectedPlot.points, gridSize, 5.0)
    }, [selectedPlot, gridSize])

    const binaryGrid = useMemo(() => {
        if (!selectedPlot) return []
        return pointsToBinaryGrid(selectedPlot.points, gridSize)
    }, [selectedPlot, gridSize])

    const smoothedGrid = useMemo(() => {
        if (!originalGrid.length) return []
        return gaussianBlur(originalGrid, smoothingSigma)
    }, [originalGrid, smoothingSigma])

    const thresholds = useMemo(() => {
        if (!smoothedGrid.length) return []
        return multiThresholdSegmentation(smoothedGrid, [50, 75, 90, 95])
    }, [smoothedGrid])

    const contourData = useMemo(() => {
        if (!smoothedGrid.length) return { contours: [], convexHull: [], metrics: null }

        const p75Binary = thresholds.find(t => t.percentile === 75)?.binary
        const threshold = getPercentileValue(smoothedGrid, 75)
        const contours = marchingSquares(smoothedGrid, threshold)

        const largestContour = contours.reduce((max, c) =>
            computeContinuousArea(c) > computeContinuousArea(max) ? c : max,
            contours[0] || []
        )

        const area = computeContinuousArea(largestContour)
        const perimeter = computeContinuousPerimeter(largestContour)

        const convexHull = p75Binary && p75Binary.length > 0
            ? computeConvexHullFromBinary(p75Binary)
            : computeConvexHull(largestContour)

        const hullArea = computeContinuousArea(convexHull)

        return {
            contours,
            convexHull,
            metrics: {
                area,
                perimeter,
                hullArea,
                convex: hullArea > 0 ? area / hullArea : 1,
                skinny: perimeter > 0 ? Math.max(0, 1 - (4 * Math.PI * area) / (perimeter * perimeter)) : 0
            }
        }
    }, [smoothedGrid, thresholds])

    const skeletonData = useMemo(() => {
        const p75Binary = thresholds.find(t => t.percentile === 75)?.binary
        if (!p75Binary || !p75Binary.length) return null

        const dt = euclideanDistanceTransform(p75Binary)
        const skeleton = zhangSuenThinning(p75Binary)
        const endpoints = getSkeletonEndpoints(skeleton)
        const junctions = getSkeletonJunctions(skeleton)
        const skeletonPixels = countFilledCells(skeleton)

        let longestPath = 0
        if (endpoints.length > 0) {
            for (let i = 0; i < endpoints.length; i++) {
                for (let j = i + 1; j < endpoints.length; j++) {
                    const d = Math.sqrt(
                        (endpoints[i].x - endpoints[j].x) ** 2 +
                        (endpoints[i].y - endpoints[j].y) ** 2
                    )
                    longestPath = Math.max(longestPath, d)
                }
            }
        }

        return {
            dt,
            skeleton,
            endpoints,
            junctions,
            stats: { pixels: skeletonPixels, longestPath }
        }
    }, [thresholds])

    const allScagnostics = useMemo(() => {
        const p75Binary = thresholds.find(t => t.percentile === 75)?.binary
        if (!smoothedGrid.length || !p75Binary || !contourData.contours.length) return null

        return computeAllScagnostics(
            smoothedGrid,
            p75Binary,
            contourData.contours,
            contourData.convexHull
        )
    }, [smoothedGrid, thresholds, contourData])

    if (loading) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-gray-500 font-serif">Loading dataset...</div>
            </div>
        )
    }

    if (!dataset) {
        return (
            <div className="min-h-screen bg-white flex items-center justify-center">
                <div className="text-red-700 font-serif">Error: Failed to load dataset</div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Academic Paper Header */}
            <header className="bg-white border-b border-gray-200 py-8">
                <div className="max-w-[1400px] mx-auto px-6">
                    <h1 className="text-2xl font-serif font-bold text-gray-900 text-center">
                        Image-Based Scagnostics Pipeline
                    </h1>
                    <p className="text-center text-gray-600 mt-2 font-serif italic">
                        Continuous Geometry Approach with Subpixel Precision
                    </p>
                    <div className="mt-4 text-center text-sm text-gray-500">
                        Interactive demonstration | {dataset.scatterplots.length} test patterns | {gridSize}×{gridSize} resolution
                    </div>
                </div>
            </header>

            {/* Abstract */}
            <div className="max-w-[1400px] mx-auto px-6 py-6">
                <div className="bg-white border border-gray-200 p-6">
                    <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-2">Abstract</h2>
                    <p className="text-sm text-gray-700 leading-relaxed">
                        This interactive tool demonstrates an image-only scagnostics pipeline that reproduces the
                        geometric intent of traditional graph-based scagnostics (Wilkinson et al., 2005) while
                        operating purely on rasterized density representations. The pipeline employs subpixel
                        contour extraction via marching squares, continuous area/perimeter computation using
                        the shoelace formula, and medial axis extraction through Zhang-Suen thinning to compute
                        nine diagnostic measures characterizing scatterplot structure.
                    </p>
                </div>
            </div>

            {/* Main Content */}
            <main className="max-w-[1400px] mx-auto px-6 pb-12 space-y-6">
                <DataGallery
                    scatterplots={dataset.scatterplots}
                    gridSize={gridSize}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                />

                {selectedPlot ? (
                    <>
                        <SelectedPlotPanel
                            plot={selectedPlot}
                            binaryGrid={binaryGrid}
                            gridSize={gridSize}
                        />

                        <SmoothingSection
                            originalGrid={originalGrid}
                            smoothedGrid={smoothedGrid}
                            sigma={smoothingSigma}
                            onSigmaChange={setSmoothingSigma}
                        />

                        <ThresholdSection
                            smoothedGrid={smoothedGrid}
                            thresholds={thresholds}
                        />

                        {contourData.metrics && (
                            <ContourSection
                                smoothedGrid={smoothedGrid}
                                contours={contourData.contours}
                                convexHull={contourData.convexHull}
                                metrics={contourData.metrics}
                            />
                        )}

                        {skeletonData && thresholds.find(t => t.percentile === 75)?.binary && (
                            <SkeletonSection
                                binaryGrid={thresholds.find(t => t.percentile === 75)!.binary}
                                dtGrid={skeletonData.dt}
                                skeleton={skeletonData.skeleton}
                                endpoints={skeletonData.endpoints}
                                junctions={skeletonData.junctions}
                                skeletonStats={skeletonData.stats}
                            />
                        )}

                        <FormulasSection />

                        {allScagnostics && (
                            <ScagnosticsSection
                                scagnostics={allScagnostics}
                                expectedHigh={selectedPlot.expected_high}
                                expectedLow={selectedPlot.expected_low}
                            />
                        )}
                    </>
                ) : (
                    <div className="bg-white border border-gray-200 p-12 text-center">
                        <p className="text-gray-500 font-serif italic">
                            Select a scatterplot pattern from the gallery above to begin analysis.
                        </p>
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="bg-white border-t border-gray-200 py-4">
                <div className="max-w-[1400px] mx-auto px-6 text-center text-xs text-gray-500">
                    Based on Wilkinson, L., Anand, A., & Grossman, R. (2005).
                    <em> Graph-Theoretic Scagnostics.</em> IEEE Symposium on Information Visualization.
                </div>
            </footer>
        </div>
    )
}
