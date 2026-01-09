"use client"

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react"
import { ITEMS_PER_PAGE } from "@/constants/pagination"
import { routePublic } from "@/config"
import { FaSearch, FaSpinner, FaChartLine, FaMapMarkerAlt, FaSort, FaSortUp, FaSortDown, FaChevronLeft, FaChevronRight } from "react-icons/fa"
import Papa from "papaparse"
import MiniSegmentChart, { type PMISFeature } from "@/components/chart/MiniSegmentChart"
import MiniGeometricChart from "@/components/chart/MiniGeometricChart"
import MiniRadarChart from "@/components/chart/MiniRadarChart"
import { isGeometricField, getGeometryType, getGeometryLabel, computeScagnostics, extractDamagePoints, normalizePoints, type ScagnosticsResult } from "@/lib/geometricUtils"

import { useIsMobile } from "@/hooks/useIsMobile"
import Card from "@/components/mobile/Card"
import InfoTooltip from "@/components/highway-heatmaps/heatmap-info-tooltips"
import { getMechanismHelp } from "@/components/highway-heatmaps/ranking-formula"
import {
  type FeatureLike,
  type RankingMechanism,
  type MetricKey,
  buildMechanisms,
  metricLabelMap,
} from "@/lib/highway-heatmap/rankingMechanism"


export const getScoreCategory = (scoreType: string, score: number): string => {
  if (scoreType === "condition") {
    if (score < 1) return "Invalid"
    if (score < 35) return "Very Poor"
    if (score < 50) return "Poor"
    if (score < 70) return "Fair"
    if (score < 90) return "Good"
    return "Very Good"
  } else if (scoreType === "distress") {
    if (score < 1) return "Invalid"
    if (score < 60) return "Very Poor"
    if (score < 70) return "Poor"
    if (score < 80) return "Fair"
    if (score < 90) return "Good"
    if (score <= 100) return "Very Good"
    return "Invalid"
  } else if (scoreType === "aadt") {
    if (score < 1) return "Invalid"
    const max = 371120
    const thresholds = [max * 0.125, max * 0.25, max * 0.375, max * 0.5, max * 0.625, max * 0.75, max * 0.875, max]
    for (let i = 0; i < thresholds.length; i++) {
      if (score <= thresholds[i]) return `Category ${i + 1}`
    }
    return "Invalid"
  } else if (scoreType === "cost") {
    if (score < 0.1) return "Invalid"
    const max = 543313
    const thresholds = [max * 0.125, max * 0.25, max * 0.375, max * 0.5, max * 0.625, max * 0.75, max * 0.875, max]
    for (let i = 0; i < thresholds.length; i++) {
      if (score <= thresholds[i]) return `Category ${i + 1}`
    }
    return "Invalid"
  } else {
    // ride score
    if (score < 0.1) return "Invalid"
    if (score < 1) return "Very Poor"
    if (score < 2) return "Poor"
    if (score < 3) return "Fair"
    if (score < 4) return "Good"
    return "Very Good"
  }
}

export const getCategoryColor = (category: string, scoreType: string): string => {
  if (category === "Invalid" || category === "No Data") {
    return "rgb(240, 240, 240)"
  }

  if (scoreType === "aadt") {
    const aadtColors = [
      "rgb(140, 190, 220)", "rgb(107, 174, 214)", "rgb(66, 146, 198)", "rgb(33, 113, 181)",
      "rgb(8, 81, 156)", "rgb(8, 69, 148)", "rgb(8, 48, 107)", "rgb(5, 24, 82)",
    ]
    const index = parseInt(category.split(" ")[1]) - 1
    return aadtColors[index] || "#ccc"
  } else if (scoreType === "cost") {
    const costColors = [
      "rgb(230, 220, 240)", "rgb(218, 218, 235)", "rgb(188, 189, 220)", "rgb(158, 154, 200)",
      "rgb(128, 125, 186)", "rgb(106, 81, 163)", "rgb(74, 20, 134)", "rgb(45, 0, 75)",
    ]
    const index = parseInt(category.split(" ")[1]) - 1
    return costColors[index] || "#ccc"
  } else {
    switch (category) {
      case "Very Poor": return "rgb(239, 68, 68)"
      case "Poor": return "rgb(249, 115, 22)"
      case "Fair": return "rgb(234, 179, 8)"
      case "Good": return "rgb(34, 197, 94)"
      case "Very Good": return "rgb(21, 128, 61)"
      case "Invalid": return "rgb(200, 200, 200)"
      default: return "rgb(75, 85, 99)"
    }
  }
}

// Inline function to avoid import issues
const cleanAndRound = (value: any): number => {
  if (value === null || typeof value === "undefined") return 0.0
  const cleaned = String(value).replace(/[^0-9.]/g, "")
  if (cleaned === "") return 0.0
  const num = parseFloat(cleaned)
  if (isNaN(num)) return 0.0
  return Number(num.toFixed(3))
}

const isInvalidForImprovementPerCost = (m: MetricKey) => m === "aadt" || m === "cost"

// Bridge gap functions
const GAP_COLLAPSE_THRESHOLD = 100
const BRIDGE_EPS = 0.0001

function calcBegin(f: PMISFeature): number {
  const bm = cleanAndRound((f as any).properties?.TX_BEG_REF_MARKER_NBR)
  const bd = cleanAndRound((f as any).properties?.TX_BEG_REF_MRKR_DISP)
  return bm + bd
}

function calcEnd(f: PMISFeature): number {
  const len = cleanAndRound((f as any).properties?.TX_LENGTH)
  return calcBegin(f) + len
}

function makeBridgeFrom(template: PMISFeature, pos: number, gapMiles: number): PMISFeature {
  const begMarker = Math.floor(pos)
  const disp = pos - begMarker

  const baseProps = { ...((template as any).properties || {}) }

  const bridgedProps = {
    ...baseProps,
    TX_BEG_REF_MARKER_NBR: Number(begMarker.toFixed(0)),
    TX_BEG_REF_MRKR_DISP: Number(disp.toFixed(3)),
    TX_LENGTH: BRIDGE_EPS,
    TX_CONDITION_SCORE: null,
    TX_DISTRESS_SCORE: null,
    TX_RIDE_SCORE: null,
    TX_AADT_CURRENT: null,
    TX_MAINTENANCE_COST_AMT: null,
    IS_GAP_BRIDGE: true,
    GAP_SIZE_MILES: gapMiles,
    BRIDGE_POS_ABS: pos,
    EFF_YEAR: null,
  }

  const bridge: PMISFeature = {
    ...(template as any),
    properties: bridgedProps,
  }
  return bridge
}

function bridgeGapsForSegments(segments: PMISFeature[]): PMISFeature[] {
  if (!segments || segments.length < 2) return segments || []

  const sorted = [...segments].sort((a, b) => calcBegin(a) - calcBegin(b))

  const minBegin = calcBegin(sorted[0])
  const maxEnd = sorted.reduce((mx, s) => Math.max(mx, calcEnd(s)), -Infinity)

  const bridged: PMISFeature[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i]
    const nxt = sorted[i + 1]
    bridged.push(cur)

    const curEnd = calcEnd(cur)
    const nxtBegin = calcBegin(nxt)
    const gap = nxtBegin - curEnd

    if (gap >= GAP_COLLAPSE_THRESHOLD) {
      const mid = curEnd + gap / 2
      if (mid > minBegin && mid < maxEnd) {
        bridged.push(makeBridgeFrom(cur, mid, gap))
      }
    }
  }
  bridged.push(sorted[sorted.length - 1])

  bridged.sort((a, b) => calcBegin(a) - calcBegin(b))
  return bridged
}

