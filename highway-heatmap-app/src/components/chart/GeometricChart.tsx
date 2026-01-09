"use client"

import React, { useMemo, useRef } from "react"
import * as d3 from "d3"
import { Delaunay } from "d3-delaunay"
import {
    extractDamagePoints,
    normalizePoints,
    computeMST,
    computeConvexHull,
    computeAlphaShapeWithCircles,
    getGeometryColor,
    getGeometryLabel,
    type Point2D,
    type Edge,
    type Circumcircle
} from "@/lib/geometricUtils"

// ---------- small utils ----------
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

interface PMISFeature {
    properties: {
        TX_SIGNED_HIGHWAY_RDBD_ID?: string
        COUNTY?: string
        RESPONSIBLE_DISTRICT?: string
        EFF_YEAR?: string | number
        TX_BEG_REF_MARKER_NBR?: string | number
        TX_BEG_REF_MRKR_DISP?: string | number
        TX_CONDITION_SCORE?: number | string
        [key: string]: any
    }
    geometry?: any
}

interface GeometricChartProps {
    data: PMISFeature[]
    geometryField: string
    highway: string
    county: string
    maxScore?: number
}

// Chart dimensions matching HighwaySegmentChart style
const CHART_WIDTH = 900
const MARGIN = { top: 8, right: 50, bottom: 60, left: 60 }

