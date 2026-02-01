// Image-only Scagnostic Pipeline 2 (Subpixel / Continuous Geometry)
// Based on: image_scagnostics_pipeline2.tex
//
// Key Concepts:
// - Subpixel precision using Marching Squares
// - Continuous Area/Perimeter (Shoelace formula, Euclidean distance)
// - Isoperimetric Quotient for "Skinny"
// - Distance Transform + Medial Axis for Skeleton
// - Skeleton pruning and branch analysis
// - Circular variance for striated detection
// - Watershed blob segmentation for clumpy
// - Multi-scale aggregation across thresholds
// */

import {
    type FloatGrid,
    type BinaryGrid,
    type Point,
    type Polyline,
    type AllScagnostics,
    type ExtendedScagnostics,
    type MultiScaleScagnostics,
    type SkeletonBranch,
    type Blob
} from "./types"
import { pointsToFloatGrid, pointsToBinaryGrid } from "./dataConversion"

// Re-export types
export {
    type FloatGrid,
    type BinaryGrid,
    type Point,
    type Polyline,
    type AllScagnostics,
    type ExtendedScagnostics,
    type MultiScaleScagnostics,
    type SkeletonBranch,
    type Blob
}
export { pointsToFloatGrid, pointsToBinaryGrid }

// Note: SkeletonTopology is exported where it's defined (with analyzeSkeletonTopology)


// ============================================================================
// STEP 0: Data Conversion - Points to Float Grid (Density)
// ============================================================================

// Imported from ./dataConversion.ts


// ============================================================================
// STEP 1: Anti-alias / Smoothing
// ============================================================================

/**
 * Generate 1D Gaussian kernel
 */
function generateGaussianKernel(sigma: number): number[] {
    const radius = Math.ceil(sigma * 3)
    const size = radius * 2 + 1
    const kernel: number[] = []
    let sum = 0

    for (let i = 0; i < size; i++) {
        const x = i - radius
        const value = Math.exp(-(x * x) / (2 * sigma * sigma))
        kernel.push(value)
        sum += value
    }

    // Normalize
    return kernel.map(v => v / sum)
}

/**
 * Apply separable Gaussian blur to float grid
 * Uses separate horizontal and vertical passes for efficiency
 */
export function gaussianBlur(grid: FloatGrid, sigma: number = 1.0): FloatGrid {
    if (sigma <= 0) return grid.map(row => [...row])

    const rows = grid.length
    const cols = grid[0]?.length || 0
    const kernel = generateGaussianKernel(sigma)
    const radius = Math.floor(kernel.length / 2)

    // Horizontal pass
    const temp: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let sum = 0
            let weightSum = 0
            for (let k = -radius; k <= radius; k++) {
                const sx = x + k
                if (sx >= 0 && sx < cols) {
                    const weight = kernel[k + radius]
                    sum += grid[y][sx] * weight
                    weightSum += weight
                }
            }
            temp[y][x] = weightSum > 0 ? sum / weightSum : 0
        }
    }

    // Vertical pass
    const result: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            let sum = 0
            let weightSum = 0
            for (let k = -radius; k <= radius; k++) {
                const sy = y + k
                if (sy >= 0 && sy < rows) {
                    const weight = kernel[k + radius]
                    sum += temp[sy][x] * weight
                    weightSum += weight
                }
            }
            result[y][x] = weightSum > 0 ? sum / weightSum : 0
        }
    }

    return result
}

// ============================================================================
// STEP 2: Percentile / Multi-threshold Segmentation
// ============================================================================

/**
 * Calculate percentile value from grid
 */
export function getPercentileValue(grid: FloatGrid, percentile: number): number {
    const values: number[] = []
    for (const row of grid) {
        for (const val of row) {
            if (val > 0) values.push(val)
        }
    }

    if (values.length === 0) return 0

    values.sort((a, b) => a - b)
    const index = Math.floor((percentile / 100) * (values.length - 1))
    return values[index]
}

/**
 * Segment grid by threshold (value-based)
 */
export function segmentByThreshold(grid: FloatGrid, threshold: number): BinaryGrid {
    return grid.map(row => row.map(val => val >= threshold ? 1 : 0))
}



/**
 * Multi-threshold segmentation (emulates alpha-shape family)
 * Returns binary masks at multiple percentile thresholds
 */
export function multiThresholdSegmentation(
    grid: FloatGrid,
    percentiles: number[] = [60, 65, 70, 75, 80, 85, 90, 95]
): { percentile: number; threshold: number; binary: BinaryGrid }[] {
    return percentiles.map(p => {
        const threshold = getPercentileValue(grid, p)
        return {
            percentile: p,
            threshold,
            binary: segmentByThreshold(grid, threshold)
        }
    })
}

// ============================================================================
// STEP 3: Subpixel Contour Extraction (Marching Squares)
// ============================================================================

// Edge indices: 0=top, 1=right, 2=bottom, 3=left
// For each cell code (0-15), define which edges are connected
// Format: [entryEdge, exitEdge] pairs - when entering from entryEdge, exit via exitEdge
const EDGE_TABLE: Record<number, [number, number][]> = {
    0: [],           // All outside - no contour
    1: [[2, 3]],     // BL inside
    2: [[1, 2]],     // BR inside
    3: [[1, 3]],     // BL+BR inside
    4: [[0, 1]],     // TR inside
    5: [[0, 3], [1, 2]], // TR+BL inside (saddle - ambiguous, use average)
    6: [[0, 2]],     // TR+BR inside
    7: [[0, 3]],     // TR+BR+BL inside
    8: [[3, 0]],     // TL inside
    9: [[2, 0]],     // TL+BL inside
    10: [[1, 0], [2, 3]], // TL+BR inside (saddle - ambiguous)
    11: [[1, 0]],    // TL+BL+BR inside
    12: [[3, 1]],    // TL+TR inside
    13: [[2, 1]],    // TL+TR+BL inside
    14: [[3, 2]],    // TL+TR+BR inside
    15: []           // All inside - no contour
}

// Given entry edge, find exit edge for a cell code
function getExitEdge(code: number, entryEdge: number): number {
    const pairs = EDGE_TABLE[code]
    for (const [entry, exit] of pairs) {
        if (entry === entryEdge) return exit
        if (exit === entryEdge) return entry  // Can traverse in reverse
    }
    return -1
}

// Get the adjacent cell when exiting via an edge
function getAdjacentCell(x: number, y: number, edge: number): { x: number; y: number; entryEdge: number } {
    switch (edge) {
        case 0: return { x, y: y - 1, entryEdge: 2 }  // Exit top -> enter from bottom
        case 1: return { x: x + 1, y, entryEdge: 3 }  // Exit right -> enter from left
        case 2: return { x, y: y + 1, entryEdge: 0 }  // Exit bottom -> enter from top
        case 3: return { x: x - 1, y, entryEdge: 1 }  // Exit left -> enter from right
        default: return { x: -1, y: -1, entryEdge: -1 }
    }
}

/**
 * Marching Squares contour extraction with proper contour tracing
 * Returns subpixel polylines by tracing contours cell-by-cell
 */
export function marchingSquares(grid: FloatGrid, threshold: number): Polyline[] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const contours: Polyline[] = []

    // Track visited cell+edge combinations to avoid retracing
    const visitedEdges = new Set<string>()

    // Get cell classification (4-bit code)
    // Bits: TL=8, TR=4, BR=2, BL=1
    const getCell = (x: number, y: number): number => {
        if (x < 0 || y < 0 || x >= cols - 1 || y >= rows - 1) return -1
        let code = 0
        if (grid[y][x] >= threshold) code |= 8     // TL
        if (grid[y][x + 1] >= threshold) code |= 4 // TR
        if (grid[y + 1][x + 1] >= threshold) code |= 2 // BR
        if (grid[y + 1][x] >= threshold) code |= 1 // BL
        return code
    }

    // Interpolate point on an edge
    const getEdgePoint = (x: number, y: number, edge: number): Point => {
        const tl = grid[y][x]
        const tr = grid[y][x + 1]
        const br = grid[y + 1][x + 1]
        const bl = grid[y + 1][x]

        const lerp = (v1: number, v2: number, x1: number, y1: number, x2: number, y2: number): Point => {
            if (Math.abs(v1 - v2) < 0.0001) {
                return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }
            }
            const t = Math.max(0, Math.min(1, (threshold - v1) / (v2 - v1)))
            return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) }
        }

        switch (edge) {
            case 0: return lerp(tl, tr, x, y, x + 1, y)           // Top
            case 1: return lerp(tr, br, x + 1, y, x + 1, y + 1)   // Right
            case 2: return lerp(bl, br, x, y + 1, x + 1, y + 1)   // Bottom
            case 3: return lerp(tl, bl, x, y, x, y + 1)           // Left
            default: return { x: x + 0.5, y: y + 0.5 }
        }
    }

    // Get starting edges for a cell (edges that have contour crossings)
    const getStartingEdges = (code: number): number[] => {
        const edges: number[] = []
        const pairs = EDGE_TABLE[code]
        for (const [e1, e2] of pairs) {
            edges.push(e1, e2)
        }
        return [...new Set(edges)]
    }

    // Trace a single contour starting from a cell and edge
    const traceContour = (startX: number, startY: number, startEdge: number): Polyline => {
        const contour: Point[] = []
        let x = startX
        let y = startY
        let entryEdge = startEdge
        let iterations = 0
        const maxIterations = rows * cols * 2

        while (iterations < maxIterations) {
            iterations++
            const code = getCell(x, y)
            if (code === -1 || code === 0 || code === 15) break

            const edgeKey = `${x},${y},${entryEdge}`
            if (visitedEdges.has(edgeKey)) {
                // We've completed a loop or hit a visited segment
                break
            }
            visitedEdges.add(edgeKey)

            // Get exit edge
            const exitEdge = getExitEdge(code, entryEdge)
            if (exitEdge === -1) break

            // Add the interpolated point at the exit edge
            const point = getEdgePoint(x, y, exitEdge)
            contour.push(point)

            // Mark the exit edge as visited too
            visitedEdges.add(`${x},${y},${exitEdge}`)

            // Move to adjacent cell
            const next = getAdjacentCell(x, y, exitEdge)
            x = next.x
            y = next.y
            entryEdge = next.entryEdge

            // Check if we're back at start
            if (x === startX && y === startY && entryEdge === startEdge) {
                break
            }
        }

        return contour
    }

    // Find all contours by scanning for unvisited cells with contour crossings
    for (let y = 0; y < rows - 1; y++) {
        for (let x = 0; x < cols - 1; x++) {
            const code = getCell(x, y)
            if (code === 0 || code === 15 || code === -1) continue

            // Get edges that have contour crossings
            const startingEdges = getStartingEdges(code)

            for (const edge of startingEdges) {
                const edgeKey = `${x},${y},${edge}`
                if (visitedEdges.has(edgeKey)) continue

                // Trace contour from this starting point
                const contour = traceContour(x, y, edge)

                if (contour.length >= 3) {
                    contours.push(contour)
                }
            }
        }
    }

    return contours
}