// Helper to check if a field is a Scagnostics field
const isScagnosticsField = (field: string): boolean => field.startsWith('SCAG_')

// Get the scagnostics key from field name
const getScagKey = (field: string): keyof ScagnosticsResult | null => {
  const map: Record<string, keyof ScagnosticsResult> = {
    'SCAG_OUTLYING': 'outlying',
    'SCAG_SKEWED': 'skewed',
    'SCAG_STRINGY': 'stringy',
    'SCAG_SPARSE': 'sparse',
    'SCAG_CONVEX': 'convex',
    'SCAG_CLUMPY': 'clumpy',
    'SCAG_SKINNY': 'skinny',
    'SCAG_STRIATED': 'striated',
    'SCAG_MONOTONIC': 'monotonic'
  }
  return map[field] || null
}

// This new component will defer rendering of the MiniSegmentChart
const DeferredChartCell: React.FC<{
  segmentData: PMISFeature[]
  metric: string
  getCategory: (scoreType: string, score: number) => string
  getCategoryColor: (category: string, scoreType: string) => string
  color: string
  index: number
  maxScore?: number
}> = ({ segmentData, metric, getCategory, getCategoryColor, color, index, maxScore }) => {
  const [isReady, setIsReady] = useState(false)

  // Memoize scagnostics computation
  const scagnostics = useMemo(() => {
    if (!isScagnosticsField(metric) || segmentData.length === 0) return null
    const damagePoints = extractDamagePoints(segmentData, maxScore || 49)
    if (damagePoints.length < 5) return null
    const normalizedPoints = normalizePoints(damagePoints)
    return computeScagnostics(normalizedPoints)
  }, [segmentData, metric, maxScore])

  useEffect(() => {
    // Stagger rendering to prevent blocking the main thread.
    // Each chart will render slightly after the previous one.
    const handle = setTimeout(() => setIsReady(true), index * 2)
    return () => clearTimeout(handle)
  }, [index])

  if (!isReady) {
    return <FaSpinner className="animate-spin mx-auto" size={16} style={{ color }} />
  }

  // Check if this is a Scagnostics field
  if (isScagnosticsField(metric)) {
    if (!scagnostics) {
      return (
        <div className="w-full h-full bg-gray-100 flex items-center justify-center text-xs text-gray-400">
          {"< 5 pts"}
        </div>
      )
    }

    // SCAG_RADAR shows the mini radar chart
    if (metric === 'SCAG_RADAR') {
      return (
        <div className="w-full h-full flex items-center justify-center">
          <MiniRadarChart
            values={scagnostics}
            size={120}
            color="#3B82F6"
          />
        </div>
      )
    }

    // Individual metric - show percentage value with color coding
    const scagKey = getScagKey(metric)
    if (scagKey) {
      const value = scagnostics[scagKey]
      const percentage = Math.round(value * 100)
      // Color based on value: low=green, mid=yellow, high=red
      const bgColor = value < 0.3 ? '#dcfce7' : value < 0.7 ? '#fef9c3' : '#fee2e2'
      const textColor = value < 0.3 ? '#166534' : value < 0.7 ? '#854d0e' : '#991b1b'

      return (
        <div
          className="w-full h-full flex items-center justify-center text-sm font-medium"
          style={{ backgroundColor: bgColor, color: textColor }}
        >
          {percentage}%
        </div>
      )
    }
  }

  // Check if this is a geometric field
  if (isGeometricField(metric)) {
    const geometryType = getGeometryType(metric)
    if (geometryType) {
      return (
        <MiniGeometricChart
          data={segmentData}
          geometryType={geometryType}
          maxScore={maxScore || 49}
        />
      )
    }
  }

  return (
    <MiniSegmentChart
      data={segmentData}
      metric={metric}
      getCategory={getCategory}
      getCategoryColor={getCategoryColor}
      maxScore={maxScore}
    />
  )
}

// Pre-calculate score data to avoid recalculating during render
interface ScoreData {
  value: number
  category: string
  color: string
}

interface ProcessedFeature {
  highway: string
  county: string
  formattedCounty: string
  scores: { [key: string]: ScoreData }
  numYears?: number
  refLength?: number
  dataAvail?: number
  interestingness?: number
  yoyDiffSum?: { [field: string]: number }
}

interface TableModalPMISProps {
  title?: string
  containerDimensions?: { width: number; height: number }
  setSelectedHighway?: (hwy: string) => void
  showMapModal?: (rte_nm: string, location: string, locationType: 'county' | 'district') => void
  mapModalOpen?: boolean
  mapModalInfo?: { highway: string; location: string; locationType: 'county' | 'district' } | null
  addChart?: (chart: { highway: string; county: string; field: string }, scoreValue: number) => void
  activeHeatMapData?: {
    highway: string
    county: string
    scores: { value: string; label: string }[]
    id: string
  }[]
  search?: string
  setSearch?: (search: string) => void
  features?: PMISFeature[]
  viewType?: 'county' | 'district'
  setViewType?: (viewType: 'county' | 'district') => void
  onDataProcessed?: (data: ProcessedFeature[]) => void
  onSegmentDataReady?: (data: Map<string, PMISFeature[]>) => void
  onAvailableHighwaysReady?: (highways: Set<string>) => void
  headerContent?: React.ReactNode
  customFields?: string[]
  maxConditionScore?: number
}

type SortDirection = "asc" | "desc" | null
type SortColumn = "highway" | "county" | "condition" | "distress" | "ride" | "aadt" | "cost" | "yoy_condition" | null

interface TableRowProps {
  item: ProcessedFeature
  fields: string[]
  isHighwayAvailable: (highway: string) => boolean
  handleMapClick: (highway: string, county: string) => void
  handleChartClick: (highway: string, county: string, field: string) => void
  activeHeatMapData: {
    highway: string
    county: string
    scores: { value: string; label: string }[]
    id: string
  }[]
  getScoreCategory: (scoreType: string, score: number) => string
  getCategoryColor: (category: string, scoreType: string) => string
  segmentData: PMISFeature[]
  rowIndex: number
  clickedMapKey: string | null
  rankingScore?: number | null
  rankingHasScore?: boolean
  rankingActive: boolean
  azMode: boolean
  maxConditionScore?: number
}

