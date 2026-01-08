"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import * as d3 from "d3"

// ---------- small utils ----------
const cleanAndRound = (value: any): number => {
  if (value === null || typeof value === "undefined") return 0.0
  const cleaned = String(value).replace(/[^0-9.]/g, "")
  if (cleaned === "") return 0.0
  const num = parseFloat(cleaned)
  if (isNaN(num)) return 0.0
  return Number(num.toFixed(3))
}
const round2 = (v: number | string) => Number(Number(v).toFixed(2))

const getContrastColor = (hexOrRgb: string): string => {
  let r = 0, g = 0, b = 0
  if (hexOrRgb.startsWith("#")) {
    const hex = hexOrRgb.replace("#", "")
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16)
      g = parseInt(hex[1] + hex[1], 16)
      b = parseInt(hex[2] + hex[2], 16)
    } else if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16)
      g = parseInt(hex.substring(2, 4), 16)
      b = parseInt(hex.substring(4, 6), 16)
    }
  } else if (hexOrRgb.startsWith("rgb")) {
    const rgb = hexOrRgb.match(/\d+/g)
    if (rgb && rgb.length >= 3) {
      r = parseInt(rgb[0])
      g = parseInt(rgb[1])
      b = parseInt(rgb[2])
    }
  }
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000
  return (yiq >= 128) ? "#000000" : "#ffffff"
}

// ---------- globals ----------
const GLOBAL_AADT_MAX = 371120
const GLOBAL_COST_MAX = 543313

const GAP_COLLAPSE_THRESHOLD = 100 // miles — collapse these completely
const GAP_SPACER_PCT = 10 // final spacer width (% of width)

// animation clamp
const MIN_ANIM_MS = 300
const MAX_ANIM_MS = 1000

// ---------- types ----------
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

export interface SelectedScore {
  value: string
  label: string
}

interface HighwaySegmentChartProps {
  data: PMISFeature[]
  selectedHighway: string
  selectedScore: SelectedScore
}

type Seg = { begin: number; end: number; score: number; year: number; original: PMISFeature }
type Gap = { start: number; end: number; size: number }
type Interval = { start: number; end: number }

// ---------- palettes ----------
const getDiscreteCategory = (metric: string, value: number): number => {
  const max = metric === "TX_AADT_CURRENT" ? GLOBAL_AADT_MAX : GLOBAL_COST_MAX
  const thresholds = [
    max * 0.125,
    max * 0.25,
    max * 0.375,
    max * 0.5,
    max * 0.625,
    max * 0.75,
    max * 0.875,
    max,
  ]
  for (let i = 0; i < thresholds.length; i++) if (value <= thresholds[i]) return i
  return thresholds.length - 1
}

const getDiscreteColor = (index: number, metric: string): string => {
  const aadt = [
    "rgb(140,190,220)",
    "rgb(107,174,214)",
    "rgb(66,146,198)",
    "rgb(33,113,181)",
    "rgb(8,81,156)",
    "rgb(8,69,148)",
    "rgb(8,48,107)",
    "rgb(5,24,82)",
  ]
  const cost = [
    "rgb(230,220,240)",
    "rgb(218,218,235)",
    "rgb(188,189,220)",
    "rgb(158,154,200)",
    "rgb(128,125,186)",
    "rgb(106,81,163)",
    "rgb(74,20,134)",
    "rgb(45,0,75)",
  ]
  return metric === "TX_AADT_CURRENT" ? aadt[index] || "#ccc" : cost[index] || "#ccc"
}

const getCategory = (metric: string, score: number): string => {
  switch (metric) {
    case "TX_DISTRESS_SCORE":
      if (score >= 90) return "Very Good"
      if (score >= 80) return "Good"
      if (score >= 70) return "Fair"
      if (score >= 60) return "Poor"
      if (score < 1) return "Invalid"
      return "Very Poor"
    case "TX_RIDE_SCORE":
      if (score >= 4.0) return "Very Good"
      if (score >= 3.0) return "Good"
      if (score >= 2.0) return "Fair"
      if (score >= 1.0) return "Poor"
      if (score < 0.1) return "Invalid"
      return "Very Poor"
    case "TX_CONDITION_SCORE":
      if (score >= 90) return "Very Good"
      if (score >= 70) return "Good"
      if (score >= 50) return "Fair"
      if (score >= 35) return "Poor"
      if (score < 1) return "Invalid"
      return "Very Poor"
    default:
      return "Very Good"
  }
}

