"use client"

import { useEffect, useRef, useState, useMemo } from "react"

interface ScatterplotData {
    col_x: number
    col_y: number
    pointCount: number
    binaryGrid: number[][]
    category?: string  // Category for sorting before clustering
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
    leader: ScatterplotData
    members: ScatterplotData[]
    x: number
    y: number
    vx: number
    vy: number
}

interface ScagExplorerProps {
    scatterplots: ScatterplotData[]
    selectedMetrics?: (keyof ScatterplotData['scagnostics'])[]
    threshold?: number
}

/**
 * Compute metric statistics for normalization
 */
function computeMetricStats(
    scatterplots: ScatterplotData[],
    metrics: (keyof ScatterplotData['scagnostics'])[]
): { means: Record<string, number>; stds: Record<string, number> } {
    const means: Record<string, number> = {}
    const stds: Record<string, number> = {}

    for (const m of metrics) {
        const values = scatterplots.map(s => s.scagnostics[m])
        const mean = values.reduce((a, b) => a + b, 0) / values.length
        const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
        means[m] = mean
        stds[m] = Math.sqrt(variance) || 0.01 // Avoid division by zero
    }

    return { means, stds }
}

/**
 * Compute cluster centroid (average of all members' metrics)
 */
function computeClusterCentroid(
    members: ScatterplotData[],
    metrics: (keyof ScatterplotData['scagnostics'])[]
): Record<string, number> {
    const centroid: Record<string, number> = {}
    for (const m of metrics) {
        centroid[m] = members.reduce((sum, s) => sum + s.scagnostics[m], 0) / members.length
    }
    return centroid
}

/**
 * IMPROVED LEADER clustering algorithm with:
 * 1. Z-score normalization for fair metric comparison
 * 2. Centroid-based distance (not just leader)
 * 3. Cluster refinement pass
 */
