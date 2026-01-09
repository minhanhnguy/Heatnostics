"use client"

import React, { useMemo } from "react"
import * as d3 from "d3"
import { Delaunay } from "d3-delaunay"
import {
    extractDamagePoints,
    normalizePoints,
    computeMST,
    computeConvexHull,
    computeAlphaShape,
    getGeometryColor,
    type Point2D,
    type Edge
} from "@/lib/geometricUtils"

export interface PMISFeature {
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

interface MiniGeometricChartProps {
    data: PMISFeature[]
    geometryType: 'mst' | 'alpha_shape' | 'convex_hull'
    maxScore?: number
}

// ViewBox dimensions - increased height for more circular alpha shapes
const VBOX_W = 100
const VBOX_H = 60  // Increased from 24 for better circle aspect ratio
const PADDING = 2

const MiniGeometricChart: React.FC<MiniGeometricChartProps> = ({
    data,
    geometryType,
    maxScore = 49
}) => {
    const svgRef = React.useRef<SVGSVGElement>(null)

    const { points, normalizedPoints, geometry } = useMemo(() => {
        // Extract damage points from features
        const pts = extractDamagePoints(data, maxScore)

        if (pts.length < 2) {
            return { points: pts, normalizedPoints: [], geometry: null }
        }

        // Normalize points to [0, 1] range
        const normalized = normalizePoints(pts)

        // Compute the requested geometry
        let geom: { type: 'mst'; edges: Edge[] } | { type: 'hull' | 'alpha'; polygons: Point2D[][] } | null = null

        if (geometryType === 'mst') {
            const edges = computeMST(normalized)
            geom = { type: 'mst', edges }
        } else if (geometryType === 'convex_hull') {
            const hull = computeConvexHull(normalized)
            geom = { type: 'hull', polygons: [hull] }
        } else if (geometryType === 'alpha_shape') {
            const polygons = computeAlphaShape(normalized)
            geom = { type: 'alpha', polygons }
        }

        return { points: pts, normalizedPoints: normalized, geometry: geom }
    }, [data, geometryType, maxScore])

    // D3 Rendering
    React.useEffect(() => {
        if (!svgRef.current) return

        const svg = d3.select(svgRef.current)
        svg.selectAll("*").remove()

        if (normalizedPoints.length < 2 || !geometry) return

        const color = getGeometryColor(geometryType)

        // Scale normalized [0,1] coordinates to viewBox
        const scaleX = (x: number) => PADDING + x * (VBOX_W - 2 * PADDING)
        const scaleY = (y: number) => PADDING + (1 - y) * (VBOX_H - 2 * PADDING) // Flip Y so newer years are at top

        // Draw geometry
        if (geometry.type === 'mst') {
            // Draw MST edges
            svg.selectAll("line")
                .data(geometry.edges)
                .enter()
                .append("line")
                .attr("x1", d => scaleX(d.p1.x))
                .attr("y1", d => scaleY(d.p1.y))
                .attr("x2", d => scaleX(d.p2.x))
                .attr("y2", d => scaleY(d.p2.y))
                .attr("stroke", color)
                .attr("stroke-width", 0.8)
                .attr("stroke-opacity", 0.8)
        } else if (geometry.type === 'hull') {
            // Draw convex hull polygon
            const combinedPathData = geometry.polygons
                .filter((polygon: Point2D[]) => polygon.length >= 3)
                .map((polygon: Point2D[]) => {
                    return polygon.map((p, i) => {
                        const x = scaleX(p.x)
                        const y = scaleY(p.y)
                        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
                    }).join(" ") + " Z"
                })
                .join(" ")

            if (combinedPathData) {
                svg.append("path")
                    .attr("d", combinedPathData)
                    .attr("fill", color)
                    .attr("fill-opacity", 0.2)
                    .attr("fill-rule", "evenodd")
                    .attr("stroke", color)
                    .attr("stroke-width", 0.8)
                    .attr("stroke-opacity", 0.8)
            }
        } else if (geometry.type === 'alpha') {
            // Alpha shape: Draw clipped circles (alpha balls) + polygon
            // Same visualization as GeometricChart
            const delaunay = Delaunay.from(normalizedPoints, (p: Point2D) => p.x, (p: Point2D) => p.y)
            const voronoi = delaunay.voronoi([0, 0, 1, 1])

            // Compute alpha radius (same as in alpha shape computation)
            const mstEdges = computeMST(normalizedPoints)
            let alphaRadius = 0.1
            if (mstEdges.length > 0) {
                const lengths = mstEdges.map((e: Edge) => e.length).sort((a: number, b: number) => a - b)
                const idx = Math.floor(lengths.length * 0.9)
                alphaRadius = lengths[Math.min(idx, lengths.length - 1)] * 1.5
            }

            // Create defs for clip paths - use unique ID to avoid conflicts with other charts
            const defs = svg.append("defs")
            const chartId = Math.random().toString(36).substring(7)

            // Draw clipped circles
            normalizedPoints.forEach((pt: Point2D, i: number) => {
                const cellPath = voronoi.renderCell(i)
                if (!cellPath) return

                // Convert cell path to viewBox coordinates
                const screenCellPath = cellPath.replace(/([0-9.-]+),([0-9.-]+)/g, (_: string, x: string, y: string) => {
                    return `${scaleX(parseFloat(x))},${scaleY(parseFloat(y))}`
                })

                const clipId = `mini-clip-${chartId}-${i}`
                defs.append("clipPath")
                    .attr("id", clipId)
                    .append("path")
                    .attr("d", screenCellPath)

                // Draw circle with alpha radius, clipped to Voronoi cell
                const cx = scaleX(pt.x)
                const cy = scaleY(pt.y)
                const rx = alphaRadius * (VBOX_W - 2 * PADDING)
                const ry = alphaRadius * (VBOX_H - 2 * PADDING)

                svg.append("ellipse")
                    .attr("clip-path", `url(#${clipId})`)
                    .attr("cx", cx)
                    .attr("cy", cy)
                    .attr("rx", rx)
                    .attr("ry", ry)
                    .attr("fill", "#f3f4f6")  // Same as GeometricChart
                    .attr("fill-opacity", 0.7)
                    .attr("stroke", "#9ca3af")  // Same as GeometricChart
                    .attr("stroke-width", 0.5)
                    .attr("stroke-opacity", 0.6)
            })

            // Draw alpha shape polygon on top
            const combinedPathData = geometry.polygons
                .filter((polygon: Point2D[]) => polygon.length >= 3)
                .map((polygon: Point2D[]) => {
                    return polygon.map((p, i) => {
                        const x = scaleX(p.x)
                        const y = scaleY(p.y)
                        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`
                    }).join(" ") + " Z"
                })
                .join(" ")

            if (combinedPathData) {
                svg.append("path")
                    .attr("d", combinedPathData)
                    .attr("fill", color)
                    .attr("fill-opacity", 0.15)
                    .attr("fill-rule", "evenodd")
                    .attr("stroke", color)
                    .attr("stroke-width", 0.8)
                    .attr("stroke-opacity", 0.8)
            }
        }

        // Draw points
        svg.selectAll("circle")
            .data(normalizedPoints)
            .enter()
            .append("circle")
            .attr("cx", d => scaleX(d.x))
            .attr("cy", d => scaleY(d.y))
            .attr("r", 0.3)
            .attr("fill", "#374151") // Gray-700
            .attr("fill-opacity", 0.7)

    }, [normalizedPoints, geometry, geometryType])

    // Show message if insufficient data
    if (points.length < 2) {
        return (
            <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                <span className="text-[8px] text-gray-400">
                    {points.length === 0 ? "No Data" : "Need ≥2 pts"}
                </span>
            </div>
        )
    }

    return (
        <div className="w-full h-full overflow-hidden">
            <svg
                ref={svgRef}
                className="block"
                width="100%"
                height="100%"
                viewBox={`0 0 ${VBOX_W} ${VBOX_H}`}
                preserveAspectRatio="xMidYMid meet"
            />
        </div>
    )
}

export default React.memo(MiniGeometricChart)
