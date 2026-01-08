"use client"

import type React from "react"
import { useEffect, useState, useCallback, useRef, useMemo } from "react"
import { useResizeDetector } from "react-resize-detector"
import { routePublic } from "@/config"
import TableModalPMIS from "@/components/TableModalPMIS"
import MapExplorerModal from "@/components/map-arcgis/MapExplorerModal"
import PopupTemplate from '@arcgis/core/PopupTemplate'
import GeoJSONLayer from '@arcgis/core/layers/GeoJSONLayer'

import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer'
import Graphic from '@arcgis/core/Graphic'

import dynamicImport from "next/dynamic"
import Papa from "papaparse"
import { useIsMobile } from "@/hooks/useIsMobile"



const ScoreGauge = dynamicImport(() => import("@/components/chart/ScoreGauge"), { ssr: false })
const CategoryBarChart = dynamicImport(() => import("@/components/chart/CategoryBarChart"), { ssr: false })
const HeatMapModal = dynamicImport(() => import("@/components/HeatMapModal"), { ssr: false })
const DynamicMapComponent = dynamicImport(() => import("@/components/map-arcgis/map"), { ssr: false })
const ChartsView = dynamicImport(() => import("@/components/mobile/ChartsView"), { ssr: false })

// Map field names to score types
const fieldToScoreType = {
  TX_CONDITION_SCORE: "condition",
  TX_DISTRESS_SCORE: "distress",
  TX_RIDE_SCORE: "ride",
  TX_AADT_CURRENT: "aadt",
  TX_MAINTENANCE_COST_AMT: "cost",
}

// Add this interface at the top of the file after the existing interfaces
interface ChartData {
  highway: string
  county: string
  field: string
}

