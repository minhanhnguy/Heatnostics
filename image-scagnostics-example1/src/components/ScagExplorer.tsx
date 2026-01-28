"use client"

import { useEffect, useRef, useState, useMemo } from "react"

interface HighwayData {
    highway: string
    location: string
    pointCount: number
    binaryGrid: number[][]
    scagnostics: {
        stringy: number
        sparse: number
        convex: number
        skinny: number
        clumpy: number
        outlying: number
        skewed: number
        striated: number
        monotonic: number
    }
}

interface LeaderCluster {
    leader: HighwayData
    members: HighwayData[]
    x: number
    y: number
    vx: number
    vy: number
}

interface ScagExplorerProps {
    highways: HighwayData[]
    selectedMetrics?: (keyof HighwayData['scagnostics'])[]
    threshold?: number
}

// LEADER clustering algorithm
function leaderClustering(
    highways: HighwayData[],
    metrics: (keyof HighwayData['scagnostics'])[],
    threshold: number
): LeaderCluster[] {
    const clusters: LeaderCluster[] = []

    // Euclidean distance in metric space
    const distance = (a: HighwayData, b: HighwayData): number => {
        let sum = 0
        for (const m of metrics) {
            const diff = a.scagnostics[m] - b.scagnostics[m]
            sum += diff * diff
        }
        return Math.sqrt(sum)
    }

    for (const highway of highways) {
        // Find closest leader
        let closestCluster: LeaderCluster | null = null
        let minDist = Infinity

        for (const cluster of clusters) {
            const d = distance(highway, cluster.leader)
            if (d < minDist) {
                minDist = d
                closestCluster = cluster
            }
        }

        // If close enough to a leader, add to that cluster
        if (closestCluster && minDist < threshold) {
            closestCluster.members.push(highway)
        } else {
            // Create new cluster with this as leader
            clusters.push({
                leader: highway,
                members: [highway],
                x: Math.random() * 600 + 100,
                y: Math.random() * 400 + 100,
                vx: 0,
                vy: 0,
            })
        }
    }

    return clusters
}