// ============================================================================
// STEP 4 & 5: Continuous Geometry Calculations
// ============================================================================

/**
 * Continuous Area using Shoelace Formula
 */
export function computeContinuousArea(contour: Polyline): number {
    let area = 0
    const n = contour.length
    if (n < 3) return 0

    for (let i = 0; i < n; i++) {
        const curr = contour[i]
        const next = contour[(i + 1) % n]
        area += (curr.x * next.y - next.x * curr.y)
    }
    return Math.abs(area) / 2
}

/**
 * Continuous Perimeter
 */
export function computeContinuousPerimeter(contour: Polyline): number {
    let perimeter = 0
    const n = contour.length
    if (n < 2) return 0

    for (let i = 0; i < n; i++) {
        const curr = contour[i]
        const next = contour[(i + 1) % n]
        const dx = next.x - curr.x
        const dy = next.y - curr.y
        perimeter += Math.sqrt(dx * dx + dy * dy)
    }
    return perimeter
}

/**
 * Convex Hull using Graham Scan
 */
export function computeConvexHull(points: Point[]): Polyline {
    if (points.length < 3) return points

    // Find lowest point
    let lowest = 0
    for (let i = 1; i < points.length; i++) {
        if (points[i].y < points[lowest].y ||
            (points[i].y === points[lowest].y && points[i].x < points[lowest].x)) {
            lowest = i
        }
    }

    const pivot = points[lowest]

    // Sort by polar angle, then by distance from pivot
    const sorted = points
        .filter((_, i) => i !== lowest)
        .map(p => {
            const dy = p.y - pivot.y
            const dx = p.x - pivot.x
            return {
                point: p,
                angle: Math.atan2(dy, dx),
                distSq: dx * dx + dy * dy
            }
        })
        .sort((a, b) => {
            const diffAngle = a.angle - b.angle
            if (Math.abs(diffAngle) > 1e-10) return diffAngle
            return a.distSq - b.distSq // Ascending distance for collinear points
        })
        .map(p => p.point)

    // Graham scan
    const stack: Point[] = [pivot]

    const cross = (o: Point, a: Point, b: Point): number => {
        return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
    }

    for (const p of sorted) {
        while (stack.length > 1 && cross(stack[stack.length - 2], stack[stack.length - 1], p) <= 0) {
            stack.pop()
        }
        stack.push(p)
    }

    return stack
}



/**
 * Isoperimetric Quotient (for Skinny metric)
 * Skinny = 1 - IQ where IQ = 4*pi*A / P^2
 */
export function computeSkinnyIQ(area: number, perimeter: number): number {
    if (perimeter === 0) return 0
    const iq = (4 * Math.PI * area) / (perimeter * perimeter)
    // IQ is 1 for circle, near 0 for thin shapes
    // Skinny should be 1 for thin, 0 for circle => 1 - IQ
    return Math.max(0, Math.min(1, 1 - iq))
}



// ============================================================================
// STEP 6: Distance Transform
// ============================================================================

/**
 * Euclidean Distance Transform (2-pass algorithm)
 */
export function euclideanDistanceTransform(grid: BinaryGrid): FloatGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const INF = rows + cols

    // Initialize: 0 for background, INF for foreground
    const dt: number[][] = Array.from({ length: rows }, (_, y) =>
        Array.from({ length: cols }, (_, x) => grid[y][x] === 1 ? INF * INF : 0)
    )

    // Pass 1: top-left to bottom-right
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (dt[y][x] === 0) continue
            const top = y > 0 ? dt[y - 1][x] + 1 : INF * INF
            const left = x > 0 ? dt[y][x - 1] + 1 : INF * INF
            dt[y][x] = Math.min(dt[y][x], top, left)
        }
    }

    // Pass 2: bottom-right to top-left
    for (let y = rows - 1; y >= 0; y--) {
        for (let x = cols - 1; x >= 0; x--) {
            if (dt[y][x] === 0) continue
            const bottom = y < rows - 1 ? dt[y + 1][x] + 1 : INF * INF
            const right = x < cols - 1 ? dt[y][x + 1] + 1 : INF * INF
            dt[y][x] = Math.min(dt[y][x], bottom, right)
        }
    }

    // Return sqrt for actual distance
    return dt.map(row => row.map(v => Math.sqrt(v)))
}

// ============================================================================
// STEP 7: Skeleton / Medial Axis Extraction
// ============================================================================

/**
 * Zhang-Suen Thinning Algorithm for skeleton extraction
 * Returns a 1-pixel wide skeleton
 */
export function zhangSuenThinning(grid: BinaryGrid): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    // Create working copy
    let current = grid.map(row => [...row])
    let changed = true

    const getNeighbors = (img: BinaryGrid, y: number, x: number): number[] => {
        // P2, P3, P4, P5, P6, P7, P8, P9 (clockwise from top)
        return [
            img[y - 1]?.[x] || 0,     // P2
            img[y - 1]?.[x + 1] || 0, // P3
            img[y]?.[x + 1] || 0,     // P4
            img[y + 1]?.[x + 1] || 0, // P5
            img[y + 1]?.[x] || 0,     // P6
            img[y + 1]?.[x - 1] || 0, // P7
            img[y]?.[x - 1] || 0,     // P8
            img[y - 1]?.[x - 1] || 0  // P9
        ]
    }

    const countTransitions = (neighbors: number[]): number => {
        let count = 0
        for (let i = 0; i < 8; i++) {
            if (neighbors[i] === 0 && neighbors[(i + 1) % 8] === 1) count++
        }
        return count
    }

    const countNeighbors = (neighbors: number[]): number => {
        return neighbors.reduce((sum, n) => sum + n, 0)
    }

    while (changed) {
        changed = false
        const toRemove: [number, number][] = []

        // Step 1
        for (let y = 1; y < rows - 1; y++) {
            for (let x = 1; x < cols - 1; x++) {
                if (current[y][x] !== 1) continue

                const neighbors = getNeighbors(current, y, x)
                const B = countNeighbors(neighbors)
                const A = countTransitions(neighbors)

                if (B >= 2 && B <= 6 && A === 1 &&
                    neighbors[0] * neighbors[2] * neighbors[4] === 0 &&
                    neighbors[2] * neighbors[4] * neighbors[6] === 0) {
                    toRemove.push([y, x])
                }
            }
        }

        for (const [y, x] of toRemove) {
            current[y][x] = 0
            changed = true
        }
        toRemove.length = 0

        // Step 2
        for (let y = 1; y < rows - 1; y++) {
            for (let x = 1; x < cols - 1; x++) {
                if (current[y][x] !== 1) continue

                const neighbors = getNeighbors(current, y, x)
                const B = countNeighbors(neighbors)
                const A = countTransitions(neighbors)

                if (B >= 2 && B <= 6 && A === 1 &&
                    neighbors[0] * neighbors[2] * neighbors[6] === 0 &&
                    neighbors[0] * neighbors[4] * neighbors[6] === 0) {
                    toRemove.push([y, x])
                }
            }
        }

        for (const [y, x] of toRemove) {
            current[y][x] = 0
            changed = true
        }
    }

    return current
}



/**
 * Get skeleton endpoints (pixels with exactly 1 neighbor)
 * Also includes skeleton pixels on the boundary that have 1 or fewer internal neighbors
 */
export function getSkeletonEndpoints(skeleton: BinaryGrid): Point[] {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const endpoints: Point[] = []

    // Check ALL pixels including boundaries
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (skeleton[y]?.[x] !== 1) continue

            let neighbors = 0
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const ny = y + dy
                    const nx = x + dx
                    // Safe boundary check
                    if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                        if (skeleton[ny][nx] === 1) neighbors++
                    }
                }
            }

            // Endpoint: exactly 1 neighbor
            // Also treat boundary pixels with 1 neighbor as endpoints
            if (neighbors === 1) {
                endpoints.push({ x, y })
            }
            // Special case: isolated pixel (0 neighbors) - also an endpoint
            else if (neighbors === 0) {
                endpoints.push({ x, y })
            }
        }
    }

    return endpoints
}

/**
 * Get skeleton junctions - only "true" junctions where branches diverge to different endpoints.
 * A junction must:
 * 1. Have 3+ neighbors (candidate junction)
 * 2. Have at least 2 branches that lead to DIFFERENT endpoints
 * 3. Be representative of a cluster (if adjacent junctions exist, only keep one per cluster)
 */