const TableRow: React.FC<TableRowProps> = React.memo(
  ({ item, fields, isHighwayAvailable, handleMapClick, handleChartClick, activeHeatMapData, getScoreCategory, getCategoryColor, segmentData, rowIndex, clickedMapKey, rankingScore, rankingHasScore, rankingActive, azMode, maxConditionScore }) => {
    const isMapClicked = clickedMapKey === `${item.highway}|${item.formattedCounty}`
    return (
      <tr className="hover:bg-blue-50 border-b border-gray-200">
        {/* Highway */}
        <td className="p-2 border-r border-gray-300 overflow-hidden">
          <div className="w-full h-[56px] md:h-[100px] flex items-center">
            <span className="text-xs font-medium truncate block text-gray-900">{item.highway}</span>
          </div>
        </td>

        {/* County */}
        <td className="p-2 border-r border-gray-300 overflow-hidden">
          <div className="w-full h-[56px] md:h-[100px] flex items-center">
            <span className="text-xs truncate block text-gray-900">{item.formattedCounty}</span>
          </div>
        </td>



        {/* Chart Columns */}
        {fields.map((field: string, fieldIndex) => {
          const scoreData = item.scores[field]
          const isActive = activeHeatMapData.some(
            (d) => d.highway === item.highway && d.county === item.formattedCounty && d.scores.some((s) => s.value === field),
          )
          // For geometric and scagnostics fields, hasData is true if there's segment data
          // For score fields, hasData requires valid score data
          const isGeometric = isGeometricField(field)
          const isScag = isScagnosticsField(field)
          const hasData = (isGeometric || isScag) ? segmentData.length > 0 : (scoreData && scoreData.category !== "No Data")
          const cellIndex = fieldIndex + 2 // Offset for Map and Highway/Loc columns

          return (
            <td key={`${field}-${fieldIndex}`} className="p-0 border-r border-gray-300 relative" style={{ width: field === 'SCAG_RADAR' ? "120px" : isScag ? "50px" : "120px" }}>
              <div className="w-full h-[56px] md:h-[100px]">
                <button
                  onClick={() => (hasData ? handleChartClick(item.highway, item.formattedCounty, field) : undefined)}
                  className="w-full h-full relative flex items-stretch justify-center"
                  title={isGeometric ? getGeometryLabel(field) : (hasData ? `${scoreData?.category || "N/A"}: ${scoreData?.value || "N/A"}` : "No data available")}
                  disabled={!hasData}
                >
                  {isActive && (
                    <div className="absolute inset-0 border-2 border-black rounded" style={{ zIndex: 10 }} />
                  )}
                  {hasData ? (
                    <DeferredChartCell
                      segmentData={segmentData}
                      metric={field}
                      getCategory={getScoreCategory}
                      getCategoryColor={getCategoryColor}
                      color={isGeometric ? '#374151' : (scoreData?.color || '#ccc')}
                      index={cellIndex}
                      maxScore={maxConditionScore}
                    />
                  ) : (
                    <div className="w-full h-full bg-gray-100 flex items-center justify-center text-xs text-gray-400">
                      No Data
                    </div>
                  )}
                </button>
              </div>
            </td>
          )
        })}
      </tr>
    )
  },
)
TableRow.displayName = "TableRow"

// Table body component
interface TableBodyProps {
  visibleRows: ProcessedFeature[]
  fields: string[]
  isHighwayAvailable: (highway: string) => boolean
  handleMapClick: (highway: string, county: string) => void
  handleChartClick: (highway: string, county: string, field: string) => void
  activeHeatMapData: {
    highway: string
    county: string
    scores: { value: string; label: string }[]
    id: string
  }[]
  getScoreCategory: (scoreType: string, score: number) => string
  getCategoryColor: (category: string, scoreType: string) => string
  segmentDataByHighwayCounty: Map<string, PMISFeature[]>
  clickedMapKey: string | null
  scoreLookup: Map<string, { score: number; hasScore: boolean }>
  rankingActive: boolean
  azMode: boolean
  maxConditionScore?: number
}

const TableBodyComponent: React.FC<TableBodyProps> = React.memo(
  ({
    visibleRows,
    fields,
    isHighwayAvailable,
    handleMapClick,
    handleChartClick,
    activeHeatMapData,
    getScoreCategory,
    getCategoryColor,
    segmentDataByHighwayCounty,
    clickedMapKey,
    scoreLookup,
    rankingActive,
    azMode,
    maxConditionScore,
  }) => {
    return (
      <tbody>
        {visibleRows.map((item, index) => {
          const key = `${item.highway}|${item.formattedCounty}`
          const entry = rankingActive ? scoreLookup.get(key) : undefined
          const rankingScore = rankingActive ? (entry?.score ?? 0) : null
          const rankingHasScore = rankingActive ? (entry?.hasScore ?? false) : false
          return (
            <TableRow
              key={`${item.highway}-${item.formattedCounty}-${index}`}
              item={item}
              fields={fields}
              isHighwayAvailable={isHighwayAvailable}
              handleMapClick={handleMapClick}
              handleChartClick={handleChartClick}
              activeHeatMapData={activeHeatMapData}
              getScoreCategory={getScoreCategory}
              getCategoryColor={getCategoryColor}
              segmentData={segmentDataByHighwayCounty.get(key) || []}
              rowIndex={index}
              clickedMapKey={clickedMapKey}
              rankingScore={rankingScore}
              rankingHasScore={rankingHasScore}
              rankingActive={rankingActive}
              azMode={azMode}
              maxConditionScore={maxConditionScore}
            />
          )
        })}
      </tbody>
    )
  }
)

TableBodyComponent.displayName = "TableBodyComponent"

