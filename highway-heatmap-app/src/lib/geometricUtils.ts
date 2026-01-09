/**
 * Geometric utilities for computing MST, Alpha Shape, and Convex Hull
 * on 2D point clouds derived from heatmap damage data.
 */

import { Delaunay } from 'd3-delaunay'

export interface Point2D {
    x: number
    y: number
    year?: number
    position?: number
    score?: number
}

export interface Edge {
    p1: Point2D
    p2: Point2D
    length: number
}

/**
 * Compute Euclidean distance between two points
 */
function distance(p1: Point2D, p2: Point2D): number {
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    return Math.sqrt(dx * dx + dy * dy)
}

/**
 * Compute Minimum Spanning Tree using Prim's algorithm
 * Returns edges of the MST
 */
export function computeMST(points: Point2D[]): Edge[] {
    if (points.length < 2) return []

    const n = points.length
    const inMST = new Array(n).fill(false)
    const key = new Array(n).fill(Infinity)
    const parent = new Array(n).fill(-1)

    key[0] = 0

    for (let count = 0; count < n - 1; count++) {
        // Find minimum key vertex not in MST
        let minKey = Infinity
        let u = -1
        for (let v = 0; v < n; v++) {
            if (!inMST[v] && key[v] < minKey) {
                minKey = key[v]
                u = v
            }
        }

        if (u === -1) break
        inMST[u] = true

        // Update keys of adjacent vertices
        for (let v = 0; v < n; v++) {
            if (!inMST[v]) {
                const dist = distance(points[u], points[v])
                if (dist < key[v]) {
                    key[v] = dist
                    parent[v] = u
                }
            }
        }
    }

    // Build edges from parent array
    const edges: Edge[] = []
    for (let i = 1; i < n; i++) {
        if (parent[i] !== -1) {
            edges.push({
                p1: points[parent[i]],
                p2: points[i],
                length: distance(points[parent[i]], points[i])
            })
        }
    }

    return edges
}

/**
 * Compute Convex Hull using Graham scan algorithm
 * Returns vertices of the convex hull in counter-clockwise order
 */
export function computeConvexHull(points: Point2D[]): Point2D[] {
    if (points.length < 3) return [...points]

    // Find the bottom-most point (or left-most in case of tie)
    let minIdx = 0
    for (let i = 1; i < points.length; i++) {
        if (points[i].y < points[minIdx].y ||
            (points[i].y === points[minIdx].y && points[i].x < points[minIdx].x)) {
            minIdx = i
        }
    }

    const pivot = points[minIdx]

    // Sort points by polar angle with respect to pivot
    const sorted = points
        .filter((_, i) => i !== minIdx)
        .map(p => ({
            point: p,
            angle: Math.atan2(p.y - pivot.y, p.x - pivot.x),
            dist: distance(pivot, p)
        }))
        .sort((a, b) => {
            if (Math.abs(a.angle - b.angle) < 1e-10) {
                return a.dist - b.dist
            }
            return a.angle - b.angle
        })
        .map(item => item.point)

    // Cross product to determine turn direction
    function cross(o: Point2D, a: Point2D, b: Point2D): number {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    }

    const hull: Point2D[] = [pivot]

    for (const p of sorted) {
        // Remove points that make clockwise turn
        while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
            hull.pop()
        }
        hull.push(p)
    }

    return hull
}

/**
 * Circumcircle data for visualization
 */
export interface Circumcircle {
    cx: number  // center x (normalized)
    cy: number  // center y (normalized)
    r: number   // radius (normalized)
}

/**
 * Compute circumcenter and circumradius of a triangle
 */
function computeCircumcircle(p0: Point2D, p1: Point2D, p2: Point2D): Circumcircle | null {
    const ax = p0.x, ay = p0.y
    const bx = p1.x, by = p1.y
    const cx = p2.x, cy = p2.y

    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    if (Math.abs(d) < 1e-10) return null // Degenerate triangle

    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d

    const r = Math.sqrt((ax - ux) * (ax - ux) + (ay - uy) * (ay - uy))

    return { cx: ux, cy: uy, r }
}

/**
 * Compute Alpha Shape with circumcircles for visualization
 * Returns both the boundary polygons and the circumcircles of valid triangles
 */