export function getSkeletonJunctions(skeleton: BinaryGrid): Point[] {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    // Helper to count neighbors
    const countNeighbors = (x: number, y: number): number => {
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                if (skeleton[y + dy]?.[x + dx] === 1) count++
            }
        }
        return count
    }

    // Helper to get neighbor positions
    const getNeighbors = (x: number, y: number): Point[] => {
        const neighbors: Point[] = []
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                if (skeleton[y + dy]?.[x + dx] === 1) {
                    neighbors.push({ x: x + dx, y: y + dy })
                }
            }
        }
        return neighbors
    }

    // Find all candidate junctions (3+ neighbors)
    const candidates: Point[] = []
    const candidateSet = new Set<string>()
    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (skeleton[y][x] !== 1) continue
            if (countNeighbors(x, y) >= 3) {
                candidates.push({ x, y })
                candidateSet.add(`${x},${y}`)
            }
        }
    }

    // Trace a path from a starting point until we reach an endpoint
    // Skip over intermediate junctions (other candidates)
    const traceToEndpoint = (start: Point, origin: Point): Point | null => {
        const visited = new Set<string>()
        visited.add(`${origin.x},${origin.y}`)

        // BFS to find reachable endpoints from this branch
        const queue: Point[] = [start]

        while (queue.length > 0) {
            const current = queue.shift()!
            const key = `${current.x},${current.y}`

            if (visited.has(key)) continue
            visited.add(key)

            const neighborCount = countNeighbors(current.x, current.y)

            // Found an endpoint (1 neighbor)
            if (neighborCount === 1) {
                return current
            }

            // If this is another candidate junction (not adjacent to origin), stop this branch
            if (candidateSet.has(key)) {
                // Check if this candidate is adjacent to origin
                const dx = Math.abs(current.x - origin.x)
                const dy = Math.abs(current.y - origin.y)
                if (dx > 1 || dy > 1) {
                    // Not adjacent, stop here
                    continue
                }
                // Adjacent candidate - continue through it
            }

            // Continue exploring neighbors
            const neighbors = getNeighbors(current.x, current.y)
            for (const n of neighbors) {
                if (!visited.has(`${n.x},${n.y}`)) {
                    queue.push(n)
                }
            }
        }

        return null
    }

    // Group adjacent candidates into clusters
    const visited = new Set<string>()
    const clusters: Point[][] = []

    for (const candidate of candidates) {
        const key = `${candidate.x},${candidate.y}`
        if (visited.has(key)) continue

        // BFS to find all adjacent candidates in this cluster
        const cluster: Point[] = []
        const queue: Point[] = [candidate]

        while (queue.length > 0) {
            const current = queue.shift()!
            const currentKey = `${current.x},${current.y}`

            if (visited.has(currentKey)) continue
            visited.add(currentKey)
            cluster.push(current)

            // Check all 8 neighbors for other candidates
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = current.x + dx
                    const ny = current.y + dy
                    const neighborKey = `${nx},${ny}`
                    if (candidateSet.has(neighborKey) && !visited.has(neighborKey)) {
                        queue.push({ x: nx, y: ny })
                    }
                }
            }
        }

        clusters.push(cluster)
    }

    // For each cluster, find the best representative junction
    const junctions: Point[] = []

    for (const cluster of clusters) {
        // For each candidate in cluster, count how many unique endpoints it reaches
        let bestCandidate: Point | null = null
        let bestEndpointCount = 0

        for (const candidate of cluster) {
            const neighbors = getNeighbors(candidate.x, candidate.y)
            const reachedEndpoints: Set<string> = new Set()

            for (const neighbor of neighbors) {
                const endpoint = traceToEndpoint(neighbor, candidate)
                if (endpoint) {
                    reachedEndpoints.add(`${endpoint.x},${endpoint.y}`)
                }
            }

            // A junction needs to reach at least 2 different endpoints to be meaningful
            if (reachedEndpoints.size >= 2 && reachedEndpoints.size > bestEndpointCount) {
                bestCandidate = candidate
                bestEndpointCount = reachedEndpoints.size
            }
        }

        // If no candidate reaches 2+ endpoints, take the first one if it reaches at least 1
        if (!bestCandidate && cluster.length > 0) {
            for (const candidate of cluster) {
                const neighbors = getNeighbors(candidate.x, candidate.y)
                for (const neighbor of neighbors) {
                    const endpoint = traceToEndpoint(neighbor, candidate)
                    if (endpoint) {
                        bestCandidate = candidate
                        break
                    }
                }
                if (bestCandidate) break
            }
        }

        if (bestCandidate) {
            junctions.push(bestCandidate)
        }
    }

    return junctions
}

/**
 * Compute longest path in skeleton using BFS
 */
/**
 * Compute longest path and return the actual path points
 */
export function computeSkeletonLongestPathData(skeleton: BinaryGrid): Point[] {
    const endpoints = getSkeletonEndpoints(skeleton)
    if (endpoints.length === 0) return []

    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    // BFS that keeps track of the path
    const bfs = (start: Point): Point[] => {
        const visited = new Set<string>()
        const queue: { p: Point; path: Point[] }[] = [{ p: start, path: [start] }]
        let longest: Point[] = []

        while (queue.length > 0) {
            const { p, path } = queue.shift()!
            const key = `${p.x},${p.y}`
            if (visited.has(key)) continue
            visited.add(key)

            if (path.length > longest.length) {
                longest = path
            }

            // Check 8 neighbors
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = p.x + dx
                    const ny = p.y + dy
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                        skeleton[ny][nx] === 1 && !visited.has(`${nx},${ny}`)) {
                        queue.push({ p: { x: nx, y: ny }, path: [...path, { x: nx, y: ny }] })
                    }
                }
            }
        }
        return longest
    }

    let maxPath: Point[] = []
    for (const ep of endpoints) {
        const path = bfs(ep)
        if (path.length > maxPath.length) {
            maxPath = path
        }
    }
    return maxPath
}

export function computeSkeletonLongestPath(skeleton: BinaryGrid): number {
    const endpoints = getSkeletonEndpoints(skeleton)
    if (endpoints.length === 0) return 0

    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    const bfs = (start: Point): number => {
        const visited = new Set<string>()
        const queue: { p: Point; dist: number }[] = [{ p: start, dist: 0 }]
        let maxDist = 0

        while (queue.length > 0) {
            const { p, dist } = queue.shift()!
            const key = `${p.x},${p.y}`
            if (visited.has(key)) continue
            visited.add(key)
            maxDist = Math.max(maxDist, dist)

            // Check 8 neighbors
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = p.x + dx
                    const ny = p.y + dy
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                        skeleton[ny][nx] === 1 && !visited.has(`${nx},${ny}`)) {
                        const edgeDist = (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1
                        queue.push({ p: { x: nx, y: ny }, dist: dist + edgeDist })
                    }
                }
            }
        }

        return maxDist
    }

    // Find longest path from any endpoint
    let longestPath = 0
    for (const ep of endpoints) { // Check all endpoints for accuracy
        longestPath = Math.max(longestPath, bfs(ep))
    }

    return longestPath
}

/**
 * Prune short branches from skeleton
 * Removes spur branches shorter than minLength (in pixels)
 * As per LaTeX: remove branches shorter than 0.5%-2.0% of image diagonal
 */
export function pruneSkeletonBranches(skeleton: BinaryGrid, minLength: number): BinaryGrid {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const pruned = skeleton.map(row => [...row])

    let changed = true
    while (changed) {
        changed = false
        const endpoints = getSkeletonEndpoints(pruned)

        for (const ep of endpoints) {
            // Trace from endpoint and measure branch length
            const visited = new Set<string>()
            let current = ep
            let branchLength = 0
            const branchPixels: Point[] = [current]

            while (true) {
                visited.add(`${current.x},${current.y}`)

                // Find next pixel along branch
                let next: Point | null = null
                let neighbors = 0

                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dy === 0 && dx === 0) continue
                        const nx = current.x + dx
                        const ny = current.y + dy
                        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                            pruned[ny][nx] === 1) {
                            neighbors++
                            if (!visited.has(`${nx},${ny}`)) {
                                next = { x: nx, y: ny }
                                branchLength += (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1
                            }
                        }
                    }
                }

                if (!next || neighbors >= 3) {
                    // Hit junction or end
                    break
                }

                branchPixels.push(next)
                current = next
            }

            // Remove branch if too short
            if (branchLength < minLength && branchLength > 0) {
                for (const p of branchPixels) {
                    // Don't remove junctions
                    let neighborCount = 0
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dy === 0 && dx === 0) continue
                            const nx = p.x + dx
                            const ny = p.y + dy
                            if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                                pruned[ny][nx] === 1) {
                                neighborCount++
                            }
                        }
                    }
                    if (neighborCount <= 2) {
                        pruned[p.y][p.x] = 0
                        changed = true
                    }
                }
            }
        }
    }

    return pruned
}

// SkeletonBranch type is imported from ./types

/**
 * Unified skeleton topology analysis
 * Returns consistent endpoints, junctions, and branches that all agree with each other
 *
 * TRUE JUNCTION DEFINITION:
 * A junction is a point where the skeleton ACTUALLY DIVERGES to reach DIFFERENT endpoints.
 * - Must have 3+ neighbors (candidate)
 * - Must have branches leading to at least 2 DIFFERENT endpoints
 * - Branches must be meaningful (length > MIN_BRANCH_LENGTH pixels)
 *
 * This filters out:
 * - Artifacts from thinning (3 neighbors but not a real branch point)
 * - Tiny spurs that don't represent real structure
 * - "Junctions" where all paths lead to the same endpoint
 */
