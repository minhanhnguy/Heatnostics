"use client"

import React, { useMemo } from "react"
import { RadarChartExpanded } from "@/components/chart/MiniRadarChart"
import {
    extractDamagePoints,
    normalizePoints,
    computeScagnostics,
    SCAGNOSTICS_LABELS,
    type ScagnosticsResult
} from "@/lib/geometricUtils"

interface PMISFeature {
    properties: {
        TX_SIGNED_HIGHWAY_RDBD_ID?: string
        COUNTY?: string
        EFF_YEAR?: string | number
        TX_CONDITION_SCORE?: number | string
        [key: string]: any
    }
}

interface ScagnosticsChartProps {
    data: PMISFeature[]
    highway: string
    county: string
    maxScore?: number
}

const ScagnosticsChart: React.FC<ScagnosticsChartProps> = ({
    data,
    highway,
    county,
    maxScore = 49
}) => {
    // Compute scagnostics from the data
    const scagnostics = useMemo(() => {
        const damagePoints = extractDamagePoints(data, maxScore)
        if (damagePoints.length < 5) return null
        const normalizedPoints = normalizePoints(damagePoints)
        return computeScagnostics(normalizedPoints)
    }, [data, maxScore])

    if (!scagnostics) {
        return (
            <div className="w-full flex flex-col items-center justify-center py-12 bg-gray-50">
                <p className="text-gray-500">Insufficient damage points (&lt; 5)</p>
                <p className="text-sm text-gray-400 mt-2">
                    Scagnostics requires at least 5 damage points to compute meaningful metrics.
                </p>
            </div>
        )
    }

    return (
        <div className="w-full p-6 bg-white">
            <div className="flex flex-col lg:flex-row items-center lg:items-start gap-8">
                {/* Radar Chart */}
                <div className="flex-shrink-0">
                    <RadarChartExpanded
                        values={scagnostics}
                        size={280}
                        color="#3B82F6"
                        title={`${highway} - ${county}`}
                    />
                </div>

                {/* Metrics Table */}
                <div className="flex-grow w-full lg:w-auto">
                    <h3 className="text-lg font-semibold text-gray-800 mb-4">Scagnostics Metrics</h3>
                    <div className="grid grid-cols-1 gap-2">
                        {SCAGNOSTICS_LABELS.map(({ key, label }) => {
                            const value = scagnostics[key]
                            const percentage = Math.round(value * 100)
                            const bgColor = value < 0.3 ? 'bg-green-100' : value < 0.7 ? 'bg-yellow-100' : 'bg-red-100'
                            const textColor = value < 0.3 ? 'text-green-700' : value < 0.7 ? 'text-yellow-700' : 'text-red-700'

                            return (
                                <div
                                    key={key}
                                    className={`flex items-center justify-between px-4 py-2 rounded-lg ${bgColor}`}
                                >
                                    <span className="font-medium text-gray-700">{label}</span>
                                    <div className="flex items-center gap-3">
                                        {/* Progress bar */}
                                        <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${value < 0.3 ? 'bg-green-500' : value < 0.7 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                style={{ width: `${percentage}%` }}
                                            />
                                        </div>
                                        <span className={`font-semibold ${textColor} w-12 text-right`}>
                                            {percentage}%
                                        </span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default React.memo(ScagnosticsChart)