export function computeAlphaShapeWithCircles(points: Point2D[], alpha?: number): { polygons: Point2D[][], circles: Circumcircle[] } {
    if (points.length < 3) return { polygons: [points], circles: [] }

    // Compute Delaunay triangulation
    const coords = points.flatMap(p => [p.x, p.y])
    const delaunay = new Delaunay(coords)

    // Get triangles
    const triangles: number[][] = []
    for (let i = 0; i < delaunay.triangles.length; i += 3) {
        triangles.push([
            delaunay.triangles[i],
            delaunay.triangles[i + 1],
            delaunay.triangles[i + 2]
        ])
    }

    // Compute alpha if not provided (90th percentile of MST edge lengths)
    if (alpha === undefined) {
        const mstEdges = computeMST(points)
        if (mstEdges.length === 0) {
            alpha = 1
        } else {
            const lengths = mstEdges.map(e => e.length).sort((a, b) => a - b)
            const idx = Math.floor(lengths.length * 0.9)
            alpha = lengths[Math.min(idx, lengths.length - 1)] * 1.5
        }
    }

    // Filter triangles by circumradius <= alpha and collect circumcircles
    const validTriangles: number[][] = []
    const circles: Circumcircle[] = []

    for (const tri of triangles) {
        const p0 = points[tri[0]]
        const p1 = points[tri[1]]
        const p2 = points[tri[2]]

        const circle = computeCircumcircle(p0, p1, p2)
        if (!circle) continue

        if (circle.r <= alpha) {
            validTriangles.push(tri)
            circles.push(circle)
        }
    }

    if (validTriangles.length === 0) {
        return { polygons: [computeConvexHull(points)], circles: [] }
    }

    // Extract boundary edges (edges that appear in only one triangle)
    const edgeCount = new Map<string, { count: number; edge: [number, number] }>()

    for (const tri of validTriangles) {
        const edges: [number, number][] = [
            [tri[0], tri[1]],
            [tri[1], tri[2]],
            [tri[2], tri[0]]
        ]

        for (const [i, j] of edges) {
            const key = i < j ? `${i}-${j}` : `${j}-${i}`
            const existing = edgeCount.get(key)
            if (existing) {
                existing.count++
            } else {
                edgeCount.set(key, { count: 1, edge: i < j ? [i, j] : [j, i] })
            }
        }
    }

    // Boundary edges appear exactly once
    const boundaryEdges: [number, number][] = []
    for (const [, value] of edgeCount) {
        if (value.count === 1) {
            boundaryEdges.push(value.edge)
        }
    }

    if (boundaryEdges.length === 0) {
        return { polygons: [computeConvexHull(points)], circles }
    }

    // Build adjacency list for boundary vertices
    const adjacency = new Map<number, number[]>()
    for (const [i, j] of boundaryEdges) {
        if (!adjacency.has(i)) adjacency.set(i, [])
        if (!adjacency.has(j)) adjacency.set(j, [])
        adjacency.get(i)!.push(j)
        adjacency.get(j)!.push(i)
    }

    // Helper: compute angle from point 'from' to point 'to'
    const angle = (from: number, to: number): number => {
        return Math.atan2(points[to].y - points[from].y, points[to].x - points[from].x)
    }

    // Helper: normalize angle difference to [0, 2π)
    const normalizeAngle = (a: number): number => {
        while (a < 0) a += 2 * Math.PI
        while (a >= 2 * Math.PI) a -= 2 * Math.PI
        return a
    }

    // Track used directed edges to handle disconnected components
    const usedDirectedEdges = new Set<string>()
    const polygons: Point2D[][] = []

    // Get all unique boundary vertices sorted by x (then y) for consistent ordering
    const boundaryVertices = new Set<number>()
    for (const [i, j] of boundaryEdges) {
        boundaryVertices.add(i)
        boundaryVertices.add(j)
    }
    const sortedVertices = Array.from(boundaryVertices).sort((a, b) => {
        if (points[a].x !== points[b].x) return points[a].x - points[b].x
        return points[a].y - points[b].y
    })

    // Function to trace one polygon starting from a vertex
    const tracePolygon = (startVertex: number): Point2D[] | null => {
        const neighbors = adjacency.get(startVertex) || []
        if (neighbors.length === 0) return null

        // Find an unused outgoing edge
        let firstNext = -1
        let bestAngle = -Infinity
        for (const neighbor of neighbors) {
            const key = `${startVertex}-${neighbor}`
            if (!usedDirectedEdges.has(key)) {
                const a = angle(startVertex, neighbor)
                if (a > bestAngle) {
                    bestAngle = a
                    firstNext = neighbor
                }
            }
        }

        if (firstNext === -1) return null

        const polygon: Point2D[] = []
        let prev = startVertex
        let current = firstNext
        polygon.push(points[startVertex])
        usedDirectedEdges.add(`${startVertex}-${firstNext}`)
        usedDirectedEdges.add(`${firstNext}-${startVertex}`)

        const maxIterations = boundaryEdges.length * 2
        let iterations = 0

        while (current !== startVertex && iterations < maxIterations) {
            iterations++
            polygon.push(points[current])

            const currentNeighbors = adjacency.get(current) || []
            if (currentNeighbors.length === 0) break

            const incomingAngle = angle(current, prev)

            let bestNext = -1
            let bestTurnAngle = Infinity

            for (const neighbor of currentNeighbors) {
                if (neighbor === prev) continue

                const outgoingAngle = angle(current, neighbor)
                const turnAngle = normalizeAngle(outgoingAngle - incomingAngle)

                if (turnAngle < bestTurnAngle) {
                    bestTurnAngle = turnAngle
                    bestNext = neighbor
                }
            }

            if (bestNext === -1) break

            const directedKey = `${current}-${bestNext}`
            const reverseKey = `${bestNext}-${current}`
            if (usedDirectedEdges.has(directedKey)) break
            usedDirectedEdges.add(directedKey)
            usedDirectedEdges.add(reverseKey)

            prev = current
            current = bestNext
        }

        return polygon.length >= 3 ? polygon : null
    }

    // Trace all disconnected components
    for (const startVertex of sortedVertices) {
        const polygon = tracePolygon(startVertex)
        if (polygon) {
            polygons.push(polygon)
        }
    }

    return {
        polygons: polygons.length > 0 ? polygons : [computeConvexHull(points)],
        circles
    }
}

