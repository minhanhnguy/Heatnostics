"use client"

import { useEffect, useState } from "react"
import HighwayHeatmap from "@/components/HighwayHeatmap"
import HeatnosticsPanel from "@/components/HeatnosticsPanel"

interface PMISFeature {
  properties: Record<string, any>
  geometry?: any
}

interface FeatureCollection {
  type: string
  name: string
  features: PMISFeature[]
}

export default function Home() {
  const [data, setData] = useState<PMISFeature[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      try {
        const response = await fetch("/data/ih0610_r_harris.json")
        if (!response.ok) {
          throw new Error(`Failed to load data: ${response.status}`)
        }
        const json: FeatureCollection = await response.json()
        setData(json.features || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center p-8">
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">
          Heatnostics Development
        </h1>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
          <span className="ml-3 text-gray-600">Loading highway data...</span>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center h-64 text-red-500">
          {error}
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="flex gap-6 items-stretch">
          {/* Left: Heatmap in its own box - sized to match chart + padding */}
          <div className="bg-white rounded-xl shadow-lg p-6" style={{ width: '1008px', minHeight: '740px' }}>
            <h2 className="text-lg font-semibold text-gray-800 mb-4 text-center">
              IH0610 R — Harris County
            </h2>
            <HighwayHeatmap data={data} width={960} height={680} />
          </div>

          {/* Right: Heatnostics Charts in separate boxes */}
          <div className="flex flex-col gap-4">
            <HeatnosticsPanel data={data} />
          </div>
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <div className="flex items-center justify-center h-64 text-gray-500">
          No data available
        </div>
      )}
    </main>
  )
}