// Force-directed layout step with collision prevention
function forceLayoutStep(
    clusters: LeaderCluster[],
    width: number,
    height: number,
    metrics: (keyof HighwayData['scagnostics'])[]
): void {
    const repulsionStrength = 15000  // Increased for stronger repulsion
    const attractionStrength = 0.005  // Reduced to prevent overcrowding
    const damping = 0.7
    const centerForce = 0.008
    const collisionPadding = 15  // Extra padding between nodes

    // Distance in metric space
    const metricDistance = (a: HighwayData, b: HighwayData): number => {
        let sum = 0
        for (const m of metrics) {
            const diff = a.scagnostics[m] - b.scagnostics[m]
            sum += diff * diff
        }
        return Math.sqrt(sum)
    }

    // Get node size
    const getSize = (c: LeaderCluster) => Math.sqrt(c.members.length) * 20 + 30

    // Calculate forces for each cluster
    for (let i = 0; i < clusters.length; i++) {
        const c1 = clusters[i]
        let fx = 0
        let fy = 0
        const size1 = getSize(c1)

        // Repulsion from other clusters - always apply, stronger when close
        for (let j = 0; j < clusters.length; j++) {
            if (i === j) continue
            const c2 = clusters[j]
            const size2 = getSize(c2)

            const dx = c1.x - c2.x
            const dy = c1.y - c2.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.1
            const minDist = (size1 + size2) / 2 + collisionPadding

            // Strong repulsion when overlapping or close
            if (dist < minDist * 3) {
                // Stronger force when closer to collision
                const overlap = minDist / dist
                const force = repulsionStrength * overlap * overlap / (dist + 1)
                fx += (dx / dist) * force
                fy += (dy / dist) * force
            }
        }

        // Weak attraction based on metric similarity (only for distant similar clusters)
        for (let j = 0; j < clusters.length; j++) {
            if (i === j) continue
            const c2 = clusters[j]

            const metricDist = metricDistance(c1.leader, c2.leader)
            const dx = c2.x - c1.x
            const dy = c2.y - c1.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const size2 = getSize(c2)
            const minDist = (size1 + size2) / 2 + collisionPadding

            // Only attract if not too close and similar
            if (dist > minDist * 2 && metricDist < 0.3) {
                const attraction = attractionStrength * (1 - metricDist * 2)
                if (attraction > 0) {
                    fx += dx * attraction
                    fy += dy * attraction
                }
            }
        }

        // Center attraction
        const cx = width / 2
        const cy = height / 2
        fx += (cx - c1.x) * centerForce
        fy += (cy - c1.y) * centerForce

        // Apply forces with damping
        c1.vx = (c1.vx + fx) * damping
        c1.vy = (c1.vy + fy) * damping

        // Clamp velocity to prevent wild movements
        const maxVel = 20
        const vel = Math.sqrt(c1.vx * c1.vx + c1.vy * c1.vy)
        if (vel > maxVel) {
            c1.vx = (c1.vx / vel) * maxVel
            c1.vy = (c1.vy / vel) * maxVel
        }
    }

    // Update positions
    for (const c of clusters) {
        const size = getSize(c)
        c.x = Math.max(size, Math.min(width - size, c.x + c.vx))
        c.y = Math.max(size, Math.min(height - size, c.y + c.vy))
    }

    // Collision resolution pass - push overlapping nodes apart
    for (let iteration = 0; iteration < 3; iteration++) {
        for (let i = 0; i < clusters.length; i++) {
            for (let j = i + 1; j < clusters.length; j++) {
                const c1 = clusters[i]
                const c2 = clusters[j]
                const size1 = getSize(c1)
                const size2 = getSize(c2)

                const dx = c2.x - c1.x
                const dy = c2.y - c1.y
                const dist = Math.sqrt(dx * dx + dy * dy) || 0.1
                const minDist = (size1 + size2) / 2 + collisionPadding

                if (dist < minDist) {
                    // Push apart
                    const overlap = (minDist - dist) / 2
                    const nx = dx / dist
                    const ny = dy / dist

                    c1.x -= nx * overlap
                    c1.y -= ny * overlap
                    c2.x += nx * overlap
                    c2.y += ny * overlap

                    // Keep in bounds
                    c1.x = Math.max(size1, Math.min(width - size1, c1.x))
                    c1.y = Math.max(size1, Math.min(height - size1, c1.y))
                    c2.x = Math.max(size2, Math.min(width - size2, c2.x))
                    c2.y = Math.max(size2, Math.min(height - size2, c2.y))
                }
            }
        }
    }
}

// Render a small binary grid
function MiniGrid({ grid, size }: { grid: number[][], size: number }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || !grid.length) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        const gridSize = grid.length
        const scale = size / gridSize

        ctx.fillStyle = '#f3f4f6'
        ctx.fillRect(0, 0, size, size)

        ctx.fillStyle = '#1f2937'
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                if (grid[y][x] === 1) {
                    ctx.fillRect(x * scale, y * scale, Math.ceil(scale), Math.ceil(scale))
                }
            }
        }
    }, [grid, size])

    return <canvas ref={canvasRef} width={size} height={size} className="rounded" />
}