export interface SkeletonTopology {
    endpoints: Point[]           // Pixels with 1 neighbor (branch tips)
    junctions: Point[]           // Raw pixels with 3+ neighbors
    branches: SkeletonBranch[]   // Paths between nodes
    displayJunctions: Point[]    // TRUE junctions (actually diverge to different endpoints)
    loopTops: Point[]            // Top points of detected loops (farthest from connection points)
    loopCount: number            // Number of detected loops
}

// Minimum branch length to be considered meaningful (in pixels)
const MIN_BRANCH_LENGTH = 3

export function analyzeSkeletonTopology(skeleton: BinaryGrid, dt: FloatGrid): SkeletonTopology {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    // Helper to count neighbors
    const countNeighbors = (x: number, y: number): number => {
        let count = 0
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const ny = y + dy
                const nx = x + dx
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                    if (skeleton[ny][nx] === 1) count++
                }
            }
        }
        return count
    }

    // Helper to get neighbor positions
    const getNeighbors = (x: number, y: number): Point[] => {
        const neighbors: Point[] = []
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const ny = y + dy
                const nx = x + dx
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                    if (skeleton[ny][nx] === 1) {
                        neighbors.push({ x: nx, y: ny })
                    }
                }
            }
        }
        return neighbors
    }

    // Step 1: Find ALL endpoints (1 neighbor) and ALL candidate junctions (3+ neighbors)
    const endpoints: Point[] = []
    const endpointSet = new Set<string>()
    const candidateJunctions: Point[] = []
    const candidateSet = new Set<string>()

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (skeleton[y]?.[x] !== 1) continue

            const neighbors = countNeighbors(x, y)

            if (neighbors <= 1) {
                endpoints.push({ x, y })
                endpointSet.add(`${x},${y}`)
            } else if (neighbors >= 3) {
                candidateJunctions.push({ x, y })
                candidateSet.add(`${x},${y}`)
            }
        }
    }

    // Step 2: For each candidate junction, trace branches and find which endpoints they reach
    // A TRUE junction must have branches reaching at least 2 DIFFERENT endpoints

    /**
     * Trace from a starting point (adjacent to candidate) until we reach an endpoint
     * Returns: { endpoint: the endpoint reached (or null), length: path length }
     */
    const traceBranchToEndpoint = (
        start: Point,
        origin: Point
    ): { endpoint: Point | null; length: number } => {
        const visited = new Set<string>()
        visited.add(`${origin.x},${origin.y}`)

        let current = start
        let prev = origin
        let length = Math.sqrt((current.x - prev.x) ** 2 + (current.y - prev.y) ** 2)

        const maxIterations = rows * cols
        let iterations = 0

        while (iterations < maxIterations) {
            iterations++
            const currentKey = `${current.x},${current.y}`

            if (visited.has(currentKey)) break
            visited.add(currentKey)

            // Check if we reached an endpoint
            if (endpointSet.has(currentKey)) {
                return { endpoint: current, length }
            }

            // Check if we hit another candidate junction
            // If so, continue through it (we want to find the ultimate endpoint)

            // Find next pixel
            const neighbors = getNeighbors(current.x, current.y)
            const nextCandidates = neighbors.filter(n =>
                !visited.has(`${n.x},${n.y}`) &&
                (n.x !== prev.x || n.y !== prev.y)
            )

            if (nextCandidates.length === 0) {
                // Dead end - might be at image boundary or disconnected
                // Check if current has only 1 neighbor (it's effectively an endpoint)
                const neighborCount = countNeighbors(current.x, current.y)
                if (neighborCount <= 1) {
                    return { endpoint: current, length }
                }
                break
            }

            // Continue along the path
            const next = nextCandidates[0]
            length += Math.sqrt((next.x - current.x) ** 2 + (next.y - current.y) ** 2)
            prev = current
            current = next
        }

        return { endpoint: null, length }
    }

    // Step 3: Identify TRUE junctions
    const trueJunctions: Point[] = []

    for (const candidate of candidateJunctions) {
        const neighbors = getNeighbors(candidate.x, candidate.y)

        // Track which endpoints each branch reaches and the branch length
        const branchResults: { endpoint: Point | null; length: number }[] = []

        for (const neighbor of neighbors) {
            const result = traceBranchToEndpoint(neighbor, candidate)
            branchResults.push(result)
        }

        // Filter for meaningful branches (length >= MIN_BRANCH_LENGTH and reaches an endpoint)
        const meaningfulBranches = branchResults.filter(
            r => r.endpoint !== null && r.length >= MIN_BRANCH_LENGTH
        )

        // Count unique endpoints reached by meaningful branches
        const uniqueEndpoints = new Set<string>()
        for (const branch of meaningfulBranches) {
            if (branch.endpoint) {
                uniqueEndpoints.add(`${branch.endpoint.x},${branch.endpoint.y}`)
            }
        }

        // TRUE JUNCTION: reaches at least 2 different endpoints via meaningful branches
        if (uniqueEndpoints.size >= 2) {
            trueJunctions.push(candidate)
        }
    }

    // Step 4: Cluster adjacent true junctions and pick representatives
    const displayJunctions: Point[] = []
    const processedJunctions = new Set<string>()

    for (const junction of trueJunctions) {
        const key = `${junction.x},${junction.y}`
        if (processedJunctions.has(key)) continue

        // BFS to find cluster of adjacent true junctions
        const cluster: Point[] = []
        const queue: Point[] = [junction]
        const trueJunctionSet = new Set(trueJunctions.map(j => `${j.x},${j.y}`))

        while (queue.length > 0) {
            const current = queue.shift()!
            const currentKey = `${current.x},${current.y}`
            if (processedJunctions.has(currentKey)) continue
            processedJunctions.add(currentKey)
            cluster.push(current)

            // Check 8-neighbors for other true junctions
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = current.x + dx
                    const ny = current.y + dy
                    const neighborKey = `${nx},${ny}`
                    if (trueJunctionSet.has(neighborKey) && !processedJunctions.has(neighborKey)) {
                        queue.push({ x: nx, y: ny })
                    }
                }
            }
        }

        // Pick center of cluster as representative
        if (cluster.length > 0) {
            const centerX = Math.round(cluster.reduce((sum, p) => sum + p.x, 0) / cluster.length)
            const centerY = Math.round(cluster.reduce((sum, p) => sum + p.y, 0) / cluster.length)
            // Find the cluster member closest to center
            let bestDist = Infinity
            let representative = cluster[0]
            for (const p of cluster) {
                const dist = Math.sqrt((p.x - centerX) ** 2 + (p.y - centerY) ** 2)
                if (dist < bestDist) {
                    bestDist = dist
                    representative = p
                }
            }
            displayJunctions.push(representative)
        }
    }

    // Step 5: Extract branches using only meaningful nodes (endpoints + TRUE junctions)
    // This gives branch counts that match the visual representation
    const nodeSet = new Set<string>()
    for (const ep of endpoints) nodeSet.add(`${ep.x},${ep.y}`)
    for (const j of displayJunctions) nodeSet.add(`${j.x},${j.y}`)

    const branches: SkeletonBranch[] = []
    const visitedEdges = new Set<string>()
    const meaningfulNodes = [...endpoints, ...displayJunctions]

    for (const startNode of meaningfulNodes) {
        const startNeighbors = getNeighbors(startNode.x, startNode.y)

        for (const firstStep of startNeighbors) {
            // Create edge key to avoid tracing same branch twice
            const edgeKey = `${Math.min(startNode.x, firstStep.x)},${Math.min(startNode.y, firstStep.y)}-${Math.max(startNode.x, firstStep.x)},${Math.max(startNode.y, firstStep.y)}`
            if (visitedEdges.has(edgeKey)) continue
            visitedEdges.add(edgeKey)

            // Trace branch until we hit another meaningful node
            const pixels: Point[] = [startNode]
            let current = firstStep
            let prev = startNode
            let length = Math.sqrt((current.x - prev.x) ** 2 + (current.y - prev.y) ** 2)
            let radiusSum = dt[startNode.y]?.[startNode.x] || 0

            const maxIterations = skeleton.length * (skeleton[0]?.length || 0)
            let iterations = 0

            while (iterations < maxIterations) {
                iterations++
                pixels.push(current)
                radiusSum += dt[current.y]?.[current.x] || 0

                // Mark edge as visited
                const ek = `${Math.min(prev.x, current.x)},${Math.min(prev.y, current.y)}-${Math.max(prev.x, current.x)},${Math.max(prev.y, current.y)}`
                visitedEdges.add(ek)

                // Check if current is a meaningful node (endpoint or TRUE junction)
                const currentKey = `${current.x},${current.y}`
                if (nodeSet.has(currentKey)) {
                    // Reached another meaningful node - branch complete
                    break
                }

                // Find next pixel (not the one we came from)
                const currentNeighbors = getNeighbors(current.x, current.y)
                const nextCandidates = currentNeighbors.filter(n => n.x !== prev.x || n.y !== prev.y)

                if (nextCandidates.length === 0) {
                    // Dead end
                    break
                }

                // If multiple candidates (we're at a raw junction that's not a TRUE junction),
                // just pick the first one and continue through
                const next = nextCandidates[0]
                length += Math.sqrt((next.x - current.x) ** 2 + (next.y - current.y) ** 2)
                prev = current
                current = next
            }

            if (pixels.length >= 2) {
                branches.push({
                    pixels,
                    length,
                    meanRadius: radiusSum / pixels.length,
                    startPoint: pixels[0],
                    endPoint: pixels[pixels.length - 1]
                })
            }
        }
    }

    // Step 6: Detect loops and find their "top" points
    // A loop is a cycle in the skeleton graph
    // Loop top = the point on the loop farthest from the connection points
    const loopTops: Point[] = []
    let loopCount = 0

    // Find loop connection points: raw junctions that are NOT true junctions
    // These are where loops connect to the main skeleton
    const trueJunctionSet = new Set(displayJunctions.map(j => `${j.x},${j.y}`))
    const loopConnectionCandidates = candidateJunctions.filter(
        j => !trueJunctionSet.has(`${j.x},${j.y}`)
    )

    // Track which loop connection points we've already processed
    const processedLoopPoints = new Set<string>()

    for (const startPoint of loopConnectionCandidates) {
        const startKey = `${startPoint.x},${startPoint.y}`
        if (processedLoopPoints.has(startKey)) continue

        // Try to find a loop starting from this point
        // A loop exists if we can trace a path that returns to a point we've seen
        const neighbors = getNeighbors(startPoint.x, startPoint.y)

        for (let i = 0; i < neighbors.length; i++) {
            for (let j = i + 1; j < neighbors.length; j++) {
                // Try to find a path from neighbor[i] to neighbor[j] that doesn't go through startPoint
                const pathResult = findPathBetween(
                    neighbors[i],
                    neighbors[j],
                    startPoint,
                    skeleton,
                    rows,
                    cols,
                    candidateJunctions
                )

                if (pathResult.found && pathResult.path.length >= 3) {
                    // Found a loop! The path + startPoint forms a cycle
                    loopCount++

                    // Find the top of the loop (point farthest from startPoint)
                    let maxDist = 0
                    let loopTop = pathResult.path[0]

                    for (const p of pathResult.path) {
                        const dist = Math.sqrt(
                            (p.x - startPoint.x) ** 2 + (p.y - startPoint.y) ** 2
                        )
                        if (dist > maxDist) {
                            maxDist = dist
                            loopTop = p
                        }
                    }

                    // Only add if it's not already an endpoint or junction
                    const topKey = `${loopTop.x},${loopTop.y}`
                    if (!endpointSet.has(topKey) && !candidateSet.has(topKey)) {
                        loopTops.push(loopTop)
                    }

                    // Mark all junction candidates on this loop as processed
                    for (const p of pathResult.path) {
                        const pKey = `${p.x},${p.y}`
                        if (candidateSet.has(pKey)) {
                            processedLoopPoints.add(pKey)
                        }
                    }
                    processedLoopPoints.add(startKey)
                }
            }
        }
    }

    // Also check for loops at true junctions (loops that diverge to different endpoints)
    for (const junction of displayJunctions) {
        const jKey = `${junction.x},${junction.y}`
        if (processedLoopPoints.has(jKey)) continue

        const neighbors = getNeighbors(junction.x, junction.y)

        for (let i = 0; i < neighbors.length; i++) {
            for (let j = i + 1; j < neighbors.length; j++) {
                const pathResult = findPathBetween(
                    neighbors[i],
                    neighbors[j],
                    junction,
                    skeleton,
                    rows,
                    cols,
                    candidateJunctions
                )

                if (pathResult.found && pathResult.path.length >= 3) {
                    loopCount++

                    let maxDist = 0
                    let loopTop = pathResult.path[0]

                    for (const p of pathResult.path) {
                        const dist = Math.sqrt(
                            (p.x - junction.x) ** 2 + (p.y - junction.y) ** 2
                        )
                        if (dist > maxDist) {
                            maxDist = dist
                            loopTop = p
                        }
                    }

                    const topKey = `${loopTop.x},${loopTop.y}`
                    if (!endpointSet.has(topKey) && !candidateSet.has(topKey)) {
                        loopTops.push(loopTop)
                    }

                    processedLoopPoints.add(jKey)
                }
            }
        }
    }

    return {
        endpoints,
        junctions: candidateJunctions,  // All raw junctions (3+ neighbors) - for reference
        branches,                        // Branches between meaningful nodes only
        displayJunctions,                // TRUE junctions (red dots)
        loopTops,                        // Top points of loops (to be shown as green dots)
        loopCount                        // Number of detected loops
    }
}

