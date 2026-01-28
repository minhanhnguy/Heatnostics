"use client"

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { FaSpinner, FaChevronDown, FaChevronUp } from "react-icons/fa"
import { UMAP } from "umap-js"
import MiniSegmentChart from "@/components/chart/MiniSegmentChart"
import { type ScagnosticsResult, SCAGNOSTICS_LABELS, extractDamagePoints } from "@/lib/geometricUtils"
import type { PMISFeature } from "@/components/chart/MiniSegmentChart"
import { getScoreCategory, getCategoryColor } from "@/components/TableModalPMIS"

interface ScagnosticsValidationProps {
  features: PMISFeature[]
  viewType: 'county' | 'district'
  headerContent?: React.ReactNode
  maxConditionScore?: number
  minPointsK?: number // 1, 3 or 5, defaults to 5
  addChart?: (chart: { highway: string; county: string; field: string }, scoreValue: number) => void
  useStrategicData?: boolean // Use strategic scagnostics data file
}

interface PrecomputedScagnostics {
  highway: string
  location: string
  pointCount: number
  scagnostics: ScagnosticsResult
}

interface HighwayScagnostics extends PrecomputedScagnostics {
  segments: PMISFeature[]
}

type MetricKey = keyof ScagnosticsResult

// Colors for each metric
const METRIC_COLORS: Record<MetricKey, string> = {
  outlying: '#EF4444',   // Red
  skewed: '#F97316',     // Orange
  stringy: '#EAB308',    // Yellow
  sparse: '#22C55E',     // Green
  convex: '#06B6D4',     // Cyan
  clumpy: '#3B82F6',     // Blue
  skinny: '#8B5CF6',     // Purple
  striated: '#EC4899',   // Pink
  monotonic: '#6366F1',  // Indigo
}

// Simplified chart item component - uses MiniSegmentChart directly
const ChartItem = React.memo(({
  item,
  metricKey,
  addChart,
}: {
  item: HighwayScagnostics
  metricKey: MetricKey
  addChart?: (chart: { highway: string; county: string; field: string }, scoreValue: number) => void
  index?: number // kept for compatibility but unused
}) => {
  // Use all segments - no sampling for accuracy
  return (
    <div className="border rounded-lg p-3 bg-gray-50 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate" title={item.highway}>
            {item.highway}
          </div>
          <div className="text-xs text-gray-500 truncate" title={item.location}>
            {item.location}
          </div>
        </div>
        <span
          className="text-lg font-bold ml-2 flex-shrink-0"
          style={{ color: METRIC_COLORS[metricKey] }}
        >
          {(item.scagnostics[metricKey] * 100).toFixed(0)}%
        </span>
      </div>
      <button
        onClick={() => {
          if (addChart) {
            addChart({ highway: item.highway, county: item.location, field: 'TX_CONDITION_SCORE' }, 0)
          }
        }}
        className="w-full h-32 border rounded overflow-hidden bg-white cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
        title={`Click to view larger heatmap (${item.segments.length} segments)`}
      >
        <MiniSegmentChart
          data={item.segments}
          metric="TX_CONDITION_SCORE"
          getCategory={getScoreCategory}
          getCategoryColor={getCategoryColor}
        />
      </button>
      <div className="flex items-center justify-between mt-2 text-xs">
        <span className={item.pointCount < 3 ? "text-amber-600 font-medium" : "text-gray-500"}>
          {item.pointCount < 3 ? "⚠️ Low Data: " : ""}{item.pointCount} points
        </span>
        <span className="text-gray-400">Click to expand</span>
      </div>
    </div>
  )
})

ChartItem.displayName = 'ChartItem'

