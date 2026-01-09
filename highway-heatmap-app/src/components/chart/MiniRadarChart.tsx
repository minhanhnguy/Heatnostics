"use client"

import React from "react"

interface MiniRadarChartProps {
    // All values should be in [0, 1] range
    values: {
        outlying: number
        skewed: number
        stringy: number
        sparse: number
        convex: number
        clumpy: number
        skinny: number
        striated: number
        monotonic: number
    }
    size?: number
    showLabels?: boolean
    color?: string
}

const LABELS = [
    'Out', 'Skw', 'Str', 'Spr', 'Con', 'Clm', 'Skn', 'Stri', 'Mon'
]

const FULL_LABELS = [
    'Outlying', 'Skewed', 'Stringy', 'Sparse', 'Convex',
    'Clumpy', 'Skinny', 'Striated', 'Monotonic'
]

const MiniRadarChart: React.FC<MiniRadarChartProps> = ({
    values,
    size = 40,
    showLabels = false,
    color = "#3B82F6"
}) => {
    const center = size / 2
    const radius = (size / 2) - (showLabels ? 15 : 4)

    // Convert values object to array in correct order
    const valueArray = [
        values.outlying,
        values.skewed,
        values.stringy,
        values.sparse,
        values.convex,
        values.clumpy,
        values.skinny,
        values.striated,
        values.monotonic
    ]

    const numAxes = 9
    const angleStep = (2 * Math.PI) / numAxes

    // Generate polygon points for the data
    const getPoint = (index: number, value: number) => {
        const angle = -Math.PI / 2 + index * angleStep // Start from top
        const r = value * radius
        return {
            x: center + r * Math.cos(angle),
            y: center + r * Math.sin(angle)
        }
    }

    // Generate polygon path
    const polygonPoints = valueArray.map((v, i) => {
        const point = getPoint(i, v)
        return `${point.x},${point.y}`
    }).join(' ')

    // Generate background grid circles
    const gridCircles = [0.25, 0.5, 0.75, 1].map(scale => (
        <circle
            key={scale}
            cx={center}
            cy={center}
            r={radius * scale}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={0.5}
        />
    ))

    // Generate axis lines
    const axisLines = Array.from({ length: numAxes }, (_, i) => {
        const angle = -Math.PI / 2 + i * angleStep
        const endX = center + radius * Math.cos(angle)
        const endY = center + radius * Math.sin(angle)
        return (
            <line
                key={i}
                x1={center}
                y1={center}
                x2={endX}
                y2={endY}
                stroke="#d1d5db"
                strokeWidth={0.5}
            />
        )
    })

    // Generate labels if enabled
    const labels = showLabels ? Array.from({ length: numAxes }, (_, i) => {
        const angle = -Math.PI / 2 + i * angleStep
        const labelRadius = radius + 10
        const x = center + labelRadius * Math.cos(angle)
        const y = center + labelRadius * Math.sin(angle)
        return (
            <text
                key={i}
                x={x}
                y={y}
                fontSize={8}
                fill="#6b7280"
                textAnchor="middle"
                dominantBaseline="middle"
            >
                {showLabels ? LABELS[i] : ''}
            </text>
        )
    }) : null

    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Background grid */}
            {gridCircles}
            {axisLines}

            {/* Data polygon */}
            <polygon
                points={polygonPoints}
                fill={color}
                fillOpacity={0.3}
                stroke={color}
                strokeWidth={1}
            />

            {/* Data points */}
            {valueArray.map((v, i) => {
                const point = getPoint(i, v)
                return (
                    <circle
                        key={i}
                        cx={point.x}
                        cy={point.y}
                        r={1.5}
                        fill={color}
                    />
                )
            })}

            {/* Labels */}
            {labels}
        </svg>
    )
}

// Larger version for expanded view
export const RadarChartExpanded: React.FC<MiniRadarChartProps & { title?: string }> = ({
    values,
    size = 200,
    color = "#3B82F6",
    title
}) => {
    const center = size / 2
    const radius = (size / 2) - 40

    const valueArray = [
        values.outlying,
        values.skewed,
        values.stringy,
        values.sparse,
        values.convex,
        values.clumpy,
        values.skinny,
        values.striated,
        values.monotonic
    ]

    const numAxes = 9
    const angleStep = (2 * Math.PI) / numAxes

    const getPoint = (index: number, value: number) => {
        const angle = -Math.PI / 2 + index * angleStep
        const r = value * radius
        return {
            x: center + r * Math.cos(angle),
            y: center + r * Math.sin(angle)
        }
    }

    const polygonPoints = valueArray.map((v, i) => {
        const point = getPoint(i, v)
        return `${point.x},${point.y}`
    }).join(' ')

    const gridCircles = [0.25, 0.5, 0.75, 1].map(scale => (
        <circle
            key={scale}
            cx={center}
            cy={center}
            r={radius * scale}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth={1}
        />
    ))

    const axisLines = Array.from({ length: numAxes }, (_, i) => {
        const angle = -Math.PI / 2 + i * angleStep
        const endX = center + radius * Math.cos(angle)
        const endY = center + radius * Math.sin(angle)
        return (
            <line
                key={i}
                x1={center}
                y1={center}
                x2={endX}
                y2={endY}
                stroke="#d1d5db"
                strokeWidth={1}
            />
        )
    })

    const labels = Array.from({ length: numAxes }, (_, i) => {
        const angle = -Math.PI / 2 + i * angleStep
        const labelRadius = radius + 25
        const x = center + labelRadius * Math.cos(angle)
        const y = center + labelRadius * Math.sin(angle)
        return (
            <g key={i}>
                <text
                    x={x}
                    y={y}
                    fontSize={11}
                    fontWeight={500}
                    fill="#374151"
                    textAnchor="middle"
                    dominantBaseline="middle"
                >
                    {FULL_LABELS[i]}
                </text>
                <text
                    x={x}
                    y={y + 12}
                    fontSize={10}
                    fill="#6b7280"
                    textAnchor="middle"
                    dominantBaseline="middle"
                >
                    {(valueArray[i] * 100).toFixed(0)}%
                </text>
            </g>
        )
    })

    return (
        <div className="flex flex-col items-center">
            {title && <h4 className="text-sm font-medium text-gray-700 mb-2">{title}</h4>}
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {gridCircles}
                {axisLines}

                <polygon
                    points={polygonPoints}
                    fill={color}
                    fillOpacity={0.25}
                    stroke={color}
                    strokeWidth={2}
                />

                {valueArray.map((v, i) => {
                    const point = getPoint(i, v)
                    return (
                        <circle
                            key={i}
                            cx={point.x}
                            cy={point.y}
                            r={4}
                            fill={color}
                            stroke="white"
                            strokeWidth={1.5}
                        />
                    )
                })}

                {labels}
            </svg>
        </div>
    )
}

export default React.memo(MiniRadarChart)