function leaderClustering(
    scatterplots: ScatterplotData[],
    metrics: (keyof ScatterplotData['scagnostics'])[],
    threshold: number
): LeaderCluster[] {
    if (scatterplots.length === 0) return []

    // Step 1: Compute normalization statistics
    const { means, stds } = computeMetricStats(scatterplots, metrics)

    // Diagnostic: Analyze how well each metric differentiates categories
    console.log('\n📊 METRIC ANALYSIS BY CATEGORY:')
    const categories = [...new Set(scatterplots.map(s => s.category || 'unknown'))]
    for (const metric of metrics) {
        const catMeans: Record<string, number> = {}
        for (const cat of categories) {
            const catItems = scatterplots.filter(s => s.category === cat)
            if (catItems.length > 0) {
                catMeans[cat] = catItems.reduce((sum, s) => sum + s.scagnostics[metric], 0) / catItems.length
            }
        }
        // Sort by mean value
        const sorted = Object.entries(catMeans).sort((a, b) => b[1] - a[1])
        const range = sorted.length > 0 ? sorted[0][1] - sorted[sorted.length - 1][1] : 0
        console.log(`  ${metric}: range=${range.toFixed(3)}, top=${sorted.slice(0, 3).map(([cat, val]) => `${cat}:${val.toFixed(2)}`).join(', ')}`)
    }

    // Normalized distance function (z-score based)
    const normalizedDistance = (a: ScatterplotData, b: ScatterplotData): number => {
        let sum = 0
        for (const m of metrics) {
            // Z-score normalization: (value - mean) / std
            const normA = (a.scagnostics[m] - means[m]) / stds[m]
            const normB = (b.scagnostics[m] - means[m]) / stds[m]
            const diff = normA - normB
            sum += diff * diff
        }
        return Math.sqrt(sum)
    }

    // Distance from point to cluster centroid
    const distanceToCentroid = (
        point: ScatterplotData,
        centroid: Record<string, number>
    ): number => {
        let sum = 0
        for (const m of metrics) {
            const normPoint = (point.scagnostics[m] - means[m]) / stds[m]
            const normCentroid = (centroid[m] - means[m]) / stds[m]
            const diff = normPoint - normCentroid
            sum += diff * diff
        }
        return Math.sqrt(sum)
    }

    // Step 2: Initial LEADER pass
    const clusters: LeaderCluster[] = []
    const clusterCentroids: Record<string, number>[] = []

    for (const scatterplot of scatterplots) {
        let closestIdx = -1
        let minDist = Infinity

        // Find closest cluster by centroid distance
        for (let i = 0; i < clusters.length; i++) {
            const d = distanceToCentroid(scatterplot, clusterCentroids[i])
            if (d < minDist) {
                minDist = d
                closestIdx = i
            }
        }

        // Normalized threshold (scale by sqrt of metrics count for z-scores)
        const normalizedThreshold = threshold * Math.sqrt(metrics.length)

        if (closestIdx >= 0 && minDist < normalizedThreshold) {
            clusters[closestIdx].members.push(scatterplot)
            // Update centroid
            clusterCentroids[closestIdx] = computeClusterCentroid(
                clusters[closestIdx].members,
                metrics
            )
        } else {
            // Create new cluster
            clusters.push({
                leader: scatterplot,
                members: [scatterplot],
                x: Math.random() * 600 + 100,
                y: Math.random() * 400 + 100,
                vx: 0,
                vy: 0,
            })
            clusterCentroids.push(computeClusterCentroid([scatterplot], metrics))
        }
    }

    // Step 3: Refinement pass - reassign items to closest centroid
    let changed = true
    let iterations = 0
    const maxIterations = 5

    while (changed && iterations < maxIterations) {
        changed = false
        iterations++

        for (let ci = 0; ci < clusters.length; ci++) {
            const cluster = clusters[ci]
            const toRemove: number[] = []

            for (let mi = 0; mi < cluster.members.length; mi++) {
                const member = cluster.members[mi]
                const currentDist = distanceToCentroid(member, clusterCentroids[ci])

                // Check if member is closer to another cluster
                for (let oi = 0; oi < clusters.length; oi++) {
                    if (oi === ci) continue
                    const otherDist = distanceToCentroid(member, clusterCentroids[oi])

                    if (otherDist < currentDist * 0.8) { // Require significant improvement
                        // Move to other cluster
                        clusters[oi].members.push(member)
                        toRemove.push(mi)
                        changed = true
                        break
                    }
                }
            }

            // Remove moved members (reverse order to maintain indices)
            for (let i = toRemove.length - 1; i >= 0; i--) {
                cluster.members.splice(toRemove[i], 1)
            }
        }

        // Update centroids after reassignment
        for (let i = 0; i < clusters.length; i++) {
            if (clusters[i].members.length > 0) {
                clusterCentroids[i] = computeClusterCentroid(clusters[i].members, metrics)
            }
        }

        // Remove empty clusters
        for (let i = clusters.length - 1; i >= 0; i--) {
            if (clusters[i].members.length === 0) {
                clusters.splice(i, 1)
                clusterCentroids.splice(i, 1)
            }
        }
    }

    // Step 4: Update leaders to be the member closest to centroid
    for (let i = 0; i < clusters.length; i++) {
        let bestMember = clusters[i].members[0]
        let bestDist = Infinity

        for (const member of clusters[i].members) {
            const dist = distanceToCentroid(member, clusterCentroids[i])
            if (dist < bestDist) {
                bestDist = dist
                bestMember = member
            }
        }

        clusters[i].leader = bestMember
    }

    console.log(`LEADER Clustering: ${scatterplots.length} items → ${clusters.length} clusters (${iterations} refinement iterations)`)

    // Diagnostic: Analyze mixed-category clusters
    for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i]
        const categories = cluster.members.reduce((acc, m) => {
            const cat = m.category || 'unknown'
            acc[cat] = (acc[cat] || 0) + 1
            return acc
        }, {} as Record<string, number>)

        const catKeys = Object.keys(categories)
        if (catKeys.length > 1) {
            console.log(`\n⚠️ MIXED Cluster ${i} (${cluster.members.length} members):`)
            console.log(`  Categories: ${catKeys.map(k => `${k}:${categories[k]}`).join(', ')}`)

            // Show the centroid metrics
            const centroid = clusterCentroids[i]
            console.log(`  Centroid metrics:`)
            for (const m of metrics) {
                console.log(`    ${m}: ${centroid[m].toFixed(3)}`)
            }

            // Sample some members and show why they're in the same cluster
            const sampleMembers = cluster.members.slice(0, Math.min(3, cluster.members.length))
            for (const member of sampleMembers) {
                const dist = distanceToCentroid(member, centroid)
                // Show which metrics differ most
                const diffs: { metric: string; diff: number }[] = []
                for (const m of metrics) {
                    const normMember = (member.scagnostics[m] - means[m]) / stds[m]
                    const normCentroid = (centroid[m] - means[m]) / stds[m]
                    diffs.push({ metric: m, diff: Math.abs(normMember - normCentroid) })
                }
                diffs.sort((a, b) => b.diff - a.diff)
                console.log(`    Largest diffs: ${diffs.slice(0, 3).map(d => `${d.metric}:${d.diff.toFixed(2)}`).join(', ')}`)
            }
        }
    }

    return clusters
}