/**
 * Compute Alpha Shape from Delaunay triangulation
 * Alpha parameter determines the level of detail:
 * - Smaller alpha = more detailed (concave) shape
 * - Larger alpha = smoother (more convex) shape
 * 
 * If alpha is not provided, use 90th percentile of MST edge lengths
 */
export function computeAlphaShape(points: Point2D[], alpha?: number): Point2D[][] {
    if (points.length < 3) return [points]

    // Compute Delaunay triangulation
    const coords = points.flatMap(p => [p.x, p.y])
    const delaunay = new Delaunay(coords)

    // Get triangles
    const triangles: number[][] = []
    for (let i = 0; i < delaunay.triangles.length; i += 3) {
        triangles.push([
            delaunay.triangles[i],
            delaunay.triangles[i + 1],
            delaunay.triangles[i + 2]
        ])
    }

    // Compute alpha if not provided (90th percentile of MST edge lengths)
    if (alpha === undefined) {
        const mstEdges = computeMST(points)
        if (mstEdges.length === 0) {
            alpha = 1
        } else {
            const lengths = mstEdges.map(e => e.length).sort((a, b) => a - b)
            const idx = Math.floor(lengths.length * 0.9)
            alpha = lengths[Math.min(idx, lengths.length - 1)] * 1.5
        }
    }

    // Filter triangles by circumradius <= alpha
    const validTriangles: number[][] = []

    for (const tri of triangles) {
        const p0 = points[tri[0]]
        const p1 = points[tri[1]]
        const p2 = points[tri[2]]

        // Compute circumradius
        const a = distance(p0, p1)
        const b = distance(p1, p2)
        const c = distance(p2, p0)
        const s = (a + b + c) / 2
        const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)))

        if (area > 1e-10) {
            const circumradius = (a * b * c) / (4 * area)
            if (circumradius <= alpha) {
                validTriangles.push(tri)
            }
        }
    }

    if (validTriangles.length === 0) {
        // Fall back to convex hull if no valid triangles
        return [computeConvexHull(points)]
    }

    // Extract boundary edges (edges that appear in only one triangle)
    const edgeCount = new Map<string, { count: number; edge: [number, number] }>()

    for (const tri of validTriangles) {
        const edges: [number, number][] = [
            [tri[0], tri[1]],
            [tri[1], tri[2]],
            [tri[2], tri[0]]
        ]

        for (const [i, j] of edges) {
            const key = i < j ? `${i}-${j}` : `${j}-${i}`
            const existing = edgeCount.get(key)
            if (existing) {
                existing.count++
            } else {
                edgeCount.set(key, { count: 1, edge: i < j ? [i, j] : [j, i] })
            }
        }
    }

    // Boundary edges appear exactly once
    const boundaryEdges: [number, number][] = []
    for (const [, value] of edgeCount) {
        if (value.count === 1) {
            boundaryEdges.push(value.edge)
        }
    }

    if (boundaryEdges.length === 0) {
        return [computeConvexHull(points)]
    }

    // Build adjacency list for boundary vertices
    // Each vertex maps to list of connected vertices via boundary edges
    const adjacency = new Map<number, number[]>()
    for (const [i, j] of boundaryEdges) {
        if (!adjacency.has(i)) adjacency.set(i, [])
        if (!adjacency.has(j)) adjacency.set(j, [])
        adjacency.get(i)!.push(j)
        adjacency.get(j)!.push(i)
    }

    // Helper: compute angle from point 'from' to point 'to'
    const angle = (from: number, to: number): number => {
        return Math.atan2(points[to].y - points[from].y, points[to].x - points[from].x)
    }

    // Helper: normalize angle difference to [0, 2π)
    const normalizeAngle = (a: number): number => {
        while (a < 0) a += 2 * Math.PI
        while (a >= 2 * Math.PI) a -= 2 * Math.PI
        return a
    }

    // Track used directed edges to handle disconnected components
    const usedDirectedEdges = new Set<string>()
    const polygons: Point2D[][] = []

    // Get all unique boundary vertices sorted by x (then y) for consistent ordering
    const boundaryVertices = new Set<number>()
    for (const [i, j] of boundaryEdges) {
        boundaryVertices.add(i)
        boundaryVertices.add(j)
    }
    const sortedVertices = Array.from(boundaryVertices).sort((a, b) => {
        if (points[a].x !== points[b].x) return points[a].x - points[b].x
        return points[a].y - points[b].y
    })

    // Function to trace one polygon starting from a vertex
    const tracePolygon = (startVertex: number): Point2D[] | null => {
        const neighbors = adjacency.get(startVertex) || []
        if (neighbors.length === 0) return null

        // Find an unused outgoing edge
        let firstNext = -1
        let bestAngle = -Infinity
        for (const neighbor of neighbors) {
            const key = `${startVertex}-${neighbor}`
            if (!usedDirectedEdges.has(key)) {
                const a = angle(startVertex, neighbor)
                // Prefer going "up" (larger y / positive angle)
                if (a > bestAngle) {
                    bestAngle = a
                    firstNext = neighbor
                }
            }
        }

        if (firstNext === -1) return null // All edges from this vertex already used

        const polygon: Point2D[] = []
        let prev = startVertex
        let current = firstNext
        polygon.push(points[startVertex])
        // Mark both forward and reverse edges as used to prevent tracing same boundary twice
        usedDirectedEdges.add(`${startVertex}-${firstNext}`)
        usedDirectedEdges.add(`${firstNext}-${startVertex}`)

        const maxIterations = boundaryEdges.length * 2
        let iterations = 0

        while (current !== startVertex && iterations < maxIterations) {
            iterations++
            polygon.push(points[current])

            const currentNeighbors = adjacency.get(current) || []
            if (currentNeighbors.length === 0) break

            // Find the next vertex by taking the smallest turn angle (rightmost turn for outer boundary)
            const incomingAngle = angle(current, prev)

            let bestNext = -1
            let bestTurnAngle = Infinity

            for (const neighbor of currentNeighbors) {
                if (neighbor === prev) continue

                const outgoingAngle = angle(current, neighbor)
                const turnAngle = normalizeAngle(outgoingAngle - incomingAngle)

                if (turnAngle < bestTurnAngle) {
                    bestTurnAngle = turnAngle
                    bestNext = neighbor
                }
            }

            if (bestNext === -1) break

            const directedKey = `${current}-${bestNext}`
            const reverseKey = `${bestNext}-${current}`
            if (usedDirectedEdges.has(directedKey)) break
            // Mark both forward and reverse edges as used
            usedDirectedEdges.add(directedKey)
            usedDirectedEdges.add(reverseKey)

            prev = current
            current = bestNext
        }

        return polygon.length >= 3 ? polygon : null
    }

    // Trace all disconnected components by finding unused starting vertices
    for (const startVertex of sortedVertices) {
        // Try to trace a polygon from this vertex
        const polygon = tracePolygon(startVertex)
        if (polygon) {
            polygons.push(polygon)
        }
    }

    return polygons.length > 0 ? polygons : [computeConvexHull(points)]
}

