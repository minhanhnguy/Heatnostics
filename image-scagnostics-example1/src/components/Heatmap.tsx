"use client"

import { useEffect, useRef, useMemo } from "react"
import * as d3 from "d3"

interface DataPoint {
    year: number
    position: number
    endPosition: number
    score: number
}

interface HeatmapProps {
    data: DataPoint[]
    years: number[]
    minPos: number
    maxPos: number
}

// Color scale matching highway-heatmap-app
const getColor = (score: number): string => {
    if (score >= 90) return "rgb(21,128,61)"    // Very Good - Dark Green
    if (score >= 70) return "rgb(34,197,94)"    // Good - Green
    if (score >= 50) return "rgb(234,179,8)"    // Fair - Yellow
    if (score >= 35) return "rgb(249,115,22)"   // Poor - Orange
    if (score < 1) return "rgb(200,200,200)"    // Invalid - Gray
    return "rgb(239,68,68)"                      // Very Poor - Red
}

const getCategory = (score: number): string => {
    if (score >= 90) return "Very Good"
    if (score >= 70) return "Good"
    if (score >= 50) return "Fair"
    if (score >= 35) return "Poor"
    if (score < 1) return "Invalid"
    return "Very Poor"
}

// Contrast color for tooltip text
const getContrastColor = (hexOrRgb: string): string => {
    let r = 0, g = 0, b = 0;
    const rgbMatch = hexOrRgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
        r = parseInt(rgbMatch[1]);
        g = parseInt(rgbMatch[2]);
        b = parseInt(rgbMatch[3]);
    }
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? "#1a1a1a" : "#ffffff";
}

export default function Heatmap({ data, years, minPos, maxPos }: HeatmapProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<SVGSVGElement>(null)
    const tooltipRef = useRef<HTMLDivElement>(null)

    // Reverse years so newest is at top
    const sortedYears = useMemo(() => [...years].sort((a, b) => b - a), [years])

    useEffect(() => {
        if (!svgRef.current || !containerRef.current || !data.length) return

        const svg = d3.select(svgRef.current)
        const tooltip = tooltipRef.current
        const container = containerRef.current

        // Get container dimensions
        const containerWidth = container.clientWidth
        const containerHeight = container.clientHeight

        // Use container dimensions with padding
        const margin = { top: 5, right: 40, bottom: 40, left: 50 }
        const width = containerWidth
        const height = containerHeight
        const innerWidth = width - margin.left - margin.right
        const innerHeight = height - margin.top - margin.bottom

        svg.attr("width", width).attr("height", height)

        // Clear previous content
        svg.selectAll("*").remove()

        // Main group
        const g = svg
            .append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`)

        // Scales
        const xScale = d3.scaleLinear()
            .domain([minPos, maxPos])
            .range([0, innerWidth])

        const yScale = d3.scalePoint<number>()
            .domain(sortedYears)
            .range([0, innerHeight])
            .padding(0.5)

        // Calculate line width based on available space
        const approxSpacing = sortedYears.length > 1 ? innerHeight / (sortedYears.length - 1) : innerHeight
        const lineWidth = Math.max(3, Math.min(16, approxSpacing * 0.65))

        // Y grid lines (light)
        const yGridG = g.append("g").attr("class", "y-grid")
        sortedYears.forEach(year => {
            const y = yScale(year) ?? 0
            yGridG.append("line")
                .attr("x1", 0)
                .attr("x2", innerWidth)
                .attr("y1", y)
                .attr("y2", y)
                .attr("stroke", "rgba(0,0,0,0.15)")
                .attr("stroke-width", 0.5)
        })

        // Draw segments as lines
        const segG = g.append("g").attr("class", "segments")

        data.forEach(d => {
            const y = yScale(d.year) ?? 0
            const color = getColor(d.score)

            segG.append("line")
                .attr("class", "segment")
                .attr("x1", xScale(d.position))
                .attr("x2", xScale(d.endPosition))
                .attr("y1", y)
                .attr("y2", y)
                .attr("stroke", color)
                .attr("stroke-width", lineWidth)
                .attr("stroke-linecap", "butt")
                .style("cursor", "pointer")
                .datum(d)
        })

        // Tooltip interactions
        if (tooltip) {
            segG.selectAll<SVGLineElement, DataPoint>("line.segment")
                .on("mousemove", (event, d) => {
                    const color = getColor(d.score)
                    tooltip.style.display = "block"
                    tooltip.style.left = `${event.clientX + 12}px`
                    tooltip.style.top = `${event.clientY + 12}px`
                    tooltip.innerHTML = `
            Year: ${d.year}<br/>
            Position: ${d.position.toFixed(2)} - ${d.endPosition.toFixed(2)}<br/>
            Score: ${d.score}<br/>
            Category: ${getCategory(d.score)}
          `
                    tooltip.style.backgroundColor = color
                    tooltip.style.color = getContrastColor(color)
                })
                .on("mouseout", () => {
                    tooltip.style.display = "none"
                })
        }

        // X-axis
        const xAxisG = g.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${innerHeight})`)

        xAxisG.append("line")
            .attr("x1", 0)
            .attr("x2", innerWidth)
            .attr("y1", 0)
            .attr("y2", 0)
            .attr("stroke", "#666")
            .attr("stroke-width", 1)

        // X-axis ticks
        const xTicks = d3.ticks(minPos, maxPos, 8)
        xTicks.forEach(tick => {
            const x = xScale(tick)
            xAxisG.append("line")
                .attr("x1", x)
                .attr("x2", x)
                .attr("y1", 0)
                .attr("y2", 4)
                .attr("stroke", "#666")

            xAxisG.append("text")
                .attr("x", x)
                .attr("y", 16)
                .attr("text-anchor", "middle")
                .attr("font-size", 11)
                .attr("fill", "#555")
                .text(tick.toFixed(0))
        })

        // X-axis label
        g.append("text")
            .attr("x", innerWidth / 2)
            .attr("y", innerHeight + 32)
            .attr("text-anchor", "middle")
            .attr("font-size", 12)
            .attr("fill", "#555")
            .text("Reference Marker")

        // Y-axis
        const yAxisG = g.append("g").attr("class", "y-axis")

        yAxisG.append("line")
            .attr("x1", 0)
            .attr("x2", 0)
            .attr("y1", 0)
            .attr("y2", innerHeight)
            .attr("stroke", "#666")
            .attr("stroke-width", 1)

        // Only show every Nth year if too many
        const yearStep = sortedYears.length > 20 ? 2 : 1
        sortedYears.forEach((year, i) => {
            if (i % yearStep !== 0 && i !== sortedYears.length - 1) return
            const y = yScale(year) ?? 0
            yAxisG.append("line")
                .attr("x1", -4)
                .attr("x2", 0)
                .attr("y1", y)
                .attr("y2", y)
                .attr("stroke", "#666")

            yAxisG.append("text")
                .attr("x", -8)
                .attr("y", y)
                .attr("text-anchor", "end")
                .attr("dominant-baseline", "middle")
                .attr("font-size", 11)
                .attr("fill", "#555")
                .text(year)
        })

    }, [data, sortedYears, minPos, maxPos])

    return (
        <div ref={containerRef} className="relative w-full h-full">
            {/* Tooltip */}
            <div
                ref={tooltipRef}
                className="pointer-events-none fixed z-[9999] hidden rounded-md px-2 py-1 text-xs shadow-lg border border-slate-700 whitespace-nowrap"
                style={{ display: "none" }}
            />

            <svg
                ref={svgRef}
                style={{
                    width: "100%",
                    height: "100%",
                    overflow: "visible",
                    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
                }}
            />
        </div>
    )
}
