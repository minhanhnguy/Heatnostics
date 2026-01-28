/**
 * Image-only Scagnostic Pipeline 2 (Subpixel / Continuous Geometry)
 * Based on: image_scagnostics_pipeline2.tex
 *
 * Key Concepts:
 * - Subpixel precision using Marching Squares
 * - Continuous Area/Perimeter (Shoelace formula, Euclidean distance)
 * - Isoperimetric Quotient for "Skinny"
 * - Distance Transform + Medial Axis for Skeleton
 */

export type FloatGrid = number[][]         // 0.0 to 1.0 (density)
export type BinaryGrid = number[][]        // 0 or 1
export interface Point { x: number; y: number }
export type Polyline = Point[]

// ============================================================================
// STEP 0: Data Conversion - Points to Float Grid (Density)
// ============================================================================

/**
 * Convert point cloud to a float grid (density representation)
 * Uses kernel density estimation with Gaussian kernel
 */
export function pointsToFloatGrid(
    points: [number, number][],
    gridSize: number,
    sigma: number = 3.0
): FloatGrid {
    const grid: FloatGrid = Array.from({ length: gridSize }, () =>
        Array(gridSize).fill(0)
    )

    // For each point, add Gaussian contribution to nearby cells
    const radius = Math.ceil(sigma * 3) // 3-sigma rule

    for (const [px, py] of points) {
        const centerX = Math.floor(px)
        const centerY = Math.floor(py)

        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const x = centerX + dx
                const y = centerY + dy

                if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
                    const dist2 = dx * dx + dy * dy
                    const weight = Math.exp(-dist2 / (2 * sigma * sigma))
                    grid[y][x] += weight
                }
            }
        }
    }

    // Normalize to [0, 1]
    let maxVal = 0
    for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
            maxVal = Math.max(maxVal, grid[y][x])
        }
    }

    if (maxVal > 0) {
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                grid[y][x] /= maxVal
            }
        }
    }

    return grid
}

/**
 * Convert point cloud to binary grid (simple rasterization)
 */
export function pointsToBinaryGrid(
    points: [number, number][],
    gridSize: number
): BinaryGrid {
    const grid: BinaryGrid = Array.from({ length: gridSize }, () =>
        Array(gridSize).fill(0)
    )

    for (const [px, py] of points) {
        const x = Math.floor(px)
        const y = Math.floor(py)
        if (x >= 0 && x < gridSize && y >= 0 && y < gridSize) {
            grid[y][x] = 1
        }
    }

    return grid
}

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
 * Segment grid by percentile
 */
export function segmentByPercentile(grid: FloatGrid, percentile: number): BinaryGrid {
    const threshold = getPercentileValue(grid, percentile)
    return segmentByThreshold(grid, threshold)
}

/**
 * Multi-threshold segmentation (emulates alpha-shape family)
 * Returns binary masks at multiple percentile thresholds
 */
export function multiThresholdSegmentation(
    grid: FloatGrid,
    percentiles: number[] = [50, 75, 90, 95]
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

    // Sort by polar angle
    const sorted = points
        .filter((_, i) => i !== lowest)
        .map(p => ({
            point: p,
            angle: Math.atan2(p.y - pivot.y, p.x - pivot.x)
        }))
        .sort((a, b) => a.angle - b.angle)
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
 * Compute convex hull from all foreground pixels in a binary grid
 * This ensures the hull covers the entire shape, not just contour vertices
 */
export function computeConvexHullFromBinary(grid: BinaryGrid): Polyline {
    const points: Point[] = []
    const rows = grid.length
    const cols = grid[0]?.length || 0

    // Collect all foreground pixel coordinates
    // For efficiency, only collect boundary pixels (pixels with at least one background neighbor)
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] !== 1) continue

            // Check if this is a boundary pixel
            const isBoundary =
                y === 0 || y === rows - 1 || x === 0 || x === cols - 1 ||
                grid[y - 1]?.[x] !== 1 || grid[y + 1]?.[x] !== 1 ||
                grid[y]?.[x - 1] !== 1 || grid[y]?.[x + 1] !== 1

            if (isBoundary) {
                // Add corner points of the pixel for better hull coverage
                points.push({ x, y })
                points.push({ x: x + 1, y })
                points.push({ x, y: y + 1 })
                points.push({ x: x + 1, y: y + 1 })
            }
        }
    }

    if (points.length < 3) {
        // Fallback: collect all foreground pixels
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (grid[y][x] === 1) {
                    points.push({ x: x + 0.5, y: y + 0.5 })
                }
            }
        }
    }

    return computeConvexHull(points)
}

/**
 * Get all foreground pixel center coordinates from a binary grid
 */