const EXP3: React.FC = () => {
  // ─── Mobile detection ──────────────────────────────────────────
  const isMobile = useIsMobile()

  // ─── State ─────────────────────────────────────────────────────
  const [selectedHighway, setSelectedHighway] = useState<string | null>(null)
  const [mapModalOpen, setMapModalOpen] = useState(false)
  const [selectedYear, setSelectedYear] = useState<number>(2022)
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 })
  const [pmisFeatures, setPmisFeatures] = useState<any[]>([])
  const [selectedCharts, setSelectedCharts] = useState<{ highway: string; county: string; field: string }[]>([])
  const [scoreGauges, setScoreGauges] = useState<{ [k in "condition" | "distress" | "ride" | "aadt" | "cost"]?: number }>({})
  const [mapModalInfo, setMapModalInfo] = useState<{ highway: string; location: string; locationType: 'county' | 'district' } | null>(null)
  const [activeHeatMapData, setActiveHeatMapData] = useState<
    { highway: string; county: string; scores: { value: string; label: string }[]; id: string }[]
  >([])

  // Add search state management with debouncing
  const [tableSearch, setTableSearch] = useState("")
  const [debouncedTableSearch, setDebouncedTableSearch] = useState("")

  // Mobile-specific state
  const [viewType, setViewType] = useState<'county' | 'district'>('county')
  const [processedData, setProcessedData] = useState<any[]>([])
  const [segmentDataByHighwayCounty, setSegmentDataByHighwayCounty] = useState<Map<string, any[]>>(new Map())
  const [availableHighways, setAvailableHighways] = useState<Set<string>>(new Set())
  // Data readiness flags for global loading indicator
  const [isPmisLoaded, setIsPmisLoaded] = useState(false)
  const [isTableLoaded, setIsTableLoaded] = useState(false)
  // Track decompression state for local overlay on PMIS Data panel
  const [isDecompressing, setIsDecompressing] = useState(true)

  // Optimized debounce effect for search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTableSearch(tableSearch), 150)
    return () => clearTimeout(timer)
  }, [tableSearch])

  // Track if all modals were recently closed
  const [recentlyCleared, setRecentlyCleared] = useState(false)

  // Use a ref to generate unique IDs for heatmaps
  const heatmapIdCounter = useRef(0)
  const getNextHeatmapId = () => {
    heatmapIdCounter.current += 1
    return `heatmap-${heatmapIdCounter.current}`
  }

  // Extract all AADT and Cost values for percentile calculations
  const allAADTValues = useMemo(() => {
    if (!pmisFeatures.length) return []
    return pmisFeatures.map((f) => Number(f.properties.TX_AADT_CURRENT)).filter((v) => !isNaN(v) && v > 0)
  }, [pmisFeatures])

  const allCostValues = useMemo(() => {
    if (!pmisFeatures.length) return []
    return pmisFeatures.map((f) => Number(f.properties.TX_MAINTENANCE_COST_AMT)).filter((v) => !isNaN(v) && v > 0)
  }, [pmisFeatures])

  // ─── Resize detector for the table (attach this to the left panel content) ─────
  const {
    ref: tableContainerRef,
    width,
    height,
  } = useResizeDetector({ refreshMode: "debounce", refreshRate: 100 })

  useEffect(() => {
    if (width && height) setContainerDimensions({ width, height })
  }, [width, height])

  // ─── Load PMIS features from trimmed CSV ───────────────────────
  useEffect(() => {
    setIsPmisLoaded(false)
    setIsDecompressing(true)
    Papa.parse(`${routePublic}/files/PMIS_2024_trimmed.csv`, {
      download: true,
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        const features = results.data.map((row: any) => ({ properties: row }))
        setIsDecompressing(false)
        setPmisFeatures(features)
        setIsPmisLoaded(true)
      },
      error: (err: any) => {
        console.error("Failed to load PMIS data:", err)
        setIsDecompressing(false)
        setIsPmisLoaded(true)
      },
    })
  }, [])

  // ─── Reset all data when all heatmaps are closed ───────────────
  useEffect(() => {
    if (activeHeatMapData.length === 0) {
      setScoreGauges({})
      setSelectedCharts([])
      heatmapIdCounter.current = 0
      setRecentlyCleared(true)
    } else {
      setRecentlyCleared(false)
    }
  }, [activeHeatMapData])

  // ─── Update gauges when heatmaps or their scores change ─────────
  useEffect(() => {
    const activeScoreTypes: Record<string, boolean> = {
      condition: false, distress: false, ride: false, aadt: false, cost: false,
    }

    activeHeatMapData.forEach((heatmap) => {
      heatmap.scores.forEach((score) => {
        const scoreType = fieldToScoreType[score.value as keyof typeof fieldToScoreType]
        if (scoreType) activeScoreTypes[scoreType] = true
      })
    })

    setScoreGauges((prev) => {
      const newGauges: typeof prev = {}
      Object.entries(prev).forEach(([type, value]) => {
        if (activeScoreTypes[type]) newGauges[type as keyof typeof prev] = value
      })
      return newGauges
    })
  }, [activeHeatMapData])

  // ─── Chart‐adding callback ─────────────────────────────────────
  const addChart = useCallback(
    (chart: ChartData, scoreValue: number) => {
      if (recentlyCleared) {
        setRecentlyCleared(false)
        setSelectedCharts([chart])
        const scoreType = fieldToScoreType[chart.field as keyof typeof fieldToScoreType]
        if (scoreType) setScoreGauges({ [scoreType]: scoreValue })
      } else {
        setSelectedCharts((prev) =>
          prev.some((c) => c.highway === chart.highway && c.county === chart.county && c.field === chart.field)
            ? prev
            : [...prev, chart],
        )
        const scoreType = fieldToScoreType[chart.field as keyof typeof fieldToScoreType]
        if (scoreType) setScoreGauges((prev) => ({ ...prev, [scoreType]: scoreValue }))
      }
    },
    [recentlyCleared],
  )

  // ─── Add or update heatmap data ────────────────────────────────
  const addOrUpdateHeatMapData = useCallback(
    (chart: ChartData) => {
      let scoreLabel: string
      switch (chart.field) {
        case "TX_AADT_CURRENT": scoreLabel = "AADT"; break
        case "TX_MAINTENANCE_COST_AMT": scoreLabel = "Maintenance Cost"; break
        case "TX_CONDITION_SCORE": scoreLabel = "Condition Score"; break
        case "TX_DISTRESS_SCORE": scoreLabel = "Distress Score"; break
        case "TX_RIDE_SCORE": scoreLabel = "Ride Score"; break
        default:
          scoreLabel = chart.field.replace("TX_", "").split("_").map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(" ")
      }

      const newScore = { value: chart.field, label: scoreLabel }

      if (recentlyCleared) {
        const newHeatmapId = getNextHeatmapId()
        setActiveHeatMapData([{ highway: chart.highway, county: chart.county, scores: [newScore], id: newHeatmapId }])
        return
      }

      const existingIndex = activeHeatMapData.findIndex(
        (item) => item.highway === chart.highway && item.county === chart.county,
      )

      if (existingIndex >= 0) {
        setActiveHeatMapData((prev) => {
          const updated = [...prev]
          const scoreExists = updated[existingIndex].scores.some((s) => s.value === chart.field)
          if (!scoreExists) {
            updated[existingIndex] = { ...updated[existingIndex], scores: [...updated[existingIndex].scores, newScore] }
          }
          return updated
        })
      } else {
        setActiveHeatMapData((prev) => [
          ...prev, { highway: chart.highway, county: chart.county, scores: [newScore], id: getNextHeatmapId() },
        ])
      }
    },
    [activeHeatMapData, recentlyCleared],
  )

  const handleAddChart = useCallback(
    (chart: ChartData, scoreValue: number) => {
      addChart(chart, scoreValue)
      addOrUpdateHeatMapData(chart)
    },
    [addChart, addOrUpdateHeatMapData],
  )

  // ─── Open/Close MapModal ───────────────────────────────────────
  const showMapModal = useCallback((highway: string, location: string, locationType: 'county' | 'district') => {
    setMapModalInfo({ highway, location, locationType });
    setMapModalOpen(true)
  }, [])
  const closeMapModal = useCallback(() => { setMapModalOpen(false); setMapModalInfo(null) }, [])

  // ─── Draggable split state ─────────────────────────────────────
  const [leftPanelWidth, setLeftPanelWidth] = useState(50) // Percentage
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(50)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return
    setIsDragging(true)
    dragStartX.current = e.clientX
    dragStartWidth.current = leftPanelWidth
    e.preventDefault()
  }, [leftPanelWidth])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return
    const containerRect = containerRef.current.getBoundingClientRect()
    const deltaX = e.clientX - dragStartX.current
    const deltaPercent = (deltaX / containerRect.width) * 100
    const newWidth = Math.min(Math.max(dragStartWidth.current + deltaPercent, 20), 80)
    setLeftPanelWidth(newWidth)
  }, [isDragging])

  const handleMouseUp = useCallback(() => setIsDragging(false), [])
  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      return () => {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  // ─── Visualization renderer ────────────────────────────────────
  const renderVisualization = useCallback((type: string, value: number) => {
    const key = `${type}-${value}`
    if (type === "aadt") return <CategoryBarChart key={key} value={value} dataType="aadt" allValues={allAADTValues} />
    if (type === "cost") return <CategoryBarChart key={key} value={value} dataType="cost" allValues={allCostValues} />
    return <ScoreGauge key={key} value={value} scoreType={type as "condition" | "distress" | "ride"} />
  }, [allAADTValues, allCostValues])
  const hasScores = Object.keys(scoreGauges).length > 0;

  // Helper for checking highway availability
  const reformatHighwayName = useCallback((highway: string): string => {
    const lastSpaceIndex = highway.lastIndexOf(" ")
    if (lastSpaceIndex !== -1) {
      return highway.substring(0, lastSpaceIndex) + "-" + highway.substring(lastSpaceIndex + 1) + "G"
    }
    return highway + "G"
  }, [])

  const isHighwayAvailable = useCallback((highway: string): boolean => {
    if (availableHighways.size === 0) return true
    const reformattedHighway = reformatHighwayName(highway)
    return availableHighways.has(reformattedHighway)
  }, [availableHighways, reformatHighwayName])

  // Helper for removing charts
  const handleRemoveChart = useCallback((id: string) => {
    setActiveHeatMapData((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const handleRemoveScore = useCallback((id: string, scoreValue: string) => {
    setActiveHeatMapData((prev) =>
      prev
        .map((item) =>
          item.id === id ? { ...item, scores: item.scores.filter((s) => s.value !== scoreValue) } : item
        )
        .filter((item) => item.scores.length > 0)
    )
  }, [])

  // Mobile-specific wrappers
  const handleMobileMapClick = useCallback((highway: string, county: string) => {
    showMapModal(highway, county, viewType)
  }, [showMapModal, viewType])

  const handleMobileChartClick = useCallback((highway: string, county: string, field: string) => {
    const feature = processedData.find((f) => f.highway === highway && f.county === county)
    const scoreValue = feature?.scores[field]?.value || 0
    handleAddChart({ highway, county, field }, scoreValue)
  }, [processedData, handleAddChart])
  // ─── Table modal element ───────────────────────────────────────
  // Wrap onDataProcessed to flag when table data becomes available
  const handleTableDataProcessed = useCallback((data: any[]) => {
    setProcessedData(data)
    if (Array.isArray(data) && data.length > 0) setIsTableLoaded(true)
  }, [])

  const tableModalComponent = useMemo(() => (
    <TableModalPMIS
      title="PMIS Data"
      containerDimensions={containerDimensions}
      setSelectedHighway={setSelectedHighway}
      addChart={handleAddChart}
      activeHeatMapData={activeHeatMapData}
      showMapModal={showMapModal}
      mapModalOpen={mapModalOpen}
      mapModalInfo={mapModalInfo}
      search={debouncedTableSearch}
      setSearch={setTableSearch}
      features={pmisFeatures}
      viewType={viewType}
      setViewType={setViewType}
      onDataProcessed={handleTableDataProcessed}
      onSegmentDataReady={setSegmentDataByHighwayCounty}
      onAvailableHighwaysReady={setAvailableHighways}
    />
  ), [containerDimensions, handleAddChart, activeHeatMapData, showMapModal, mapModalOpen, mapModalInfo, debouncedTableSearch, pmisFeatures, viewType, handleTableDataProcessed])

  // ─── Layout ────────────────────────────────────────────────────────────
  // Use the same TableModalPMIS for both mobile and desktop - it's now responsive
  if (isMobile) {
    const mobileLoading = !(isPmisLoaded && isTableLoaded)
    return (
      <div className="flex flex-col h-screen overflow-hidden">
        {!mobileLoading && tableModalComponent}

        {/* Map Modal */}
        {mapModalOpen && mapModalInfo && (
          <MapExplorerModal
            open={mapModalOpen}
            onClose={closeMapModal}
            title={`PMIS Explorer — ${mapModalInfo.highway}`}
            preset={'sections'}
            overlayLayers={[
              {
                layer: (() => {
                  const popupTemplate = new PopupTemplate({
                    title: "<span style='color:rgba(17,17,17,1);'>Feature Information</span>",
                    content: `
                      <b>Highway:</b> {TX_SIGNED_HIGHWAY_RDBD_ID}<br>
                      <b>Year:</b> {EFF_YEAR}<br>
                      <b>Beginning TRM Number:</b> {TX_BEG_REF_MARKER_NBR}<br>
                      <b>Beginning TRM Displacement:</b> {TX_BEG_REF_MRKR_DISP}<br>
                      <b>Ending TRM Number:</b> {TX_END_REF_MARKER_NBR}<br>
                      <b>Ending TRM Displacement:</b> {TX_END_REF_MARKER_DISP}<br>
                      <b>AADT Current:</b> {TX_AADT_CURRENT}<br>
                      <b>18KIP ESALS:</b> {TX_CURRENT_18KIP_MEAS}<br>
                      <b>Truck AADT Percentage:</b> {TX_TRUCK_AADT_PCT}<br>
                      <b>Distress Score:</b> {TX_DISTRESS_SCORE}<br>
                      <b>Condition Score:</b> {TX_CONDITION_SCORE}<br>
                      <b>Ride Score:</b> {TX_RIDE_SCORE}<br>
                      <b>Maintenance Section:</b> {MAINT_SECTION}<br>
                      <b>Pavement Type:</b> {BROAD_PAV_TYPE}
                    `,
                  })
                  const lyr = new GeoJSONLayer({
                    id: 'pmis-geojson',
                    url: `${routePublic}/files/results_dfo_highway/pmis_lines_${selectedYear}.geojson`,
                    title: 'PMIS Data',
                    popupTemplate,
                    outFields: ['*'],
                    renderer: {
                      type: 'unique-value',
                      valueExpression: `
                        var s = $feature.TX_CONDITION_SCORE;
                        if (s < 1) return 'Invalid';
                        if (s >= 90) return 'Very Good';
                        if (s >= 70) return 'Good';
                        if (s >= 50) return 'Fair';
                        if (s >= 35) return 'Poor';
                        return 'Very Poor';
                      `,
                      valueExpressionTitle: 'Condition Category',
                      uniqueValueInfos: [
                        { value: 'Invalid', label: 'Invalid', symbol: { type: 'simple-line', color: 'rgba(200,200,200,0.6)', width: 2 } },
                        { value: 'Very Poor', label: 'Very Poor', symbol: { type: 'simple-line', color: 'rgba(239, 68, 68, 0.9)', width: 2 } },
                        { value: 'Poor', label: 'Poor', symbol: { type: 'simple-line', color: 'rgba(249, 115, 22, 0.9)', width: 2 } },
                        { value: 'Fair', label: 'Fair', symbol: { type: 'simple-line', color: 'rgba(234, 179, 8, 0.9)', width: 2 } },
                        { value: 'Good', label: 'Good', symbol: { type: 'simple-line', color: 'rgba(34, 197, 94, 0.9)', width: 2 } },
                        { value: 'Very Good', label: 'Very Good', symbol: { type: 'simple-line', color: 'rgba(21, 128, 61, 0.9)', width: 2 } },
                      ],
                    } as any,
                  })
                  return lyr
                })(),
                name: 'PMIS Data',
                visible: true,
                popupEnabled: true,
                legendColor: '#6b7280',
                legendShape: 'line' as const,
              },
            ]}
            yearDropdown={{
              selectedYear,
              years: (() => { const ys: number[] = []; for (let y = 1996; y <= 2022; y++) ys.push(y); return ys.reverse(); })(),
              onYearChange: setSelectedYear,
            }}
            showLegend={true}
            popupEnabled={true}
            onMapLoaded={(_map, view) => {
              const zoomToQuery = async () => {
                try {
                  const layer = view.map.findLayerById('pmis-geojson') as any;
                  if (!layer) return;

                  const rawHwy = String(mapModalInfo?.highway || '').toUpperCase().trim();
                  const getFormats = (h: string) => {
                    const formats = new Set<string>([h]);
                    if (h.includes('-')) { formats.add(h.replace('-', ' ')); formats.add(h.split('-')[0]); }
                    if (h.includes(' ')) { formats.add(h.replace(' ', '-')); formats.add(h.split(' ')[0]); }
                    if (h.startsWith('IH')) formats.add(h.replace('IH', 'I'));
                    if (h.startsWith('I')) formats.add(h.replace('IH', 'IH'));
                    if (h.startsWith('BU') && h.length > 6) formats.add(h.slice(0, 6));
                    return Array.from(formats);
                  };
                  const highwayFormats = getFormats(rawHwy);
                  const baseDigits = rawHwy.replace(/\D+/g, '');

                  const fieldName = mapModalInfo?.locationType === 'district' ? 'RESPONSIBLE_DISTRICT' : 'COUNTY';
                  const rawLoc = String(mapModalInfo?.location || '');
                  const normLoc = rawLoc.replace(/^\s*\d+\s*[-–—]\s*/, '').toUpperCase().trim();

                  const whereHighway = '(' + highwayFormats.map(f => `TX_SIGNED_HIGHWAY_RDBD_ID = '${f}'`).join(' OR ') + ')';
                  const whereLoc = normLoc ? `UPPER(${fieldName}) LIKE '%${normLoc}%'` : '';
                  let where = [whereHighway, whereLoc].filter(Boolean).join(' AND ');

                  const q = layer.createQuery();
                  q.where = where || '1=1';
                  q.returnGeometry = true;
                  const { extent } = await layer.queryExtent(q);
                  if (extent) {
                    view.padding = { top: 20, right: 20, bottom: 20, left: 20 } as any;
                    await view.goTo(extent);
                    return;
                  }

                  if (baseDigits) {
                    const likeHighway = `TX_SIGNED_HIGHWAY_RDBD_ID LIKE '%${baseDigits}%'`;
                    where = [likeHighway, whereLoc].filter(Boolean).join(' AND ');
                    q.where = where;
                    const { extent: extent2 } = await layer.queryExtent(q);
                    if (extent2) {
                      view.padding = { top: 20, right: 20, bottom: 20, left: 20 } as any;
                      await view.goTo(extent2);
                      return;
                    }
                  }

                  q.where = '(' + highwayFormats.map(f => `TX_SIGNED_HIGHWAY_RDBD_ID = '${f}'`).join(' OR ') + ')';
                  const { extent: extent3 } = await layer.queryExtent(q);
                  if (extent3) {
                    view.padding = { top: 20, right: 20, bottom: 20, left: 20 } as any;
                    await view.goTo(extent3);
                  }
                } catch { }
              };
              zoomToQuery();
            }}
            highlightByExtent={{
              targetLayerId: 'pmis-geojson',
              where: (() => {
                const rawHwy = String(mapModalInfo?.highway || '').toUpperCase().trim();
                const formats = new Set<string>([rawHwy]);

                // Parse highway components
                let prefix = '';
                let number = '';
                let suffix = '';
                let i = 0;

                // Extract prefix (letters)
                while (i < rawHwy.length && !/\d/.test(rawHwy[i]) && rawHwy[i] !== ' ' && rawHwy[i] !== '-') {
                  prefix += rawHwy[i++];
                }
                // Skip separators
                while (i < rawHwy.length && (rawHwy[i] === ' ' || rawHwy[i] === '-')) i++;
                // Extract number
                while (i < rawHwy.length && /\d/.test(rawHwy[i])) {
                  number += rawHwy[i++];
                }
                // Skip separators
                while (i < rawHwy.length && (rawHwy[i] === ' ' || rawHwy[i] === '-')) i++;
                // Extract suffix
                suffix = rawHwy.substring(i).trim();

                // Generate prefix variations
                const prefixes = [prefix];
                if (prefix === 'IH') prefixes.push('I');
                else if (prefix === 'I') prefixes.push('IH');

                // Generate suffix variations with direction mappings
                const suffixes = [''];
                if (suffix) {
                  suffixes.push(suffix);
                  const dirMap: Record<string, string[]> = {
                    'L': ['LG', 'LN', 'LOOP'],
                    'E': ['EA', 'EB', 'EAST'],
                    'W': ['WA', 'WB', 'WEST'],
                    'N': ['NA', 'NB', 'NORTH'],
                    'S': ['SA', 'SB', 'SOUTH'],
                    'R': ['RG', 'RT', 'RA'],
                    'X': ['XG', 'XA', 'XB'],
                  };
                  if (suffix.length === 1 && suffix in dirMap) {
                    dirMap[suffix].forEach(s => suffixes.push(s));
                  }
                }

                // Generate all combinations
                for (const p of prefixes) {
                  for (const s of suffixes) {
                    if (s) {
                      formats.add(`${p}${number}-${s}`);
                      formats.add(`${p}${number} ${s}`);
                      formats.add(`${p}${number}${s}`);
                    } else {
                      formats.add(`${p}${number}`);
                    }
                  }
                }

                const whereHighway = '(' + Array.from(formats).map(f => `TX_SIGNED_HIGHWAY_RDBD_ID = '${f}'`).join(' OR ') + ')';
                const fieldName = mapModalInfo?.locationType === 'district' ? 'RESPONSIBLE_DISTRICT' : 'COUNTY';
                const rawLoc = String(mapModalInfo?.location || '');
                const normLoc = rawLoc.replace(/^\s*\d+\s*[-–—]\s*/, '').toUpperCase().trim();
                const whereLoc = normLoc ? `UPPER(${fieldName}) LIKE '%${normLoc}%'` : '';
                return [whereHighway, whereLoc].filter(Boolean).join(' AND ');
              })(),
              widths: { outline: 6, glow: 4, main: 5 },
            }}
          />
        )}
      </div>
    )
  }

  // Desktop layout
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* When hasScores === true, add md:grid-cols-2 so it becomes 2 cols on >=768px.
        On small screens it stays 1 col (grid-cols-1) either way. */}
      <div
        ref={containerRef}
        className={`grid grid-cols-1 ${hasScores ? 'md:grid-cols-2' : ''} gap-4 flex-grow p-4 bg-gray-100 overflow-hidden`}
      >
        {/* <div ref={containerRef}  className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-grow p-4 bg-gray-100"> */}
        <div className="relative h-full overflow-hidden rounded-lg shadow-md border border-gray-200 bg-white">
          {/* Decompression overlay - covers only PMIS Data panel */}
          {isDecompressing && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-white">
              <div className="flex flex-col items-center justify-center">
                <div className="h-6 w-6 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin"></div>
                <p className="mt-2 text-sm font-medium text-gray-700">Loading data...</p>
              </div>
            </div>
          )}
          {tableModalComponent}
        </div>
        {hasScores && (
          <div className="relative flex flex-col min-h-0 overflow-hidden rounded-lg shadow-md border border-gray-200 bg-white">
            <div className="flex flex-col flex-shrink-0">
              <div className="px-5 py-3 bg-gradient-to-r from-[rgb(20,55,90)] to-[rgb(30,65,100)] text-white font-bold flex justify-between items-center">
                <span>PMIS Heat Maps</span>
                <button
                  onClick={() => setActiveHeatMapData([])}
                  className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-sm transition-colors"
                  title="Close all heatmaps"
                >
                  Close All
                </button>
              </div>

              {/* Gauges */}
              <div className="p-2 bg-gray-50 overflow-x-auto">
                <div className="flex gap-6 min-w-min">
                  {Object.keys(scoreGauges).length > 0 && (
                    <div className="py-1 px-3 bg-gray-50 shadow-sm mb-4">
                      <div className="pb-2">
                        <div className="flex flex-row gap-6 min-w-min">
                          {Object.entries(scoreGauges).map(([type, value]) => (
                            <div
                              key={`viz-${type}`}
                              className="w-[220px] h-[120px] flex-shrink-0 flex flex-col justify-end"
                            >
                              {renderVisualization(type, value || 0)}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Scrollable modals */}
            <div className="flex-grow min-h-0 overflow-y-auto px-4 pb-4">
              {activeHeatMapData.map((data) => (
                <div key={data.id} className="mb-4">
                  <HeatMapModal
                    id={data.id}
                    highway={data.highway}
                    county={data.county}
                    selectedScores={data.scores}
                    features={pmisFeatures}
                    onClose={() =>
                      setActiveHeatMapData((prev) =>
                        prev.filter((item) => item.id !== data.id),
                      )
                    }
                    onRemoveScore={(scoreValue) => {
                      setActiveHeatMapData((prev) =>
                        prev
                          .map((item) =>
                            item.id === data.id
                              ? {
                                ...item,
                                scores: item.scores.filter(
                                  (s) => s.value !== scoreValue,
                                ),
                              }
                              : item,
                          )
                          .filter((item) => item.scores.length > 0),
                      )
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
      {/* Map Modal */}
      {mapModalOpen && mapModalInfo && (
        <MapExplorerModal
          open={mapModalOpen}
          onClose={closeMapModal}
          title={`PMIS Explorer — ${mapModalInfo.highway}`}
          preset={'sections'}
          overlayLayers={[
            {
              layer: (() => {
                const popupTemplate = new PopupTemplate({
                  title: "<span style='color:rgba(17,17,17,1);'>Feature Information</span>",
                  content: `
                    <b>Highway:</b> {TX_SIGNED_HIGHWAY_RDBD_ID}<br>
                    <b>Year:</b> {EFF_YEAR}<br>
                    <b>Beginning TRM Number:</b> {TX_BEG_REF_MARKER_NBR}<br>
                    <b>Beginning TRM Displacement:</b> {TX_BEG_REF_MRKR_DISP}<br>
                    <b>Ending TRM Number:</b> {TX_END_REF_MARKER_NBR}<br>
                    <b>Ending TRM Displacement:</b> {TX_END_REF_MARKER_DISP}<br>
                    <b>AADT Current:</b> {TX_AADT_CURRENT}<br>
                    <b>18KIP ESALS:</b> {TX_CURRENT_18KIP_MEAS}<br>
                    <b>Truck AADT Percentage:</b> {TX_TRUCK_AADT_PCT}<br>
                    <b>Distress Score:</b> {TX_DISTRESS_SCORE}<br>
                    <b>Condition Score:</b> {TX_CONDITION_SCORE}<br>
                    <b>Ride Score:</b> {TX_RIDE_SCORE}<br>
                    <b>Maintenance Section:</b> {MAINT_SECTION}<br>
                    <b>Pavement Type:</b> {BROAD_PAV_TYPE}
                  `,
                })
                const lyr = new GeoJSONLayer({
                  id: 'pmis-geojson',
                  url: `${routePublic}/files/results_dfo_highway/pmis_lines_${selectedYear}.geojson`,
                  title: 'PMIS Data',
                  popupTemplate,
                  outFields: ['*'],
                  renderer: {
                    type: 'unique-value',
                    valueExpression: `
                      var s = $feature.TX_CONDITION_SCORE;
                      if (s < 1) return 'Invalid';
                      if (s >= 90) return 'Very Good';
                      if (s >= 70) return 'Good';
                      if (s >= 50) return 'Fair';
                      if (s >= 35) return 'Poor';
                      return 'Very Poor';
                    `,
                    valueExpressionTitle: 'Condition Category',
                    uniqueValueInfos: [
                      { value: 'Invalid', label: 'Invalid', symbol: { type: 'simple-line', color: 'rgba(200,200,200,0.6)', width: 2 } },
                      { value: 'Very Poor', label: 'Very Poor', symbol: { type: 'simple-line', color: 'rgba(239, 68, 68, 0.9)', width: 2 } },
                      { value: 'Poor', label: 'Poor', symbol: { type: 'simple-line', color: 'rgba(249, 115, 22, 0.9)', width: 2 } },
                      { value: 'Fair', label: 'Fair', symbol: { type: 'simple-line', color: 'rgba(234, 179, 8, 0.9)', width: 2 } },
                      { value: 'Good', label: 'Good', symbol: { type: 'simple-line', color: 'rgba(34, 197, 94, 0.9)', width: 2 } },
                      { value: 'Very Good', label: 'Very Good', symbol: { type: 'simple-line', color: 'rgba(21, 128, 61, 0.9)', width: 2 } },
                    ],
                  } as any,
                })
                return lyr
              })(),
              name: 'PMIS Data',
              visible: true,
              popupEnabled: true,
              legendColor: '#6b7280',
              legendShape: 'line' as const,
            },
          ]}
          yearDropdown={{
            selectedYear,
            years: (() => { const ys: number[] = []; for (let y = 1996; y <= 2022; y++) ys.push(y); return ys.reverse(); })(),
            onYearChange: setSelectedYear,
          }}
          showLegend={true}
          popupEnabled={true}
          onMapLoaded={(_map, view) => {
            const zoomToQuery = async () => {
              try {
                const layer = view.map.findLayerById('pmis-geojson') as any;
                if (!layer) return;

                // Normalize highway input and try multiple formats
                const rawHwy = String(mapModalInfo?.highway || '').toUpperCase().trim();
                const getFormats = (h: string) => {
                  const formats = new Set<string>([h]);
                  if (h.includes('-')) { formats.add(h.replace('-', ' ')); formats.add(h.split('-')[0]); }
                  if (h.includes(' ')) { formats.add(h.replace(' ', '-')); formats.add(h.split(' ')[0]); }
                  if (h.startsWith('IH')) formats.add(h.replace('IH', 'I'));
                  if (h.startsWith('I') && !h.startsWith('IH')) formats.add('IH' + h);
                  if (h.startsWith('BU') && h.length > 6) formats.add(h.slice(0, 6));
                  return Array.from(formats);
                };
                const highwayFormats = getFormats(rawHwy);
                const baseDigits = rawHwy.replace(/\D+/g, '');

                // Determine location field and normalize value
                const fieldName = mapModalInfo?.locationType === 'district' ? 'RESPONSIBLE_DISTRICT' : 'COUNTY';
                const rawLoc = String(mapModalInfo?.location || '');
                // Remove any leading number + dash and uppercase
                const normLoc = rawLoc.replace(/^\s*\d+\s*[-–—]\s*/, '').toUpperCase().trim();

                // Build primary where clause
                const whereHighway = '(' + highwayFormats.map(f => `TX_SIGNED_HIGHWAY_RDBD_ID = '${f}'`).join(' OR ') + ')';
                const whereLoc = normLoc ? `UPPER(${fieldName}) LIKE '%${normLoc}%'` : '';
                let where = [whereHighway, whereLoc].filter(Boolean).join(' AND ');

                const q = layer.createQuery();
                q.where = where || '1=1';
                q.returnGeometry = true;
                const { extent } = await layer.queryExtent(q);
                if (extent) {
                  view.padding = { top: 20, right: 20, bottom: 20, left: 20 } as any;
                  await view.goTo(extent);
                  return;
                }

                // Fallback 1: LIKE on highway by numeric part + location
                if (baseDigits) {
                  const likeHighway = `TX_SIGNED_HIGHWAY_RDBD_ID LIKE '%${baseDigits}%'`;
                  where = [likeHighway, whereLoc].filter(Boolean).join(' AND ');
                  q.where = where;
                  const { extent: extent2 } = await layer.queryExtent(q);
                  if (extent2) {
                    view.padding = { top: 20, right: 20, bottom: 20, left: 20 } as any;
                    await view.goTo(extent2);
                    return;
                  }
                }

                // Fallback 2: Highway only
                q.where = '(' + highwayFormats.map(f => `TX_SIGNED_HIGHWAY_RDBD_ID = '${f}'`).join(' OR ') + ')';
                const { extent: extent3 } = await layer.queryExtent(q);
                if (extent3) {
                  view.padding = { top: 20, right: 20, bottom: 20, left: 20 } as any;
                  await view.goTo(extent3);
                }
              } catch { }
            };
            zoomToQuery();
          }}
          highlightByExtent={{
            targetLayerId: 'pmis-geojson',
            where: (() => {
              const rawHwy = String(mapModalInfo?.highway || '').toUpperCase().trim();
              const formats = new Set<string>([rawHwy]);

              // Parse highway components
              let prefix = '';
              let number = '';
              let suffix = '';
              let i = 0;

              // Extract prefix (letters)
              while (i < rawHwy.length && !/\d/.test(rawHwy[i]) && rawHwy[i] !== ' ' && rawHwy[i] !== '-') {
                prefix += rawHwy[i++];
              }
              // Skip separators
              while (i < rawHwy.length && (rawHwy[i] === ' ' || rawHwy[i] === '-')) i++;
              // Extract number
              while (i < rawHwy.length && /\d/.test(rawHwy[i])) {
                number += rawHwy[i++];
              }
              // Skip separators
              while (i < rawHwy.length && (rawHwy[i] === ' ' || rawHwy[i] === '-')) i++;
              // Extract suffix
              suffix = rawHwy.substring(i).trim();

              // Generate prefix variations
              const prefixes = [prefix];
              if (prefix === 'IH') prefixes.push('I');
              else if (prefix === 'I') prefixes.push('IH');

              // Generate suffix variations with direction mappings
              const suffixes = [''];
              if (suffix) {
                suffixes.push(suffix);
                const dirMap: Record<string, string[]> = {
                  'L': ['LG', 'LN', 'LOOP'],
                  'E': ['EA', 'EB', 'EAST'],
                  'W': ['WA', 'WB', 'WEST'],
                  'N': ['NA', 'NB', 'NORTH'],
                  'S': ['SA', 'SB', 'SOUTH'],
                  'R': ['RG', 'RT', 'RA'],
                  'X': ['XG', 'XA', 'XB'],
                };
                if (suffix.length === 1 && suffix in dirMap) {
                  dirMap[suffix].forEach(s => suffixes.push(s));
                }
              }

              // Generate all combinations
              for (const p of prefixes) {
                for (const s of suffixes) {
                  if (s) {
                    formats.add(`${p}${number}-${s}`);
                    formats.add(`${p}${number} ${s}`);
                    formats.add(`${p}${number}${s}`);
                  } else {
                    formats.add(`${p}${number}`);
                  }
                }
              }

              const whereHighway = '(' + Array.from(formats).map(f => `TX_SIGNED_HIGHWAY_RDBD_ID = '${f}'`).join(' OR ') + ')';
              const fieldName = mapModalInfo?.locationType === 'district' ? 'RESPONSIBLE_DISTRICT' : 'COUNTY';
              const rawLoc = String(mapModalInfo?.location || '');
              const normLoc = rawLoc.replace(/^\s*\d+\s*[-–—]\s*/, '').toUpperCase().trim();
              const whereLoc = normLoc ? `UPPER(${fieldName}) LIKE '%${normLoc}%'` : '';
              return [whereHighway, whereLoc].filter(Boolean).join(' AND ');
            })(),
            widths: { outline: 6, glow: 4, main: 5 },
          }}
        />
      )}
    </div>
  );
}

export default EXP3