// Force-directed layout step with collision prevention
function forceLayoutStep(
    clusters: LeaderCluster[],
    width: number,
    height: number,
    metrics: (keyof ScatterplotData['scagnostics'])[]
): void {
    const repulsionStrength = 15000
    const attractionStrength = 0.005
    const damping = 0.7
    const centerForce = 0.008
    const collisionPadding = 15

    // Distance in metric space
    const metricDistance = (a: ScatterplotData, b: ScatterplotData): number => {
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

        // Repulsion from other clusters
        for (let j = 0; j < clusters.length; j++) {
            if (i === j) continue
            const c2 = clusters[j]
            const size2 = getSize(c2)

            const dx = c1.x - c2.x
            const dy = c1.y - c2.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.1
            const minDist = (size1 + size2) / 2 + collisionPadding

            if (dist < minDist * 3) {
                const overlap = minDist / dist
                const force = repulsionStrength * overlap * overlap / (dist + 1)
                fx += (dx / dist) * force
                fy += (dy / dist) * force
            }
        }

        // Weak attraction based on metric similarity
        for (let j = 0; j < clusters.length; j++) {
            if (i === j) continue
            const c2 = clusters[j]

            const metricDist = metricDistance(c1.leader, c2.leader)
            const dx = c2.x - c1.x
            const dy = c2.y - c1.y
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const size2 = getSize(c2)
            const minDist = (size1 + size2) / 2 + collisionPadding

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

        // Clamp velocity
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

    // Collision resolution pass
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
                    const overlap = (minDist - dist) / 2
                    const nx = dx / dist
                    const ny = dy / dist

                    c1.x -= nx * overlap
                    c1.y -= ny * overlap
                    c2.x += nx * overlap
                    c2.y += ny * overlap

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

export default function ScagExplorer({ scatterplots, selectedMetrics, threshold = 0.3 }: ScagExplorerProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
    const [hoveredCluster, setHoveredCluster] = useState<number | null>(null)
    const [selectedCluster, setSelectedCluster] = useState<number | null>(null)

    const metrics = selectedMetrics || ['sparse', 'convex', 'skinny', 'stringy', 'clumpy', 'outlying', 'skewed', 'striated', 'monotonic']

    // Initial clustering - sort by category first so same-category items are processed together
    const initialClusters = useMemo(() => {
        // Sort by category to ensure same-category items are processed consecutively
        // This helps Leader algorithm group similar items together
        const sorted = [...scatterplots].sort((a, b) => {
            const catA = a.category || ''
            const catB = b.category || ''
            return catA.localeCompare(catB)
        })
        return leaderClustering(sorted, metrics, threshold)
    }, [scatterplots, metrics, threshold])

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
        const maxIterations = 150  // Reduced for better performance

        const animate = () => {
            if (iterations >= maxIterations) return

            setClusters(prev => {
                const next = prev.map(c => ({ ...c }))
                // Run 2 force steps per frame for faster convergence
                forceLayoutStep(next, dimensions.width, dimensions.height, metrics)
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
                    {clusters.length} clusters from {scatterplots.length} scatterplots
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
                                    Cluster: Col {clusters[selectedCluster].leader.col_x} vs Col {clusters[selectedCluster].leader.col_y}
                                </h3>
                                <div className="text-sm text-gray-500">
                                    {clusters[selectedCluster].members.length} scatterplot{clusters[selectedCluster].members.length > 1 ? 's' : ''} in this cluster
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedCluster(null)}
                                className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                            >
                                x
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
                                            ({clusters[selectedCluster].leader.col_x}, {clusters[selectedCluster].leader.col_y})
                                        </span>
                                        <span className="text-sm text-gray-500">
                                            {clusters[selectedCluster].leader.pointCount} points
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

                        {/* Cluster Metrics Range - Shows why items are grouped */}
                        <div className="shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-200">
                            <div className="text-xs font-semibold text-amber-800 mb-2">CLUSTER METRIC RANGES (why these are grouped)</div>
                            <div className="grid grid-cols-9 gap-1 text-[10px]">
                                {metrics.map(m => {
                                    const values = clusters[selectedCluster].members.map(mem => mem.scagnostics[m])
                                    const min = Math.min(...values)
                                    const max = Math.max(...values)
                                    const range = max - min
                                    const isNarrow = range < 0.15
                                    return (
                                        <div key={m} className={`rounded px-1 py-0.5 text-center ${isNarrow ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                            <div className="font-semibold capitalize truncate">{m}</div>
                                            <div className="font-mono">{min.toFixed(2)}-{max.toFixed(2)}</div>
                                            <div className="text-[8px]">Δ{range.toFixed(2)}</div>
                                        </div>
                                    )
                                })}
                            </div>
                            <div className="text-[10px] text-amber-700 mt-1">
                                <span className="inline-block w-2 h-2 bg-green-100 border border-green-300 rounded mr-1"></span>Narrow range (good grouping)
                                <span className="inline-block w-2 h-2 bg-red-100 border border-red-300 rounded ml-3 mr-1"></span>Wide range (potential mismatch)
                            </div>
                        </div>

                        {/* All Members Grid */}
                        <div className="flex-1 overflow-auto p-4">
                            {/* Category breakdown */}
                            {(() => {
                                const categories = clusters[selectedCluster].members.reduce((acc, m) => {
                                    const cat = m.category || 'unknown'
                                    acc[cat] = (acc[cat] || 0) + 1
                                    return acc
                                }, {} as Record<string, number>)
                                const catEntries = Object.entries(categories).sort((a, b) => b[1] - a[1])
                                const isMixed = catEntries.length > 1
                                return (
                                    <div className={`text-xs mb-3 p-2 rounded ${isMixed ? 'bg-orange-50 border border-orange-200' : 'bg-green-50 border border-green-200'}`}>
                                        <span className="font-semibold">{isMixed ? '⚠️ MIXED CATEGORIES:' : '✓ SINGLE CATEGORY:'}</span>
                                        {catEntries.map(([cat, count]) => (
                                            <span key={cat} className="ml-2 px-1.5 py-0.5 bg-white rounded border">
                                                {cat}: {count}
                                            </span>
                                        ))}
                                    </div>
                                )
                            })()}
                            <div className="text-xs font-semibold text-gray-500 mb-3">ALL CLUSTER MEMBERS ({clusters[selectedCluster].members.length})</div>
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
                                        {/* Category badge */}
                                        {member.category && (
                                            <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[8px] text-center py-0.5 truncate px-1">
                                                {member.category}
                                            </div>
                                        )}
                                        {/* Hover tooltip */}
                                        <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-1">
                                            <div className="text-white text-xs font-medium text-center leading-tight">
                                                {member.category || `(${member.col_x}, ${member.col_y})`}
                                            </div>
                                            <div className="text-gray-300 text-[10px] text-center">
                                                {member.pointCount} points
                                            </div>
                                            <div className="text-indigo-300 text-[10px] mt-1 grid grid-cols-3 gap-0.5">
                                                <span>str:{member.scagnostics.stringy.toFixed(1)}</span>
                                                <span>spa:{member.scagnostics.sparse.toFixed(1)}</span>
                                                <span>con:{member.scagnostics.convex.toFixed(1)}</span>
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
                            <span className="font-medium">Metrics used for clustering:</span> {metrics.join(', ')} - Click outside or x to close
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
