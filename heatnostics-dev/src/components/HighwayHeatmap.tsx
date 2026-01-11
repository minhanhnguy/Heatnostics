"use client"

import React, { useEffect, useRef, useMemo } from "react"
import * as d3 from "d3"

// ---------- Types ----------
interface PMISFeature {
    properties: {
        TX_SIGNED_HIGHWAY_RDBD_ID?: string
        COUNTY?: string
        EFF_YEAR?: string | number
        TX_BEG_REF_MARKER_NBR?: string | number
        TX_BEG_REF_MRKR_DISP?: string | number
        TX_END_REF_MARKER_NBR?: string | number
        TX_END_REF_MARKER_DISP?: string | number
        TX_CONDITION_SCORE?: number | string
        TX_LENGTH?: number | string
        [key: string]: any
    }
}

interface HighwayHeatmapProps {
    data: PMISFeature[]
    width?: number
    height?: number
}

// ---------- Utilities ----------
const cleanAndRound = (value: any): number => {
    if (value === null || typeof value === "undefined") return 0.0
    const cleaned = String(value).replace(/[^0-9.]/g, "")
    if (cleaned === "") return 0.0
    const num = parseFloat(cleaned)
    if (isNaN(num)) return 0.0
    return Number(num.toFixed(3))
}

const getAbsBegin = (f: PMISFeature): number => {
    const bm = cleanAndRound(f.properties.TX_BEG_REF_MARKER_NBR)
    const bd = cleanAndRound(f.properties.TX_BEG_REF_MRKR_DISP)
    return bm + bd
}

const getAbsEnd = (f: PMISFeature): number => {
    const len = cleanAndRound(f.properties.TX_LENGTH)
    return getAbsBegin(f) + len
}

// Category & Color - matching highway-heatmap-app
const getCategory = (score: number): string => {
    if (score >= 90) return "Very Good"
    if (score >= 70) return "Good"
    if (score >= 50) return "Fair"
    if (score >= 35) return "Poor"
    if (score < 1) return "Invalid"
    return "Very Poor"
}

const getCategoryColor = (category: string): string => {
    switch (category) {
        case "Very Poor": return "rgb(239,68,68)"
        case "Poor": return "rgb(249,115,22)"
        case "Fair": return "rgb(234,179,8)"
        case "Good": return "rgb(34,197,94)"
        case "Very Good": return "rgb(21,128,61)"
        case "Invalid": return "rgb(200,200,200)"
        default: return "rgb(75,85,99)"
    }
}