/**
 * Normalize points to [0, 1] range for both x and y
 */
export function normalizePoints(points: Point2D[]): Point2D[] {
    if (points.length === 0) return []

    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity

    for (const p of points) {
        if (p.x < minX) minX = p.x
        if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
    }

    const rangeX = maxX - minX || 1
    const rangeY = maxY - minY || 1

    return points.map(p => ({
        ...p,
        x: (p.x - minX) / rangeX,
        y: (p.y - minY) / rangeY
    }))
}

/**
 * Extract damage points from PMIS features
 * Points are where condition score is < 50 AND > 0
 */
export function extractDamagePoints(
    features: Array<{ properties: Record<string, any> }>,
    maxScore: number = 49
): Point2D[] {
    const points: Point2D[] = []

    for (const f of features) {
        const props = f.properties
        const score = Number(props.TX_CONDITION_SCORE)

        // Filter: score must be > 0 and <= maxScore
        if (isNaN(score) || score <= 0 || score > maxScore) continue

        const markerNbr = Number(props.TX_BEG_REF_MARKER_NBR) || 0
        const markerDisp = Number(props.TX_BEG_REF_MRKR_DISP) || 0
        const position = markerNbr + markerDisp

        const year = Number(props.EFF_YEAR) || 0
        if (year === 0) continue

        points.push({
            x: position,
            y: year,
            position,
            year,
            score
        })
    }

    return points
}

