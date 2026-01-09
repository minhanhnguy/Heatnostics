"use client"

import React, { useMemo } from "react"
import * as d3 from "d3"

// Inline function to avoid import issues
const cleanAndRound = (value: any): number => {
  if (value === null || typeof value === "undefined") return 0.0
  const cleaned = String(value).replace(/[^0-9.]/g, "")
  if (cleaned === "") return 0.0
  const num = parseFloat(cleaned)
  if (isNaN(num)) return 0.0
  return Number(num.toFixed(3))
}

export interface PMISFeature {
  properties: {
    TX_SIGNED_HIGHWAY_RDBD_ID?: string
    COUNTY?: string
    RESPONSIBLE_DISTRICT?: string
    EFF_YEAR?: string | number
    TX_BEG_REF_MARKER_NBR?: string | number
    TX_BEG_REF_MRKR_DISP?: string | number
    TX_END_REF_MARKER_NBR?: string | number
    TX_END_REF_MARKER_DISP?: string | number
    TX_CONDITION_SCORE?: number | string
    TX_DISTRESS_SCORE?: number | string
    TX_RIDE_SCORE?: number | string
    TX_AADT_CURRENT?: number | string
    TX_MAINTENANCE_COST_AMT?: number | string
    TX_LENGTH?: number | string

    IS_GAP_BRIDGE?: boolean
    GAP_SIZE_MILES?: number
    BRIDGE_POS_ABS?: number

    [key: string]: any
  }
  geometry?: any
}

interface MiniSegmentChartProps {
  data: PMISFeature[]
  metric: string
  getCategory: (scoreType: string, score: number) => string
  getCategoryColor: (category: string, scoreType: string) => string
  maxScore?: number
}

const fieldToScoreType: Record<string, string> = {
  TX_CONDITION_SCORE: "condition",
  TX_DISTRESS_SCORE: "distress",
  TX_RIDE_SCORE: "ride",
  TX_AADT_CURRENT: "aadt",
  TX_MAINTENANCE_COST_AMT: "cost",
}

// ---- Bar layout (row-space units, later scaled to constant viewBox) ----
const BAR_THICKNESS = 1
const MIN_SEGMENT_WIDTH = 2 // percent
const VERTICAL_GAP = 0.5
const VERTICAL_PAD = 0.5

// ---- Gap handling ----
const GAP_COLLAPSE_THRESHOLD = 100 // miles
const GAP_SPACER_PCT = 10 // % of chart width reserved per big gap

// ---- Divider (fixed in the SVG, independent of year-count) ----
const GAP_LINE_THICKNESS = 1.3
const GAP_LINE_COLOR = "#444"

// Use a constant viewBox height so the zigzag's size never changes with year-count
const VBOX_H = 24 // <-- change if you want everything taller/shorter

// Vertical coverage of the divider line (fraction of total height)
const DIVIDER_VERTICAL_COVERAGE = 0.9 // 90%

// Fixed zigzag band height and width (do NOT depend on number of years)
const ZIGZAG_BAND_HEIGHT = 1 // in viewBox units
const ZIGZAG_WIDTH_PCT = 25  // % of spacer width

type Seg = { begin: number; end: number; score: number; year: number }
type Gap = { start: number; end: number; size: number }

function getAbsBegin(f: PMISFeature): number {
  const bm = cleanAndRound(f.properties.TX_BEG_REF_MARKER_NBR)
  const bd = cleanAndRound(f.properties.TX_BEG_REF_MRKR_DISP)
  return bm + bd
}
function getAbsEnd(f: PMISFeature): number {
  const len = cleanAndRound(f.properties.TX_LENGTH)
  return getAbsBegin(f) + len
}