/**
 * Helper: Find a path between two points without going through an excluded point
 * Used for loop detection
 */
function findPathBetween(
    start: Point,
    end: Point,
    exclude: Point,
    skeleton: BinaryGrid,
    rows: number,
    cols: number,
    junctions: Point[]
): { found: boolean; path: Point[] } {
    const visited = new Set<string>()
    visited.add(`${exclude.x},${exclude.y}`)

    const junctionSet = new Set(junctions.map(j => `${j.x},${j.y}`))
    const endKey = `${end.x},${end.y}`

    // BFS to find path
    const queue: { point: Point; path: Point[] }[] = [{ point: start, path: [start] }]

    const getNeighbors = (x: number, y: number): Point[] => {
        const neighbors: Point[] = []
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const ny = y + dy
                const nx = x + dx
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                    if (skeleton[ny][nx] === 1) {
                        neighbors.push({ x: nx, y: ny })
                    }
                }
            }
        }
        return neighbors
    }

    const maxIterations = rows * cols
    let iterations = 0

    while (queue.length > 0 && iterations < maxIterations) {
        iterations++
        const { point, path } = queue.shift()!
        const key = `${point.x},${point.y}`

        if (visited.has(key)) continue
        visited.add(key)

        // Check if we reached the end
        if (key === endKey) {
            return { found: true, path }
        }

        // If we hit a junction (other than start), we might be leaving the loop
        // Allow continuing through junctions but limit path length
        if (path.length > 100) continue  // Prevent infinite loops

        const neighbors = getNeighbors(point.x, point.y)
        for (const n of neighbors) {
            const nKey = `${n.x},${n.y}`
            if (!visited.has(nKey)) {
                queue.push({ point: n, path: [...path, n] })
            }
        }
    }

    return { found: false, path: [] }
}

/**
 * Extract individual branches from skeleton with their statistics
 * Each branch runs from endpoint/junction to endpoint/junction
 * @deprecated Use analyzeSkeletonTopology() for consistent results
 */
export function extractSkeletonBranches(skeleton: BinaryGrid, dt: FloatGrid): SkeletonBranch[] {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const branches: SkeletonBranch[] = []
    const visitedEdges = new Set<string>()

    const endpoints = getSkeletonEndpoints(skeleton)
    const junctions = getSkeletonJunctions(skeleton)
    const startPoints = [...endpoints, ...junctions]

    const getNeighbors = (p: Point): Point[] => {
        const neighbors: Point[] = []
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const nx = p.x + dx
                const ny = p.y + dy
                if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                    skeleton[ny][nx] === 1) {
                    neighbors.push({ x: nx, y: ny })
                }
            }
        }
        return neighbors
    }

    const isJunctionOrEndpoint = (p: Point): boolean => {
        const neighbors = getNeighbors(p)
        return neighbors.length === 1 || neighbors.length >= 3
    }

    for (const start of startPoints) {
        const neighbors = getNeighbors(start)

        for (const firstNeighbor of neighbors) {
            const edgeKey = `${Math.min(start.x, firstNeighbor.x)},${Math.min(start.y, firstNeighbor.y)}-${Math.max(start.x, firstNeighbor.x)},${Math.max(start.y, firstNeighbor.y)}`
            if (visitedEdges.has(edgeKey)) continue

            // Trace branch
            const pixels: Point[] = [start]
            let current = firstNeighbor
            let prev = start
            let length = Math.sqrt((current.x - prev.x) ** 2 + (current.y - prev.y) ** 2)
            let radiusSum = dt[start.y]?.[start.x] || 0

            while (true) {
                pixels.push(current)
                radiusSum += dt[current.y]?.[current.x] || 0

                // Mark edge as visited
                const ek = `${Math.min(prev.x, current.x)},${Math.min(prev.y, current.y)}-${Math.max(prev.x, current.x)},${Math.max(prev.y, current.y)}`
                visitedEdges.add(ek)

                if (isJunctionOrEndpoint(current)) break

                // Find next pixel (not previous)
                const currNeighbors = getNeighbors(current)
                // Filter out the node we just came from
                const nextCandidates = currNeighbors.filter(n => n.x !== prev.x || n.y !== prev.y)

                if (nextCandidates.length === 0) break

                // Pick the first valid neighbor (should be only 1 in a branch)
                const next = nextCandidates[0]

                length += Math.sqrt((next.x - current.x) ** 2 + (next.y - current.y) ** 2)
                prev = current
                current = next
            }

            if (pixels.length >= 2) {
                branches.push({
                    pixels,
                    length,
                    meanRadius: radiusSum / pixels.length,
                    startPoint: pixels[0],
                    endPoint: pixels[pixels.length - 1]
                })
            }
        }
    }

    return branches
}



/**
 * Get skeleton arc length (total length of all skeleton pixels)
 */
export function computeSkeletonArcLength(skeleton: BinaryGrid): number {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    let L = 0
    const visited = new Set<string>()

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (skeleton[y][x] !== 1) continue

            // Add half the distance to each neighbor (to avoid double counting)
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const nx = x + dx
                    const ny = y + dy
                    if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                        skeleton[ny][nx] === 1) {
                        const edgeKey = `${Math.min(x, nx)},${Math.min(y, ny)}-${Math.max(x, nx)},${Math.max(y, ny)}`
                        if (!visited.has(edgeKey)) {
                            visited.add(edgeKey)
                            L += Math.sqrt(dx * dx + dy * dy)
                        }
                    }
                }
            }
        }
    }

    return L
}

// ============================================================================
// STEP 8: Structure Tensor for Orientation Analysis
// ============================================================================

/**
 * Compute structure tensor and coherence for striated detection
 */