const ScagnosticsValidation: React.FC<ScagnosticsValidationProps> = ({
  features,
  viewType,
  headerContent,
  minPointsK = 5,
  addChart,
  useStrategicData = false,
}) => {
  const [isLoading, setIsLoading] = useState(true)
  const [precomputedData, setPrecomputedData] = useState<PrecomputedScagnostics[]>([])
  const [umapData, setUmapData] = useState<{ x: number; y: number; item: HighwayScagnostics }[]>([])
  const [isComputingUmap, setIsComputingUmap] = useState(false)
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('outlying')
  const [expandedMetrics, setExpandedMetrics] = useState<Set<MetricKey>>(new Set(['outlying']))
  const svgRef = useRef<SVGSVGElement>(null)

  // Load precomputed scagnostics data based on minPointsK and useStrategicData
  useEffect(() => {
    setIsLoading(true)
    let dataFile: string
    if (useStrategicData) {
      dataFile = '/files/scagnostics_precomputed_k3_strategic.json'
    } else if (minPointsK === 3) {
      dataFile = '/files/scagnostics_precomputed_k3.json'
    } else {
      dataFile = '/files/scagnostics_precomputed.json'
    }

    fetch(dataFile)
      .then(res => res.json())
      .then(data => {
        const results = viewType === 'district' ? data.district : data.county
        setPrecomputedData(results)
        setIsLoading(false)
      })
      .catch(err => {
        console.error('Failed to load precomputed scagnostics:', err)
        setIsLoading(false)
      })
  }, [viewType, minPointsK, useStrategicData])

  // Group features by highway + location for segment lookup
  const featuresByKey = useMemo(() => {
    const map = new Map<string, PMISFeature[]>()
    features.forEach(f => {
      const highway = f.properties.TX_SIGNED_HIGHWAY_RDBD_ID
      const location = viewType === 'district'
        ? f.properties.RESPONSIBLE_DISTRICT
        : f.properties.COUNTY
      if (highway && location) {
        const formattedLocation = location.replace(/^\s*\d+\s*-\s*/, "").toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())
        const key = `${highway}|${formattedLocation}`
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(f)
      }
    })
    return map
  }, [features, viewType])

  // Merge precomputed data with segments
  const highwayScagnostics = useMemo((): HighwayScagnostics[] => {
    return precomputedData.map(item => {
      const key = `${item.highway}|${item.location}`
      const segments = featuresByKey.get(key) || []
      return { ...item, segments }
    }).filter(item => item.segments.length > 0)
  }, [precomputedData, featuresByKey])

  // Calculate kept and filtered counts for the current K value
  const { keptCount, filteredCount, totalCount } = useMemo(() => {
    const totalPairs = featuresByKey.size
    const keptPairs = highwayScagnostics.length
    return {
      keptCount: keptPairs,
      filteredCount: totalPairs - keptPairs,
      totalCount: totalPairs
    }
  }, [featuresByKey, highwayScagnostics])

  // Compute UMAP embedding - deferred to not block initial render
  useEffect(() => {
    if (highwayScagnostics.length < 10 || isLoading) {
      setUmapData([])
      return
    }

    setIsComputingUmap(true)

    const timeoutId = setTimeout(() => {
      const dataMatrix = highwayScagnostics.map(item => [
        item.scagnostics.outlying,
        item.scagnostics.skewed,
        item.scagnostics.stringy,
        item.scagnostics.sparse,
        item.scagnostics.convex,
        item.scagnostics.clumpy,
        item.scagnostics.skinny,
        item.scagnostics.striated,
        item.scagnostics.monotonic,
      ])

      try {
        const umap = new UMAP({
          nComponents: 2,
          nNeighbors: Math.min(15, Math.floor(highwayScagnostics.length / 3)),
          minDist: 0.1,
          spread: 1.0,
        })

        const embedding = umap.fit(dataMatrix)

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
        embedding.forEach(([x, y]) => {
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
        })
        const rangeX = maxX - minX || 1
        const rangeY = maxY - minY || 1

        const normalized = embedding.map(([x, y], i) => ({
          x: (x - minX) / rangeX,
          y: (y - minY) / rangeY,
          item: highwayScagnostics[i],
        }))

        setUmapData(normalized)
      } catch (err) {
        console.error('UMAP computation failed:', err)
        setUmapData([])
      }
      setIsComputingUmap(false)
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [highwayScagnostics, isLoading])

  // Get top N examples for each metric
  const getTopExamples = useCallback((metric: MetricKey, n: number = 5): HighwayScagnostics[] => {
    return [...highwayScagnostics]
      .sort((a, b) => b.scagnostics[metric] - a.scagnostics[metric])
      .slice(0, n)
  }, [highwayScagnostics])

  // Compute histogram bins for a metric
  const computeHistogram = useCallback((metric: MetricKey, numBins: number = 20) => {
    const values = highwayScagnostics.map(item => item.scagnostics[metric])
    if (values.length === 0) return []

    const bins: { start: number; end: number; count: number }[] = []
    const binWidth = 1 / numBins

    for (let i = 0; i < numBins; i++) {
      bins.push({
        start: i * binWidth,
        end: (i + 1) * binWidth,
        count: 0,
      })
    }

    values.forEach(v => {
      const binIndex = Math.min(Math.floor(v * numBins), numBins - 1)
      bins[binIndex].count++
    })

    return bins
  }, [highwayScagnostics])

  // Toggle metric expansion
  const toggleMetric = (metric: MetricKey) => {
    setExpandedMetrics(prev => {
      const next = new Set(prev)
      if (next.has(metric)) {
        next.delete(metric)
      } else {
        next.add(metric)
      }
      return next
    })
  }

  // Render examples section
  const renderExamplesSection = () => {
    if (highwayScagnostics.length === 0) {
      return (
        <div className="flex items-center justify-center h-32 text-gray-500">
          No data available
        </div>
      )
    }

    return (
      <div className="space-y-3">
        {SCAGNOSTICS_LABELS.map(({ key, label }) => {
          const isExpanded = expandedMetrics.has(key)
          const topExamples = isExpanded ? getTopExamples(key, 5) : []

          return (
            <div key={key} className="border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleMetric(key)}
                className="w-full px-4 py-2 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: METRIC_COLORS[key] }}
                  />
                  <span className="font-semibold text-gray-900 text-sm">{label}</span>
                  <span className="text-xs text-gray-500">
                    (avg: {(highwayScagnostics.reduce((sum, item) => sum + item.scagnostics[key], 0) / highwayScagnostics.length * 100).toFixed(1)}%)
                  </span>
                </div>
                {isExpanded ? <FaChevronUp className="text-gray-400" /> : <FaChevronDown className="text-gray-400" />}
              </button>

              {isExpanded && (
                <div className="p-3 bg-white">
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    {topExamples.map((item, idx) => (
                      <ChartItem
                        key={`${item.highway}-${item.location}-${idx}`}
                        item={item}
                        metricKey={key}
                        addChart={addChart}
                        index={idx}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Render distributions section
  const renderDistributionsSection = () => {
    if (highwayScagnostics.length === 0) {
      return (
        <div className="flex items-center justify-center h-32 text-gray-500">
          No data available
        </div>
      )
    }

    const numBins = 20

    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {SCAGNOSTICS_LABELS.map(({ key, label }) => {
          const bins = computeHistogram(key, numBins)
          const maxCount = Math.max(...bins.map(b => b.count), 1)
          const values = highwayScagnostics.map(item => item.scagnostics[key])
          const mean = values.reduce((s, v) => s + v, 0) / values.length
          const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
          const std = Math.sqrt(variance)

          return (
            <div key={key} className="border rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: METRIC_COLORS[key] }}
                />
                <span className="font-semibold text-gray-900 text-sm">{label}</span>
              </div>

              <div className="text-xs text-gray-500 mb-2 flex gap-3">
                <span>Mean: {(mean * 100).toFixed(1)}%</span>
                <span>Std: {(std * 100).toFixed(1)}%</span>
              </div>

              <div className="h-16 flex items-end gap-px">
                {bins.map((bin, i) => (
                  <div
                    key={i}
                    className="flex-1 transition-all hover:opacity-80"
                    style={{
                      height: `${(bin.count / maxCount) * 100}%`,
                      backgroundColor: METRIC_COLORS[key],
                      minHeight: bin.count > 0 ? '2px' : '0',
                    }}
                    title={`${(bin.start * 100).toFixed(0)}-${(bin.end * 100).toFixed(0)}%: ${bin.count} items`}
                  />
                ))}
              </div>

              <div className="flex justify-between mt-1 text-xs text-gray-400">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>

              <div className="mt-1 text-xs">
                {std < 0.1 ? (
                  <span className="text-red-500">Low variance - may not be discriminative</span>
                ) : std < 0.2 ? (
                  <span className="text-yellow-600">Moderate variance</span>
                ) : (
                  <span className="text-green-600">Good variance - discriminative</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Render UMAP section
  const renderUmapSection = () => {
    if (highwayScagnostics.length < 10) {
      return (
        <div className="flex items-center justify-center h-32 text-gray-500">
          Need at least 10 data points for UMAP visualization (currently have {highwayScagnostics.length})
        </div>
      )
    }

    if (isComputingUmap || umapData.length === 0) {
      return (
        <div className="flex items-center justify-center h-32">
          <FaSpinner className="animate-spin mr-2" />
          Computing UMAP embedding...
        </div>
      )
    }

    const width = 600
    const height = 350
    const padding = 40

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-700">Color by:</span>
          {SCAGNOSTICS_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSelectedMetric(key)}
              className={`px-2 py-1 text-xs rounded-full transition-colors ${selectedMetric === key
                ? 'text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              style={{
                backgroundColor: selectedMetric === key ? METRIC_COLORS[key] : undefined,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-4">
          <div className="border rounded-lg p-3 bg-white flex-1">
            <svg
              ref={svgRef}
              width={width}
              height={height}
              className="mx-auto"
            >
              <defs>
                <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                  <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#f0f0f0" strokeWidth="1" />
                </pattern>
              </defs>
              <rect x={padding} y={padding} width={width - 2 * padding} height={height - 2 * padding} fill="url(#grid)" />

              <text x={width / 2} y={height - 10} textAnchor="middle" className="text-xs fill-gray-400">
                UMAP Dimension 1
              </text>
              <text
                x={15}
                y={height / 2}
                textAnchor="middle"
                transform={`rotate(-90, 15, ${height / 2})`}
                className="text-xs fill-gray-400"
              >
                UMAP Dimension 2
              </text>

              {umapData.map((point, i) => {
                const x = padding + point.x * (width - 2 * padding)
                const y = padding + (1 - point.y) * (height - 2 * padding)
                const value = point.item.scagnostics[selectedMetric]
                const opacity = 0.3 + value * 0.7

                return (
                  <g key={i}>
                    <circle
                      cx={x}
                      cy={y}
                      r={4}
                      fill={METRIC_COLORS[selectedMetric]}
                      opacity={opacity}
                      className="cursor-pointer hover:r-6 transition-all"
                    >
                      <title>
                        {point.item.highway} - {point.item.location}
                        {'\n'}{selectedMetric}: {(value * 100).toFixed(0)}%
                        {'\n'}Points: {point.item.pointCount}
                      </title>
                    </circle>
                  </g>
                )
              })}
            </svg>
          </div>

          <div className="w-48 space-y-2">
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-xs text-gray-500">Total Points</div>
              <div className="text-lg font-bold text-gray-900">{umapData.length}</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-xs text-gray-500">High ({'>'}70%)</div>
              <div className="text-lg font-bold" style={{ color: METRIC_COLORS[selectedMetric] }}>
                {umapData.filter(p => p.item.scagnostics[selectedMetric] > 0.7).length}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-xs text-gray-500">Medium (30-70%)</div>
              <div className="text-lg font-bold text-yellow-600">
                {umapData.filter(p => p.item.scagnostics[selectedMetric] >= 0.3 && p.item.scagnostics[selectedMetric] <= 0.7).length}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-xs text-gray-500">Low ({'<'}30%)</div>
              <div className="text-lg font-bold text-gray-600">
                {umapData.filter(p => p.item.scagnostics[selectedMetric] < 0.3).length}
              </div>
            </div>
            {/* Color Legend - moved here from chart */}
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-xs text-gray-500 mb-1">{SCAGNOSTICS_LABELS.find(l => l.key === selectedMetric)?.label} Scale</div>
              <div
                className="h-3 rounded"
                style={{
                  background: `linear-gradient(to right, ${METRIC_COLORS[selectedMetric]}4D, ${METRIC_COLORS[selectedMetric]})`
                }}
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-lg shadow border bg-white">
      <div className="px-5 py-3 bg-gradient-to-r from-[rgb(20,55,90)] to-[rgb(30,65,100)] text-white font-bold flex-shrink-0 flex items-center justify-between">
        <span>Step 3: Scagnostics Validation</span>
        {headerContent && <div className="flex items-center">{headerContent}</div>}
      </div>

      <div className="px-4 py-2 bg-gray-50 border-b text-sm text-gray-700 flex items-center gap-4 flex-shrink-0">
        {totalCount > 0 && (
          <>
            <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-md font-medium">
              {keptCount} kept
            </span>
            <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded-md font-medium">
              {filteredCount} filtered
            </span>
          </>
        )}
        {isLoading && (
          <span className="flex items-center gap-1 text-blue-600">
            <FaSpinner className="animate-spin" />
            Loading...
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <FaSpinner className="animate-spin mr-2 text-blue-500" size={24} />
            <span className="text-gray-600">Loading precomputed scagnostics...</span>
          </div>
        ) : (
          <div className="space-y-6">
            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
                <span className="w-1 h-6 bg-blue-500 rounded"></span>
                Example Heatmaps for Each Metric
              </h2>
              <p className="text-sm text-gray-600 mb-3">
                Highway segments with the highest values for each scagnostics metric. Click to expand/collapse.
              </p>
              {renderExamplesSection()}
            </section>

            <hr className="border-gray-200" />

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
                <span className="w-1 h-6 bg-green-500 rounded"></span>
                Distribution Analysis
              </h2>
              <p className="text-sm text-gray-600 mb-3">
                Distribution of scagnostics values across all {highwayScagnostics.length} highway-location pairs.
                A good measure should have a varied distribution, not all clustered at 0 or 1.
              </p>
              {renderDistributionsSection()}
            </section>

            <hr className="border-gray-200" />

            <section>
              <h2 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
                <span className="w-1 h-6 bg-purple-500 rounded"></span>
                UMAP Clustering
              </h2>
              <p className="text-sm text-gray-600 mb-3">
                UMAP dimensionality reduction of the 9-dimensional scagnostics space to 2D.
                Clusters indicate highway segments with similar scagnostics profiles.
              </p>
              {renderUmapSection()}
            </section>
          </div>
        )}
      </div>


      {useStrategicData && (
        // Debug info removed
        null
      )}
    </div >
  )
}

export default ScagnosticsValidation