/**
 * Check if a field is a geometric visualization type
 */
export function isGeometricField(field: string): boolean {
    return field.startsWith('GEOMETRIC_')
}

/**
 * Get the geometry type from field name
 */
export function getGeometryType(field: string): 'mst' | 'alpha_shape' | 'convex_hull' | null {
    switch (field) {
        case 'GEOMETRIC_MST':
            return 'mst'
        case 'GEOMETRIC_ALPHA_SHAPE':
            return 'alpha_shape'
        case 'GEOMETRIC_CONVEX_HULL':
            return 'convex_hull'
        default:
            return null
    }
}

/**
 * Get color for geometry type
 */
export function getGeometryColor(type: 'mst' | 'alpha_shape' | 'convex_hull'): string {
    switch (type) {
        case 'mst':
            return '#22C55E' // Green
        case 'alpha_shape':
            return '#FB923C' // Light Orange
        case 'convex_hull':
            return '#3B82F6' // Blue
    }
}

/**
 * Get label for geometry field
 */
export function getGeometryLabel(field: string): string {
    switch (field) {
        case 'GEOMETRIC_MST':
            return 'MST'
        case 'GEOMETRIC_ALPHA_SHAPE':
            return 'Alpha Shape'
        case 'GEOMETRIC_CONVEX_HULL':
            return 'Convex Hull'
        default:
            return field
    }
}

// ============================================================
// SCAGNOSTICS - 9 Graph-Theoretic Measures
// Based on Wilkinson et al. "Graph-Theoretic Scagnostics"
// ============================================================

/**
 * Result of Scagnostics computation - all 9 metrics normalized to [0, 1]
 */
export interface ScagnosticsResult {
    outlying: number   // Ratio of outlier MST edges
    skewed: number     // Asymmetry of MST edge distribution
    stringy: number    // MST diameter / (n-1)
    sparse: number     // Alpha area / Hull area
    convex: number     // Convexity measure
    clumpy: number     // Short edge clustering
    skinny: number     // Perimeter² / (4π × Area)
    striated: number   // Parallel edges ratio
    monotonic: number  // |Spearman correlation|
}

/**
 * Minimum points required for meaningful Scagnostics
 */
const MIN_POINTS_FOR_SCAGNOSTICS = 5

/**
 * Compute polygon area using Shoelace formula
 */
function computePolygonArea(polygon: Point2D[]): number {
    if (polygon.length < 3) return 0
    let area = 0
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length
        area += polygon[i].x * polygon[j].y
        area -= polygon[j].x * polygon[i].y
    }
    return Math.abs(area) / 2
}

/**
 * Compute polygon perimeter
 */
function computePolygonPerimeter(polygon: Point2D[]): number {
    if (polygon.length < 2) return 0
    let perimeter = 0
    for (let i = 0; i < polygon.length; i++) {
        const j = (i + 1) % polygon.length
        perimeter += distance(polygon[i], polygon[j])
    }
    return perimeter
}