const GeometricChart: React.FC<GeometricChartProps> = ({
    data,
    geometryField,
    highway,
    county,
    maxScore = 49
}) => {
    const svgRef = useRef<SVGSVGElement | null>(null)
    const tooltipRef = useRef<HTMLDivElement | null>(null)

    const geometryType = useMemo(() => {
        switch (geometryField) {
            case 'GEOMETRIC_MST': return 'mst' as const
            case 'GEOMETRIC_ALPHA_SHAPE': return 'alpha_shape' as const
            case 'GEOMETRIC_CONVEX_HULL': return 'convex_hull' as const
            default: return 'mst' as const
        }
    }, [geometryField])

    const { points, geometry, xDomain, yDomain, years } = useMemo(() => {
        // Extract damage points from features
        const pts = extractDamagePoints(data, maxScore)

        if (pts.length < 2) {
            return { points: pts, geometry: null, xDomain: [0, 1], yDomain: [1996, 2024], years: [] }
        }

        // Get domains for axes (use original values, not normalized)
        const xVals = pts.map(p => p.x)
        const yVals = pts.map(p => p.y)
        const xDom: [number, number] = [Math.min(...xVals), Math.max(...xVals)]
        const yDom: [number, number] = [Math.min(...yVals), Math.max(...yVals)]

        // Get all years from max to min (fill in missing years like HighwaySegmentChart)
        const uniqueYears = Array.from(new Set(pts.map(p => p.year)))
            .filter((y): y is number => typeof y === 'number' && y > 0)
        let allYears: number[] = []
        if (uniqueYears.length > 0) {
            const minY = Math.min(...uniqueYears)
            const maxY = Math.max(...uniqueYears)
            for (let y = maxY; y >= minY; y--) {
                allYears.push(y)
            }
        }

        // Normalize points for geometry computation
        const normalized = normalizePoints(pts)

        // Compute geometry
        let geom: { type: 'mst'; edges: Edge[] } | { type: 'hull'; polygons: Point2D[][] } | { type: 'alpha'; polygons: Point2D[][]; circles: Circumcircle[] } | null = null

        if (geometryType === 'mst') {
            const edges = computeMST(normalized)
            geom = { type: 'mst', edges }
        } else if (geometryType === 'convex_hull') {
            const hull = computeConvexHull(normalized)
            geom = { type: 'hull', polygons: [hull] }
        } else if (geometryType === 'alpha_shape') {
            const { polygons, circles } = computeAlphaShapeWithCircles(normalized)
            geom = { type: 'alpha', polygons, circles }
        }

        return { points: pts, geometry: geom, xDomain: xDom, yDomain: yDom, years: allYears }
    }, [data, geometryType, maxScore])

    const hasData = points.length >= 2 && geometry !== null

    // D3 Rendering
    React.useEffect(() => {
        if (!svgRef.current) return

        const svg = d3.select(svgRef.current)
        const tooltipEl = tooltipRef.current
        const container = svgRef.current.parentElement as HTMLElement | null

        // Dynamic inner height based on number of years (matching HighwaySegmentChart)
        const rowHeight = 22  // Moderate increase for more circular alpha balls
        const minInnerHeight = 100
        const innerHeight = Math.max(minInnerHeight, years.length * rowHeight)
        const height = innerHeight + MARGIN.top + MARGIN.bottom
        const innerWidth = CHART_WIDTH - MARGIN.left - MARGIN.right

        svg.attr("viewBox", `0 0 ${CHART_WIDTH} ${height}`)

        // Clear and rebuild
        svg.selectAll("*").remove()

        const rootG = svg.append("g")
            .attr("class", "chart-root")
            .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`)

        // Create scales using original data domains
        const xScale = d3.scaleLinear()
            .domain(xDomain as [number, number])
            .range([0, innerWidth])

        const yScale = d3.scaleLinear()
            .domain(yDomain as [number, number])
            .range([innerHeight, 0]) // Flip Y so newer years are at top

        // ---- Y grid lines ----
        const gridYG = rootG.append("g").attr("class", "y-grid")
        years.forEach(year => {
            const yPos = yScale(year)
            gridYG.append("line")
                .attr("class", "y-grid-line")
                .attr("x1", 0)
                .attr("x2", innerWidth)
                .attr("y1", yPos)
                .attr("y2", yPos)
                .attr("stroke", "rgba(0,0,0,0.3)")
                .attr("stroke-width", 1)
        })

        // ---- X axis ----
        const xAxisG = rootG.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${innerHeight})`)

        // X axis domain line
        xAxisG.append("line")
            .attr("class", "axis-line")
            .attr("x1", 0)
            .attr("x2", innerWidth)
            .attr("y1", 0)
            .attr("y2", 0)
            .attr("stroke", "#444")
            .attr("stroke-width", 1)

        // X axis ticks
        const xTicks = xScale.ticks(6)
        xTicks.forEach(tick => {
            const xPos = xScale(tick)
            const tickG = xAxisG.append("g")
                .attr("class", "tick")
                .attr("transform", `translate(${xPos},0)`)

            tickG.append("line")
                .attr("y1", 0)
                .attr("y2", 6)
                .attr("stroke", "#444")

            tickG.append("text")
                .attr("y", 24)
                .attr("text-anchor", "middle")
                .attr("font-size", 20)
                .attr("fill", "#2a3f5f")
                .attr("transform", "rotate(-15)")
                .text(tick.toFixed(1))
        })

        // X axis label
        rootG.append("text")
            .attr("class", "x-label")
            .attr("x", innerWidth / 2)
            .attr("y", innerHeight + 48)
            .attr("text-anchor", "middle")
            .attr("font-size", 22)
            .attr("fill", "#2a3f5f")
            .text("Reference Marker")

        // ---- Y axis ----
        const yAxisG = rootG.append("g").attr("class", "y-axis")

        // Y axis domain line
        yAxisG.append("line")
            .attr("class", "axis-line")
            .attr("x1", 0)
            .attr("x2", 0)
            .attr("y1", 0)
            .attr("y2", innerHeight)
            .attr("stroke", "#444")
            .attr("stroke-width", 1)

        // Y axis ticks (years)
        years.forEach(year => {
            const yPos = yScale(year)
            const tickG = yAxisG.append("g")
                .attr("class", "y-tick")
                .attr("transform", `translate(0,${yPos})`)

            tickG.append("line")
                .attr("x1", -6)
                .attr("x2", 0)
                .attr("y1", 0)
                .attr("y2", 0)
                .attr("stroke", "#444")

            tickG.append("text")
                .attr("x", -10)
                .attr("text-anchor", "end")
                .attr("font-size", 22)
                .attr("fill", "#2a3f5f")
                .attr("dominant-baseline", "middle")
                .text(String(year))
        })

        if (!hasData) {
            rootG.append("text")
                .attr("x", innerWidth / 2)
                .attr("y", innerHeight / 2)
                .attr("text-anchor", "middle")
                .attr("fill", "#9CA3AF")
                .attr("font-size", 18)
                .text("Insufficient data points")
            return
        }

        const color = getGeometryColor(geometryType)

        // Normalize points for drawing (same normalization as geometry computation)
        const normalizedPoints = normalizePoints(points)

        // Helper to convert normalized coords to screen coords
        const toScreenX = (normX: number) => {
            const origX = xDomain[0] + normX * (xDomain[1] - xDomain[0])
            return xScale(origX)
        }
        const toScreenY = (normY: number) => {
            const origY = yDomain[0] + normY * (yDomain[1] - yDomain[0])
            return yScale(origY)
        }

        // Draw geometry
        const geomG = rootG.append("g").attr("class", "geometry")

        if (geometry!.type === 'mst') {
            // Draw MST edges
            geomG.selectAll("line.mst-edge")
                .data((geometry as { type: 'mst'; edges: Edge[] }).edges)
                .enter()
                .append("line")
                .attr("class", "mst-edge")
                .attr("x1", d => toScreenX(d.p1.x))
                .attr("y1", d => toScreenY(d.p1.y))
                .attr("x2", d => toScreenX(d.p2.x))
                .attr("y2", d => toScreenY(d.p2.y))
                .attr("stroke", color)
                .attr("stroke-width", 2)
                .attr("stroke-opacity", 0.8)
        } else if (geometry!.type === 'hull') {
            // Draw convex hull polygon
            const polygons = (geometry as { type: 'hull'; polygons: Point2D[][] }).polygons

            // Combine all polygons into a single path
            const combinedPathData = polygons
                .filter(polygon => polygon.length >= 3)
                .map(polygon => {
                    return polygon.map((p, i) => {
                        const x = toScreenX(p.x)
                        const y = toScreenY(p.y)
                        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
                    }).join(" ") + " Z"
                })
                .join(" ")

            if (combinedPathData) {
                geomG.append("path")
                    .attr("d", combinedPathData)
                    .attr("fill", color)
                    .attr("fill-opacity", 0.15)
                    .attr("fill-rule", "evenodd")
                    .attr("stroke", color)
                    .attr("stroke-width", 2)
                    .attr("stroke-opacity", 0.8)
            }
        } else if (geometry!.type === 'alpha') {
            // Draw alpha shape with circumcircles visualization
            const alphaGeom = geometry as { type: 'alpha'; polygons: Point2D[][]; circles: Circumcircle[] }

            // Draw circles centered on each point, clipped to Voronoi cells
            // This shows the "alpha ball" around each point, with boundaries where they meet
            const normalizedPts = normalizePoints(points)
            const delaunay = Delaunay.from(normalizedPts, (p: Point2D) => p.x, (p: Point2D) => p.y)
            const voronoi = delaunay.voronoi([0, 0, 1, 1])

            // Compute alpha radius (same as used in alpha shape computation)
            const mstEdges = computeMST(normalizedPts)
            let alphaRadius = 0.1 // default
            if (mstEdges.length > 0) {
                const lengths = mstEdges.map(e => e.length).sort((a, b) => a - b)
                const idx = Math.floor(lengths.length * 0.9)
                alphaRadius = lengths[Math.min(idx, lengths.length - 1)] * 1.5
            }

            // Create a defs element for clip paths
            const defs = svg.append("defs")

            // Draw each circle centered on its point, clipped to Voronoi cell
            normalizedPts.forEach((pt, i) => {
                const cellPath = voronoi.renderCell(i)
                if (!cellPath) return

                // Convert cell path to screen coordinates for clip path
                const screenCellPath = cellPath.replace(/([0-9.-]+),([0-9.-]+)/g, (_: string, x: string, y: string) => {
                    const screenX = toScreenX(parseFloat(x))
                    const screenY = toScreenY(parseFloat(y))
                    return `${screenX},${screenY}`
                })

                // Create clip path for this cell
                const clipId = `clip-point-${i}`
                defs.append("clipPath")
                    .attr("id", clipId)
                    .append("path")
                    .attr("d", screenCellPath)

                // Draw circle centered on this point with alpha radius, clipped to cell
                const cx = toScreenX(pt.x)
                const cy = toScreenY(pt.y)
                const rx = alphaRadius * innerWidth
                const ry = alphaRadius * innerHeight

                geomG.append("ellipse")
                    .attr("class", "alpha-ball")
                    .attr("clip-path", `url(#${clipId})`)
                    .attr("cx", cx)
                    .attr("cy", cy)
                    .attr("rx", rx)
                    .attr("ry", ry)
                    .attr("fill", "#f3f4f6")  // Very light gray fill
                    .attr("fill-opacity", 0.7)
                    .attr("stroke", "#9ca3af")  // Gray stroke for circle edge
                    .attr("stroke-width", 1)
                    .attr("stroke-opacity", 0.6)
            })

            // COMMENTED OUT: Draw Delaunay triangulation edges ON TOP of circles (darker)
            // TODO: Come back to this later
            /*
            const drawnDelaunayEdges = new Set<string>()
            for (let i = 0; i < delaunay.triangles.length; i += 3) {
                const tri = [
                    delaunay.triangles[i],
                    delaunay.triangles[i + 1],
                    delaunay.triangles[i + 2]
                ]

                for (let j = 0; j < 3; j++) {
                    const p1Idx = tri[j]
                    const p2Idx = tri[(j + 1) % 3]

                    const edgeKey = p1Idx < p2Idx ? `${p1Idx}-${p2Idx}` : `${p2Idx}-${p1Idx}`
                    if (drawnDelaunayEdges.has(edgeKey)) continue
                    drawnDelaunayEdges.add(edgeKey)

                    const p1 = normalizedPts[p1Idx]
                    const p2 = normalizedPts[p2Idx]

                    geomG.append("line")
                        .attr("class", "delaunay-edge")
                        .attr("x1", toScreenX(p1.x))
                        .attr("y1", toScreenY(p1.y))
                        .attr("x2", toScreenX(p2.x))
                        .attr("y2", toScreenY(p2.y))
                        .attr("stroke", "#374151")  // Gray-700 - darker than circles
                        .attr("stroke-width", 0.75)
                        .attr("stroke-opacity", 0.6)
                }
            }
            */

            // Draw Voronoi edges where circles touch
            // Use d3-delaunay's edge rendering which correctly handles truncation
            // Iterate all edges from the Delaunay triangulation
            const drawnEdges = new Set<string>()

            // Get all Voronoi cell polygons
            const cellPolygons: number[][][] = []
            for (let i = 0; i < normalizedPts.length; i++) {
                const cell = voronoi.cellPolygon(i)
                cellPolygons.push(cell || [])
            }

            // For each Delaunay edge, find the shared Voronoi edge
            for (let i = 0; i < delaunay.triangles.length; i += 3) {
                const tri = [
                    delaunay.triangles[i],
                    delaunay.triangles[i + 1],
                    delaunay.triangles[i + 2]
                ]

                for (let j = 0; j < 3; j++) {
                    const p1Idx = tri[j]
                    const p2Idx = tri[(j + 1) % 3]

                    const edgeKey = p1Idx < p2Idx ? `${p1Idx}-${p2Idx}` : `${p2Idx}-${p1Idx}`
                    if (drawnEdges.has(edgeKey)) continue
                    drawnEdges.add(edgeKey)

                    const p1 = normalizedPts[p1Idx]
                    const p2 = normalizedPts[p2Idx]

                    // Check if circles touch in normalized space
                    const dx = p2.x - p1.x
                    const dy = p2.y - p1.y
                    const dist = Math.sqrt(dx * dx + dy * dy)

                    // Only draw Voronoi edge if circles overlap
                    if (dist < 2 * alphaRadius) {
                        // Find shared edge between Voronoi cells of p1 and p2
                        const cell1 = cellPolygons[p1Idx]
                        const cell2 = cellPolygons[p2Idx]

                        if (cell1.length > 0 && cell2.length > 0) {
                            // Find vertices that are shared (or very close) between both cells
                            const epsilon = 0.0001
                            const sharedPoints: number[][] = []

                            for (const v1 of cell1) {
                                for (const v2 of cell2) {
                                    if (Math.abs(v1[0] - v2[0]) < epsilon && Math.abs(v1[1] - v2[1]) < epsilon) {
                                        sharedPoints.push(v1)
                                        break
                                    }
                                }
                            }

                            // If we found exactly 2 shared points, clip and draw the edge
                            if (sharedPoints.length >= 2) {
                                // Get line segment endpoints
                                let lx1 = sharedPoints[0][0]
                                let ly1 = sharedPoints[0][1]
                                let lx2 = sharedPoints[1][0]
                                let ly2 = sharedPoints[1][1]

                                // Clip line to the union of both circles (where it's inside at least one)
                                // But we want the intersection - where it's inside BOTH
                                // The edge should extend from where it enters the lens to where it exits

                                // Helper: check if point is inside the lens (intersection of both circles)
                                const isInsideLens = (x: number, y: number) => {
                                    const d1 = Math.sqrt((x - p1.x) ** 2 + (y - p1.y) ** 2)
                                    const d2 = Math.sqrt((x - p2.x) ** 2 + (y - p2.y) ** 2)
                                    // Use a small tolerance to ensure edge reaches circle boundary
                                    const tolerance = alphaRadius * 0.02
                                    return d1 <= alphaRadius + tolerance && d2 <= alphaRadius + tolerance
                                }

                                // Use higher resolution for more accurate clipping
                                const samples = 100
                                let firstInside = -1
                                let lastInside = -1

                                for (let s = 0; s <= samples; s++) {
                                    const t = s / samples
                                    const px = lx1 + t * (lx2 - lx1)
                                    const py = ly1 + t * (ly2 - ly1)
                                    if (isInsideLens(px, py)) {
                                        if (firstInside === -1) firstInside = s
                                        lastInside = s
                                    }
                                }

                                // Only draw if we have a visible portion
                                if (firstInside !== -1 && lastInside !== -1) {
                                    const t1 = firstInside / samples
                                    const t2 = lastInside / samples

                                    const clippedX1 = lx1 + t1 * (lx2 - lx1)
                                    const clippedY1 = ly1 + t1 * (ly2 - ly1)
                                    const clippedX2 = lx1 + t2 * (lx2 - lx1)
                                    const clippedY2 = ly1 + t2 * (ly2 - ly1)

                                    const sx1 = toScreenX(clippedX1)
                                    const sy1 = toScreenY(clippedY1)
                                    const sx2 = toScreenX(clippedX2)
                                    const sy2 = toScreenY(clippedY2)

                                    geomG.append("line")
                                        .attr("class", "voronoi-edge")
                                        .attr("x1", sx1)
                                        .attr("y1", sy1)
                                        .attr("x2", sx2)
                                        .attr("y2", sy2)
                                        .attr("stroke", "#4b5563")  // Darker gray
                                        .attr("stroke-width", 0.5)
                                        .attr("stroke-opacity", 1.0)
                                }
                            }
                        }
                    }
                }
            }

            // Then draw the alpha shape polygons
            const combinedPathData = alphaGeom.polygons
                .filter(polygon => polygon.length >= 3)
                .map(polygon => {
                    return polygon.map((p, i) => {
                        const x = toScreenX(p.x)
                        const y = toScreenY(p.y)
                        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
                    }).join(" ") + " Z"
                })
                .join(" ")

            if (combinedPathData) {
                geomG.append("path")
                    .attr("d", combinedPathData)
                    .attr("fill", color)
                    .attr("fill-opacity", 0.15)
                    .attr("fill-rule", "evenodd")
                    .attr("stroke", color)
                    .attr("stroke-width", 2)
                    .attr("stroke-opacity", 0.8)
            }
        }

        // Draw points with tooltips
        const pointsG = rootG.append("g").attr("class", "points")

        type PointData = typeof points[0]

        const showTooltip = (event: any, d: PointData) => {
            if (!tooltipEl) return
            const cx = event.clientX
            const cy = event.clientY
            const tooltipWidth = 180
            const tooltipHeight = 80
            const offset = 12
            const viewportWidth = window.innerWidth
            const viewportHeight = window.innerHeight

            // Determine horizontal position
            let left: number
            if (cx < tooltipWidth + offset) {
                left = cx + offset
            } else if (cx > viewportWidth - tooltipWidth - offset) {
                left = cx - tooltipWidth - offset
            } else {
                left = cx + offset
            }

            // Determine vertical position
            let top: number
            if (cy > viewportHeight - tooltipHeight - offset) {
                top = cy - tooltipHeight - offset
            } else {
                top = cy + offset
            }

            tooltipEl.style.left = `${left}px`
            tooltipEl.style.top = `${top}px`
            tooltipEl.innerHTML = `Position: ${d.position?.toFixed(2)}<br>Year: ${d.year}<br>Score: ${d.score}`

            // Dynamic styles
            tooltipEl.style.backgroundColor = color
            tooltipEl.style.color = getContrastColor(color)
            tooltipEl.style.border = "1px solid rgba(0,0,0,0.1)"
            tooltipEl.style.borderRadius = "6px"
            tooltipEl.style.padding = "8px"
            tooltipEl.style.boxShadow = "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)"

            tooltipEl.classList.remove("hidden")
        }

        const hideTooltip = () => {
            if (tooltipEl) {
                tooltipEl.classList.add("hidden")
            }
        }

        pointsG.selectAll("circle.data-point")
            .data(points)
            .enter()
            .append("circle")
            .attr("class", "data-point")
            .attr("cx", d => xScale(d.x))
            .attr("cy", d => yScale(d.y))
            .attr("r", 4)
            .attr("fill", "#374151")
            .attr("fill-opacity", 0.9)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5)
            .style("cursor", "pointer")
            .on("mousemove", (event: any, d: PointData) => showTooltip(event, d))
            .on("mouseout", hideTooltip)

        // Legend removed as per user request

    }, [points, geometry, geometryType, geometryField, xDomain, yDomain, years, hasData])

    return (
        <div className="w-full">
            <div className="relative w-full">
                {/* Plotly-like tooltip - fixed positioning to overlay everything */}
                <div
                    ref={tooltipRef}
                    className="pointer-events-none fixed z-[9999] hidden rounded-md bg-slate-800/95 px-2 py-1 text-xs text-white shadow-lg border border-slate-700 whitespace-normal"
                />

                <svg
                    ref={svgRef}
                    style={{
                        width: "100%",
                        height: "auto",
                        overflow: "visible",
                        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                    }}
                />
            </div>
            <p className="mt-2 text-xs text-gray-500 text-center">
                {points.length} damage points (condition score &gt; 0 and ≤ {maxScore})
            </p>
        </div>
    )
}

export default React.memo(GeometricChart)