export function getForegroundPoints(grid: BinaryGrid): Point[] {
    const points: Point[] = []
    const rows = grid.length
    const cols = grid[0]?.length || 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                points.push({ x: x + 0.5, y: y + 0.5 })
            }
        }
    }

    return points
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

/**
 * Convex metric: Area / ConvexHullArea
 */
export function computeConvexMetric(contour: Polyline): number {
    if (contour.length < 3) return 1

    const area = computeContinuousArea(contour)
    const hull = computeConvexHull(contour)
    const hullArea = computeContinuousArea(hull)

    if (hullArea === 0) return 1
    return Math.min(1, area / hullArea)
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
 * Extract skeleton from distance transform (ridge detection)
 * Uses local maxima detection
 */
export function extractSkeletonFromDT(dt: FloatGrid): BinaryGrid {
    const rows = dt.length
    const cols = dt[0]?.length || 0
    const skeleton: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            const val = dt[y][x]
            if (val <= 0) continue

            // Check if local maximum in at least one direction
            const isRidge =
                (val >= dt[y - 1][x] && val >= dt[y + 1][x]) ||  // Vertical ridge
                (val >= dt[y][x - 1] && val >= dt[y][x + 1]) ||  // Horizontal ridge
                (val >= dt[y - 1][x - 1] && val >= dt[y + 1][x + 1]) ||  // Diagonal
                (val >= dt[y - 1][x + 1] && val >= dt[y + 1][x - 1])     // Anti-diagonal

            if (isRidge && val > 1) {
                skeleton[y][x] = 1
            }
        }
    }

    return skeleton
}

/**
 * Get skeleton endpoints (pixels with exactly 1 neighbor)
 */
export function getSkeletonEndpoints(skeleton: BinaryGrid): Point[] {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const endpoints: Point[] = []

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (skeleton[y][x] !== 1) continue

            let neighbors = 0
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (skeleton[y + dy]?.[x + dx] === 1) neighbors++
                }
            }

            if (neighbors === 1) {
                endpoints.push({ x, y })
            }
        }
    }

    return endpoints
}

/**
 * Get skeleton junctions (pixels with 3+ neighbors)
 */
export function getSkeletonJunctions(skeleton: BinaryGrid): Point[] {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const junctions: Point[] = []

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (skeleton[y][x] !== 1) continue

            let neighbors = 0
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (skeleton[y + dy]?.[x + dx] === 1) neighbors++
                }
            }

            if (neighbors >= 3) {
                junctions.push({ x, y })
            }
        }
    }

    return junctions
}

/**
 * Compute longest path in skeleton using BFS
 */
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
    for (const ep of endpoints.slice(0, 10)) { // Limit for performance
        longestPath = Math.max(longestPath, bfs(ep))
    }

    return longestPath
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

// ============================================================================
// STEP 9: Complete Scagnostics Metrics
// ============================================================================

