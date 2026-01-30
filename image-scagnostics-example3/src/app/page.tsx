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
  computeContinuousArea,
  computeContinuousPerimeter,
  euclideanDistanceTransform,
  zhangSuenThinning,
  pruneSkeletonBranches,
  getSkeletonEndpoints,
  getSkeletonJunctions,
  computeSkeletonArcLength,
  computeSkeletonLongestPath,
  computeSkeletonLongestPathData,
  computeAllScagnostics,
  extractSkeletonBranches,
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
// Constants
// ============================================================================

const PRIMARY_PERCENTILE = 50

// ============================================================================
// Step Components (Academic Style)
// ============================================================================

function DataGallery({
  scatterplots,
  gridSize,
  selectedIndex,
  onSelect,
  onDownload,
  isDownloading
}: {
  scatterplots: ScatterplotData[]
  gridSize: number
  selectedIndex: number | null
  onSelect: (index: number) => void
  onDownload: () => void
  isDownloading: boolean
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

      <div className="mb-4 flex justify-end">
        <button
          onClick={onDownload}
          disabled={isDownloading}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors"
        >
          {isDownloading ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Processing...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download All Scagnostic Results
            </>
          )}
        </button>
      </div>

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
                  className={`relative aspect-square border overflow-hidden transition-all ${selectedIndex === index
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
            Extracted iso-contour (white) at P{PRIMARY_PERCENTILE} threshold with convex hull overlay (red dashed).
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
  longestPathPoints,
  skeletonStats
}: {
  binaryGrid: BinaryGridType
  dtGrid: FloatGridType
  skeleton: BinaryGridType
  endpoints: Point[]
  junctions: Point[]
  longestPathPoints?: Point[]
  skeletonStats: { pixels: number; longestPath: number; arcLength: number }
}) {
  const gridSize = binaryGrid.length

  return (
    <section className="bg-white border border-gray-200 p-6">
      <SectionHeader
        number="5"
        title="Distance Transform & Medial Axis"
        subtitle="Zhang-Suen thinning with branch pruning (as per pipeline spec)"
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
          <FigureCaption number="5a">Binary mask M at P{PRIMARY_PERCENTILE}.</FigureCaption>
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
              longestPathPoints={longestPathPoints}
              gridSize={gridSize}
              label=""
            />
          </div>
          <FigureCaption number="5c">Pruned medial axis S with endpoints (green) and junctions (red).</FigureCaption>
        </div>
      </div>

      <div className="mt-4">
        <TableCaption number="2">Skeleton topology statistics (after pruning branches &lt; 1% diagonal).</TableCaption>
        <table className="w-full text-sm border-collapse max-w-md mx-auto">
          <tbody className="font-mono text-xs">
            <tr className="border-b border-gray-200">
              <td className="py-1.5 text-gray-600">Skeleton pixels</td>
              <td className="py-1.5 text-right text-gray-900">{skeletonStats.pixels}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-1.5 text-gray-600">Arc length L</td>
              <td className="py-1.5 text-right text-gray-900">{skeletonStats.arcLength.toFixed(1)} px</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-1.5 text-gray-600">Endpoints (degree=1)</td>
              <td className="py-1.5 text-right text-gray-900">{endpoints.length}</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-1.5 text-gray-600">Junctions (branch points)</td>
              <td className="py-1.5 text-right text-gray-900">{junctions.length}</td>
            </tr>
            <tr>
              <td className="py-1.5 text-gray-600">Longest path L_max</td>
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
 * Section 6: Formula Definitions & Semantic Analysis
 * Updated to match image_scagnostics_pipeline2.tex
 */
function FormulasSection() {
  const formulas = [
    {
      metric: "Stringy",
      formula: "\\frac{L_{\\text{max}}}{L_{\\text{total}}}",
      description: "Ratio of longest skeleton path to total skeleton length",
      original: "Ratio of path length to α-hull perimeter in MST",
      assessment: "Good",
      notes: "Simplified ratio: captures how much of the skeleton structure contributes to the main linear path versus branching."
    },
    {
      metric: "Sparse",
      formula: "1 - \\frac{|M|}{A_{\\text{hull}}}",
      description: "One minus filled pixels over convex hull area",
      original: "Ratio of points to α-hull area (inverse density)",
      assessment: "Excellent",
      notes: "Direct analogue using pixel density. Convex hull from binary mask matches α-hull at α→∞."
    },
    {
      metric: "Convex",
      formula: "\\frac{A}{A_{\\text{hull}}}",
      description: "Contour area divided by convex hull area",
      original: "Ratio of α-hull area to convex hull area",
      assessment: "Excellent",
      notes: "Nearly identical formulation. Subpixel marching squares contour area closely approximates α-shape area."
    },
    {
      metric: "Skinny",
      formula: "\\lambda_1(1-IQ) + \\lambda_2\\frac{\\sigma_r^2}{\\bar{r}^2}",
      description: "IQ component + medial width variance",
      original: "1 - 4πA/P² combined with width variability",
      assessment: "Excellent",
      notes: "As per LaTeX: combines isoperimetric quotient (1 - 4πA/P²) with medial axis width variance (Var_r/r̄²). λ₁=0.7, λ₂=0.3 for balanced measure."
    },
    {
      metric: "Clumpy",
      formula: "\\max\\left(\\frac{B \\cdot \\text{Var}(\\{a_i\\})}{A^2}, 1-\\frac{1}{n}\\right)",
      description: "Blob variance measure or connected component measure",
      original: "RUNT statistic on MST edge lengths",
      assessment: "Good",
      notes: "Combines watershed blob segmentation (B blobs, areas aᵢ) with connected component count (n). Captures both density-based and spatial clustering."
    },
    {
      metric: "Outlying",
      formula: "\\frac{1}{2}(O_M + O_k)",
      description: "Average of Mahalanobis + branch-based outlying",
      original: "Length of outlying MST edges / total edge length",
      assessment: "Excellent",
      notes: "As per LaTeX: O_M uses robust Mahalanobis distance (pixels > med + 3·MAD), O_k uses thin skeleton branches. Combines statistical and geometric outlier detection."
    },
    {
      metric: "Skewed",
      formula: "\\frac{|\\mu_3|}{\\mu_2^{3/2}}",
      description: "Skewness along principal axis",
      original: "Skewness of MST edge length distribution",
      assessment: "Excellent",
      notes: "As per LaTeX: projects intensity-weighted pixels onto principal eigenvector, computes |μ₃|/μ₂^(3/2). Captures asymmetry along main axis."
    },
    {
      metric: "Striated",
      formula: "1 - V_{\\text{circ}}",
      description: "One minus circular variance of orientations",
      original: "Measure of parallel lines using angle consistency",
      assessment: "Excellent",
      notes: "As specified in LaTeX: 1 - circular variance of orientation angles θ(x,y) from structure tensor. High coherence = low variance = striated."
    },
    {
      metric: "Monotonic",
      formula: "|\\rho|",
      description: "Absolute Spearman correlation on skeleton path",
      original: "Spearman correlation on point coordinates",
      assessment: "Excellent",
      notes: "As specified: sample points along principal skeleton path, compute |ρ| between x and y ranks. Captures monotonic trends."
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
  const [isDownloading, setIsDownloading] = useState(false)

  const handleDownload = async () => {
    if (!dataset) return
    setIsDownloading(true)

    // Allow UI to update before heavy computation
    await new Promise(resolve => setTimeout(resolve, 100))

    try {
      const headers = [
        "Name",
        "Category",
        "Points",
        "Stringy",
        "Sparse",
        "Convex",
        "Skinny",
        "Clumpy",
        "Outlying",
        "Skewed",
        "Striated",
        "Monotonic"
      ]

      const rows = [headers.join(",")]

      for (const plot of dataset.scatterplots) {
        // Replicate pipeline logic for each plot
        const original = pointsToFloatGrid(plot.points, gridSize, 5.0)
        const smoothed = gaussianBlur(original, smoothingSigma)

        // Thresholding
        const thresholds = multiThresholdSegmentation(smoothed, [50, 75, 90, 95])
        const binary = thresholds.find(t => t.percentile === PRIMARY_PERCENTILE)?.binary
        if (!binary) continue

        // Contours
        const thresholdVal = getPercentileValue(smoothed, PRIMARY_PERCENTILE)
        const contours = marchingSquares(smoothed, thresholdVal)

        // Convex Hull from all points
        const allPoints = contours.flat()
        const convexHull = computeConvexHull(allPoints)

        // Compute Scagnostics
        const scagnostics = computeAllScagnostics(
          smoothed,
          binary,
          contours,
          convexHull
        )

        const row = [
          `"${plot.name}"`,
          `"${plot.category}"`,
          plot.n_points,
          scagnostics.stringy.toFixed(6),
          scagnostics.sparse.toFixed(6),
          scagnostics.convex.toFixed(6),
          scagnostics.skinny.toFixed(6),
          scagnostics.clumpy.toFixed(6),
          scagnostics.outlying.toFixed(6),
          scagnostics.skewed.toFixed(6),
          scagnostics.striated.toFixed(6),
          scagnostics.monotonic.toFixed(6)
        ].join(",")

        rows.push(row)

        // Yield to main thread every few iterations to keep UI responsive
        if (dataset.scatterplots.indexOf(plot) % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }

      const csvContent = rows.join("\n")
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.setAttribute("href", url)
      link.setAttribute("download", `scagnostics_results_${new Date().toISOString().slice(0, 10)}.csv`)
      link.style.visibility = "hidden"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

    } catch (error) {
      console.error("Error computing scagnostics:", error)
      alert("An error occurred while computing scagnostics. Check console for details.")
    } finally {
      setIsDownloading(false)
    }
  }

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

    const pBinary = thresholds.find(t => t.percentile === PRIMARY_PERCENTILE)?.binary
    const threshold = getPercentileValue(smoothedGrid, PRIMARY_PERCENTILE)
    const contours = marchingSquares(smoothedGrid, threshold)

    // Use all contours for area and perimeter
    const area = contours.reduce((sum, c) => sum + computeContinuousArea(c), 0)
    const perimeter = contours.reduce((sum, c) => sum + computeContinuousPerimeter(c), 0)

    // Convex Hull from all contour points
    const allPoints = contours.flat()
    const convexHull = computeConvexHull(allPoints)

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
    const pBinary = thresholds.find(t => t.percentile === PRIMARY_PERCENTILE)?.binary
    if (!pBinary || !pBinary.length) return null

    const dt = euclideanDistanceTransform(pBinary)
    const rawSkeleton = zhangSuenThinning(pBinary)

    // Prune short branches (1% of diagonal to remove noise, as per LaTeX spec)
    const diag = Math.sqrt(2) * gridSize
    const pruneLength = diag * 0.01
    const skeleton = pruneSkeletonBranches(rawSkeleton, pruneLength)

    const endpoints = getSkeletonEndpoints(skeleton)
    const junctions = getSkeletonJunctions(skeleton)
    const skeletonPixels = countFilledCells(skeleton)
    const arcLength = computeSkeletonArcLength(skeleton)

    // Extract branches for statistics
    const branches = extractSkeletonBranches(skeleton, dt)

    // Compute longest path using BFS (same as lib function)
    const longestPath = computeSkeletonLongestPath(skeleton)
    const longestPathPoints = computeSkeletonLongestPathData(skeleton)

    console.log("Skeleton Stats:", {
      longestPath,
      arcLength,
      ratio: longestPath / arcLength,
      pixels: skeletonPixels,
      branches: branches.length
    })

    return {
      dt,
      skeleton,
      rawSkeleton,
      endpoints,
      junctions,
      branches,
      longestPathPoints,
      stats: { pixels: skeletonPixels, longestPath, arcLength }
    }
  }, [thresholds, gridSize])

  const allScagnostics = useMemo(() => {
    const pBinary = thresholds.find(t => t.percentile === PRIMARY_PERCENTILE)?.binary
    if (!smoothedGrid.length || !pBinary || !contourData.contours.length) return null

    return computeAllScagnostics(
      smoothedGrid,
      pBinary,
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
          onDownload={handleDownload}
          isDownloading={isDownloading}
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

            {skeletonData && thresholds.find(t => t.percentile === PRIMARY_PERCENTILE)?.binary && (
              <SkeletonSection
                binaryGrid={thresholds.find(t => t.percentile === PRIMARY_PERCENTILE)!.binary}
                dtGrid={skeletonData.dt}
                skeleton={skeletonData.skeleton}
                endpoints={skeletonData.endpoints}
                junctions={skeletonData.junctions}
                longestPathPoints={skeletonData.longestPathPoints}
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