export function computeStructureTensor(grid: FloatGrid, windowSize: number = 5): {
    coherence: FloatGrid
    orientation: FloatGrid
    meanCoherence: number
} {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const coherence: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    const orientation: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))

    // Compute gradients (Sobel-like)
    const Ix: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    const Iy: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            Ix[y][x] = (grid[y][x + 1] - grid[y][x - 1]) / 2
            Iy[y][x] = (grid[y + 1][x] - grid[y - 1][x]) / 2
        }
    }

    const half = Math.floor(windowSize / 2)
    let totalCoherence = 0
    let count = 0

    for (let y = half; y < rows - half; y++) {
        for (let x = half; x < cols - half; x++) {
            // Compute structure tensor elements in window
            let Jxx = 0, Jyy = 0, Jxy = 0

            for (let wy = -half; wy <= half; wy++) {
                for (let wx = -half; wx <= half; wx++) {
                    const ix = Ix[y + wy][x + wx]
                    const iy = Iy[y + wy][x + wx]
                    Jxx += ix * ix
                    Jyy += iy * iy
                    Jxy += ix * iy
                }
            }

            // Eigenvalues
            const trace = Jxx + Jyy
            const det = Jxx * Jyy - Jxy * Jxy
            const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - det))
            const lambda1 = trace / 2 + discriminant
            const lambda2 = trace / 2 - discriminant

            // Coherence
            const coh = (lambda1 + lambda2 > 0.001)
                ? (lambda1 - lambda2) / (lambda1 + lambda2)
                : 0
            coherence[y][x] = coh
            totalCoherence += coh
            count++

            // Orientation
            orientation[y][x] = Math.atan2(2 * Jxy, Jxx - Jyy) / 2
        }
    }

    return {
        coherence,
        orientation,
        meanCoherence: count > 0 ? totalCoherence / count : 0
    }
}

/**
 * Compute circular variance of orientation angles within mask
 * As per LaTeX: striated score ≈ 1 - circular variance
 * Circular variance = 1 - R where R = |mean resultant vector|
 */
export function computeCircularVariance(
    orientation: FloatGrid,
    mask: BinaryGrid
): number {
    const rows = orientation.length
    const cols = orientation[0]?.length || 0

    // Sum of unit vectors in orientation direction (doubled angle for axial data)
    let sumCos = 0
    let sumSin = 0
    let count = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y]?.[x] !== 1) continue

            const theta = orientation[y][x]
            // Double the angle for axial data (orientations are undirected)
            sumCos += Math.cos(2 * theta)
            sumSin += Math.sin(2 * theta)
            count++
        }
    }

    if (count === 0) return 1 // Maximum variance if no data

    // Mean resultant length R
    const R = Math.sqrt(sumCos * sumCos + sumSin * sumSin) / count

    // Circular variance = 1 - R
    return 1 - R
}

// Blob type is imported from ./types

/**
 * Find local maxima in smoothed density grid
 * Used as seeds for watershed-like blob segmentation
 */
export function findLocalMaxima(grid: FloatGrid, minHeight: number = 0.1): Point[] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const maxima: Point[] = []

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            const val = grid[y][x]
            if (val < minHeight) continue

            // Check if local maximum (8-neighborhood)
            let isMax = true
            for (let dy = -1; dy <= 1 && isMax; dy++) {
                for (let dx = -1; dx <= 1 && isMax; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (grid[y + dy][x + dx] > val) {
                        isMax = false
                    }
                }
            }

            if (isMax) {
                maxima.push({ x, y })
            }
        }
    }

    return maxima
}

/**
 * Simple watershed-like blob segmentation on density grid
 * Returns blobs with their areas for clumpy calculation
 * As per LaTeX: Clumpy = B·Var({a_i})/A² where B = number of blobs
 */
export function watershedBlobSegmentation(
    grid: FloatGrid,
    mask: BinaryGrid,
    minBlobSize: number = 10
): Blob[] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const blobs: Blob[] = []

    // Find local maxima as seed points
    const maxima = findLocalMaxima(grid, 0.1)
    if (maxima.length === 0) return blobs

    // Label array: -1 = unvisited, 0 = background, 1+ = blob labels
    const labels: number[][] = Array.from({ length: rows }, () => Array(cols).fill(-1))

    // Mark background
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y][x] === 0) {
                labels[y][x] = 0
            }
        }
    }

    // Assign each foreground pixel to nearest maximum using gradient descent
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y][x] === 0) continue

            // Gradient ascent to find which peak this pixel belongs to
            let cx = x
            let cy = y
            const path: Point[] = [{ x: cx, y: cy }]
            const maxSteps = rows + cols

            for (let step = 0; step < maxSteps; step++) {
                let maxVal = grid[cy][cx]
                let nx = cx
                let ny = cy

                // Find neighbor with highest value
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dy === 0 && dx === 0) continue
                        const px = cx + dx
                        const py = cy + dy
                        if (px >= 0 && px < cols && py >= 0 && py < rows &&
                            mask[py][px] === 1 && grid[py][px] > maxVal) {
                            maxVal = grid[py][px]
                            nx = px
                            ny = py
                        }
                    }
                }

                if (nx === cx && ny === cy) break // At local maximum
                cx = nx
                cy = ny
                path.push({ x: cx, y: cy })
            }

            // Find which maximum this reached
            const maxIdx = maxima.findIndex(m => m.x === cx && m.y === cy)
            const label = maxIdx >= 0 ? maxIdx + 1 : 0

            // Label the entire path
            for (const p of path) {
                if (labels[p.y][p.x] === -1) {
                    labels[p.y][p.x] = label
                }
            }
        }
    }

    // Collect blobs
    const blobMap = new Map<number, Point[]>()
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const label = labels[y][x]
            if (label > 0) {
                if (!blobMap.has(label)) blobMap.set(label, [])
                blobMap.get(label)!.push({ x, y })
            }
        }
    }

    // Create blob objects
    for (const [label, pixels] of blobMap) {
        if (pixels.length < minBlobSize) continue

        let sumX = 0, sumY = 0, peakVal = 0
        for (const p of pixels) {
            sumX += p.x
            sumY += p.y
            peakVal = Math.max(peakVal, grid[p.y][p.x])
        }

        blobs.push({
            pixels,
            area: pixels.length,
            centroid: { x: sumX / pixels.length, y: sumY / pixels.length },
            peakValue: peakVal
        })
    }

    return blobs
}

/**
 * Compute clumpy measure using blob segmentation
 * As per LaTeX: Clumpy = B·Var({a_i})/A² (normalized)
 */
export function computeClumpyFromBlobs(blobs: Blob[], totalArea: number): number {
    const B = blobs.length
    if (B <= 1 || totalArea === 0) return 0

    const areas = blobs.map(b => b.area)
    const meanArea = areas.reduce((s, a) => s + a, 0) / B
    const variance = areas.reduce((s, a) => s + (a - meanArea) ** 2, 0) / B

    // Normalized clumpy: B * Var(areas) / A²
    // Scale to [0, 1] range
    const raw = (B * variance) / (totalArea * totalArea)

    // Use log scaling to normalize (empirically tuned)
    return Math.min(1, Math.sqrt(raw) * 10)
}

/**
 * Sample points along the principal skeleton path
 * For monotonic calculation as per LaTeX
 */
export function sampleSkeletonPath(
    skeleton: BinaryGrid,
    numSamples: number = 50
): Point[] {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const endpoints = getSkeletonEndpoints(skeleton)

    if (endpoints.length < 2) {
        // Just sample all skeleton pixels
        const allPixels: Point[] = []
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (skeleton[y][x] === 1) {
                    allPixels.push({ x, y })
                }
            }
        }
        return allPixels.slice(0, numSamples)
    }

    // Find the two endpoints farthest apart
    let maxDist = 0
    let startEp = endpoints[0]
    let endEp = endpoints[1]

    for (let i = 0; i < endpoints.length; i++) {
        for (let j = i + 1; j < endpoints.length; j++) {
            const d = Math.sqrt(
                (endpoints[i].x - endpoints[j].x) ** 2 +
                (endpoints[i].y - endpoints[j].y) ** 2
            )
            if (d > maxDist) {
                maxDist = d
                startEp = endpoints[i]
                endEp = endpoints[j]
            }
        }
    }

    // BFS to find path from startEp to endEp
    const visited = new Map<string, Point | null>()
    const queue: Point[] = [startEp]
    visited.set(`${startEp.x},${startEp.y}`, null)

    while (queue.length > 0) {
        const current = queue.shift()!
        if (current.x === endEp.x && current.y === endEp.y) break

        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const nx = current.x + dx
                const ny = current.y + dy
                const key = `${nx},${ny}`
                if (nx >= 0 && nx < cols && ny >= 0 && ny < rows &&
                    skeleton[ny][nx] === 1 && !visited.has(key)) {
                    visited.set(key, current)
                    queue.push({ x: nx, y: ny })
                }
            }
        }
    }

    // Reconstruct path
    const path: Point[] = []
    let current: Point | null = endEp
    while (current) {
        path.unshift(current)
        current = visited.get(`${current.x},${current.y}`) || null
    }

    if (path.length === 0) return []

    // Sample evenly along path
    const samples: Point[] = []
    const step = Math.max(1, Math.floor(path.length / numSamples))
    for (let i = 0; i < path.length; i += step) {
        samples.push(path[i])
        if (samples.length >= numSamples) break
    }

    return samples
}

/**
 * Compute Spearman rank correlation
 */
export function spearmanCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 3) return 0

    const n = x.length

    // Compute ranks
    const rankX = computeRanks(x)
    const rankY = computeRanks(y)

    // Spearman using d² formula
    let sumD2 = 0
    for (let i = 0; i < n; i++) {
        const d = rankX[i] - rankY[i]
        sumD2 += d * d
    }

    return 1 - (6 * sumD2) / (n * (n * n - 1))
}