const MiniSegmentChart: React.FC<MiniSegmentChartProps> = ({
  data,
  metric,
  getCategory,
  getCategoryColor,
  maxScore,
}) => {
  const svgRef = React.useRef<SVGSVGElement>(null)

  const years = useMemo(() => {
    // Always use all years from 1996 to 2024 for consistent vertical spacing
    const allYears: number[] = []
    for (let year = 2024; year >= 1996; year--) {
      allYears.push(year)
    }
    return allYears
  }, [])

  const { segmentsByYear, bigGaps, minPos, maxPos } = useMemo(() => {
    const segs: Seg[] = []
    for (const f of data) {
      if (f.properties?.IS_GAP_BRIDGE) continue
      const begin = getAbsBegin(f)
      const end = getAbsEnd(f)
      const rawScore = f.properties[metric]
      const score = Number(rawScore)
      const year = Number(f.properties.EFF_YEAR) || 0

      if (!isFinite(begin) || !isFinite(end) || end <= begin) continue

      // Filter by maxScore if provided: exclude scores that are 0 or greater than maxScore
      if (maxScore !== undefined && (score <= 0 || score > maxScore)) continue

      segs.push({ begin, end, score, year })
    }

    if (segs.length === 0) {
      return {
        segmentsByYear: new Map<number, Seg[]>(),
        bigGaps: [] as Gap[],
        minPos: Infinity,
        maxPos: -Infinity,
      }
    }

    let minPos = Infinity
    let maxPos = -Infinity
    for (const s of segs) {
      if (s.begin < minPos) minPos = s.begin
      if (s.end > maxPos) maxPos = s.end
    }

    // union coverage across years → detect true gaps once
    const intervals = segs
      .map((s) => ({ start: s.begin, end: s.end }))
      .sort((a, b) => a.start - b.start)

    const EPS = 1e-6
    const union: { start: number; end: number }[] = []
    for (const iv of intervals) {
      if (!union.length) union.push({ ...iv })
      else {
        const last = union[union.length - 1]
        if (iv.start <= last.end + EPS) last.end = Math.max(last.end, iv.end)
        else union.push({ ...iv })
      }
    }

    const gaps: Gap[] = []
    for (let i = 0; i < union.length - 1; i++) {
      const cur = union[i]
      const nxt = union[i + 1]
      const gap = nxt.start - cur.end
      if (gap >= GAP_COLLAPSE_THRESHOLD) gaps.push({ start: cur.end, end: nxt.start, size: gap })
    }

    const byYear = new Map<number, Seg[]>()
    for (const s of segs) {
      if (!byYear.has(s.year)) byYear.set(s.year, [])
      byYear.get(s.year)!.push(s)
    }
    for (const [, arr] of byYear) arr.sort((a, b) => a.begin - b.begin)

    return { segmentsByYear: byYear, bigGaps: gaps, minPos, maxPos }
  }, [data, metric, maxScore])

  // X compression + spacers
  const compressFns = useMemo(() => {
    if (!isFinite(minPos) || !isFinite(maxPos) || maxPos <= minPos) {
      return {
        toPct: (_pos: number) => 0,
        widthPct: (_len: number, _at: number) => 0,
        gapsSorted: [] as Gap[],
      }
    }

    const gapsSorted = [...bigGaps].sort((a, b) => a.start - b.start)
    const removedMiles = gapsSorted.reduce((acc, g) => acc + g.size, 0)
    const baseVisibleMiles = (maxPos - minPos) - removedMiles
    const safeVisibleMiles = baseVisibleMiles > 0 ? baseVisibleMiles : 1e-6

    const totalSpacerPct = gapsSorted.length * GAP_SPACER_PCT
    const drawablePct = Math.max(1e-6, 100 - totalSpacerPct)

    function pctNoSpacer(pos: number) {
      let cut = 0
      for (const g of gapsSorted) {
        if (pos > g.end) cut += g.size
        else if (pos > g.start) cut += pos - g.start
        else break
      }
      const xMiles = (pos - minPos) - cut
      return (xMiles / safeVisibleMiles) * drawablePct
    }

    function offsetFor(pos: number) {
      let count = 0
      for (const g of gapsSorted) {
        if (pos >= g.end) count++
        else break
      }
      return count * GAP_SPACER_PCT
    }

    const toPct = (pos: number) => Math.max(0, Math.min(100, pctNoSpacer(pos) + offsetFor(pos)))
    const widthPct = (len: number, at: number) => {
      const p0 = toPct(at)
      const p1 = toPct(at + len)
      return Math.max(0, p1 - p0)
    }

    return { toPct, widthPct, gapsSorted }
  }, [minPos, maxPos, bigGaps])

  // --- Compute raw row layout height (in "row units") then scale to constant VBOX_H ---
  const rowCount = Math.max(1, years.length)
  const rawHeight = VERTICAL_PAD * 2 + rowCount * BAR_THICKNESS + (rowCount - 1) * VERTICAL_GAP
  const SY = rawHeight > 0 ? VBOX_H / rawHeight : 1 // y-scale → maps row-units into constant viewBox

  // D3 Rendering Effect
  React.useEffect(() => {
    if (!svgRef.current) return

    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove() // Clear previous render

    if (segmentsByYear.size === 0 && compressFns.gapsSorted.length === 0) return

    // Draw Bars
    const yForRowRaw = (rowIdx: number) => VERTICAL_PAD + rowIdx * (BAR_THICKNESS + VERTICAL_GAP)
    const sortedYears = years.length ? years : [0]

    sortedYears.forEach((yr, rowIdx) => {
      const arr = segmentsByYear.get(yr) || []
      const yRaw = yForRowRaw(rowIdx)
      const y = yRaw * SY
      const h = BAR_THICKNESS * SY

      svg.append("g")
        .selectAll("rect")
        .data(arr)
        .enter()
        .append("rect")
        .attr("x", d => compressFns.toPct(d.begin))
        .attr("y", y)
        .attr("width", d => {
          let w = compressFns.widthPct(d.end - d.begin, d.begin)
          return Math.max(MIN_SEGMENT_WIDTH, Math.min(100 - compressFns.toPct(d.begin), w))
        })
        .attr("height", h)
        .attr("fill", d => {
          const scoreType = fieldToScoreType[metric] || ""
          const scoreTypesWithInvalidData = ["condition", "distress", "ride"]
          const shouldCheckInvalid = scoreTypesWithInvalidData.includes(scoreType)
          const isInvalidScore = shouldCheckInvalid &&
            (Number.isNaN(d.score) || d.score <= 0 || (d as any).score === null || typeof (d as any).score === "undefined")

          return isInvalidScore
            ? "#9CA3AF"
            : getCategoryColor(getCategory(scoreType, d.score), scoreType)
        })
    })

    // Draw Gap Dividers
    const gaps = compressFns.gapsSorted
    if (gaps.length > 0) {
      const margin = (1 - DIVIDER_VERTICAL_COVERAGE) * 0.5
      const y0 = VBOX_H * margin
      const y1 = VBOX_H * (1 - margin)
      const bandHalf = ZIGZAG_BAND_HEIGHT / 2
      const yTop = VBOX_H / 2 - bandHalf
      const yBot = VBOX_H / 2 + bandHalf

      gaps.forEach(g => {
        const spacerLeft = compressFns.toPct(g.start)
        const spacerRight = spacerLeft + GAP_SPACER_PCT
        const midX = (spacerLeft + spacerRight) / 2

        const halfZig = (GAP_SPACER_PCT * (ZIGZAG_WIDTH_PCT / 100)) / 2
        const leftX = Math.max(spacerLeft, midX - halfZig)
        const rightX = Math.min(spacerRight, midX + halfZig)

        const zigH = yBot - yTop
        const d = [
          `M ${midX} ${y0}`,
          `L ${midX} ${yTop}`,
          `L ${leftX} ${yTop + zigH * 0.33}`,
          `L ${rightX} ${yTop + zigH * 0.67}`,
          `L ${midX} ${yBot}`,
          `L ${midX} ${y1}`,
        ].join(" ")

        svg.append("path")
          .attr("d", d)
          .attr("stroke", GAP_LINE_COLOR)
          .attr("stroke-width", GAP_LINE_THICKNESS)
          .attr("fill", "none")
          .attr("vector-effect", "non-scaling-stroke")
          .attr("stroke-linejoin", "round")
          .attr("stroke-linecap", "round")
          .attr("shape-rendering", "geometricPrecision")
          .style("pointer-events", "none")
      })
    }

  }, [segmentsByYear, years, metric, getCategory, getCategoryColor, compressFns, SY])

  if (segmentsByYear.size === 0 && compressFns.gapsSorted.length === 0) {
    return <div className="w-full h-full bg-gray-100" />
  }

  return (
    // Full bleed: no padding so it fills the cell wrapper completely
    <div className="w-full h-full overflow-hidden">
      <svg
        ref={svgRef}
        className="block"            // remove baseline gap
        width="100%"
        height="100%"
        viewBox={`0 0 100 ${VBOX_H}`}
        preserveAspectRatio="none"   // stretch to fit wrapper
      />
    </div>
  )
}

export default React.memo(MiniSegmentChart)