const TableModalPMIS: React.FC<TableModalPMISProps> = ({
  title = "Highway Data",
  containerDimensions,
  setSelectedHighway = () => { },
  showMapModal = () => { },
  mapModalOpen = false,
  mapModalInfo = null,
  addChart = () => { },
  activeHeatMapData = [],
  search = "",
  setSearch = () => { },
  features = [],
  viewType: externalViewType,
  setViewType: externalSetViewType,
  onDataProcessed,
  onSegmentDataReady,
  onAvailableHighwaysReady,
  headerContent,
  customFields,
  maxConditionScore,
}) => {
  const [loading, setLoading] = useState(true)
  const [availableHighways, setAvailableHighways] = useState<Set<string>>(new Set())
  const [processedData, setProcessedData] = useState<ProcessedFeature[]>([])
  const [sortColumn, setSortColumn] = useState<SortColumn>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = ITEMS_PER_PAGE
  const [localSearch, setLocalSearch] = useState(search)
  const [searchTerm, setSearchTerm] = useState(search)
  const [internalViewType, setInternalViewType] = useState<'county' | 'district'>('county')
  const [clickedMapKey, setClickedMapKey] = useState<string | null>(null)
  const isMounted = useRef(true)

  // Ranking state
  const [selectedMechanismId, setSelectedMechanismId] = useState<string>("sum-of-differences")
  const azMode = selectedMechanismId === "alpha-az"
  const [selectedRankingMetric, setSelectedRankingMetric] = useState<MetricKey>("condition")
  const rankingActive = !azMode
  const rankingMetricLabel = metricLabelMap[selectedRankingMetric] || "Condition"

  // Use external viewType if provided, otherwise use internal
  const viewType = externalViewType !== undefined ? externalViewType : internalViewType
  const setViewType = externalSetViewType || setInternalViewType

  const headerRef = useRef<HTMLTableSectionElement>(null)
  const rankBtnRef = useRef<HTMLButtonElement | null>(null)
  const rankMenuRef = useRef<HTMLDivElement | null>(null)
  const [rankMenuOpen, setRankMenuOpen] = useState(false)

  // Short labels for ranking mechanisms
  const mechanismLabels: Record<string, string> = {
    "alpha-az": "A–Z",
    "sum-of-differences": "Absolute Sum",
    "improvement-over-time": "Sum of Diff",
    "improvement-per-cost": "Cost Efficiency",
    "condition-aadt-exposure": "Cond×AADT",
  }

  const fields = useMemo(
    () => customFields || ["TX_CONDITION_SCORE", "TX_DISTRESS_SCORE", "TX_RIDE_SCORE", "TX_AADT_CURRENT", "TX_MAINTENANCE_COST_AMT"],
    [customFields],
  )

  // Format county name
  const formatCountyName = useCallback((county: string | undefined): string => {
    if (!county) return ""
    const withoutPrefix = county.replace(/^\s*\d+\s*-\s*/, "")
    return withoutPrefix.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  }, [])

  const segmentDataByHighwayCounty = useMemo(() => {
    const map = new Map<string, PMISFeature[]>()
    if (!features || features.length === 0) return map

    features.forEach((feature) => {
      const highway = feature.properties.TX_SIGNED_HIGHWAY_RDBD_ID
      const location = viewType === 'district' ? feature.properties.RESPONSIBLE_DISTRICT : feature.properties.COUNTY
      if (highway && location) {
        // Normalize both county and district names to strip numeric prefixes
        // (e.g., "128 - JONES" or "08 - ABILENE") so keys match the
        // aggregated CSVs used for the table rows.
        const formattedLocation = formatCountyName(location)
        const key = `${highway}|${formattedLocation}`
        if (!map.has(key)) map.set(key, [])
        map.get(key)?.push(feature)
      }
    })

    onSegmentDataReady?.(map)
    return map
  }, [features, formatCountyName, viewType, onSegmentDataReady])

  const segmentDataByHighwayCountyBridged = useMemo(() => {
    const bridgedMap = new Map<string, PMISFeature[]>()
    for (const [key, segs] of segmentDataByHighwayCounty) {
      bridgedMap.set(key, bridgeGapsForSegments(segs))
    }
    return bridgedMap
  }, [segmentDataByHighwayCounty])

  // Memoize interestingness calculations separately for better performance
  const interestingnessCache = useMemo(() => {
    const cache = new Map<string, number>()

    if (processedData.length === 0) return cache

    processedData.forEach((item) => {
      const key = `${item.highway}|${item.formattedCounty}`
      if (cache.has(key)) return

      const segments = segmentDataByHighwayCounty.get(key) || []
      if (segments.length === 0) {
        cache.set(key, 0)
        return
      }

      const scores: number[] = []
      fields.forEach((field) => {
        segments.forEach((s) => {
          const score = Number(s.properties[field])
          if (!isNaN(score) && score > 0) scores.push(score)
        })
      })

      let interestingness = 0
      if (scores.length > 1) {
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length
        const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / (scores.length - 1)
        const stdDev = Math.sqrt(variance)
        interestingness = stdDev * Math.log10(scores.length + 1)
      } else {
        interestingness = scores.length
      }

      cache.set(key, interestingness)
    })

    return cache
  }, [processedData, segmentDataByHighwayCounty, fields])

  // Memoize pair metrics
  const pairMetrics = useMemo(() => {
    const metrics = new Map<string, { numYears: number; refLength: number; dataAvail: number }>()

    for (const [key, segments] of segmentDataByHighwayCounty) {
      if (segments.length === 0) continue

      const years = new Set(segments.map((f) => Number(f.properties.EFF_YEAR) || 0))
      const numYears = years.size

      let minBegin = Infinity
      let maxEnd = -Infinity
      let recordedMiles = 0

      segments.forEach((f) => {
        const beginMarker = cleanAndRound(f.properties.TX_BEG_REF_MARKER_NBR)
        const beginDisp = cleanAndRound(f.properties.TX_BEG_REF_MRKR_DISP)
        const length = cleanAndRound(f.properties.TX_LENGTH)
        const begin = beginMarker + beginDisp
        const end = begin + length

        minBegin = Math.min(minBegin, begin)
        maxEnd = Math.max(maxEnd, end)

        const score = Number(f.properties.TX_CONDITION_SCORE)
        if (!isNaN(score) && score > 0) {
          recordedMiles += length
        }
      })

      const refLength = minBegin === Infinity || maxEnd === -Infinity ? 0 : maxEnd - minBegin
      const dataAvail = refLength > 0 ? recordedMiles / refLength : 0

      metrics.set(key, { numYears, refLength, dataAvail })
    }

    return metrics
  }, [segmentDataByHighwayCounty])

  const processedDataWithMetrics = useMemo(() => {
    return processedData.map((item) => {
      const key = `${item.highway}|${item.formattedCounty}`
      const met = pairMetrics.get(key) || { numYears: 0, refLength: 0, dataAvail: 0 }
      const interestingness = interestingnessCache.get(key) || 0
      return { ...item, ...met, interestingness }
    })
  }, [processedData, pairMetrics, interestingnessCache])

  // Also notify parent component with enhanced data (for mobile)
  useEffect(() => {
    if (onDataProcessed && processedDataWithMetrics.length > 0) {
      onDataProcessed(processedDataWithMetrics)
    }
  }, [processedDataWithMetrics, onDataProcessed])

  // Process features once and store the result
  const processFeatures = useCallback((data: any[]): ProcessedFeature[] => {
    const processed: { [key: string]: ProcessedFeature } = {}

    data.forEach((row) => {
      const highway = row.TX_SIGNED_HIGHWAY_RDBD_ID || ""
      const location = viewType === 'district' ? (row.RESPONSIBLE_DISTRICT || "") : (row.COUNTY || "")
      const key = `${highway}|${location}`

      if (!processed[key]) {
        processed[key] = {
          highway,
          county: location,
          // For display and for feature-lookup keys, normalize both county and district
          // names to remove numeric prefixes and standardize casing.
          formattedCounty: formatCountyName(location),
          scores: {}
        }
      }

      // Pre-calculate all scores
      fields.forEach((field) => {
        const rawValue = row[field]
        if (rawValue !== undefined && rawValue !== null && rawValue !== "") {
          const value = Number(rawValue)
          if (isNaN(value)) {
            processed[key].scores[field] = { value: 0, category: "No Data", color: "rgb(240, 240, 240)" }
            return
          }

          let scoreType = ""
          switch (field) {
            case "TX_CONDITION_SCORE": scoreType = "condition"; break
            case "TX_DISTRESS_SCORE": scoreType = "distress"; break
            case "TX_RIDE_SCORE": scoreType = "ride"; break
            case "TX_AADT_CURRENT": scoreType = "aadt"; break
            case "TX_MAINTENANCE_COST_AMT": scoreType = "cost"; break
          }

          const category = getScoreCategory(scoreType, value)
          const color = getCategoryColor(category, scoreType)
          processed[key].scores[field] = { value, category, color }
        } else {
          processed[key].scores[field] = { value: 0, category: "No Data", color: "rgb(240, 240, 240)" }
        }
      })
    })

    return Object.values(processed)
  }, [fields, formatCountyName, viewType])

  // Fetch CSV data
  useEffect(() => {
    const fetchCSVData = async () => {
      try {
        const csvFile = viewType === 'district' ? 'hw_dist_avg.csv' : 'hw_cnty_avg.csv'
        const response = await fetch(`${routePublic}/files/${csvFile}`)
        const csvText = await response.text()

        Papa.parse(csvText, {
          header: true,
          dynamicTyping: true,
          skipEmptyLines: true,
          complete: (results) => {
            const validData = results.data.filter((row: any) => {
              if (viewType === 'district') {
                return row.RESPONSIBLE_DISTRICT && row.TX_SIGNED_HIGHWAY_RDBD_ID
              } else {
                return row.COUNTY && row.TX_SIGNED_HIGHWAY_RDBD_ID
              }
            })
            const processed = processFeatures(validData)

            if (isMounted.current) {
              setProcessedData(processed)
              setLoading(false)
              // Defer parent callback to avoid setState during parent render
              if (onDataProcessed) {
                queueMicrotask(() => onDataProcessed(processed))
              }
            }
          },
          error: (error: any) => {
            console.error("Error parsing CSV:", error)
            if (isMounted.current) setLoading(false)
          },
        })
      } catch (error: any) {
        console.error("Error fetching CSV data:", error)
        if (isMounted.current) setLoading(false)
      }
    }

    fetchCSVData()
  }, [processFeatures, viewType, onDataProcessed])

  // Fetch highway availability data
  useEffect(() => {
    const fetchGeoJSONData = async () => {
      try {
        const response = await fetch(`${routePublic}/files/pmis_lines_latest.geojson`)
        const data = await response.json()

        const highways = new Set<string>()
        data.features.forEach((feature: any) => {
          if (feature.properties && feature.properties.TX_SIGNED_HIGHWAY_RDBD_ID) {
            highways.add(feature.properties.TX_SIGNED_HIGHWAY_RDBD_ID)
          }
        })

        if (isMounted.current) {
          setAvailableHighways(highways)
          onAvailableHighwaysReady?.(highways)
        }
      } catch (error) {
        console.error("Error fetching GeoJSON data:", error)
      }
    }

    fetchGeoJSONData()
  }, [onAvailableHighwaysReady])

  const reformatHighwayName = useCallback((highway: string): string => {
    const lastSpaceIndex = highway.lastIndexOf(" ")
    if (lastSpaceIndex !== -1) {
      return highway.substring(0, lastSpaceIndex) + "-" + highway.substring(lastSpaceIndex + 1) + "G"
    }
    return highway + "G"
  }, [])

  const isHighwayAvailable = useCallback((highway: string): boolean => {
    // If we haven't loaded the highway data yet, assume it's available (optimistic approach)
    if (availableHighways.size === 0) {
      return true; // Allow clicking while data is loading
    }

    const reformattedHighway = reformatHighwayName(highway)
    return availableHighways.has(reformattedHighway)
  }, [availableHighways, reformatHighwayName])

  const handleMapClick = useCallback((highway: string, countyRaw: string) => {
    const formatted = formatCountyName(countyRaw)
    setSelectedHighway(highway)
    setClickedMapKey(`${highway}|${formatted}`)
    showMapModal(highway, formatted, viewType)
  }, [setSelectedHighway, showMapModal, viewType, formatCountyName])

  // Clear clicked map state when modal closes
  useEffect(() => {
    if (!mapModalOpen) {
      setClickedMapKey(null)
    } else if (mapModalInfo) {
      // normalize incoming too
      setClickedMapKey(`${mapModalInfo.highway}|${formatCountyName(mapModalInfo.location)}`)
    }
  }, [mapModalOpen, mapModalInfo, formatCountyName])

  const handleChartClick = useCallback((highway: string, county: string, field: string) => {
    const feature = processedDataWithMetrics.find((f) => f.highway === highway && f.formattedCounty === county)
    const scoreValue = feature?.scores[field]?.value || 0
    // Pass maxScore for TX_CONDITION_SCORE and geometric fields
    const needsMaxScore = field === 'TX_CONDITION_SCORE' || isGeometricField(field)
    // Call addChart directly - parent uses startTransition to defer state updates
    addChart({ highway, county, field, maxScore: needsMaxScore ? maxConditionScore : undefined } as any, scoreValue)
  }, [processedDataWithMetrics, addChart, maxConditionScore])

  // Build synthetic features for ranking
  const syntheticFeatures: FeatureLike[] = useMemo(() => {
    return processedDataWithMetrics.map((row) => {
      const props: Record<string, unknown> = {
        TX_CONDITION_SCORE: row.scores?.["TX_CONDITION_SCORE"]?.value ?? null,
        TX_DISTRESS_SCORE: row.scores?.["TX_DISTRESS_SCORE"]?.value ?? null,
        TX_RIDE_SCORE: row.scores?.["TX_RIDE_SCORE"]?.value ?? null,
        TX_AADT_CURRENT: row.scores?.["TX_AADT_CURRENT"]?.value ?? null,
        TX_MAINTENANCE_COST_AMT: row.scores?.["TX_MAINTENANCE_COST_AMT"]?.value ?? null,
        _ID_HWY: row.highway,
        _ID_LOC: row.formattedCounty,
      }
      return { properties: props }
    })
  }, [processedDataWithMetrics])

  // Build mechanisms whenever data/view/metric changes
  const { mechanisms, errors: rankingErrors } = useMemo(() => {
    return buildMechanisms(syntheticFeatures, {
      metric: selectedRankingMetric,
      getSegmentsForPair: (hwy: string, loc: string) =>
        segmentDataByHighwayCounty.get(`${hwy}|${loc}`) || [],
    })
  }, [syntheticFeatures, selectedRankingMetric, segmentDataByHighwayCounty])

  // Validate selected mechanism
  useEffect(() => {
    setSelectedMechanismId((prev) => {
      if (mechanisms.some((m) => m.id === prev)) return prev
      return "sum-of-differences"
    })
  }, [mechanisms])

  // score lookup
  const scoreLookup = useMemo(() => {
    if (azMode) {
      const map = new Map<string, { score: number; hasScore: boolean }>()
      for (const feat of syntheticFeatures) {
        const key = `${(feat as any).properties._ID_HWY}|${(feat as any).properties._ID_LOC}`
        map.set(key, { score: 0, hasScore: true })
      }
      return map
    }

    const mech = mechanisms.find((m) => m.id === selectedMechanismId)
    const map = new Map<string, { score: number; hasScore: boolean }>()
    if (!mech) return map

    for (const feat of syntheticFeatures) {
      const key = `${(feat as any).properties._ID_HWY}|${(feat as any).properties._ID_LOC}`
      try {
        const s = mech.score(feat)
        if (Number.isFinite(s)) {
          map.set(key, { score: s as number, hasScore: true })
        } else {
          map.set(key, { score: 0, hasScore: false })
        }
      } catch {
        map.set(key, { score: 0, hasScore: false })
      }
    }
    return map
  }, [azMode, selectedMechanismId, mechanisms, syntheticFeatures])

  // Sync external search prop with local state
  useEffect(() => {
    setLocalSearch(search)
    setSearchTerm(search)
  }, [search])

  const handleSearch = () => {
    setSearchTerm(localSearch)
    setSearch(localSearch) // Update parent
  }

  // Optimized filtering
  const filteredData = useMemo(() => {
    if (searchTerm === "") return processedDataWithMetrics

    const lowercasedSearchTerm = searchTerm.toLowerCase()
    return processedDataWithMetrics.filter(item => {
      const searchText = `${item.highway.toLowerCase()} ${item.formattedCounty.toLowerCase()} ${item.county.toLowerCase()}`
      return searchText.includes(lowercasedSearchTerm)
    })
  }, [processedDataWithMetrics, searchTerm])

  const metricColumnToKey: Record<
    Exclude<SortColumn, "highway" | "county" | "yoy_condition" | null>,
    MetricKey
  > = {
    condition: "condition",
    distress: "distress",
    ride: "ride",
    aadt: "aadt",
    cost: "cost",
  }

  const handleSort = useCallback(
    (column: SortColumn) => {
      if (selectedMechanismId === "alpha-az") return

      if (
        selectedMechanismId === "condition-aadt-exposure" &&
        column &&
        column !== "highway" &&
        column !== "county" &&
        column !== "yoy_condition"
      ) {
        return
      }

      if (selectedMechanismId !== "alpha-az") {
        if (column && column !== "highway" && column !== "county" && column !== "yoy_condition") {
          const key =
            metricColumnToKey[
            column as Exclude<typeof column, "highway" | "county" | "yoy_condition" | null>
            ]

          if (selectedMechanismId === "improvement-per-cost" && isInvalidForImprovementPerCost(key)) {
            return
          }

          if (key) {
            setSelectedRankingMetric(key)
            if (sortColumn === column) {
              setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
            } else {
              setSortColumn(column)
              setSortDirection("desc")
            }
            return
          }
        }

        if (column === "yoy_condition") {
          if (sortColumn === "yoy_condition") {
            setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"))
          } else {
            setSortColumn("yoy_condition")
            setSortDirection("desc")
          }
          return
        }
      }
    },
    [selectedMechanismId, sortColumn, metricColumnToKey],
  )

  const getSortIcon = useCallback((column: SortColumn) => {
    if (sortColumn !== column) return <FaSort className="text-gray-400" />
    if (sortDirection === "asc") return <FaSortUp className="text-blue-600" />
    if (sortDirection === "desc") return <FaSortDown className="text-blue-600" />
    return <FaSort className="text-gray-400" />
  }, [sortColumn, sortDirection])

  const sortedData = useMemo(() => {
    if (selectedMechanismId === "alpha-az") {
      const dir = sortDirection ?? "asc"
      return [...filteredData].sort((a, b) => {
        const byHighway = a.highway.localeCompare(b.highway)
        if (byHighway !== 0) return dir === "asc" ? byHighway : -byHighway
        const byLoc = a.formattedCounty.localeCompare(b.formattedCounty)
        return dir === "asc" ? byLoc : -byLoc
      })
    }

    if (selectedMechanismId !== "alpha-az") {
      const dir = sortDirection ?? "desc"
      const badSentinel = dir === "asc" ? Infinity : -Infinity

      return [...filteredData].sort((a, b) => {
        const keyA = `${a.highway}|${a.formattedCounty}`
        const keyB = `${b.highway}|${b.formattedCounty}`
        const entryA = scoreLookup.get(keyA)
        const entryB = scoreLookup.get(keyB)

        const scoreA = entryA?.hasScore ? entryA.score : badSentinel
        const scoreB = entryB?.hasScore ? entryB.score : badSentinel

        if (scoreA === scoreB) {
          const byHighway = a.highway.localeCompare(b.highway)
          if (byHighway !== 0) return byHighway
          return a.formattedCounty.localeCompare(b.formattedCounty)
        }

        return dir === "asc" ? scoreA - scoreB : scoreB - scoreA
      })
    }

    return [...filteredData]
  }, [filteredData, sortDirection, selectedMechanismId, scoreLookup])

  // Pagination
  const totalPages = Math.ceil(sortedData.length / itemsPerPage)
  const visibleRows = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    return sortedData.slice(startIndex, endIndex)
  }, [sortedData, currentPage, itemsPerPage])

  // Reset to page 1 when search or sort changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, sortColumn, sortDirection, selectedMechanismId])

  // Ranking UI handlers
  const ALL_METRICS: MetricKey[] = ["condition", "distress", "ride", "aadt", "cost"]

  const getAllowedMetrics = (mechId: string): MetricKey[] => {
    if (mechId === "improvement-per-cost") {
      return ALL_METRICS.filter((m) => !isInvalidForImprovementPerCost(m))
    }
    if (mechId === "condition-aadt-exposure") {
      return ["condition", "aadt"]
    }
    return ALL_METRICS
  }

  const metricKeyToSortColumn: Record<
    MetricKey,
    Exclude<SortColumn, "highway" | "county" | "yoy_condition" | null>
  > = {
    condition: "condition",
    distress: "distress",
    ride: "ride",
    aadt: "aadt",
    cost: "cost",
  }

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rankMenuOpen) return
      const t = e.target as Node
      if (
        rankMenuRef.current &&
        !rankMenuRef.current.contains(t) &&
        rankBtnRef.current &&
        !rankBtnRef.current.contains(t)
      ) {
        setRankMenuOpen(false)
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRankMenuOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onEsc)
    }
  }, [rankMenuOpen])

  useEffect(() => {
    const allowed = getAllowedMetrics(selectedMechanismId)
    if (selectedMechanismId === "alpha-az") return
    if (!allowed.includes(selectedRankingMetric)) {
      setSelectedRankingMetric(allowed[0] ?? "condition")
    }
  }, [selectedMechanismId])

  const handleMechanismPick = (nextId: string) => {
    setSelectedMechanismId(nextId)

    if (nextId === "alpha-az") {
      setSortColumn(null)
      setSortDirection("asc")
      return
    }

    const allowed = getAllowedMetrics(nextId)
    const nextMetric: MetricKey = allowed.includes(selectedRankingMetric)
      ? selectedRankingMetric
      : allowed[0] ?? "condition"

    setSelectedRankingMetric(nextMetric)
    setSortColumn(metricKeyToSortColumn[nextMetric])
    setSortDirection("desc")
  }

  const handleMetricPick = (m: MetricKey) => {
    if (selectedMechanismId === "condition-aadt-exposure") return
    if (selectedMechanismId === "improvement-per-cost" && isInvalidForImprovementPerCost(m)) return
    setSelectedRankingMetric(m)
    setSortColumn(metricKeyToSortColumn[m])
  }

  const handleOrderPick = (order: "asc" | "desc") => {
    setSortDirection(order)
  }

  // Mobile detection
  const isMobile = useIsMobile()

  // Get the current metric field for mobile view (default to condition)
  const [currentMetricIndex, setCurrentMetricIndex] = useState(0)
  const mobileMetrics = fields.map((field: string) => {
    const labels: Record<string, string> = {
      TX_CONDITION_SCORE: "Condition Score",
      TX_DISTRESS_SCORE: "Distress Score",
      TX_RIDE_SCORE: "Ride Score",
      TX_AADT_CURRENT: "AADT",
      TX_MAINTENANCE_COST_AMT: "Maintenance Cost",
    }
    return { field, label: labels[field] || field }
  })
  const currentMetric = mobileMetrics[currentMetricIndex]

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-lg shadow border bg-white">
      {isMobile ? (
        /* Mobile: Metric Selector Header */
        <div className="flex-shrink-0 bg-white shadow-md border-b border-gray-200">
          <div className="px-4 py-3 flex items-center justify-between">
            <button
              onClick={() => setCurrentMetricIndex((prev) => (prev - 1 + mobileMetrics.length) % mobileMetrics.length)}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Previous metric"
            >
              <FaChevronLeft size={20} />
            </button>

            <div className="flex-1 text-center">
              <h2 className="text-lg font-bold text-gray-800">
                {currentMetric.label}
              </h2>
            </div>

            <button
              onClick={() => setCurrentMetricIndex((prev) => (prev + 1) % mobileMetrics.length)}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Next metric"
            >
              <FaChevronRight size={20} />
            </button>
          </div>
        </div>
      ) : (
        <div className="px-5 py-3 bg-gradient-to-r from-[rgb(20,55,90)] to-[rgb(30,65,100)] text-white font-bold flex-shrink-0 flex items-center justify-between">
          <span>{title}</span>
          {headerContent && <div className="flex items-center">{headerContent}</div>}
        </div>
      )}

      {/* View Type + Ranking Controls */}
      <div className={`${isMobile ? 'px-2 py-2' : 'px-4 py-2'} border-b bg-gray-50 flex-shrink-0`}>
        <div className={`flex items-center ${isMobile ? 'gap-2 flex-row' : 'gap-4 flex-wrap'}`}>
          {/* View by */}
          <div className={`flex items-center ${isMobile ? 'flex-1 gap-1' : 'gap-2'}`}>
            <label htmlFor="viewType" className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium text-gray-700 ${isMobile ? 'flex-shrink-0' : ''}`}>
              View by:
            </label>
            <select
              id="viewType"
              value={viewType}
              onChange={(e) => {
                setViewType(e.target.value as 'county' | 'district')
                setLocalSearch("")
                setSearchTerm("")
                setSearch("")
                setCurrentPage(1)
                setLoading(true)
              }}
              className={`${isMobile ? 'flex-1 text-xs px-2 py-1' : 'px-3 py-1'} border border-gray-300 rounded-md text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500`}
            >
              <option value="county">County</option>
              <option value="district">District</option>
            </select>
          </div>

          {/* Ranking button (desktop + mobile) */}
          <div className={`${isMobile ? 'flex-1' : 'ml-auto'} relative`}>
            <button
              ref={rankBtnRef}
              type="button"
              onClick={() => setRankMenuOpen((v) => !v)}
              className={`${isMobile ? 'w-full justify-between text-xs px-2 py-1' : 'text-sm px-3 py-1.5'} inline-flex items-center gap-1 border border-gray-300 rounded-md bg-white text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500`}
              aria-haspopup="menu"
              aria-expanded={rankMenuOpen}
              aria-controls="rank-menu"
            >
              Ranking: {mechanismLabels[selectedMechanismId] || "Select..."}
            </button>

            {rankMenuOpen && (
              <div
                ref={rankMenuRef}
                id="rank-menu"
                role="menu"
                aria-labelledby="rank-menu-button"
                className={`absolute ${isMobile ? 'left-0 right-0 w-auto mx-0' : 'right-0 w-[320px]'} mt-2 rounded-md border border-gray-200 bg-white shadow-lg z-20`}
              >
                {/* Mechanism */}
                <div className="p-3 border-b">
                  <label className="block text-xs font-semibold text-gray-700 tracking-wide">
                    Mechanism
                  </label>
                  <div className="mt-1">
                    <select
                      className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={selectedMechanismId}
                      onChange={(e) => handleMechanismPick(e.target.value)}
                    >
                      <option value="alpha-az">A–Z by Highway</option>
                      <option value="sum-of-differences">The absolute sum of differences</option>
                      <option value="improvement-over-time">The sum of difference</option>
                      <option value="improvement-per-cost">Improvement per Cost</option>
                      <option value="condition-aadt-exposure">Condition × AADT Exposure</option>
                    </select>
                  </div>
                </div>

                {/* Metric */}
                <div className="p-3 border-b">
                  <label className="block text-xs font-semibold text-gray-700 tracking-wide">
                    Metric
                  </label>
                  <div className="mt-1">
                    <select
                      className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                      value={selectedRankingMetric}
                      onChange={(e) => handleMetricPick(e.target.value as MetricKey)}
                      disabled={
                        selectedMechanismId === "condition-aadt-exposure" || selectedMechanismId === "alpha-az"
                      }
                    >
                      {getAllowedMetrics(selectedMechanismId).map((m) => (
                        <option key={m} value={m}>
                          {metricLabelMap[m] ?? m}
                        </option>
                      ))}
                    </select>
                    {selectedMechanismId === "improvement-per-cost" && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        AADT and Cost are not valid for Improvement per Cost.
                      </p>
                    )}
                    {selectedMechanismId === "condition-aadt-exposure" && (
                      <p className="mt-1 text-[11px] text-gray-500">
                        Metric is fixed for Condition × AADT Exposure.
                      </p>
                    )}
                  </div>
                </div>

                {/* Order */}
                <div className="p-3">
                  <label className="block text-xs font-semibold text-gray-700 tracking-wide">
                    Order
                  </label>
                  <div className="mt-1">
                    <select
                      className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={sortDirection ?? (selectedMechanismId === "alpha-az" ? "asc" : "desc")}
                      onChange={(e) => handleOrderPick(e.target.value as "asc" | "desc")}
                    >
                      {selectedMechanismId === "alpha-az" ? (
                        <>
                          <option value="asc">A–Z</option>
                          <option value="desc">Z–A</option>
                        </>
                      ) : (
                        <>
                          <option value="desc">Descending</option>
                          <option value="asc">Ascending</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* Desktop-only helper tooltip */}
          {!isMobile && (
            <InfoTooltip ariaLabel="Explain ranking formula" tall placement="bottom-right">
              {selectedMechanismId === "alpha-az" ? (
                <div className="w-[220px] max-w-none">{getMechanismHelp(selectedMechanismId)}</div>
              ) : (
                getMechanismHelp(selectedMechanismId)
              )}
            </InfoTooltip>
          )}
        </div>
      </div>

      {/* Ranking init errors */}
      {rankingErrors.length > 0 && (
        <div className="px-4 py-2 bg-red-50 text-red-700 border-b border-red-200 text-sm">
          {rankingErrors.map((err, idx) => (
            <div key={idx}>⚠️ {err}</div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className={`${isMobile ? 'p-2' : 'p-4'} border-b flex-shrink-0`} data-table-search>
        <div className="relative flex items-center">
          <FaSearch className={`absolute ${isMobile ? 'left-2' : 'left-3'} top-1/2 -translate-y-1/2 text-gray-400`} />
          <input
            className={`${isMobile ? 'pl-7 pr-2 py-1.5 text-xs' : 'pl-9 pr-3 py-2'} w-full border rounded-l-md text-gray-900 focus:outline-none`}
            placeholder={`Search by highway or ${viewType === 'district' ? 'district' : 'county'}...`}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearch()
              }
            }}
            disabled={loading}
          />
          {localSearch && (
            <button
              onClick={() => {
                setLocalSearch("")
                setSearchTerm("")
                setSearch("")
              }}
              className={`absolute ${isMobile ? 'right-[70px]' : 'right-[90px]'} top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none ${isMobile ? 'text-sm' : ''}`}
            >
              &#x2715; {/* X icon */}
            </button>
          )}
          <button
            onClick={handleSearch}
            className={`${isMobile ? 'px-3 py-1.5 text-xs' : 'px-4 py-2'} bg-blue-500 text-white rounded-r-md hover:bg-blue-600 focus:outline-none disabled:bg-gray-400`}
            disabled={loading}
          >
            Search
          </button>
        </div>
      </div>

      {/* Body container (below search) */}
      <div className="flex-grow overflow-hidden bg-white relative">
        {sortedData.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            {loading ? <FaSpinner className="animate-spin mx-auto" /> : <div className="text-gray-500">No records found</div>}
          </div>
        ) : (
          isMobile ? (
            /* Mobile: Card View */
            <div className="absolute inset-0 flex flex-col bg-gray-50">
              <div className="flex-1 overflow-y-auto px-2 py-2">
                {visibleRows.map((item, index) => {
                  const key = `${item.highway}|${item.formattedCounty}`
                  const segmentData = segmentDataByHighwayCounty.get(key) || []
                  const isActive = activeHeatMapData.some(
                    (d) =>
                      d.highway === item.highway &&
                      d.county === item.formattedCounty &&
                      d.scores.some((s) => s.value === currentMetric.field)
                  )

                  return (
                    <Card
                      key={`${item.highway}-${item.county}-${index}`}
                      highway={item.highway}
                      location={item.formattedCounty}
                      currentMetric={currentMetric.field}
                      metricLabel={currentMetric.label}
                      segmentData={segmentData}
                      onMapClick={() => handleMapClick(item.highway, item.county)}
                      onChartClick={() => handleChartClick(item.highway, item.formattedCounty, currentMetric.field)}
                      isMapAvailable={isHighwayAvailable(item.highway)}
                      isActive={isActive}
                      index={index}
                    />
                  )
                })}
              </div>

              {/* Mobile Pagination */}
              {totalPages > 1 && (
                <div className="border-t bg-white py-2 px-2 flex-shrink-0">
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-gray-700 text-center">
                      Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedData.length)} of {sortedData.length}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        className="flex-1 px-2 py-1.5 text-xs text-gray-900 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <span className="text-xs text-gray-700 flex-shrink-0">
                        {currentPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                        className="flex-1 px-2 py-1.5 text-xs text-gray-900 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Desktop: Table View */
            <div className="absolute inset-0 flex flex-col">
              {/* Table container with scrollable body */}
              <div className="w-full h-[calc(100vh-300px)] overflow-y-auto">
                <div className="min-w-[1000px] w-full h-full">
                  <table className="w-full border-collapse bg-white">
                    {/* Table Header */}
                    <thead ref={headerRef} className="sticky top-0 bg-gray-100 border-b-2 border-gray-300 z-10 shadow-sm">
                      <tr className="text-gray-900 text-sm font-semibold">
                        <th
                          className={`p-2 text-left ${selectedMechanismId === "alpha-az" ? "" : "cursor-pointer hover:bg-gray-200"
                            } border-r border-gray-300`}
                          style={{ width: "120px" }}
                          onClick={selectedMechanismId === "alpha-az" ? undefined : () => handleSort("highway")}
                        >
                          <div className="flex items-center gap-1 text-xs text-gray-900">
                            Highway {getSortIcon("highway")}
                          </div>
                        </th>
                        <th
                          className={`p-2 text-left ${selectedMechanismId === "alpha-az" ? "" : "cursor-pointer hover:bg-gray-200"
                            } border-r border-gray-300`}
                          style={{ width: "100px" }}
                          onClick={selectedMechanismId === "alpha-az" ? undefined : () => handleSort("county")}
                        >
                          <div className="flex items-center gap-1 text-xs text-gray-900">
                            {viewType === "district" ? "District" : "County"} {getSortIcon("county")}
                          </div>
                        </th>

                        {fields.map((field: string, index: number) => {
                          const labelMap: Record<string, string> = {
                            "TX_CONDITION_SCORE": "Condition (filtered)",
                            "TX_DISTRESS_SCORE": "Distress",
                            "TX_RIDE_SCORE": "Ride",
                            "TX_AADT_CURRENT": "AADT",
                            "TX_MAINTENANCE_COST_AMT": "Cost",
                            "GEOMETRIC_MST": "MST",
                            "GEOMETRIC_ALPHA_SHAPE": "Alpha Shape",
                            "GEOMETRIC_CONVEX_HULL": "Convex Hull",
                            "SCAG_RADAR": "Radar",
                            "SCAG_OUTLYING": "Outlying",
                            "SCAG_SKEWED": "Skewed",
                            "SCAG_STRINGY": "Stringy",
                            "SCAG_SPARSE": "Sparse",
                            "SCAG_CONVEX": "Convex",
                            "SCAG_CLUMPY": "Clumpy",
                            "SCAG_SKINNY": "Skinny",
                            "SCAG_STRIATED": "Striated",
                            "SCAG_MONOTONIC": "Monotonic"
                          }
                          const label = labelMap[field] || field
                          const loweredLabel = label.toLowerCase() as keyof typeof metricColumnToKey
                          const sortKey = (metricColumnToKey[loweredLabel] as string | undefined) || field

                          return (
                            <th
                              key={`${field}-${index}`}
                              className={`p-2 text-center ${selectedMechanismId === "alpha-az" ? "" : "cursor-pointer hover:bg-gray-200"
                                } border-r border-gray-300`}
                              style={{ width: field === 'SCAG_RADAR' ? "120px" : field.startsWith('SCAG_') ? "50px" : "120px" }}
                              onClick={selectedMechanismId === "alpha-az" ? undefined : () => handleSort(sortKey as any)}
                            >
                              <div className="flex items-center justify-center gap-1 text-xs text-gray-900">
                                {label} {getSortIcon(sortKey as any)}
                              </div>
                            </th>
                          )
                        })}
                      </tr>
                    </thead>

                    {/* Table Body */}
                    <TableBodyComponent
                      visibleRows={visibleRows}
                      fields={fields.map((field: string) => field)}
                      isHighwayAvailable={isHighwayAvailable}
                      handleMapClick={handleMapClick}
                      handleChartClick={handleChartClick}
                      activeHeatMapData={activeHeatMapData}
                      getScoreCategory={getScoreCategory}
                      getCategoryColor={getCategoryColor}
                      segmentDataByHighwayCounty={segmentDataByHighwayCountyBridged}
                      clickedMapKey={clickedMapKey}
                      scoreLookup={scoreLookup}
                      rankingActive={rankingActive}
                      azMode={azMode}
                      maxConditionScore={maxConditionScore}
                    />
                  </table>
                </div>
              </div>

              {/* Pagination - sticky at the bottom */}
              {totalPages > 1 && (
                <div className="border-t bg-gray-50 py-3 px-4 mt-auto">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-700">
                      Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, sortedData.length)} of {sortedData.length} results
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1 text-sm text-gray-900 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <span className="text-sm text-gray-700">
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1 text-sm text-gray-900 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}

export default TableModalPMIS