/**
 * Compute MST diameter (longest path in tree) using BFS
 */
function computeMSTDiameter(edges: Edge[], points: Point2D[]): number {
    if (edges.length === 0 || points.length < 2) return 0

    // Build adjacency list
    const adj = new Map<number, { neighbor: number; dist: number }[]>()

    const getPointIndex = (p: Point2D): number => {
        return points.findIndex(pt => pt.x === p.x && pt.y === p.y)
    }

    edges.forEach(e => {
        const i1 = getPointIndex(e.p1)
        const i2 = getPointIndex(e.p2)
        if (i1 === -1 || i2 === -1) return

        if (!adj.has(i1)) adj.set(i1, [])
        if (!adj.has(i2)) adj.set(i2, [])
        adj.get(i1)!.push({ neighbor: i2, dist: e.length })
        adj.get(i2)!.push({ neighbor: i1, dist: e.length })
    })

    // BFS to find farthest node and distance
    const bfs = (start: number): { farthest: number; distance: number } => {
        const visited = new Set<number>()
        const queue: { node: number; dist: number }[] = [{ node: start, dist: 0 }]
        let farthest = start
        let maxDist = 0

        while (queue.length > 0) {
            const { node, dist } = queue.shift()!
            if (visited.has(node)) continue
            visited.add(node)

            if (dist > maxDist) {
                maxDist = dist
                farthest = node
            }

            const neighbors = adj.get(node) || []
            for (const { neighbor, dist: edgeDist } of neighbors) {
                if (!visited.has(neighbor)) {
                    queue.push({ node: neighbor, dist: dist + edgeDist })
                }
            }
        }
        return { farthest, distance: maxDist }
    }

    // Find diameter: BFS from node 0, then BFS from farthest node found
    const first = bfs(0)
    const second = bfs(first.farthest)
    return second.distance
}

/**
 * Compute Spearman rank correlation coefficient
 */
function spearmanCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 3) return 0

    const n = x.length

    // Create rank arrays
    const rank = (arr: number[]): number[] => {
        const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
        const ranks = new Array(n)
        for (let i = 0; i < n; i++) {
            ranks[sorted[i].i] = i + 1
        }
        return ranks
    }

    const rankX = rank(x)
    const rankY = rank(y)

    // Compute d² sum
    let d2Sum = 0
    for (let i = 0; i < n; i++) {
        const d = rankX[i] - rankY[i]
        d2Sum += d * d
    }

    // Spearman formula: 1 - (6 * Σd²) / (n * (n² - 1))
    return 1 - (6 * d2Sum) / (n * (n * n - 1))
}

/**
 * Compute all 9 Scagnostics metrics for a set of points
 * Points should already be normalized to [0, 1] range
 * 
 * @param points - Normalized point cloud
 * @returns ScagnosticsResult with all 9 metrics in [0, 1]
 */