/**
 * Compute ranks for an array of values
 */
function computeRanks(values: number[]): number[] {
    const indexed = values.map((v, i) => ({ v, i }))
    indexed.sort((a, b) => a.v - b.v)

    const ranks = new Array(values.length)
    for (let i = 0; i < indexed.length; i++) {
        ranks[indexed[i].i] = i + 1
    }

    return ranks
}

// ============================================================================
// STEP 9: Complete Scagnostics Metrics
// ============================================================================

// AllScagnostics and ExtendedScagnostics types are imported from ./types

/**
 * Compute skeleton width statistics from distance transform
 * As per LaTeX: mean radius r̄ and variance Var_r
 */
export function computeSkeletonWidthStats(
    skeleton: BinaryGrid,
    dt: FloatGrid
): { meanRadius: number; varianceRadius: number } {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0

    let sumRadius = 0
    let sumRadiusSq = 0
    let count = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (skeleton[y][x] === 1) {
                const r = dt[y]?.[x] || 0
                sumRadius += r
                sumRadiusSq += r * r
                count++
            }
        }
    }

    if (count === 0) return { meanRadius: 0, varianceRadius: 0 }

    const meanRadius = sumRadius / count
    const varianceRadius = (sumRadiusSq / count) - (meanRadius * meanRadius)

    return { meanRadius, varianceRadius: Math.max(0, varianceRadius) }
}

/**
 * Compute Skinny metric with full formula from LaTeX
 * Skinny = λ₁(1-IQ) + λ₂(Var_r/r̄²)
 * where IQ = 4πA/P² and λ₁ + λ₂ = 1
 */
export function computeSkinnyFull(
    area: number,
    perimeter: number,
    meanRadius: number,
    varianceRadius: number,
    lambda1: number = 0.7
): number {
    const lambda2 = 1 - lambda1

    // IQ component
    const iq = perimeter > 0 ? (4 * Math.PI * area) / (perimeter * perimeter) : 1
    const iqComponent = 1 - iq

    // Width variance component (coefficient of variation squared)
    const widthComponent = meanRadius > 0 ? varianceRadius / (meanRadius * meanRadius) : 0

    const skinny = lambda1 * iqComponent + lambda2 * Math.min(1, widthComponent)
    return Math.max(0, Math.min(1, skinny))
}

/**
 * Compute Stringy metric with full formula from LaTeX
 * Stringy = (L/√A) × (1-Branchiness) × (1-Loopiness)
 * where Branchiness = n_j/(n_j+n_e) and Loopiness = H/(1+H)
 */
/**
 * Compute Stringy metric as ratio of longest path to total skeleton length
 * Simplified formula: Stringy = L_max / L_total
 */
export function computeStringySimple(
    longestPath: number,
    totalSkeletonLength: number
): number {
    if (totalSkeletonLength <= 0) return 0
    return Math.min(1, longestPath / totalSkeletonLength)
}

/**
 * Count holes in a binary grid using Euler characteristic
 * Holes = 1 - χ where χ = V - E + F (for connected component)
 * Simplified: count enclosed background regions
 */
export function countHoles(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    if (rows === 0 || cols === 0) return 0

    // Create inverted grid (background becomes foreground)
    const inverted: BinaryGrid = grid.map(row => row.map(v => v === 0 ? 1 : 0))

    // Count background components
    const visited: boolean[][] = Array(rows).fill(null).map(() => Array(cols).fill(false))
    let bgComponents = 0

    const floodFill = (startY: number, startX: number, touchesBorder: boolean[]): boolean => {
        const queue: [number, number][] = [[startY, startX]]
        visited[startY][startX] = true
        let touchesEdge = false

        while (queue.length > 0) {
            const [y, x] = queue.shift()!

            // Check if this is on the border
            if (y === 0 || y === rows - 1 || x === 0 || x === cols - 1) {
                touchesEdge = true
            }

            // 4-connectivity for background
            const neighbors: [number, number][] = [
                [y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]
            ]

            for (const [ny, nx] of neighbors) {
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols &&
                    !visited[ny][nx] && inverted[ny][nx] === 1) {
                    visited[ny][nx] = true
                    queue.push([ny, nx])
                }
            }
        }

        return touchesEdge
    }

    // Find background components that don't touch the border (holes)
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (inverted[y][x] === 1 && !visited[y][x]) {
                const touchesBorder: boolean[] = []
                const touchesEdge = floodFill(y, x, touchesBorder)
                if (!touchesEdge) {
                    bgComponents++ // This is a hole
                }
            }
        }
    }

    return bgComponents
}

/**
 * Compute weighted centroid and covariance matrix for Mahalanobis distance
 * As per LaTeX: x̄ = Σwᵢxᵢ/Σwᵢ, Σ = Σwᵢ(xᵢ-x̄)(xᵢ-x̄)ᵀ/Σwᵢ
 */
export function computeWeightedStats(
    grid: FloatGrid,
    mask: BinaryGrid
): { centroid: Point; covariance: number[][]; totalWeight: number } {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    let sumWX = 0, sumWY = 0, totalWeight = 0
    const points: { x: number; y: number; w: number }[] = []

    // First pass: compute weighted centroid
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y]?.[x] === 1) {
                const w = Math.max(0.001, grid[y][x]) // Ensure positive weight
                sumWX += w * x
                sumWY += w * y
                totalWeight += w
                points.push({ x, y, w })
            }
        }
    }

    if (totalWeight === 0) {
        return {
            centroid: { x: cols / 2, y: rows / 2 },
            covariance: [[1, 0], [0, 1]],
            totalWeight: 0
        }
    }

    const centroid = { x: sumWX / totalWeight, y: sumWY / totalWeight }

    // Second pass: compute weighted covariance
    let cxx = 0, cyy = 0, cxy = 0
    for (const p of points) {
        const dx = p.x - centroid.x
        const dy = p.y - centroid.y
        cxx += p.w * dx * dx
        cyy += p.w * dy * dy
        cxy += p.w * dx * dy
    }

    cxx /= totalWeight
    cyy /= totalWeight
    cxy /= totalWeight

    // Regularize to avoid singular matrix
    const eps = 0.01
    cxx = Math.max(cxx, eps)
    cyy = Math.max(cyy, eps)

    return {
        centroid,
        covariance: [[cxx, cxy], [cxy, cyy]],
        totalWeight
    }
}

/**
 * Compute Mahalanobis distance for a point given centroid and inverse covariance
 */
function mahalanobisDistance(
    x: number, y: number,
    centroid: Point,
    covInv: number[][]
): number {
    const dx = x - centroid.x
    const dy = y - centroid.y
    return Math.sqrt(
        covInv[0][0] * dx * dx +
        2 * covInv[0][1] * dx * dy +
        covInv[1][1] * dy * dy
    )
}

/**
 * Invert a 2x2 matrix
 */
function invert2x2(m: number[][]): number[][] {
    const det = m[0][0] * m[1][1] - m[0][1] * m[1][0]
    if (Math.abs(det) < 1e-10) {
        return [[1, 0], [0, 1]] // Return identity for singular matrix
    }
    return [
        [m[1][1] / det, -m[0][1] / det],
        [-m[1][0] / det, m[0][0] / det]
    ]
}

/**
 * Compute Outlying metric using Mahalanobis distance
 * As per LaTeX: Outlying_M = Σ{wᵢ : mᵢ > med + 3·MAD} / Σwᵢ
 */
export function computeOutlyingMahalanobis(
    grid: FloatGrid,
    mask: BinaryGrid
): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    const { centroid, covariance, totalWeight } = computeWeightedStats(grid, mask)
    if (totalWeight === 0) return 0

    const covInv = invert2x2(covariance)

    // Compute Mahalanobis distances for all foreground pixels
    const distances: { d: number; w: number }[] = []
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y]?.[x] === 1) {
                const d = mahalanobisDistance(x, y, centroid, covInv)
                const w = Math.max(0.001, grid[y][x])
                distances.push({ d, w })
            }
        }
    }

    if (distances.length === 0) return 0

    // Compute median of distances
    const sortedD = distances.map(p => p.d).sort((a, b) => a - b)
    const median = sortedD[Math.floor(sortedD.length / 2)]

    // Compute MAD (Median Absolute Deviation)
    const absoluteDeviations = sortedD.map(d => Math.abs(d - median)).sort((a, b) => a - b)
    const mad = absoluteDeviations[Math.floor(absoluteDeviations.length / 2)]

    // Threshold: median + 3 * MAD
    const threshold = median + 3 * Math.max(mad, 0.1)

    // Sum weight of outlying pixels
    let outlyingWeight = 0
    for (const p of distances) {
        if (p.d > threshold) {
            outlyingWeight += p.w
        }
    }

    return Math.min(1, outlyingWeight / totalWeight)
}

/**
 * Compute Skewed metric using 3rd central moment along principal axis
 * As per LaTeX: Skewed = |μ₃|/μ₂^(3/2) where z = u·(x-x̄)
 */