// ---------- Component ----------
const HighwayHeatmap: React.FC<HighwayHeatmapProps> = ({
    data,
    width = 900,
    height = 400
}) => {
    const svgRef = useRef<SVGSVGElement>(null)
    const tooltipRef = useRef<HTMLDivElement>(null)

    // Process segments
    const { segments, years, minBegin, maxEnd } = useMemo(() => {
        const segs: { begin: number; end: number; score: number; year: number; category: string; color: string }[] = []

        for (const f of data) {
            const begin = getAbsBegin(f)
            const end = getAbsEnd(f)
            const score = Number(f.properties.TX_CONDITION_SCORE)
            const year = Number(f.properties.EFF_YEAR) || 0

            if (!isFinite(begin) || !isFinite(end) || end <= begin) continue
            if (!isFinite(score) || score <= 0) continue  // Skip score = 0
            if (year <= 0) continue

            const category = getCategory(score)
            const color = getCategoryColor(category)
            segs.push({ begin, end, score, year, category, color })
        }

        // Get unique years sorted descending
        const uniqueYears = [...new Set(segs.map(s => s.year))].sort((a, b) => b - a)

        // Get extent
        let minB = Infinity, maxE = -Infinity
        for (const s of segs) {
            if (s.begin < minB) minB = s.begin
            if (s.end > maxE) maxE = s.end
        }

        return {
            segments: segs,
            years: uniqueYears,
            minBegin: minB,
            maxEnd: maxE
        }
    }, [data])

    // D3 Rendering
    useEffect(() => {
        if (!svgRef.current || segments.length === 0) return

        const svg = d3.select(svgRef.current)
        const tooltip = tooltipRef.current

        const margin = { top: 20, right: 40, bottom: 60, left: 80 }
        const innerWidth = width - margin.left - margin.right
        const innerHeight = height - margin.top - margin.bottom

        svg.attr("viewBox", `0 0 ${width} ${height}`)
        svg.selectAll("*").remove()

        const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`)

        // Scales
        const xScale = d3.scaleLinear()
            .domain([minBegin, maxEnd])
            .range([0, innerWidth])

        const yScale = d3.scalePoint<number>()
            .domain(years)
            .range([0, innerHeight])
            .padding(0.5)

        const lineWidth = Math.min(25, innerHeight / years.length * 0.7)

        // Grid lines
        g.selectAll(".y-grid")
            .data(years)
            .enter()
            .append("line")
            .attr("class", "y-grid")
            .attr("x1", 0)
            .attr("x2", innerWidth)
            .attr("y1", d => yScale(d) ?? 0)
            .attr("y2", d => yScale(d) ?? 0)
            .attr("stroke", "#e5e7eb")
            .attr("stroke-width", 1)

        // Segments
        g.selectAll(".segment")
            .data(segments)
            .enter()
            .append("line")
            .attr("class", "segment")
            .attr("x1", d => xScale(d.begin))
            .attr("x2", d => xScale(d.end))
            .attr("y1", d => yScale(d.year) ?? 0)
            .attr("y2", d => yScale(d.year) ?? 0)
            .attr("stroke", d => d.color)
            .attr("stroke-width", lineWidth)
            .attr("stroke-linecap", "butt")
            .on("mouseover", function (event, d) {
                if (tooltip) {
                    tooltip.innerHTML = `
            <strong>Year:</strong> ${d.year}<br/>
            <strong>Score:</strong> ${d.score}<br/>
            <strong>Category:</strong> ${d.category}<br/>
            <strong>Position:</strong> ${d.begin.toFixed(2)} - ${d.end.toFixed(2)}
          `
                    tooltip.style.backgroundColor = d.color
                    tooltip.style.color = d.category === "Fair" || d.category === "Poor" ? "#000" : "#fff"
                    tooltip.style.left = `${event.pageX + 10}px`
                    tooltip.style.top = `${event.pageY + 10}px`
                    tooltip.style.opacity = "1"
                }
            })
            .on("mouseout", function () {
                if (tooltip) {
                    tooltip.style.opacity = "0"
                }
            })

        // X Axis
        const xAxis = d3.axisBottom(xScale).ticks(10)
        g.append("g")
            .attr("transform", `translate(0,${innerHeight})`)
            .call(xAxis)
            .selectAll("text")
            .attr("fill", "#374151")
            .attr("font-size", "12px")

        // X Axis Label
        g.append("text")
            .attr("x", innerWidth / 2)
            .attr("y", innerHeight + 45)
            .attr("text-anchor", "middle")
            .attr("fill", "#374151")
            .attr("font-size", "14px")
            .text("Reference Marker (Miles)")

        // Y Axis
        const yAxis = d3.axisLeft(yScale)
        g.append("g")
            .call(yAxis)
            .selectAll("text")
            .attr("fill", "#374151")
            .attr("font-size", "12px")

        // Y Axis Label
        g.append("text")
            .attr("transform", "rotate(-90)")
            .attr("x", -innerHeight / 2)
            .attr("y", -50)
            .attr("text-anchor", "middle")
            .attr("fill", "#374151")
            .attr("font-size", "14px")
            .text("Year")

    }, [segments, years, minBegin, maxEnd, width, height])

    if (segments.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-gray-500">
                No data available
            </div>
        )
    }

    return (
        <div className="relative">
            <svg ref={svgRef} className="w-full" />
            <div
                ref={tooltipRef}
                className="fixed z-50 px-3 py-2 rounded shadow-lg pointer-events-none transition-opacity"
                style={{ opacity: 0 }}
            />

            {/* Legend */}
            <div className="flex justify-center gap-4 mt-4 text-sm">
                {["Very Good", "Good", "Fair", "Poor", "Very Poor"].map((cat) => (
                    <div key={cat} className="flex items-center gap-1">
                        <div
                            className="w-4 h-4 rounded"
                            style={{ backgroundColor: getCategoryColor(cat) }}
                        />
                        <span className="text-gray-700">{cat}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default HighwayHeatmap