export interface AllScagnostics {
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

/**
 * Compute all 9 scagnostics metrics using Pipeline 2 approach
 */
export function computeAllScagnostics(
    floatGrid: FloatGrid,
    binaryGrid: BinaryGrid,
    contours: Polyline[],
    convexHull: Polyline
): AllScagnostics {
    const gridSize = floatGrid.length

    // Get largest contour
    const largestContour = contours.reduce((max, c) =>
        computeContinuousArea(c) > computeContinuousArea(max) ? c : max,
        contours[0] || []
    )

    // Basic geometry
    const area = computeContinuousArea(largestContour)
    const perimeter = computeContinuousPerimeter(largestContour)
    const hullArea = computeContinuousArea(convexHull)

    // Distance transform
    const dt = euclideanDistanceTransform(binaryGrid)
    const dtStats = getGridStats(dt)

    // Skeleton
    const skeleton = zhangSuenThinning(binaryGrid)
    const skeletonPixels = countFilledCells(skeleton)
    const longestPath = computeSkeletonLongestPath(skeleton)
    const endpoints = getSkeletonEndpoints(skeleton)
    const junctions = getSkeletonJunctions(skeleton)

    // Structure tensor for striated
    const { meanCoherence } = computeStructureTensor(floatGrid)

    // 1. STRINGY: longest path / skeleton mass
    const stringy = skeletonPixels > 0 ? Math.min(1, longestPath / skeletonPixels) : 0

    // 2. SPARSE: 1 - (filled area / hull area)
    const filledPixels = countFilledCells(binaryGrid)
    const hullPixels = hullArea // Using continuous hull area
    const sparse = hullPixels > 0 ? Math.max(0, 1 - (filledPixels / (gridSize * gridSize)) * (gridSize * gridSize / hullPixels)) : 0

    // 3. CONVEX: area / hull area
    const convex = hullArea > 0 ? Math.min(1, area / hullArea) : 1

    // 4. SKINNY: 1 - IQ (isoperimetric quotient)
    const skinny = computeSkinnyIQ(area, perimeter)

    // 5. CLUMPY: based on connected components
    // Multiple separate regions = high clumpy (distinct clusters)
    // Formula: 1 - 1/n where n = number of connected components
    // 1 component → 0, 2 components → 0.5, 3 → 0.67, etc.
    const numComponents = countConnectedComponents(binaryGrid)
    const clumpy = numComponents > 0 ? 1 - (1 / numComponents) : 0

    // 6. OUTLYING: fraction of long endpoint paths
    // Approximate: endpoints far from center
    const centerX = gridSize / 2
    const centerY = gridSize / 2
    let totalEndpointDist = 0
    for (const ep of endpoints) {
        totalEndpointDist += Math.sqrt((ep.x - centerX) ** 2 + (ep.y - centerY) ** 2)
    }
    const maxPossibleDist = Math.sqrt(2) * gridSize / 2 * endpoints.length
    const outlying = maxPossibleDist > 0 ? Math.min(1, totalEndpointDist / maxPossibleDist) : 0

    // 7. SKEWED: 1 - mean(DT) / max(DT)
    const skewed = dtStats.max > 0 ? Math.max(0, 1 - dtStats.mean / dtStats.max) : 0

    // 8. STRIATED: coherence from structure tensor
    const striated = Math.min(1, meanCoherence)

    // 9. MONOTONIC: Spearman correlation of row centroids
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

    let monotonic = 0
    if (rowCentroids.length >= 3) {
        // Spearman correlation
        const n = rowCentroids.length
        const rankRow = rowCentroids.map((_, i) => i)
        const sortedByCentroid = [...rowCentroids].sort((a, b) => a.centroid - b.centroid)
        const rankCentroid = rowCentroids.map(rc =>
            sortedByCentroid.findIndex(s => s.row === rc.row)
        )

        let sumD2 = 0
        for (let i = 0; i < n; i++) {
            const d = rankRow[i] - rankCentroid[i]
            sumD2 += d * d
        }
        const rho = 1 - (6 * sumD2) / (n * (n * n - 1))
        monotonic = Math.abs(rho)
    }

    return {
        stringy,
        sparse: Math.min(1, Math.max(0, sparse)),
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

/**
 * Get grid statistics
 */
export function getGridStats(grid: FloatGrid): { min: number; max: number; mean: number } {
    let min = Infinity
    let max = -Infinity
    let sum = 0
    let count = 0

    for (const row of grid) {
        for (const val of row) {
            min = Math.min(min, val)
            max = Math.max(max, val)
            sum += val
            count++
        }
    }

    return { min, max, mean: count > 0 ? sum / count : 0 }
}

// ============================================================================
// Main Pipeline Execution
// ============================================================================

export interface Pipeline2Result {
    // Step 1
    smoothed: FloatGrid
    smoothingSigma: number
    // Step 2
    thresholds: { percentile: number; threshold: number; binary: BinaryGrid }[]
    // Step 3+
    contours: Polyline[]
    convexHull: Polyline
    // Metrics
    metrics: {
        area: number
        perimeter: number
        hullArea: number
        skinny: number
        convex: number
    }
}

/**
 * Run Pipeline 2 on a float grid
 */
export function runPipeline2(
    inputGrid: FloatGrid,
    options: {
        smoothingSigma?: number
        percentiles?: number[]
        primaryPercentile?: number
    } = {}
): Pipeline2Result {
    const {
        smoothingSigma = 1.0,
        percentiles = [50, 75, 90, 95],
        primaryPercentile = 75
    } = options

    // Step 1: Smoothing
    const smoothed = gaussianBlur(inputGrid, smoothingSigma)

    // Step 2: Multi-threshold segmentation
    const thresholds = multiThresholdSegmentation(smoothed, percentiles)

    // Step 3: Contour extraction on primary threshold
    const primaryThreshold = getPercentileValue(smoothed, primaryPercentile)
    const contours = marchingSquares(smoothed, primaryThreshold)

    // Get largest contour for metrics
    const largestContour = contours.reduce((max, c) =>
        computeContinuousArea(c) > computeContinuousArea(max) ? c : max,
        contours[0] || []
    )

    // Compute metrics
    const area = computeContinuousArea(largestContour)
    const perimeter = computeContinuousPerimeter(largestContour)
    const convexHull = computeConvexHull(largestContour)
    const hullArea = computeContinuousArea(convexHull)
    const skinny = computeSkinnyIQ(area, perimeter)
    const convex = hullArea > 0 ? area / hullArea : 1

    return {
        smoothed,
        smoothingSigma,
        thresholds,
        contours,
        convexHull,
        metrics: {
            area,
            perimeter,
            hullArea,
            skinny,
            convex
        }
    }
}
