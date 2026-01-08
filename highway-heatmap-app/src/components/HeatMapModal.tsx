"use client"

import React from "react"
import { useEffect, useRef, useState, useMemo, useCallback } from "react"
import { FaTimes, FaChevronUp, FaChevronDown, FaTrash } from "react-icons/fa"
import HighwaySegmentChart from "@/components/chart/HighwaySegmentChart"

interface PMISFeature {
  properties: {
    TX_SIGNED_HIGHWAY_RDBD_ID?: string
    COUNTY?: string
    RESPONSIBLE_DISTRICT?: string
    EFF_YEAR?: string | number
    TX_BEG_REF_MARKER_NBR?: string | number
    TX_BEG_REF_MRKR_DISP?: string | number
    TX_END_REF_MRKR_DISP?: string | number
    TX_END_REF_MARKER_NBR?: string | number
    TX_END_REF_MARKER_DISP?: string | number
    TX_CONDITION_SCORE?: number | string
    TX_DISTRESS_SCORE?: number | string
    TX_RIDE_SCORE?: number | string
    TX_AADT_CURRENT?: number | string
    TX_MAINTENANCE_COST_AMT?: number | string
    [key: string]: any
  }
  geometry?: any
}

interface SelectedScore {
  value: string
  label: string
}

// Format county name: remove number prefix and convert from ALL CAPS to Capitalized
const formatCountyName = (county: string | undefined): string => {
  if (!county) return ""
  const withoutPrefix = county.replace(/^\d+\s*-\s*/, "")
  return withoutPrefix.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

interface HeatMapModalProps {
  id: string
  highway: string
  county: string
  selectedScores: SelectedScore[]
  features: PMISFeature[]
  onClose: () => void
  onRemoveScore: (scoreValue: string) => void
}



// Memoized chart component to prevent unnecessary re-renders
const MemoizedHighwaySegmentChart = React.memo(HighwaySegmentChart)

const HeatMapModal: React.FC<HeatMapModalProps> = ({
  id,
  highway,
  county,
  selectedScores,
  features,
  onClose,
  onRemoveScore,
}) => {
  const [visibleScores, setVisibleScores] = useState<string[]>(selectedScores.map((s) => s.value))
  const [collapsedScores, setCollapsedScores] = useState<string[]>([])
  const [loadedCharts, setLoadedCharts] = useState<Set<string>>(new Set())
  const modalRef = useRef<HTMLDivElement>(null)

  // Memoize filtered data to prevent recalculation with deep comparison
  const heatMapData = useMemo(() => {
    if (!features.length) return []
    return features.filter((f) => {
      const highwayMatch = f.properties.TX_SIGNED_HIGHWAY_RDBD_ID === highway

      // Check both COUNTY and RESPONSIBLE_DISTRICT fields
      const countyMatch = f.properties.COUNTY && formatCountyName(f.properties.COUNTY) === county

      // For district matching, we need to clean the district name from the original data
      // since the original data has "01 - PARIS" format but county parameter has "Paris"
      const originalDistrict = f.properties.RESPONSIBLE_DISTRICT
      const cleanedOriginalDistrict = originalDistrict ? formatCountyName(originalDistrict) : null
      const districtMatch = cleanedOriginalDistrict && cleanedOriginalDistrict === county

      return highwayMatch && (countyMatch || districtMatch)
    })
  }, [features, highway, county])

  // Update visible scores when selectedScores changes - optimized
  useEffect(() => {
    const newVisibleScores = selectedScores.map((s) => s.value)
    setVisibleScores(prev => {
      // Only update if actually different
      if (prev.length !== newVisibleScores.length ||
        !prev.every((score, i) => score === newVisibleScores[i])) {
        return newVisibleScores
      }
      return prev
    })

    // Batch load charts
    setLoadedCharts((prev) => {
      const newCharts = new Set(prev)
      let hasChanges = false

      newVisibleScores.forEach((score) => {
        if (!collapsedScores.includes(score) && !newCharts.has(score)) {
          newCharts.add(score)
          hasChanges = true
        }
      })

      return hasChanges ? newCharts : prev
    })
  }, [selectedScores, collapsedScores])

  const toggleCollapse = useCallback((scoreValue: string) => {
    setCollapsedScores((prev) => {
      const isCurrentlyCollapsed = prev.includes(scoreValue)
      const newCollapsed = isCurrentlyCollapsed ? prev.filter((s) => s !== scoreValue) : [...prev, scoreValue]

      // Load chart when expanding (do this in a separate effect)
      if (isCurrentlyCollapsed) {
        // Use setTimeout to avoid state update during render
        setTimeout(() => {
          setLoadedCharts((current) => new Set([...current, scoreValue]))
        }, 0)
      }

      return newCollapsed
    })
  }, [])

  const removeHeatmap = useCallback(
    (scoreValue: string) => {
      setVisibleScores((prev) => prev.filter((s) => s !== scoreValue))
      setLoadedCharts((prev) => {
        const newSet = new Set(prev)
        newSet.delete(scoreValue)
        return newSet
      })
      // Notify parent component to update its state
      onRemoveScore(scoreValue)
    },
    [onRemoveScore],
  )

  // Get active scores (visible and in the original selection)
  const activeScores = useMemo(() => {
    return selectedScores.filter((score) => visibleScores.includes(score.value))
  }, [selectedScores, visibleScores])

  // Lazy load charts - only render when expanded and loaded
  const shouldRenderChart = useCallback(
    (scoreValue: string) => {
      return !collapsedScores.includes(scoreValue) && loadedCharts.has(scoreValue)
    },
    [collapsedScores, loadedCharts],
  )

  return (
    <div ref={modalRef} className="w-full max-h-screen flex flex-col rounded-xl shadow-xl border bg-white">
      <div className="cursor-move select-none flex justify-between overflow-y-auto items-center px-4 py-2 bg-gradient-to-r from-[rgb(20,55,90)] to-[rgb(30,65,100)] text-white shrink-0 rounded-lg">
        <h2 className="font-bold text-sm">
          {highway}, {county} — {activeScores.length} Score Type{activeScores.length !== 1 ? "s" : ""}
        </h2>
        <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full">
          <FaTimes />
        </button>
      </div>
      <div className="flex-grow min-h-0 overflow-y-auto p-4 flex flex-col items-center space-y-6">
        {heatMapData.length > 0 && activeScores.length > 0 ? (
          activeScores.map((score) => (
            <div key={score.value} className="w-full border rounded-lg overflow-hidden transition-all duration-300 flex-none">
              <div className="flex justify-between items-center bg-gray-100 px-3 py-2">
                <h3 className="font-medium text-sm text-gray-700">{score.label}</h3>
                <div className="flex space-x-2">
                  <button
                    onClick={() => toggleCollapse(score.value)}
                    className="p-1.5 text-gray-600 hover:bg-gray-200 rounded-full transition-colors"
                    aria-label={collapsedScores.includes(score.value) ? "Expand" : "Collapse"}
                  >
                    {collapsedScores.includes(score.value) ? <FaChevronDown size={14} /> : <FaChevronUp size={14} />}
                  </button>
                  <button
                    onClick={() => removeHeatmap(score.value)}
                    className="p-1.5 text-gray-600 hover:bg-gray-200 hover:text-red-500 rounded-full transition-colors"
                    aria-label="Remove"
                  >
                    <FaTrash size={14} />
                  </button>
                </div>
              </div>
              <div className={`transition-all duration-300 ${collapsedScores.includes(score.value) ? "max-h-0 p-0" : "max-h-[2000px] p-3"}`}>
                {!collapsedScores.includes(score.value) && (
                  <>
                    {shouldRenderChart(score.value) ? (
                      <div className="w-full flex items-center justify-center bg-gray-50">
                        <MemoizedHighwaySegmentChart
                          key={`${highway}-${county}-${score.value}`}
                          data={heatMapData}
                          selectedHighway={highway}
                          selectedScore={score}
                        />
                      </div>
                    ) : (
                      <div className="w-full flex flex-col items-center justify-center py-8 bg-gray-50">
                        {/* Loading spinner for heatmap - matches global-content-loader style */}
                        <div className="h-6 w-6 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin"></div>
                        <p className="mt-2 text-sm font-medium text-gray-700">Loading heatmap...</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-gray-500">
            {visibleScores.length === 0
              ? "All heatmaps have been removed. Close this modal to select new score types."
              : `No data available for ${highway}, ${county} and selected score type(s).`}
          </p>
        )}
      </div>
    </div>
  )
}

// Memoize the entire component to prevent unnecessary re-renders
export default React.memo(HeatMapModal)