export default function ScagExplorer({ highways, selectedMetrics, threshold = 0.3 }: ScagExplorerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
    const [hoveredCluster, setHoveredCluster] = useState<number | null>(null)
    const [selectedCluster, setSelectedCluster] = useState<number | null>(null)

    const metrics = selectedMetrics || ['sparse', 'convex', 'skinny', 'stringy']

    // Initial clustering
    const initialClusters = useMemo(() => {
        return leaderClustering(highways, metrics, threshold)
    }, [highways, metrics, threshold])

    const [clusters, setClusters] = useState<LeaderCluster[]>([])

    // Initialize clusters
    useEffect(() => {
        const positioned = initialClusters.map((c, i) => ({
            ...c,
            x: dimensions.width / 2 + Math.cos(i * 2 * Math.PI / initialClusters.length) * 200,
            y: dimensions.height / 2 + Math.sin(i * 2 * Math.PI / initialClusters.length) * 150,
            vx: 0,
            vy: 0,
        }))
        setClusters(positioned)
    }, [initialClusters, dimensions])

    // Force layout animation
    useEffect(() => {
        if (clusters.length === 0) return

        let animationFrame: number
        let iterations = 0
        const maxIterations = 300

        const animate = () => {
            if (iterations >= maxIterations) return

            setClusters(prev => {
                const next = prev.map(c => ({ ...c }))
                forceLayoutStep(next, dimensions.width, dimensions.height, metrics)
                return next
            })

            iterations++
            animationFrame = requestAnimationFrame(animate)
        }

        animationFrame = requestAnimationFrame(animate)

        return () => cancelAnimationFrame(animationFrame)
    }, [clusters.length, dimensions, metrics])

    // Resize observer
    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const observer = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect
            setDimensions({ width, height })
        })

        observer.observe(container)
        return () => observer.disconnect()
    }, [])

    return (
        <div ref={containerRef} className="w-full h-full relative bg-gradient-to-br from-slate-50 to-slate-100 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="absolute top-2 left-2 z-10 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-sm">
                <div className="text-xs font-semibold text-gray-700">LEADER Clustering</div>
                <div className="text-xs text-gray-500">
                    {clusters.length} clusters from {highways.length} highways
                </div>
                <div className="text-xs text-gray-400 mt-1">
                    Metrics: {metrics.join(', ')}
                </div>
            </div>

            {/* Legend */}
            <div className="absolute top-2 right-2 z-10 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 shadow-sm">
                <div className="text-xs font-semibold text-gray-700 mb-1">Size = Cluster Members</div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                    <div className="w-3 h-3 bg-gray-800 rounded" /> 1
                    <div className="w-4 h-4 bg-gray-800 rounded" /> ~5
                    <div className="w-6 h-6 bg-gray-800 rounded" /> ~20
                </div>
            </div>

            {/* Clusters */}
            <svg className="w-full h-full" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}>
                {/* Connection lines for similar clusters */}
                {clusters.map((c1, i) =>
                    clusters.slice(i + 1).map((c2, j) => {
                        let metricDist = 0
                        for (const m of metrics) {
                            const diff = c1.leader.scagnostics[m] - c2.leader.scagnostics[m]
                            metricDist += diff * diff
                        }
                        metricDist = Math.sqrt(metricDist)

                        if (metricDist < threshold * 1.5) {
                            const opacity = Math.max(0, 1 - metricDist / (threshold * 1.5))
                            return (
                                <line
                                    key={`edge-${i}-${i + j + 1}`}
                                    x1={c1.x}
                                    y1={c1.y}
                                    x2={c2.x}
                                    y2={c2.y}
                                    stroke={`rgba(99, 102, 241, ${opacity * 0.3})`}
                                    strokeWidth={opacity * 2}
                                />
                            )
                        }
                        return null
                    })
                )}
            </svg>

            {/* Cluster Nodes (using HTML for rasterized images) */}
            {clusters.map((cluster, i) => {
                const size = Math.sqrt(cluster.members.length) * 20 + 30
                const isHovered = hoveredCluster === i
                const isSelected = selectedCluster === i

                return (
                    <div
                        key={i}
                        className={`absolute transition-transform duration-75 cursor-pointer ${isHovered || isSelected ? 'z-20' : 'z-10'}`}
                        style={{
                            left: cluster.x - size / 2,
                            top: cluster.y - size / 2,
                            width: size,
                            height: size,
                            transform: isHovered ? 'scale(1.15)' : 'scale(1)',
                        }}
                        onMouseEnter={() => setHoveredCluster(i)}
                        onMouseLeave={() => setHoveredCluster(null)}
                        onClick={() => setSelectedCluster(isSelected ? null : i)}
                    >
                        <div className={`w-full h-full rounded-lg overflow-hidden border-2 shadow-lg ${isSelected ? 'border-blue-500 ring-2 ring-blue-200' :
                            isHovered ? 'border-indigo-400' : 'border-gray-300'
                            }`}>
                            <MiniGrid grid={cluster.leader.binaryGrid} size={size} />
                        </div>

                        {/* Member count badge */}
                        {cluster.members.length > 1 && (
                            <div className="absolute -top-2 -right-2 bg-indigo-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center shadow">
                                {cluster.members.length}
                            </div>
                        )}
                    </div>
                )
            })}

            {/* Selected cluster details - Full modal with all members */}
            {selectedCluster !== null && clusters[selectedCluster] && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90%] overflow-hidden flex flex-col">
                        {/* Modal Header */}
                        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
                            <div>
                                <h3 className="font-semibold text-gray-800">
                                    Cluster: {clusters[selectedCluster].leader.highway} - {clusters[selectedCluster].leader.location}
                                </h3>
                                <div className="text-sm text-gray-500">
                                    {clusters[selectedCluster].members.length} member{clusters[selectedCluster].members.length > 1 ? 's' : ''} in this cluster
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedCluster(null)}
                                className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Leader Section */}
                        <div className="shrink-0 px-4 py-3 bg-indigo-50 border-b border-indigo-100">
                            <div className="flex items-center gap-4">
                                <div className="shrink-0 border-2 border-indigo-400 rounded-lg overflow-hidden shadow">
                                    <MiniGrid grid={clusters[selectedCluster].leader.binaryGrid} size={80} />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded">LEADER</span>
                                        <span className="font-semibold text-gray-800">
                                            {clusters[selectedCluster].leader.highway} - {clusters[selectedCluster].leader.location}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-4 gap-2 text-xs">
                                        {metrics.map(m => (
                                            <div key={m} className="bg-white/80 rounded px-2 py-1">
                                                <div className="text-gray-500 capitalize">{m}</div>
                                                <div className="font-mono font-semibold text-indigo-700">{clusters[selectedCluster].leader.scagnostics[m].toFixed(3)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* All Members Grid */}
                        <div className="flex-1 overflow-auto p-4">
                            <div className="text-xs font-semibold text-gray-500 mb-3">ALL CLUSTER MEMBERS</div>
                            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-3">
                                {clusters[selectedCluster].members.map((member, idx) => (
                                    <div
                                        key={idx}
                                        className={`group relative rounded-lg overflow-hidden border-2 transition-all hover:shadow-lg hover:scale-105 ${member === clusters[selectedCluster].leader
                                            ? 'border-indigo-400 bg-indigo-50'
                                            : 'border-gray-200 hover:border-indigo-300'
                                            }`}
                                    >
                                        <MiniGrid grid={member.binaryGrid} size={64} />
                                        {/* Hover tooltip */}
                                        <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-1">
                                            <div className="text-white text-xs font-medium text-center leading-tight">
                                                {member.highway}
                                            </div>
                                            <div className="text-gray-300 text-[10px] text-center">
                                                {member.location}
                                            </div>
                                            <div className="text-indigo-300 text-[10px] mt-1">
                                                skinny: {member.scagnostics.skinny.toFixed(2)}
                                            </div>
                                        </div>
                                        {/* Leader badge */}
                                        {member === clusters[selectedCluster].leader && (
                                            <div className="absolute top-0 left-0 right-0 bg-indigo-600 text-white text-[9px] font-bold text-center py-0.5">
                                                LEADER
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Footer with metrics summary */}
                        <div className="shrink-0 px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
                            <span className="font-medium">Metrics used for clustering:</span> {metrics.join(', ')} •
                            <span className="ml-2">Click outside or ✕ to close</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