export function computeScagnostics(points: Point2D[]): ScagnosticsResult {
    // Return zeros if insufficient points (K=5 gating)
    if (points.length < MIN_POINTS_FOR_SCAGNOSTICS) {
        return {
            outlying: 0, skewed: 0, stringy: 0, sparse: 0, convex: 0,
            clumpy: 0, skinny: 0, striated: 0, monotonic: 0
        }
    }

    // Compute required geometric structures
    const mstEdges = computeMST(points)
    const hull = computeConvexHull(points)
    const alphaPolygons = computeAlphaShape(points)

    // MST edge lengths
    const edgeLengths = mstEdges.map(e => e.length).sort((a, b) => a - b)
    const totalMSTLength = edgeLengths.reduce((s, l) => s + l, 0)

    // Quartiles for outlier detection
    const q1Idx = Math.floor(edgeLengths.length * 0.25)
    const q3Idx = Math.floor(edgeLengths.length * 0.75)
    const q1 = edgeLengths[q1Idx] || 0
    const q3 = edgeLengths[q3Idx] || 0
    const iqr = q3 - q1

    // 1. OUTLYING: Ratio of outlier edge lengths to total
    const outlierThreshold = q3 + 1.5 * iqr
    const outlierLength = edgeLengths
        .filter(l => l > outlierThreshold)
        .reduce((s, l) => s + l, 0)
    const outlying = totalMSTLength > 0 ? Math.min(1, outlierLength / totalMSTLength) : 0

    // 2. SKEWED: 1 - (mean / max) edge length
    const meanEdge = totalMSTLength / Math.max(1, edgeLengths.length)
    const maxEdge = edgeLengths[edgeLengths.length - 1] || 1
    const skewed = 1 - (meanEdge / Math.max(meanEdge, maxEdge))

    // 3. STRINGY: diameter / (n - 1)
    const diameter = computeMSTDiameter(mstEdges, points)
    const stringy = points.length > 1
        ? Math.min(1, diameter / (points.length - 1))
        : 0

    // 4. SPARSE & 5. CONVEX: Alpha area / Hull area
    const hullArea = computePolygonArea(hull)
    const alphaArea = alphaPolygons.reduce((sum, poly) => sum + computePolygonArea(poly), 0)
    const sparse = hullArea > 0 ? 1 - Math.min(1, alphaArea / hullArea) : 0
    const convex = hullArea > 0 ? Math.min(1, alphaArea / hullArea) : 0

    // 6. CLUMPY: Ratio of short (clustered) edges
    const shortThreshold = q1 - 1.5 * iqr
    const shortEdges = edgeLengths.filter(l => l < Math.max(0, shortThreshold))
    const clumpy = edgeLengths.length > 0
        ? shortEdges.length / edgeLengths.length
        : 0

    // 7. SKINNY: Perimeter² / (4π × Area) for alpha shape (normalized)
    const totalAlphaPerimeter = alphaPolygons.reduce((sum, poly) =>
        sum + computePolygonPerimeter(poly), 0)
    const skinnyRaw = alphaArea > 0
        ? (totalAlphaPerimeter * totalAlphaPerimeter) / (4 * Math.PI * alphaArea)
        : 1
    const skinny = Math.min(1, 1 - 1 / Math.max(1, skinnyRaw))

    // 8. STRIATED: Detect parallel edges in Delaunay triangulation
    // Simplified: check for edges with similar angles
    const delaunay = Delaunay.from(points, p => p.x, p => p.y)
    const angles: number[] = []
    for (let i = 0; i < delaunay.triangles.length; i += 3) {
        for (let j = 0; j < 3; j++) {
            const p1 = points[delaunay.triangles[i + j]]
            const p2 = points[delaunay.triangles[i + (j + 1) % 3]]
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x)
            angles.push(angle)
        }
    }
    // Count parallel edges (within 5° threshold)
    const angleThreshold = 5 * Math.PI / 180
    let parallelCount = 0
    for (let i = 0; i < angles.length; i++) {
        for (let j = i + 1; j < angles.length; j++) {
            const diff = Math.abs(angles[i] - angles[j])
            if (diff < angleThreshold || Math.abs(diff - Math.PI) < angleThreshold) {
                parallelCount++
            }
        }
    }
    const maxPairs = (angles.length * (angles.length - 1)) / 2
    const striated = maxPairs > 0 ? Math.min(1, parallelCount / maxPairs * 10) : 0

    // 9. MONOTONIC: |Spearman correlation| between x and y
    const xCoords = points.map(p => p.x)
    const yCoords = points.map(p => p.y)
    const monotonic = Math.abs(spearmanCorrelation(xCoords, yCoords))

    return {
        outlying: Math.max(0, Math.min(1, outlying)),
        skewed: Math.max(0, Math.min(1, skewed)),
        stringy: Math.max(0, Math.min(1, stringy)),
        sparse: Math.max(0, Math.min(1, sparse)),
        convex: Math.max(0, Math.min(1, convex)),
        clumpy: Math.max(0, Math.min(1, clumpy)),
        skinny: Math.max(0, Math.min(1, skinny)),
        striated: Math.max(0, Math.min(1, striated)),
        monotonic: Math.max(0, Math.min(1, monotonic))
    }
}

/**
 * Scagnostics metric labels for display
 */
export const SCAGNOSTICS_LABELS: { key: keyof ScagnosticsResult; label: string }[] = [
    { key: 'outlying', label: 'Outlying' },
    { key: 'skewed', label: 'Skewed' },
    { key: 'stringy', label: 'Stringy' },
    { key: 'sparse', label: 'Sparse' },
    { key: 'convex', label: 'Convex' },
    { key: 'clumpy', label: 'Clumpy' },
    { key: 'skinny', label: 'Skinny' },
    { key: 'striated', label: 'Striated' },
    { key: 'monotonic', label: 'Monotonic' }
]