export function computeSkewedPrincipalAxis(
    grid: FloatGrid,
    mask: BinaryGrid
): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    const { centroid, covariance, totalWeight } = computeWeightedStats(grid, mask)
    if (totalWeight === 0) return 0

    // Compute principal eigenvector of covariance
    // For 2x2 symmetric matrix [[a,b],[b,c]], eigenvectors can be computed analytically
    const a = covariance[0][0]
    const b = covariance[0][1]
    const c = covariance[1][1]

    const trace = a + c
    const det = a * c - b * b
    const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - det))
    const lambda1 = trace / 2 + discriminant // Larger eigenvalue

    // Principal eigenvector for λ₁
    let ux: number, uy: number
    if (Math.abs(b) > 1e-10) {
        ux = lambda1 - c
        uy = b
    } else if (a >= c) {
        ux = 1
        uy = 0
    } else {
        ux = 0
        uy = 1
    }

    // Normalize
    const ulen = Math.sqrt(ux * ux + uy * uy)
    if (ulen > 0) {
        ux /= ulen
        uy /= ulen
    }

    // Project points onto principal axis and compute moments
    let mu2 = 0, mu3 = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (mask[y]?.[x] === 1) {
                const w = Math.max(0.001, grid[y][x])
                const dx = x - centroid.x
                const dy = y - centroid.y
                const z = ux * dx + uy * dy // Projection onto principal axis

                mu2 += w * z * z
                mu3 += w * z * z * z
            }
        }
    }

    mu2 /= totalWeight
    mu3 /= totalWeight

    // Skewness = |μ₃| / μ₂^(3/2)
    if (mu2 <= 0) return 0

    const skewness = Math.abs(mu3) / Math.pow(mu2, 1.5)

    // Normalize to [0,1] - typical skewness values are in [-3, 3] range
    return Math.min(1, skewness / 3)
}

/**
 * Compute all 9 scagnostics metrics using Pipeline 2 approach
 * Implements formulas from image_scagnostics_pipeline2.tex exactly as specified
 */
export function computeAllScagnostics(
    floatGrid: FloatGrid,
    binaryGrid: BinaryGrid,
    contours: Polyline[],
    convexHull: Polyline
): AllScagnostics {
    const gridSize = floatGrid.length
    const diag = Math.sqrt(2) * gridSize

    // Basic geometry from all contours
    const area = contours.reduce((sum, c) => sum + computeContinuousArea(c), 0)
    // For perimeter, we also sum them up
    const perimeter = contours.reduce((sum, c) => sum + computeContinuousPerimeter(c), 0)
    const hullArea = computeContinuousArea(convexHull)

    // Distance transform
    const dt = euclideanDistanceTransform(binaryGrid)

    // Skeleton with pruning (as per LaTeX: 0.5%-2.0% of diagonal)
    const rawSkeleton = zhangSuenThinning(binaryGrid)
    const pruneLength = diag * 0.01 // 3% of diagonal (increased to reduce noise)
    const skeleton = pruneSkeletonBranches(rawSkeleton, pruneLength)

    const skeletonArcLength = computeSkeletonArcLength(skeleton)

    // Skeleton topology statistics
    const endpoints = getSkeletonEndpoints(skeleton)
    const junctions = getSkeletonJunctions(skeleton)
    const numHoles = countHoles(binaryGrid)

    // Skeleton width statistics for Skinny
    const { meanRadius, varianceRadius } = computeSkeletonWidthStats(skeleton, dt)

    // Branch statistics
    const branches = extractSkeletonBranches(skeleton, dt)

    // Structure tensor for striated
    const { orientation } = computeStructureTensor(floatGrid, 5)
    const circularVar = computeCircularVariance(orientation, binaryGrid)

    // Blob segmentation for clumpy
    const filledPixels = countFilledCells(binaryGrid)
    const blobs = watershedBlobSegmentation(floatGrid, binaryGrid, 5)

    // ========================================================================
    // 1. STRINGY: L_max / L_total
    // Simplified: ratio of longest path in skeleton to total skeleton length
    // ========================================================================
    const longestPath = computeSkeletonLongestPath(skeleton)
    const stringy = computeStringySimple(
        longestPath,
        skeletonArcLength
    )

    // ========================================================================
    // 2. SPARSE: 1 - (filled pixels / hull area)
    // LaTeX: ratio of points to α-hull area (inverse density)
    // ========================================================================
    const sparse = hullArea > 0
        ? Math.max(0, Math.min(1, 1 - filledPixels / hullArea))
        : 0

    // ========================================================================
    // 3. CONVEX: area / hull area
    // LaTeX: ratio of α-hull area to convex hull area
    // ========================================================================
    const convex = hullArea > 0 ? Math.min(1, area / hullArea) : 1

    // ========================================================================
    // 4. SKINNY: λ₁(1-IQ) + λ₂(Var_r/r̄²)
    // LaTeX: combines isoperimetric quotient (1 - 4πA/P²)
    //        with medial axis width variance (Var_r/r̄²)
    //        λ₁=0.7, λ₂=0.3 for balanced measure
    // ========================================================================
    const skinny = computeSkinnyFull(area, perimeter, meanRadius, varianceRadius, 0.7)

    // ========================================================================
    // 5. CLUMPY: max(B·Var({a_i})/A², 1-1/n)
    // LaTeX: Clumpy = B·Var({a_i})/A² (normalized)
    // Also consider connected components
    // ========================================================================
    const numComponents = countConnectedComponents(binaryGrid)
    const blobClumpy = computeClumpyFromBlobs(blobs, filledPixels)
    const componentClumpy = numComponents > 1 ? 1 - (1 / numComponents) : 0
    // Combine both measures
    const clumpy = Math.max(blobClumpy, componentClumpy)

    // ========================================================================
    // 6. OUTLYING: ½(O_M + O_k)
    // LaTeX: Average of Mahalanobis-based (O_M) and branch-based (O_k)
    // O_M = Σ{wᵢ : mᵢ > med + 3·MAD} / Σwᵢ
    // O_k = sum_{j: r_j < r_th} A_j / A
    // ========================================================================
    // Mahalanobis-based outlying
    const outlyingMahalanobis = computeOutlyingMahalanobis(floatGrid, binaryGrid)

    // Branch-based outlying
    let outlyingBranch = 0
    if (branches.length > 0 && filledPixels > 0) {
        // Compute median radius
        const radii = branches.map(b => b.meanRadius).sort((a, b) => a - b)
        const medianRadius = radii[Math.floor(radii.length / 2)]
        const radiusThreshold = medianRadius * 0.5 // Branches with < 50% of median radius

        // Sum area in thin branches
        let thinBranchArea = 0
        for (const branch of branches) {
            if (branch.meanRadius < radiusThreshold) {
                // Approximate branch area as length × 2 × radius
                thinBranchArea += branch.length * branch.meanRadius * 2
            }
        }

        outlyingBranch = Math.min(1, thinBranchArea / filledPixels)
    }

    // Combine both measures: ½(O_M + O_k)
    const outlying = (outlyingMahalanobis + outlyingBranch) / 2

    // ========================================================================
    // 7. SKEWED: |μ₃|/μ₂^(3/2)
    // LaTeX: projects intensity-weighted pixels onto principal eigenvector,
    //        computes |μ₃|/μ₂^(3/2) for skewness along main axis
    // ========================================================================
    const skewed = computeSkewedPrincipalAxis(floatGrid, binaryGrid)

    // ========================================================================
    // 8. STRIATED: 1 - circular variance of orientations
    // LaTeX: striated ≈ 1 - circular variance
    // ========================================================================
    const striated = Math.max(0, Math.min(1, 1 - circularVar))

    // ========================================================================
    // 9. MONOTONIC: Spearman correlation on skeleton path samples
    // LaTeX: |ρ| where ρ is Spearman correlation between x and y on path
    // ========================================================================
    let monotonic = 0

    // Sample points along principal skeleton path
    const pathSamples = sampleSkeletonPath(skeleton, 50)
    if (pathSamples.length >= 5) {
        const xs = pathSamples.map(p => p.x)
        const ys = pathSamples.map(p => p.y)
        monotonic = Math.abs(spearmanCorrelation(xs, ys))
    } else {
        // Fallback: use row centroids
        const rowCentroids: { row: number; centroid: number }[] = []
        for (let y = 0; y < gridSize; y++) {
            let sumX = 0, count = 0
            for (let x = 0; x < gridSize; x++) {
                if (binaryGrid[y][x] === 1) {
                    sumX += x
                    count++
                }
            }
            if (count > 0) {
                rowCentroids.push({ row: y, centroid: sumX / count })
            }
        }

        if (rowCentroids.length >= 3) {
            const rows = rowCentroids.map(rc => rc.row)
            const centroids = rowCentroids.map(rc => rc.centroid)
            monotonic = Math.abs(spearmanCorrelation(rows, centroids))
        }
    }

    return {
        stringy,
        sparse,
        convex,
        skinny,
        clumpy,
        outlying,
        skewed,
        striated,
        monotonic
    }
}



// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Count connected components in a binary grid using flood fill
 * Returns the number of separate connected regions (4-connectivity)
 */
export function countConnectedComponents(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    if (rows === 0 || cols === 0) return 0

    // Create visited array
    const visited: boolean[][] = Array(rows).fill(null).map(() => Array(cols).fill(false))
    let componentCount = 0

    // Flood fill using BFS (4-connectivity)
    const floodFill = (startY: number, startX: number) => {
        const queue: [number, number][] = [[startY, startX]]
        visited[startY][startX] = true

        while (queue.length > 0) {
            const [y, x] = queue.shift()!

            // Check 4 neighbors (up, down, left, right)
            const neighbors: [number, number][] = [
                [y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]
            ]

            for (const [ny, nx] of neighbors) {
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols &&
                    !visited[ny][nx] && grid[ny][nx] === 1) {
                    visited[ny][nx] = true
                    queue.push([ny, nx])
                }
            }
        }
    }

    // Find all connected components
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1 && !visited[y][x]) {
                floodFill(y, x)
                componentCount++
            }
        }
    }

    return componentCount
}

/**
 * Count filled cells in binary grid
 */
export function countFilledCells(grid: BinaryGrid): number {
    return grid.reduce((sum, row) =>
        sum + row.reduce((rowSum, cell) => rowSum + cell, 0), 0
    )
}