const getCategoryColor = (category: string): string => {
  switch (category) {
    case "Very Poor":
      return "rgb(239,68,68)"
    case "Poor":
      return "rgb(249,115,22)"
    case "Fair":
      return "rgb(234,179,8)"
    case "Good":
      return "rgb(34,197,94)"
    case "Very Good":
      return "rgb(21,128,61)"
    case "Invalid":
      return "rgb(200,200,200)"
    default:
      return "rgb(75,85,99)"
  }
}

const formatAADT = (v: number) => new Intl.NumberFormat("en-US").format(v)

// ---------- geometry helpers ----------
function getAbsBegin(f: PMISFeature): number {
  const bm = cleanAndRound(f.properties.TX_BEG_REF_MARKER_NBR)
  const bd = cleanAndRound(f.properties.TX_BEG_REF_MRKR_DISP)
  return bm + bd
}

function getAbsEnd(f: PMISFeature): number {
  const len = cleanAndRound(f.properties.TX_LENGTH)
  return getAbsBegin(f) + len
}

// ---------- component ----------
const HighwaySegmentChart: React.FC<HighwaySegmentChartProps> = ({
  data,
  selectedHighway,
  selectedScore,
}) => {
  const [collapsed, setCollapsed] = useState(true)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const firstRenderRef = useRef(true)

  // Filter once per highway
  const highwayData = useMemo(
    () =>
      data.filter(
        (f) => f.properties.TX_SIGNED_HIGHWAY_RDBD_ID === selectedHighway,
      ),
    [data, selectedHighway],
  )

  // Build segments/extents
  const { allSegs, minBegin, maxEnd, years, minYear, maxYear } = useMemo(() => {
    const segs: Seg[] = []

    for (const f of highwayData) {
      if (f.properties?.IS_GAP_BRIDGE) continue

      const begin = getAbsBegin(f)
      const end = getAbsEnd(f)
      const score = Number(f.properties[selectedScore.value])
      const year = Number(f.properties.EFF_YEAR) || 0

      if (!isFinite(begin) || !isFinite(end) || end <= begin) continue
      if (!isFinite(score)) continue
      if (year <= 0) continue

      segs.push({ begin, end, score, year, original: f })
    }

    let minB = Infinity
    let maxE = -Infinity
    for (const s of segs) {
      if (s.begin < minB) minB = s.begin
      if (s.end > maxE) maxE = s.end
    }

    const uniqueYears = Array.from(new Set(segs.map((s) => s.year))).filter(
      (y) => y > 0,
    )
    let ys: number[] = []
    if (uniqueYears.length > 0) {
      const minY = Math.min(...uniqueYears)
      const maxY = Math.max(...uniqueYears)
      for (let y = maxY; y >= minY; y--) {
        ys.push(y)
      }
    }

    return {
      allSegs: segs,
      minBegin: minB,
      maxEnd: maxE,
      years: ys,
      minYear: ys.length ? ys[0] : 0,
      maxYear: ys.length ? ys[ys.length - 1] : 0,
    }
  }, [highwayData, selectedScore.value])

  const hasExtent =
    isFinite(minBegin) && isFinite(maxEnd) && maxEnd > minBegin && years.length > 0

  // Union intervals + single big gap detection
  const bigGap: Gap | null = useMemo(() => {
    if (!hasExtent || !allSegs.length) return null

    const intervals = allSegs
      .map((s) => ({ start: s.begin, end: s.end }))
      .sort((a, b) => a.start - b.start)

    const union: Interval[] = []
    const EPS = 1e-6
    for (const iv of intervals) {
      if (!union.length) {
        union.push({ ...iv })
      } else {
        const last = union[union.length - 1]
        if (iv.start <= last.end + EPS) {
          last.end = Math.max(last.end, iv.end)
        } else {
          union.push({ ...iv })
        }
      }
    }

    let detectedBigGap: Gap | null = null
    for (let i = 0; i < union.length - 1; i++) {
      const size = union[i + 1].start - union[i].end
      if (size >= GAP_COLLAPSE_THRESHOLD) {
        detectedBigGap = {
          start: union[i].end,
          end: union[i + 1].start,
          size,
        }
        break
      }
    }
    return detectedBigGap
  }, [allSegs, hasExtent])

  // Base x tick positions in mile units
  const baseTicksMiles = useMemo(() => {
    const out: number[] = []
    if (!hasExtent) return out

    const span = maxEnd - minBegin
    const raw = span / 10
    const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))))
    const n = raw / pow10
    const snap = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
    const step = snap * pow10

    const base = Math.ceil(minBegin / step) * step
    for (let t = base; t <= maxEnd + 1e-9; t += step) out.push(Number(t.toFixed(6)))

    if (out[0] !== minBegin) out.unshift(minBegin)
    if (out[out.length - 1] !== maxEnd) out.push(maxEnd)

    return out
  }, [hasExtent, minBegin, maxEnd])

  // ---------- D3 rendering ----------
  useEffect(() => {
    if (!svgRef.current || !hasExtent) return

    const svg = d3.select(svgRef.current)
    const tooltipEl = tooltipRef.current
    const container = svgRef.current.parentElement as HTMLElement | null

    const isFirst = firstRenderRef.current
    const useSlideDown = isFirst // ONLY first render slides down

    // compute animation durations (clamped 300–1000 ms)
    const complexity = allSegs.length || 1
    const baseDuration = 120 * Math.log2(Math.max(2, complexity)) // grows with segments
    const duration = Math.max(
      MIN_ANIM_MS,
      Math.min(MAX_ANIM_MS, baseDuration),
    )
    const fastDuration = Math.max(
      200,
      Math.min(duration * 0.6, MAX_ANIM_MS * 0.8),
    )

    const width = 900
    const margin = { top: 8, right: 50, bottom: 60, left: 60 }

    // Dynamic inner height based on number of years
    const rowHeight = 19 // desired px per year row
    const minInnerHeight = 84
    const innerHeight = Math.max(
      minInnerHeight,
      years.length * rowHeight,
    )
    const height = innerHeight + margin.top + margin.bottom

    const innerWidth = width - margin.left - margin.right

    svg.attr("viewBox", `0 0 ${width} ${height}`)

    let rootG = svg.select<SVGGElement>(".chart-root")
    if (rootG.empty()) {
      rootG = svg.append("g").attr("class", "chart-root")
    }
    rootG.attr("transform", `translate(${margin.left},${margin.top})`)

    // Mapping from mile to fraction [0,1]
    const mapUncollapsedFrac = (x: number) =>
      (x - minBegin) / (maxEnd - minBegin)

    const mapCollapsedFrac = (x: number): number => {
      if (!bigGap) return mapUncollapsedFrac(x)

      const S = GAP_SPACER_PCT / 100
      const removed = bigGap.size
      const baseVisibleMiles = maxEnd - minBegin - removed
      const drawable = 1 - S

      let cut = 0
      if (x > bigGap.end) cut = removed
      else if (x > bigGap.start) cut = x - bigGap.start

      const miles = (x - minBegin) - cut
      const noSpacer =
        (miles / Math.max(1e-9, baseVisibleMiles)) * drawable
      const offset = x >= bigGap.end ? S : 0
      return noSpacer + offset
    }

    const xFrac = (x: number) =>
      collapsed && bigGap ? mapCollapsedFrac(x) : mapUncollapsedFrac(x)
    const xPixel = (x: number) => xFrac(x) * innerWidth

    // Use full innerHeight for years so chart fills vertically
    const yScale = d3
      .scalePoint<number>()
      .domain(years)
      .range([0, innerHeight])
      .padding(0.7)

    const approxSpacing =
      years.length > 1 ? innerHeight / (years.length - 1) : innerHeight

    const lineWidth = Math.max(
      7,
      Math.min(26, approxSpacing * 0.7),
    )

    type DrawSeg = {
      id: string
      begin: number
      end: number
      year: number
      y: number
      color: string
      tooltipHtml: string
    }

    const drawSegs: DrawSeg[] = allSegs
      .slice()
      .sort((a, b) => (a.year === b.year ? a.begin - b.begin : a.year - b.year))
      .map((s) => {
        const y = yScale(s.year) ?? 0
        let color: string
        let tooltipHtml: string

        // Overlap detection
        // strict overlap: (A.start < B.end) and (A.end > B.start)
        // We only care if it overlaps with ANOTHER segment in the same year
        const isOverlapping = allSegs.some(
          (other) =>
            other !== s &&
            other.year === s.year &&
            s.begin < other.end &&
            s.end > other.begin
        )

        const f = s.original
        const yr = s.year
        const score = s.score

        // Note: Using the interface property TX_END_REF_MARKER_DISP.
        const commonInfo = `TX_BEG_REF_MARKER_NBR: ${f.properties.TX_BEG_REF_MARKER_NBR}<br>TX_BEG_REF_MRKR_DISP: ${f.properties.TX_BEG_REF_MRKR_DISP}<br>TX_END_REF_MARKER_NBR: ${f.properties.TX_END_REF_MARKER_NBR}<br>TX_END_REF_MARKER_DISP: ${f.properties.TX_END_REF_MARKER_DISP}${isOverlapping ? "<br><b>Overlapping segment</b>" : ""}`

        if (selectedScore.value === "TX_AADT_CURRENT") {
          const idx = getDiscreteCategory(selectedScore.value, s.score)
          color = getDiscreteColor(idx, selectedScore.value)
          tooltipHtml = `Year: ${yr}<br>${selectedScore.label}: ${formatAADT(
            score,
          )}<br>Category: ${idx + 1
            }<br>${commonInfo}`
        } else if (selectedScore.value === "TX_MAINTENANCE_COST_AMT") {
          const idx = getDiscreteCategory(selectedScore.value, s.score)
          color = getDiscreteColor(idx, selectedScore.value)
          tooltipHtml = `Year: ${yr}<br>${selectedScore.label}: ${score
            }<br>Category: ${idx}<br>${commonInfo}`
        } else {
          const category = getCategory(selectedScore.value, s.score)
          color = getCategoryColor(category)
          tooltipHtml = `Year: ${yr}<br>${selectedScore.label}: ${score
            }<br>Category: ${category}<br>${commonInfo}`
        }

        return {
          id: `${s.year}-${s.begin}-${s.end}`,
          begin: s.begin,
          end: s.end,
          year: s.year,
          y,
          color,
          tooltipHtml,
        }
      })

    // ---- Y grid ----
    let gridYG = rootG.select<SVGGElement>(".y-grid")
    if (gridYG.empty()) {
      gridYG = rootG.append("g").attr("class", "y-grid")
    }

    const yGridSel = gridYG
      .selectAll<SVGLineElement, number>("line.y-grid-line")
      .data(years, (d: any) => d)

    const yGridEnter = yGridSel
      .enter()
      .append("line")
      .attr("class", "y-grid-line")
      .attr("x1", 0)
      .attr("x2", innerWidth)
      .attr("y1", (d) => (useSlideDown ? 0 : (yScale(d) ?? 0)))
      .attr("y2", (d) => (useSlideDown ? 0 : (yScale(d) ?? 0)))
      .attr("stroke", "rgba(0,0,0,0.3)")
      .attr("stroke-width", 1)

    const yGridMerged = yGridEnter.merge(yGridSel as any)

    if (useSlideDown) {
      yGridMerged.attr("y1", 0).attr("y2", 0)
    }

    yGridMerged
      .transition()
      .duration(duration)
      .attr("x1", 0)
      .attr("x2", innerWidth)
      .attr("y1", (d: any) => yScale(d) ?? 0)
      .attr("y2", (d: any) => yScale(d) ?? 0)

    yGridSel.exit().remove()

    // ---- X grid ----
    let gridXG = rootG.select<SVGGElement>(".x-grid")
    if (gridXG.empty()) {
      gridXG = rootG.append("g").attr("class", "x-grid")
    }

    const xGridMiles =
      bigGap && collapsed ? [bigGap.start, bigGap.end] : baseTicksMiles

    const xGridData = xGridMiles.map((mile) => ({
      mile,
      x: xPixel(mile),
    }))

    const xGridSel = gridXG
      .selectAll<SVGLineElement, { mile: number; x: number }>("line.x-grid-line")
      .data(xGridData, (d: any) => d.mile)

    xGridSel
      .enter()
      .append("line")
      .attr("class", "x-grid-line")
      .attr("x1", (d) => d.x)
      .attr("x2", (d) => d.x)
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .attr("stroke", "rgba(0,0,0,0.3)")
      .attr("stroke-width", 1)
      .style("opacity", collapsed && bigGap ? 1 : 0)

    xGridSel
      .transition()
      .duration(duration)
      .attr("x1", (d) => d.x)
      .attr("x2", (d) => d.x)
      .attr("y1", 0)
      .attr("y2", innerHeight)
      .style("opacity", 1)

    xGridSel
      .exit()
      .transition()
      .duration(fastDuration)
      .style("opacity", 0)
      .remove()

    // ---- segments ----
    let segG = rootG.select<SVGGElement>(".segments")
    if (segG.empty()) {
      segG = rootG.append("g").attr("class", "segments")
    }

    const segSel = segG
      .selectAll<SVGLineElement, DrawSeg>("line.segment")
      .data(drawSegs, (d: any) => d.id)

    segSel
      .exit()
      .transition()
      .duration(fastDuration)
      .style("opacity", 0)
      .remove()

    const segEnter = segSel
      .enter()
      .append("line")
      .attr("class", "segment")
      .attr("x1", (d) => xPixel(d.begin))
      .attr("x2", (d) => xPixel(d.begin))
      .attr("y1", (d) => (useSlideDown ? 0 : d.y))
      .attr("y2", (d) => (useSlideDown ? 0 : d.y))
      .attr("stroke", (d) => d.color)
      .attr("stroke-width", lineWidth)
      .attr("stroke-linecap", "butt")

    const segMerged = segEnter.merge(segSel as any)

    if (useSlideDown) {
      segMerged.attr("y1", 0).attr("y2", 0)
    }

    if (isFirst) {
      // First render: slide down vertically, x spans already in place
      segMerged
        .attr("x1", (d: DrawSeg) => xPixel(d.begin))
        .attr("x2", (d: DrawSeg) => xPixel(d.end))
        .transition()
        .duration(duration)
        .attr("y1", (d: DrawSeg) => d.y)
        .attr("y2", (d: DrawSeg) => d.y)
        .attr("stroke-width", lineWidth)
    } else {
      // Later (gap collapse/expand): animate x + y smoothly, no slide-down reset
      segMerged
        .transition()
        .duration(duration)
        .ease(d3.easeCubicInOut)
        .attr("x1", (d: DrawSeg) => xPixel(d.begin))
        .attr("x2", (d: DrawSeg) => xPixel(d.end))
        .attr("y1", (d: DrawSeg) => d.y)
        .attr("y2", (d: DrawSeg) => d.y)
        .attr("stroke-width", lineWidth)
    }

    // Custom Plotly-like tooltips
    if (tooltipEl && container) {
      const showTooltip = (event: any, d: DrawSeg) => {
        const cx = event.clientX
        const cy = event.clientY
        const tooltipWidth = 200 // approximate tooltip width
        const tooltipHeight = 100 // approximate tooltip height
        const offset = 12
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        // Determine horizontal position - flip if too close to edge
        let left: number
        if (cx < tooltipWidth + offset) {
          // Too close to left edge - show on right of cursor
          left = cx + offset
        } else if (cx > viewportWidth - tooltipWidth - offset) {
          // Too close to right edge - show on left of cursor
          left = cx - tooltipWidth - offset
        } else {
          // Default: show on right of cursor
          left = cx + offset
        }

        // Determine vertical position - flip if too close to bottom
        let top: number
        if (cy > viewportHeight - tooltipHeight - offset) {
          // Too close to bottom - show above cursor
          top = cy - tooltipHeight - offset
        } else {
          // Default: show below cursor
          top = cy + offset
        }

        tooltipEl.style.left = `${left}px`
        tooltipEl.style.top = `${top}px`
        tooltipEl.innerHTML = d.tooltipHtml

        // Dynamic styles
        tooltipEl.style.backgroundColor = d.color
        tooltipEl.style.color = getContrastColor(d.color)
        tooltipEl.style.border = "1px solid rgba(0,0,0,0.1)"
        tooltipEl.style.borderRadius = "6px"
        tooltipEl.style.padding = "8px"
        tooltipEl.style.boxShadow = "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"

        tooltipEl.classList.remove("hidden")
      }

      const hideTooltip = () => {
        tooltipEl.classList.add("hidden")
      }

      segMerged
        .on("mousemove", (event: any, d: DrawSeg) => showTooltip(event, d))
        .on("mouseout", () => hideTooltip())
    }

    // ---- X axis ----
    let xAxisG = rootG.select<SVGGElement>(".x-axis")
    if (xAxisG.empty()) {
      xAxisG = rootG
        .append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${innerHeight})`)
    } else {
      xAxisG.attr("transform", `translate(0,${innerHeight})`)
    }

    let xAxisDomain = xAxisG.select<SVGLineElement>(".axis-line")
    if (xAxisDomain.empty()) {
      xAxisDomain = xAxisG
        .append("line")
        .attr("class", "axis-line")
        .attr("y1", 0)
        .attr("y2", 0)
        .attr("stroke", "#444")
        .attr("stroke-width", 1)
    }
    xAxisDomain.attr("x1", 0).attr("x2", innerWidth)

    const tickMiles =
      bigGap && collapsed ? [bigGap.start, bigGap.end] : baseTicksMiles

    const tickData = tickMiles.map((mile) => ({
      mile,
      x: xPixel(mile),
    }))

    const tickSel = xAxisG
      .selectAll<SVGGElement, { mile: number; x: number }>("g.tick")
      .data(tickData, (d: any) => d.mile)

    const tickEnter = tickSel
      .enter()
      .append("g")
      .attr("class", "tick")
      .attr("transform", (d) => `translate(${d.x},0)`)
      .style("opacity", collapsed && bigGap ? 1 : 0)

    tickEnter
      .append("line")
      .attr("y1", 0)
      .attr("y2", 6)
      .attr("stroke", "#444")

    tickEnter
      .append("text")
      .attr("y", 24)
      .attr("text-anchor", "middle")
      .attr("font-size", 20)
      .attr("fill", "#2a3f5f")
      .attr("transform", "rotate(-15)")
      .text((d) => String(round2(d.mile)))

    tickSel
      .merge(tickEnter as any)
      .transition()
      .duration(duration)
      .attr("transform", (d) => `translate(${d.x},0)`)
      .style("opacity", 1)

    tickSel
      .exit()
      .transition()
      .duration(fastDuration)
      .style("opacity", 0)
      .remove()

    // X axis title just below ticks
    let xLabel = rootG.select<SVGTextElement>(".x-label")
    if (xLabel.empty()) {
      xLabel = rootG
        .append("text")
        .attr("class", "x-label")
        .attr("text-anchor", "middle")
        .attr("font-size", 22)
        .attr("fill", "#2a3f5f")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 48)
        .text("Reference Marker")
    } else {
      xLabel
        .attr("font-size", 22)
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 48)
        .text("Reference Marker")
    }

    // ---- Y axis ----
    let yAxisG = rootG.select<SVGGElement>(".y-axis")
    if (yAxisG.empty()) {
      yAxisG = rootG.append("g").attr("class", "y-axis")
    }

    let yAxisDomain = yAxisG.select<SVGLineElement>(".axis-line")
    if (yAxisDomain.empty()) {
      yAxisDomain = yAxisG
        .append("line")
        .attr("class", "axis-line")
        .attr("stroke", "#444")
        .attr("stroke-width", 1)
    }

    yAxisDomain.attr("x1", 0).attr("x2", 0).attr("y1", 0).attr("y2", innerHeight)

    const yTickSel = yAxisG
      .selectAll<SVGGElement, number>("g.y-tick")
      .data(years, (d: any) => d)

    const yTickEnter = yTickSel.enter().append("g").attr("class", "y-tick")

    yTickEnter
      .append("line")
      .attr("x1", -6)
      .attr("x2", 0)
      .attr("y1", 0)
      .attr("y2", 0)
      .attr("stroke", "#444")

    yTickEnter
      .append("text")
      .attr("x", -10)
      .attr("text-anchor", "end")
      .attr("font-size", 22)
      .attr("fill", "#2a3f5f")
      .attr("dominant-baseline", "middle")
      .text((d) => String(d))

    const yTicksMerged = yTickSel.merge(yTickEnter as any)

    if (useSlideDown) {
      yTicksMerged.attr("transform", "translate(0,0)")
    }

    yTicksMerged
      .transition()
      .duration(duration)
      .attr("transform", (d: any) => `translate(0,${yScale(d) ?? 0})`)

    yTickSel.exit().remove()

    // ---- Big gap markers (full height) ----
    let gapG = rootG.select<SVGGElement>(".gap-markers")
    if (gapG.empty()) {
      gapG = rootG.append("g").attr("class", "gap-markers")
    }

    const gapLinesSel = gapG
      .selectAll<SVGLineElement, number>("line.gap-marker")
      .data(bigGap ? [bigGap.start, bigGap.end] : [], (d: any) => d)

    gapLinesSel.exit().remove()

    const gapEnter = gapLinesSel
      .enter()
      .append("line")
      .attr("class", "gap-marker")
      .attr("x1", (d) => xPixel(d))
      .attr("x2", (d) => xPixel(d))
      .attr("y1", () => (useSlideDown ? 0 : 0))
      .attr("y2", () => (useSlideDown ? 0 : innerHeight))
      .attr("stroke", "#dc2626")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4,4")

    const gapMerged = gapEnter.merge(gapLinesSel as any)

    if (useSlideDown) {
      gapMerged.attr("y1", 0).attr("y2", 0)
    }

    gapMerged
      .transition()
      .duration(duration)
      .attr("x1", (d: number) => xPixel(d))
      .attr("x2", (d: number) => xPixel(d))
      .attr("y1", 0)
      .attr("y2", innerHeight)

    // mark that first render is done
    firstRenderRef.current = false
  }, [
    allSegs,
    baseTicksMiles,
    bigGap,
    collapsed,
    hasExtent,
    maxEnd,
    maxYear,
    minBegin,
    minYear,
    selectedScore.value,
    years,
  ])

  return (
    <div className="w-full">
      {!hasExtent ? (
        <div className="text-sm text-gray-500">
          No segment data available for this highway / score.
        </div>
      ) : (
        <div className="relative w-full">
          {/* Gap toggle row above chart, ~5–10px away */}
          {bigGap && (
            <div className="mb-1 flex justify-end">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => !prev)}
                className={`rounded-md px-3 py-1 text-xs font-medium shadow border transition-colors ${collapsed
                  ? "bg-green-100 text-green-900 border-green-300 hover:bg-green-200"
                  : "bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200"
                  }`}
              >
                {collapsed ? "Collapsed" : "Expanded"}
              </button>
            </div>
          )}

          {/* Plotly-like tooltip - fixed positioning to overlay everything */}
          <div
            ref={tooltipRef}
            className="pointer-events-none fixed z-[9999] hidden rounded-md bg-slate-800/95 px-2 py-1 text-xs text-white shadow-lg border border-slate-700 whitespace-normal"
          />

          <svg
            ref={svgRef}
            style={{
              width: "100%",
              height: "auto", // let height follow the viewBox (dynamic chart height)
              overflow: "visible",
              fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            }}
          />
        </div>
      )}
    </div>
  )
}

export default HighwaySegmentChart
