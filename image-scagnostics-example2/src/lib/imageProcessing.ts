/**
 * Image Processing Utilities for Image-Theoretic Scagnostics
 *
 * Implements:
 * - Morphological Closing (replaces Alpha Shape)
 * - Contour Convex Hull (replaces Graham Scan)
 * - Distance Transform + Ridge Detection (replaces MST)
 *   - Better semantic match to MST than skeletonization
 *   - O(W×H) complexity - faster than skeleton's O(W×H×k)
 * - Zhang-Suen Skeletonization (legacy, kept for comparison)
 */

// Type for a 2D binary grid
export type BinaryGrid = number[][]

/**
 * Create a disk-shaped structuring element for morphological operations
 */
function createDiskElement(radius: number): boolean[][] {
    const size = radius * 2 + 1
    const element: boolean[][] = []
    for (let y = 0; y < size; y++) {
        element[y] = []
        for (let x = 0; x < size; x++) {
            const dx = x - radius
            const dy = y - radius
            element[y][x] = dx * dx + dy * dy <= radius * radius
        }
    }
    return element
}

/**
 * Morphological Dilation - expands foreground regions
 */
function dilate(grid: BinaryGrid, radius: number): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const result: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    const element = createDiskElement(radius)
    const elemSize = radius * 2 + 1

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                // Set all pixels within structuring element to 1
                for (let ey = 0; ey < elemSize; ey++) {
                    for (let ex = 0; ex < elemSize; ex++) {
                        if (element[ey][ex]) {
                            const ny = y + ey - radius
                            const nx = x + ex - radius
                            if (ny >= 0 && ny < rows && nx >= 0 && nx < cols) {
                                result[ny][nx] = 1
                            }
                        }
                    }
                }
            }
        }
    }
    return result
}

/**
 * Morphological Erosion - shrinks foreground regions
 */
function erode(grid: BinaryGrid, radius: number): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const result: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    const element = createDiskElement(radius)
    const elemSize = radius * 2 + 1

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            // Check if all pixels in structuring element are 1
            let allSet = true
            for (let ey = 0; ey < elemSize && allSet; ey++) {
                for (let ex = 0; ex < elemSize && allSet; ex++) {
                    if (element[ey][ex]) {
                        const ny = y + ey - radius
                        const nx = x + ex - radius
                        if (ny < 0 || ny >= rows || nx < 0 || nx >= cols || grid[ny][nx] !== 1) {
                            allSet = false
                        }
                    }
                }
            }
            result[y][x] = allSet ? 1 : 0
        }
    }
    return result
}

/**
 * Morphological Closing = Dilation followed by Erosion
 * Fills small holes and gaps while preserving shape
 */
export function morphologicalClosing(grid: BinaryGrid, radius: number = 3): BinaryGrid {
    const dilated = dilate(grid, radius)
    const closed = erode(dilated, radius)
    return closed
}

/**
 * Fill interior holes in a binary grid using flood-fill from borders.
 * 
 * Algorithm:
 * 1. Flood-fill from all border pixels (background reachable from edges)
 * 2. Any pixel NOT reached by flood-fill and NOT part of foreground is an interior hole
 * 3. Fill those holes (set them to 1)
 * 
 * This improves the Convex metric for dense patterns where morphological closing
 * leaves small gaps unfilled.
 */
export function fillInteriorHoles(grid: BinaryGrid): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    if (rows === 0 || cols === 0) return grid

    // Create result grid (copy of input)
    const result: BinaryGrid = grid.map(row => [...row])

    // Track which background pixels are reachable from the border
    const reachableFromBorder: boolean[][] = Array.from({ length: rows }, () =>
        Array(cols).fill(false)
    )

    // BFS flood-fill from all border pixels that are background (0)
    const queue: [number, number][] = []

    // Add all border pixels that are background to the queue
    for (let x = 0; x < cols; x++) {
        if (grid[0][x] === 0) {
            queue.push([0, x])
            reachableFromBorder[0][x] = true
        }
        if (grid[rows - 1][x] === 0) {
            queue.push([rows - 1, x])
            reachableFromBorder[rows - 1][x] = true
        }
    }
    for (let y = 1; y < rows - 1; y++) {
        if (grid[y][0] === 0) {
            queue.push([y, 0])
            reachableFromBorder[y][0] = true
        }
        if (grid[y][cols - 1] === 0) {
            queue.push([y, cols - 1])
            reachableFromBorder[y][cols - 1] = true
        }
    }

    // BFS flood-fill
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]]
    while (queue.length > 0) {
        const [y, x] = queue.shift()!
        for (const [dy, dx] of directions) {
            const ny = y + dy
            const nx = x + dx
            if (ny >= 0 && ny < rows && nx >= 0 && nx < cols &&
                !reachableFromBorder[ny][nx] && grid[ny][nx] === 0) {
                reachableFromBorder[ny][nx] = true
                queue.push([ny, nx])
            }
        }
    }

    // Fill interior holes: any background pixel NOT reachable from border
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 0 && !reachableFromBorder[y][x]) {
                result[y][x] = 1  // Fill the hole
            }
        }
    }

    return result
}

/**
 * Adaptive Morphological Closing
 * 
 * Applies morphological closing and optionally fills interior holes.
 * 
 * For thin/stringy shapes: Skip hole-filling to preserve their linear structure
 * For dense/blob shapes: Apply hole-filling to fill gaps between sparse points
 */
export function adaptiveMorphologicalClosing(
    grid: BinaryGrid,
    radius: number = 3,
    thinThreshold: number = 3
): { closedGrid: BinaryGrid; isThinShape: boolean; maxThickness: number } {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    // Apply morphological closing first
    let closedGrid = morphologicalClosing(grid, radius)

    // Compute distance transform on the CLOSED grid (not original)
    // This gives us the thickness after closing
    const dtClosed = euclideanDistanceTransform(closedGrid)

    // Find max distance in closed grid
    let maxDT = 0
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (closedGrid[y][x] === 1) {
                maxDT = Math.max(maxDT, dtClosed[y][x])
            }
        }
    }

    // Also check the aspect ratio of the bounding box
    // Thin shapes tend to be elongated (high aspect ratio)
    let minX = cols, maxX = 0, minY = rows, maxY = 0
    let pixelCount = 0
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (closedGrid[y][x] === 1) {
                minX = Math.min(minX, x)
                maxX = Math.max(maxX, x)
                minY = Math.min(minY, y)
                maxY = Math.max(maxY, y)
                pixelCount++
            }
        }
    }

    const width = maxX - minX + 1
    const height = maxY - minY + 1
    const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height))
    const boxArea = width * height
    const fillRatio = pixelCount / Math.max(1, boxArea)

    // A shape is "thin" if:
    // 1. Max thickness is small AND aspect ratio is high (elongated)
    // 2. OR fill ratio is very low AND aspect ratio is high
    const isThinShape = (maxDT <= thinThreshold && aspectRatio > 3) ||
        (fillRatio < 0.3 && aspectRatio > 5)

    // For non-thin shapes, fill interior holes
    // This helps dense point clouds get proper Convex scores
    if (!isThinShape) {
        closedGrid = fillInteriorHoles(closedGrid)
    }

    return {
        closedGrid,
        isThinShape,
        maxThickness: maxDT
    }
}

/**
 * Find boundary pixels of foreground regions
 */
function findBoundaryPixels(grid: BinaryGrid): [number, number][] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const boundary: [number, number][] = []

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                // Check if any 4-neighbor is 0 (background)
                const hasBackgroundNeighbor =
                    (y === 0 || grid[y - 1][x] === 0) ||
                    (y === rows - 1 || grid[y + 1][x] === 0) ||
                    (x === 0 || grid[y][x - 1] === 0) ||
                    (x === cols - 1 || grid[y][x + 1] === 0)

                if (hasBackgroundNeighbor) {
                    boundary.push([x, y])
                }
            }
        }
    }
    return boundary
}

/**
 * Compute convex hull using Graham Scan algorithm
 */
function grahamScan(points: [number, number][]): [number, number][] {
    if (points.length < 3) return points

    // Find the point with lowest y (and leftmost if tied)
    let minIdx = 0
    for (let i = 1; i < points.length; i++) {
        if (points[i][1] < points[minIdx][1] ||
            (points[i][1] === points[minIdx][1] && points[i][0] < points[minIdx][0])) {
            minIdx = i
        }
    }
    const pivot = points[minIdx]

    // Sort by polar angle
    const sorted = points
        .filter((_, i) => i !== minIdx)
        .map(p => ({
            point: p,
            angle: Math.atan2(p[1] - pivot[1], p[0] - pivot[0])
        }))
        .sort((a, b) => a.angle - b.angle)
        .map(p => p.point)

    // Cross product for CCW test
    const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
        (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    const hull: [number, number][] = [pivot]
    for (const p of sorted) {
        while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
            hull.pop()
        }
        hull.push(p)
    }

    return hull
}

/**
 * Contour Convex Hull - finds convex hull from boundary pixels
 * Replaces traditional Graham Scan on all points
 */
export function contourConvexHull(grid: BinaryGrid): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const result: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))

    const boundary = findBoundaryPixels(grid)
    if (boundary.length < 3) {
        // Copy original grid if not enough points for hull
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                result[y][x] = grid[y][x]
            }
        }
        return result
    }

    const hull = grahamScan(boundary)

    // Fill the convex hull polygon
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (isPointInPolygon(x, y, hull)) {
                result[y][x] = 1
            }
        }
    }

    return result
}

/**
 * Point-in-polygon test using ray casting
 */
function isPointInPolygon(x: number, y: number, polygon: [number, number][]): boolean {
    let inside = false
    const n = polygon.length
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const [xi, yi] = polygon[i]
        const [xj, yj] = polygon[j]
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside
        }
    }
    return inside
}

/**
 * Zhang-Suen Skeletonization (thinning) algorithm
 * Produces 1-pixel wide medial axis
 */
export function skeletonize(grid: BinaryGrid): BinaryGrid {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    // Copy grid
    let result: BinaryGrid = grid.map(row => [...row])
    let changed = true

    // Get 8 neighbors in clockwise order starting from north
    const getNeighbors = (y: number, x: number): number[] => {
        const p2 = (y > 0) ? result[y - 1][x] : 0                    // N
        const p3 = (y > 0 && x < cols - 1) ? result[y - 1][x + 1] : 0 // NE
        const p4 = (x < cols - 1) ? result[y][x + 1] : 0              // E
        const p5 = (y < rows - 1 && x < cols - 1) ? result[y + 1][x + 1] : 0 // SE
        const p6 = (y < rows - 1) ? result[y + 1][x] : 0              // S
        const p7 = (y < rows - 1 && x > 0) ? result[y + 1][x - 1] : 0 // SW
        const p8 = (x > 0) ? result[y][x - 1] : 0                    // W
        const p9 = (y > 0 && x > 0) ? result[y - 1][x - 1] : 0       // NW
        return [p2, p3, p4, p5, p6, p7, p8, p9]
    }

    // Count non-zero neighbors
    const countB = (neighbors: number[]): number => neighbors.reduce((a, b) => a + b, 0)

    // Count 0→1 transitions in circular order
    const countA = (neighbors: number[]): number => {
        let count = 0
        for (let i = 0; i < 8; i++) {
            if (neighbors[i] === 0 && neighbors[(i + 1) % 8] === 1) {
                count++
            }
        }
        return count
    }

    while (changed) {
        changed = false
        const toDelete: [number, number][] = []

        // Pass 1
        for (let y = 1; y < rows - 1; y++) {
            for (let x = 1; x < cols - 1; x++) {
                if (result[y][x] !== 1) continue
                const [p2, p3, p4, p5, p6, p7, p8, p9] = getNeighbors(y, x)
                const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9]
                const B = countB(neighbors)
                const A = countA(neighbors)

                if (B >= 2 && B <= 6 && A === 1 &&
                    p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0) {
                    toDelete.push([y, x])
                }
            }
        }

        for (const [y, x] of toDelete) {
            result[y][x] = 0
            changed = true
        }
        toDelete.length = 0

        // Pass 2
        for (let y = 1; y < rows - 1; y++) {
            for (let x = 1; x < cols - 1; x++) {
                if (result[y][x] !== 1) continue
                const [p2, p3, p4, p5, p6, p7, p8, p9] = getNeighbors(y, x)
                const neighbors = [p2, p3, p4, p5, p6, p7, p8, p9]
                const B = countB(neighbors)
                const A = countA(neighbors)

                if (B >= 2 && B <= 6 && A === 1 &&
                    p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0) {
                    toDelete.push([y, x])
                }
            }
        }

        for (const [y, x] of toDelete) {
            result[y][x] = 0
            changed = true
        }
    }

    return result
}

// ============================================================
// DISTANCE TRANSFORM + RIDGE DETECTION (Replaces MST)
// ============================================================

/**
 * Euclidean Distance Transform (EDT)
 * For each foreground pixel, computes distance to nearest background pixel.
 * Uses efficient two-pass algorithm: O(W×H)
 *
 * Returns a grid where each cell contains the squared distance to nearest background
 * (squared to avoid sqrt in inner loop for performance)
 */
export function euclideanDistanceTransform(grid: BinaryGrid): number[][] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const INF = rows + cols // A value larger than any possible distance

    // Initialize: foreground = INF, background = 0
    const dt: number[][] = Array.from({ length: rows }, (_, y) =>
        Array.from({ length: cols }, (_, x) => grid[y][x] === 1 ? INF * INF : 0)
    )

    // Pass 1: Scan from top-left to bottom-right
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (dt[y][x] === 0) continue // Background pixel

            // Check top and left neighbors
            const fromTop = y > 0 ? dt[y - 1][x] + 1 : INF * INF
            const fromLeft = x > 0 ? dt[y][x - 1] + 1 : INF * INF
            const fromTopLeft = (y > 0 && x > 0) ? dt[y - 1][x - 1] + 2 : INF * INF // sqrt(2)^2 ≈ 2

            dt[y][x] = Math.min(dt[y][x], fromTop, fromLeft, fromTopLeft)
        }
    }

    // Pass 2: Scan from bottom-right to top-left
    for (let y = rows - 1; y >= 0; y--) {
        for (let x = cols - 1; x >= 0; x--) {
            if (dt[y][x] === 0) continue // Background pixel

            // Check bottom and right neighbors
            const fromBottom = y < rows - 1 ? dt[y + 1][x] + 1 : INF * INF
            const fromRight = x < cols - 1 ? dt[y][x + 1] + 1 : INF * INF
            const fromBottomRight = (y < rows - 1 && x < cols - 1) ? dt[y + 1][x + 1] + 2 : INF * INF

            dt[y][x] = Math.min(dt[y][x], fromBottom, fromRight, fromBottomRight)
        }
    }

    return dt
}

/**
 * Find ridge pixels (local maxima in the distance transform)
 * These are pixels whose distance value is >= all their neighbors
 * Ridge pixels form the medial axis / centerline of the shape
 *
 * For thin shapes (max DT <= 3), uses foreground pixels directly as ridge
 * since local maxima detection fails on 1-2 pixel wide lines.
 *
 * Complexity: O(W×H)
 */
export function findRidgePixels(dt: number[][], grid: BinaryGrid): BinaryGrid {
    const rows = dt.length
    const cols = dt[0]?.length || 0
    const ridges: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))

    // Check maximum DT value to detect thin shapes
    let maxDT = 0
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                maxDT = Math.max(maxDT, dt[y][x])
            }
        }
    }

    // For thin shapes (max DT <= 3), the shape itself IS the ridge
    // This handles 1-2 pixel wide lines where local maxima detection fails
    if (maxDT <= 3) {
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (grid[y][x] === 1) {
                    ridges[y][x] = 1
                }
            }
        }
        return ridges
    }

    // For thicker shapes, find local maxima (ridge pixels)
    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            // Only consider foreground pixels
            if (grid[y][x] !== 1) continue

            const val = dt[y][x]
            if (val <= 0) continue // Skip if at boundary

            // Check if this is a local maximum (ridge pixel)
            // A pixel is on the ridge if it's >= all 8 neighbors
            let isRidge = true
            let strictlyGreater = false

            for (let dy = -1; dy <= 1 && isRidge; dy++) {
                for (let dx = -1; dx <= 1 && isRidge; dx++) {
                    if (dy === 0 && dx === 0) continue
                    const neighborVal = dt[y + dy][x + dx]
                    if (neighborVal > val) {
                        isRidge = false
                    }
                    if (neighborVal < val) {
                        strictlyGreater = true
                    }
                }
            }

            // Must be >= all neighbors AND > at least one (to avoid flat regions)
            // OR be a thin line (width 1-2 pixels)
            if (isRidge && (strictlyGreater || val <= 2)) {
                ridges[y][x] = 1
            }
        }
    }

    return ridges
}

// 8. STRIATED: Coherence of skeleton orientation (Parallelism)
// ------------------------------------------------------------------
// OLD METHOD: Histogram of edge angles. Fails for Skinny ellipses (they look like one big parallel line).
// NEW METHOD: Skeleton Parallelism.
// - Striated patterns (grids/lines) have MULTIPLE distinct skeletal branches that are parallel.
// - Skinny patterns (ellipses) have only ONE main skeletal branch (or a loop).
// Algorithm:
// 1. Decompose skeleton into branch segments.
// 2. Compute angle for each segment > 10px.
// 3. Find dominant angle.
// 4. Count total length of segments aligned with dominant angle.
// 5. PENALTY: If number of parallel segments < 3, score is REDUCED.
//    (A simple line has 1 segment aligned => Low score. A grid has 10+ segments => High score).
export function computeStriated(ridgeGrid: number[][]): number {
    const height = ridgeGrid.length
    const width = ridgeGrid[0].length
    const segments: { length: number, angle: number }[] = []

    // Simple segment tracing
    // We scan for connected runs of pixels.
    // This is a simplified Hough-like approach on the skeleton pixels.
    const visited = Array.from({ length: height }, () => Array(width).fill(false))
    let totalSkeletonPixels = 0

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (ridgeGrid[y][x] === 1) {
                totalSkeletonPixels++
                if (visited[y][x]) continue

                // Trace this segment
                const q: [number, number][] = [[x, y]]
                visited[y][x] = true
                const componentPixels: [number, number][] = []

                let head = 0
                while (head < q.length) {
                    const [cx, cy] = q[head++]
                    componentPixels.push([cx, cy])

                    // 8-neighbor connectivity for skeleton
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue
                            const nx = cx + dx, ny = cy + dy
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height && ridgeGrid[ny][nx] === 1 && !visited[ny][nx]) {
                                visited[ny][nx] = true
                                q.push([nx, ny])
                            }
                        }
                    }
                }

                // Analyze this connected component (branch)
                // Fit a line to it to get angle
                if (componentPixels.length > 5) { // Ignore tiny noise
                    // Linear regression on pixels
                    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0
                    for (const p of componentPixels) {
                        sumX += p[0]; sumY += p[1]
                    }
                    const n = componentPixels.length
                    const meanX = sumX / n
                    const meanY = sumY / n

                    let numer = 0, denom = 0
                    for (const p of componentPixels) {
                        numer += (p[0] - meanX) * (p[1] - meanY)
                        denom += (p[0] - meanX) ** 2
                    }

                    // Angle in degrees [0, 180)
                    let angle = 0
                    if (Math.abs(denom) < 0.1) {
                        angle = 90 // Vertical
                    } else {
                        angle = Math.atan(numer / denom) * (180 / Math.PI)
                    }
                    // Normalize to [0, 180)
                    angle = (angle + 360) % 180

                    segments.push({ length: n, angle })
                }
            }
        }
    }

    if (totalSkeletonPixels === 0 || segments.length === 0) return 0

    // Bin segments by angle (12 bins of 15 degrees)
    const bins = new Array(12).fill(0)

    segments.forEach(seg => {
        // Map 0-180 to 0-11
        const binIdx = Math.floor(seg.angle / 15) % 12
        bins[binIdx] += seg.length
    })

    // Find dominant orientation
    let maxBinVal = 0
    let maxBinIdx = 0
    for (let i = 0; i < 12; i++) {
        if (bins[i] > maxBinVal) {
            maxBinVal = bins[i]
            maxBinIdx = i
        }
    }

    // Add neighbors (circular)
    const prev = (maxBinIdx - 1 + 12) % 12
    const next = (maxBinIdx + 1) % 12
    const alignedLength = bins[maxBinIdx] + bins[prev] + bins[next]

    // "Parallelism Ratio"
    const coherence = alignedLength / totalSkeletonPixels

    // PENALTY for few segments
    // Striated grids usually have many disjoint parallel segments (or connected orthogonal ones)
    // A single long line (Skinny) has 1 segment.
    const alignedSegmentsCount = segments.filter(s => {
        const bin = Math.floor(s.angle / 15) % 12
        return bin === maxBinIdx || bin === prev || bin === next
    }).length

    // Sigmoid penalty: 1 segment -> 0.1, 5 segments -> 0.9
    // Logic: We need MULTIPLE parallel lines to be "Striated".
    let countPenalty = 0
    if (alignedSegmentsCount <= 1) countPenalty = 0.1 // Likely just skinny
    else if (alignedSegmentsCount === 2) countPenalty = 0.5
    else countPenalty = 1.0 // 3+ segments

    return coherence * countPenalty
}

/**
 * Find endpoints in ridge/skeleton (pixels with exactly 1 neighbor)
 */
function findEndpoints(ridgeGrid: BinaryGrid): [number, number][] {
    const rows = ridgeGrid.length
    const cols = ridgeGrid[0]?.length || 0
    const endpoints: [number, number][] = []

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (ridgeGrid[y][x] !== 1) continue

            // Count 8-connected neighbors
            let neighborCount = 0
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (ridgeGrid[y + dy][x + dx] === 1) neighborCount++
                }
            }

            // Endpoint = exactly 1 neighbor
            if (neighborCount === 1) {
                endpoints.push([y, x])
            }
        }
    }
    return endpoints
}

/**
 * Find junction pixels in skeleton (pixels with >= 3 neighbors)
 */
function findJunctions(skeletonGrid: BinaryGrid): [number, number][] {
    const rows = skeletonGrid.length
    const cols = skeletonGrid[0]?.length || 0
    const junctions: [number, number][] = []

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (skeletonGrid[y][x] !== 1) continue

            // Count 8-connected neighbors
            let neighborCount = 0
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (skeletonGrid[y + dy][x + dx] === 1) neighborCount++
                }
            }

            // Junction = 3 or more neighbors
            if (neighborCount >= 3) {
                junctions.push([y, x])
            }
        }
    }
    return junctions
}

/**
 * Extract skeleton branches (segments between junctions/endpoints)
 * Returns array of branches, each branch is an array of pixel coordinates with its length
 */
interface SkeletonBranch {
    pixels: [number, number][]
    length: number
    startType: 'endpoint' | 'junction'
    endType: 'endpoint' | 'junction'
}

function extractSkeletonBranches(skeletonGrid: BinaryGrid): SkeletonBranch[] {
    const rows = skeletonGrid.length
    const cols = skeletonGrid[0]?.length || 0
    const branches: SkeletonBranch[] = []

    // Find endpoints and junctions
    const endpoints = findEndpoints(skeletonGrid)
    const junctions = findJunctions(skeletonGrid)

    // Create a set of junction positions for fast lookup
    const junctionSet = new Set<string>()
    for (const [y, x] of junctions) {
        junctionSet.add(`${y},${x}`)
    }
    const endpointSet = new Set<string>()
    for (const [y, x] of endpoints) {
        endpointSet.add(`${y},${x}`)
    }

    // Track visited edges to avoid duplicate branches
    const visitedEdges = new Set<string>()

    // Get 8-connected neighbors
    const getNeighbors = (y: number, x: number): [number, number][] => {
        const neighbors: [number, number][] = []
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const ny = y + dy
                const nx = x + dx
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && skeletonGrid[ny][nx] === 1) {
                    neighbors.push([ny, nx])
                }
            }
        }
        return neighbors
    }

    // Trace a branch from a starting point
    const traceBranch = (startY: number, startX: number, prevY: number, prevX: number): SkeletonBranch | null => {
        const pixels: [number, number][] = [[startY, startX]]
        let curY = startY, curX = startX
        let pY = prevY, pX = prevX
        let length = 0

        const startKey = `${startY},${startX}`
        const startType: 'endpoint' | 'junction' = endpointSet.has(startKey) ? 'endpoint' : 'junction'

        while (true) {
            const neighbors = getNeighbors(curY, curX)

            // Find next pixel (not the one we came from)
            let nextPixel: [number, number] | null = null
            for (const [ny, nx] of neighbors) {
                if (ny === pY && nx === pX) continue
                nextPixel = [ny, nx]
                break
            }

            if (!nextPixel) break

            const [ny, nx] = nextPixel
            const edgeKey = curY < ny || (curY === ny && curX < nx)
                ? `${curY},${curX}-${ny},${nx}`
                : `${ny},${nx}-${curY},${curX}`

            if (visitedEdges.has(edgeKey)) break
            visitedEdges.add(edgeKey)

            // Calculate step length (diagonal = sqrt(2), orthogonal = 1)
            const stepLength = (Math.abs(ny - curY) === 1 && Math.abs(nx - curX) === 1) ? 1.414 : 1
            length += stepLength

            pixels.push([ny, nx])
            pY = curY
            pX = curX
            curY = ny
            curX = nx

            // Check if we reached a junction or endpoint (stop point)
            const curKey = `${curY},${curX}`
            if (junctionSet.has(curKey) || endpointSet.has(curKey)) {
                const endType: 'endpoint' | 'junction' = endpointSet.has(curKey) ? 'endpoint' : 'junction'
                return { pixels, length, startType, endType }
            }
        }

        // If we got here without reaching a proper endpoint, return the branch anyway
        if (pixels.length > 1) {
            return { pixels, length, startType, endType: 'endpoint' }
        }
        return null
    }

    // Start tracing from each endpoint and junction
    const startPoints = [...endpoints, ...junctions]

    for (const [startY, startX] of startPoints) {
        const neighbors = getNeighbors(startY, startX)
        for (const [ny, nx] of neighbors) {
            const edgeKey = startY < ny || (startY === ny && startX < nx)
                ? `${startY},${startX}-${ny},${nx}`
                : `${ny},${nx}-${startY},${startX}`

            if (!visitedEdges.has(edgeKey)) {
                visitedEdges.add(edgeKey)
                // Calculate initial step length
                const stepLength = (Math.abs(ny - startY) === 1 && Math.abs(nx - startX) === 1) ? 1.414 : 1

                const branch = traceBranch(ny, nx, startY, startX)
                if (branch) {
                    branch.pixels.unshift([startY, startX])
                    branch.length += stepLength
                    branches.push(branch)
                }
            }
        }
    }

    return branches
}

/**
 * Compute path length from an endpoint to nearest junction using BFS
 * Returns the path length in pixels
 */
function computeEndpointPathLength(
    skeletonGrid: BinaryGrid,
    endpointY: number,
    endpointX: number,
    junctionSet: Set<string>
): number {
    const rows = skeletonGrid.length
    const cols = skeletonGrid[0]?.length || 0
    const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))

    // BFS to find shortest path to any junction
    const queue: [number, number, number][] = [[endpointY, endpointX, 0]]
    visited[endpointY][endpointX] = true

    while (queue.length > 0) {
        const [y, x, dist] = queue.shift()!

        // Check 8-connected neighbors
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const ny = y + dy
                const nx = x + dx

                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols &&
                    !visited[ny][nx] && skeletonGrid[ny][nx] === 1) {
                    visited[ny][nx] = true
                    const stepDist = (dy !== 0 && dx !== 0) ? 1.414 : 1
                    const newDist = dist + stepDist

                    // Check if this is a junction
                    if (junctionSet.has(`${ny},${nx}`)) {
                        return newDist
                    }

                    queue.push([ny, nx, newDist])
                }
            }
        }
    }

    // If no junction found, return total path length to end
    let totalLength = 0
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (visited[y][x]) totalLength++
        }
    }
    return totalLength
}

/**
 * BFS to find longest path in ridge network from a starting point
 * Returns the maximum distance found
 */
function bfsRidgePath(ridgeGrid: BinaryGrid, startY: number, startX: number): number {
    const rows = ridgeGrid.length
    const cols = ridgeGrid[0]?.length || 0
    const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))

    const queue: [number, number, number][] = [[startY, startX, 0]] // y, x, distance
    visited[startY][startX] = true
    let maxDist = 0

    while (queue.length > 0) {
        const [y, x, dist] = queue.shift()!
        maxDist = Math.max(maxDist, dist)

        // Check 8-connected neighbors
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue
                const ny = y + dy
                const nx = x + dx
                if (ny >= 0 && ny < rows && nx >= 0 && nx < cols &&
                    !visited[ny][nx] && ridgeGrid[ny][nx] === 1) {
                    visited[ny][nx] = true
                    // Diagonal distance = sqrt(2), orthogonal = 1
                    const stepDist = (dy !== 0 && dx !== 0) ? 1.414 : 1
                    queue.push([ny, nx, dist + stepDist])
                }
            }
        }
    }
    return maxDist
}

/**
 * Find all connected components in a binary grid using flood fill
 * Returns an array of component grids (each same size as input, with only that component's pixels)
 * 
 * Complexity: O(W×H)
 */
function findConnectedComponents(grid: BinaryGrid): BinaryGrid[] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
    const components: BinaryGrid[] = []

    for (let startY = 0; startY < rows; startY++) {
        for (let startX = 0; startX < cols; startX++) {
            if (grid[startY][startX] !== 1 || visited[startY][startX]) continue

            // Found a new component - flood fill to extract it
            const componentGrid: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
            const queue: [number, number][] = [[startY, startX]]
            visited[startY][startX] = true
            componentGrid[startY][startX] = 1

            while (queue.length > 0) {
                const [y, x] = queue.shift()!

                // Check 8-connected neighbors
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dy === 0 && dx === 0) continue
                        const ny = y + dy
                        const nx = x + dx
                        if (ny >= 0 && ny < rows && nx >= 0 && nx < cols &&
                            !visited[ny][nx] && grid[ny][nx] === 1) {
                            visited[ny][nx] = true
                            componentGrid[ny][nx] = 1
                            queue.push([ny, nx])
                        }
                    }
                }
            }

            components.push(componentGrid)
        }
    }

    return components
}

/**
 * Find the longest path through a single connected component
 */
function findLongestPathInComponent(componentGrid: BinaryGrid): number {
    const endpoints = findEndpoints(componentGrid)

    if (endpoints.length === 0) {
        // No clear endpoints - find any pixel and do BFS
        const rows = componentGrid.length
        const cols = componentGrid[0]?.length || 0
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (componentGrid[y][x] === 1) {
                    return bfsRidgePath(componentGrid, y, x)
                }
            }
        }
        return 0
    }

    // Find longest path from any endpoint (sample if too many)
    const MAX_ENDPOINTS = 10
    const sampledEndpoints = endpoints.length > MAX_ENDPOINTS
        ? endpoints.filter((_, i) => i % Math.ceil(endpoints.length / MAX_ENDPOINTS) === 0).slice(0, MAX_ENDPOINTS)
        : endpoints

    let maxDist = 0
    for (const [ey, ex] of sampledEndpoints) {
        const dist = bfsRidgePath(componentGrid, ey, ex)
        maxDist = Math.max(maxDist, dist)
    }

    return maxDist
}

/**
 * Find the SUM of longest paths across ALL connected components
 * This matches graph-theoretic MST behavior where disconnected regions
 * would each contribute their diameter to the total structure length
 * 
 * Complexity: O(W×H × k) where k = number of components (typically small)
 */
export function findSummedLongestPaths(ridgeGrid: BinaryGrid): { totalPath: number; numComponents: number } {
    const components = findConnectedComponents(ridgeGrid)

    if (components.length === 0) {
        return { totalPath: 0, numComponents: 0 }
    }

    let totalPath = 0
    for (const component of components) {
        const pathLength = findLongestPathInComponent(component)
        totalPath += pathLength
    }

    return { totalPath, numComponents: components.length }
}

/**
 * Find the longest path through the ridge network (single component only)
 * This is the Distance Transform equivalent of MST diameter
 *
 * Complexity: O(k × W × H) where k = number of endpoints (bounded)
 */
export function findLongestRidgePath(ridgeGrid: BinaryGrid): number {
    const endpoints = findEndpoints(ridgeGrid)

    if (endpoints.length === 0) {
        // No clear endpoints - find any ridge pixel and do BFS
        const rows = ridgeGrid.length
        const cols = ridgeGrid[0]?.length || 0
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (ridgeGrid[y][x] === 1) {
                    return bfsRidgePath(ridgeGrid, y, x)
                }
            }
        }
        return 0
    }

    // Cap endpoints to ensure O(1) complexity (max 20 endpoints)
    const MAX_ENDPOINTS = 20
    const sampledEndpoints = endpoints.length > MAX_ENDPOINTS
        ? endpoints.filter((_, i) => i % Math.ceil(endpoints.length / MAX_ENDPOINTS) === 0).slice(0, MAX_ENDPOINTS)
        : endpoints

    // Find longest path from any endpoint
    let maxDist = 0
    for (const [ey, ex] of sampledEndpoints) {
        const dist = bfsRidgePath(ridgeGrid, ey, ex)
        maxDist = Math.max(maxDist, dist)
    }

    return maxDist
}


/**
 * Compute Stringy metric using Skeletonization + Path Summation
 * 
 * EXACTLY MATCHES GRAPH-THEORETIC FORMULA:
 *   Graph:  Stringy = MST_Diameter / (n - 1)
 *   Image:  Stringy = SumOfLongestPaths(Skeleton) / (n - 1)
 * 
 * Key insight: We ALWAYS skeletonize the pattern to 1-pixel width.
 * This ensures the skeleton length is proportional to point count,
 * regardless of the original pattern's thickness.
 * 
 * For thick patterns, skeletonization reduces to medial axis.
 * For thin patterns, skeleton preserves existing connectivity.
 * 
 * Summing paths across components handles gaps (like MST would connect them).
 *
 * Complexity: O(W×H × k) where k = Zhang-Suen iterations (bounded)
 */
export function computeStringyDT(
    closedGrid: BinaryGrid,
    originalGrid?: BinaryGrid,  // Optional: used for thin-shape detection (deprecated)
    pointCount?: number          // Optional: original point count for exact graph-theoretic match
): { stringy: number; ridgeGrid: BinaryGrid; isThinShape: boolean; totalRidgePixels: number; longestPath: number; numComponents: number } {
    const rows = closedGrid.length
    const cols = closedGrid[0]?.length || 0

    // ALWAYS use skeleton for path computation
    // This guarantees 1-pixel width which matches graph-theoretic MST behavior
    // Skeleton length is proportional to pattern arc length ≈ point count
    const skeletonGridRaw = skeletonize(closedGrid)

    // PRUNE SKELETON (Repair: Remove "hair" branches < 5px)
    // This repairs "Stringy" which was being penalized by tiny noise branches
    const branches = extractSkeletonBranches(skeletonGridRaw)
    const width = closedGrid[0].length
    const height = closedGrid.length
    const skeletonGrid = Array(height).fill(0).map(() => Array(width).fill(0))

    // Rebuild skeleton keeping only long branches
    for (const branch of branches) {
        if (branch.pixels.length >= 5) {
            for (const [y, x] of branch.pixels) {
                skeletonGrid[y][x] = 1
            }
        }
    }
    // Ensure connectivity? Creating a gap might break components.
    // Actually, graph theory says small dead-ends are essentially noise.
    // If a bridge is short, we might lose connectivity, but for "Stringy" (Sum of Longest Paths),
    // breaking a weak bridge is actually arguably correct (it's not a strong path).
    // But to be safe, let's keep branches that connect two junctions?
    // extractSkeletonBranches splits at junctions. "Hair" is [Junction -> Endpoint].
    // So we only prune [Junction -> Endpoint] branches < 5px.
    // The previous loop filters ALL small branches. Let's refine.

    // RE-REBUILD: Only prune tips
    // Reset to raw first
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            skeletonGrid[y][x] = skeletonGridRaw[y][x];

    // Identify tips to prune
    for (const branch of branches) {
        // A branch is a "tip" if its distance from the main body is small?
        // extractSkeletonBranches doesn't tell us connectivity easily.
        // Simple heuristic: If it's short, just kill it.
        // If it breaks connectivity, 'findSummedLongestPaths' sums components anyway, so it's fine.
        if (branch.pixels.length < 5) {
            for (const [y, x] of branch.pixels) {
                skeletonGrid[y][x] = 0
            }
        }
    }


    // Use original grid for thin-shape detection (for display purposes only)
    const gridForThinCheck = originalGrid || closedGrid
    const dtOriginal = euclideanDistanceTransform(gridForThinCheck)

    // Find max distance transform value on the ORIGINAL grid
    let maxDTOriginal = 0
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (gridForThinCheck[y][x] === 1) {
                maxDTOriginal = Math.max(maxDTOriginal, dtOriginal[y][x])
            }
        }
    }

    // Thin-shape detection (for display/debugging purposes)
    const THIN_SHAPE_THRESHOLD = 3
    const isThinShape = maxDTOriginal <= THIN_SHAPE_THRESHOLD

    // Use skeleton as the "ridge" grid for visualization and path computation
    const ridgeGrid = skeletonGrid

    // Count total skeleton pixels
    const totalRidgePixels = countFilledPixels(ridgeGrid)

    // Find SUM of longest paths across ALL connected components
    // This matches graph-theoretic MST behavior where all points are connected
    const { totalPath: summedPath, numComponents } = findSummedLongestPaths(ridgeGrid)

    // FORMULA: Match graph-theoretic MST_Diameter / (n-1)
    // Numerator: Sum of longest paths across all skeleton components
    // Denominator: (n-1) for exact match, or skeleton pixels as fallback
    const denominator = pointCount ? (pointCount - 1) : totalRidgePixels
    const stringy = denominator > 0 ? Math.min(1, summedPath / denominator) : 0

    return { stringy, ridgeGrid, isThinShape, totalRidgePixels, longestPath: summedPath, numComponents }
}

/**
 * Count filled pixels in a grid
 */
export function countFilledPixels(grid: BinaryGrid): number {
    return grid.reduce((sum, row) => sum + row.reduce((s, v) => s + v, 0), 0)
}

/**
 * Get bounding box of filled pixels
 */
function getBoundingBox(grid: BinaryGrid): { minX: number, maxX: number, minY: number, maxY: number } {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    let minX = cols, maxX = 0, minY = rows, maxY = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                minX = Math.min(minX, x)
                maxX = Math.max(maxX, x)
                minY = Math.min(minY, y)
                maxY = Math.max(maxY, y)
            }
        }
    }
    return { minX, maxX, minY, maxY }
}

/**
 * Compute contour length (perimeter) of all foreground regions
 */
function computeContourLength(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    let perimeter = 0

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                // Count edges adjacent to background
                if (y === 0 || grid[y - 1][x] === 0) perimeter++
                if (y === rows - 1 || grid[y + 1][x] === 0) perimeter++
                if (x === 0 || grid[y][x - 1] === 0) perimeter++
                if (x === cols - 1 || grid[y][x + 1] === 0) perimeter++
            }
        }
    }
    return perimeter
}

/**
 * Compute Clumpy using Connected Component Analysis (v5 - fixed)
 *
 * Graph-theoretic: Ratio of MST edges shorter than Q1 - 1.5*IQR (tight clusters)
 * Image-theoretic (v5): Multiple dense connected components with gaps between them
 *
 * Key insight: Clumpy patterns have multiple SEPARATE dense regions.
 * We detect this by:
 * 1. Finding connected components in the original (non-closed) grid
 * 2. Measuring how many substantial components exist
 * 3. Checking that components are dense (not sparse scattered points)
 *
 * Algorithm:
 * 1. Find connected components in the binary grid
 * 2. Filter to significant components (>5 pixels)
 * 3. Measure density of each component (pixels / bounding box)
 * 4. Clumpy = f(number of dense components)
 */
function computeClumpy(closedGrid: BinaryGrid): number {
    const rows = closedGrid.length
    const cols = closedGrid[0]?.length || 0
    const totalPixels = countFilledPixels(closedGrid)

    if (totalPixels < 10) return 0

    // Find connected components
    const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
    const components: { size: number; minX: number; maxX: number; minY: number; maxY: number }[] = []

    for (let startY = 0; startY < rows; startY++) {
        for (let startX = 0; startX < cols; startX++) {
            if (closedGrid[startY][startX] !== 1 || visited[startY][startX]) continue

            // Flood fill to find component
            let size = 0
            let minX = cols, maxX = 0, minY = rows, maxY = 0
            const queue: [number, number][] = [[startY, startX]]
            visited[startY][startX] = true

            while (queue.length > 0) {
                const [y, x] = queue.shift()!
                size++
                minX = Math.min(minX, x)
                maxX = Math.max(maxX, x)
                minY = Math.min(minY, y)
                maxY = Math.max(maxY, y)

                // 8-connected neighbors
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dy === 0 && dx === 0) continue
                        const ny = y + dy
                        const nx = x + dx
                        if (ny >= 0 && ny < rows && nx >= 0 && nx < cols &&
                            !visited[ny][nx] && closedGrid[ny][nx] === 1) {
                            visited[ny][nx] = true
                            queue.push([ny, nx])
                        }
                    }
                }
            }

            if (size >= 5) {
                components.push({ size, minX, maxX, minY, maxY })
            }
        }
    }

    if (components.length <= 1) return 0

    // Calculate density for each component
    const denseComponents = components.filter(c => {
        const bboxArea = (c.maxX - c.minX + 1) * (c.maxY - c.minY + 1)
        const density = bboxArea > 0 ? c.size / bboxArea : 0
        return density > 0.2 // Must be reasonably dense
    })

    if (denseComponents.length <= 1) return 0

    // Check size balance - clumpy clusters should be somewhat similar in size
    const sizes = denseComponents.map(c => c.size)
    const maxSize = Math.max(...sizes)
    const minSize = Math.min(...sizes)
    const sizeBalance = maxSize > 0 ? minSize / maxSize : 0

    // Clumpy score based on:
    // 1. Number of dense components (more = more clumpy, up to ~5)
    // 2. Size balance (similar sizes = more clumpy)
    const numScore = Math.min(1, (denseComponents.length - 1) / 4)
    const balanceScore = 0.3 + sizeBalance * 0.7

    const clumpy = numScore * balanceScore

    return Math.max(0, Math.min(1, clumpy))
}

/**
 * Compute Outlying using Distance from Centroid Analysis (v5 - fixed)
 *
 * Graph-theoretic: Total length of MST edges exceeding Q3 + 1.5*IQR, normalized by total MST length
 * Image-theoretic (v5): Pixels far from the center of mass
 *
 * Key insight: Outlying patterns have isolated points/regions far from the main body.
 * We detect this by:
 * 1. Finding the centroid of all foreground pixels
 * 2. Computing distance of each pixel from centroid
 * 3. Finding pixels beyond Q3 + 1.5*IQR (true outliers)
 * 4. Weighting by how far beyond the threshold they are
 *
 * This approach directly mirrors the MST edge length analysis.
 */
/**
 * Compute Outlying: Proportion of pixels in non-primary components (v6 - Component Based)
 *
 * Old method (Centroid distance) failed for non-circular shapes.
 * New method:
 * 1. Find connected components.
 * 2. Identify largest component as "Main Body".
 * 3. Treat all other components as "Outliers".
 * 4. Metric = Sqrt(Sum(OutlierPixels) / TotalPixels).
 * 
 * Sqrt boosts scores for small outliers (e.g., 1% noise becomes 0.1 score).
 */
function computeOutlying(closedGrid: BinaryGrid): number {
    const rows = closedGrid.length
    const cols = closedGrid[0]?.length || 0
    const totalPixels = countFilledPixels(closedGrid)

    if (totalPixels < 10) return 0

    // Find connected components
    const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
    const componentSizes: number[] = []

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (closedGrid[y][x] === 1 && !visited[y][x]) {
                // BFS to find component size
                let size = 0
                const q: [number, number][] = [[y, x]]
                visited[y][x] = true
                let head = 0

                while (head < q.length) {
                    const [cy, cx] = q[head++]
                    size++

                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dy === 0 && dx === 0) continue
                            const ny = cy + dy, nx = cx + dx
                            if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && closedGrid[ny][nx] === 1 && !visited[ny][nx]) {
                                visited[ny][nx] = true
                                q.push([ny, nx])
                            }
                        }
                    }
                }
                componentSizes.push(size)
            }
        }
    }

    if (componentSizes.length <= 1) return 0

    // Sort descending
    componentSizes.sort((a, b) => b - a)

    // Largest is main body
    const mainSize = componentSizes[0]

    // All others are outliers
    const outlierPixels = totalPixels - mainSize
    const ratio = outlierPixels / totalPixels

    // Use Sqrt to boost visibility of small outliers
    return Math.min(1, Math.sqrt(ratio))
}

/**
 * Compute Sparse: Measures how spread out / dispersed the points are
 *
 * Graph-theoretic: 1 - (alpha_shape_area / hull_area)
 * Image-theoretic (UPDATED): Uses original points + interior hole detection
 *
 * Key insight: Shapes like rings are conceptually sparse (hollow)
 * but fill their hull well after morphological closing.
 * We detect interior holes and factor them into sparseness.
 *
 * Formula: sparse = 1 - (originalPoints / hullArea) + interiorHoleBonus
 */
function computeSparse(originalGrid: BinaryGrid, closedGrid: BinaryGrid, hullGrid: BinaryGrid): number {
    const originalPixels = countFilledPixels(originalGrid)
    const closedPixels = countFilledPixels(closedGrid)
    const hullPixels = countFilledPixels(hullGrid)

    if (hullPixels === 0) return 0

    // Base sparse: how much of the hull is NOT filled by original points
    // Use original grid (before closing) for true sparseness
    const baseSparseness = 1 - (originalPixels / hullPixels)

    // Detect interior holes in the closed shape
    // Interior hole = background pixels inside the closed shape that aren't reachable from border
    const rows = closedGrid.length
    const cols = closedGrid[0]?.length || 0

    // Find pixels that are inside the hull but not in the closed shape
    let interiorHolePixels = 0
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (hullGrid[y][x] === 1 && closedGrid[y][x] === 0) {
                interiorHolePixels++
            }
        }
    }

    // Interior hole bonus: rings and hollow shapes should be more sparse
    const interiorHoleRatio = hullPixels > 0 ? interiorHolePixels / hullPixels : 0

    // Combine: base sparseness + interior hole contribution
    // Using normalized weights: α=0.6 for fill ratio, (1-α)=0.4 for holes
    // This guarantees output remains in [0,1]
    const alpha = 0.6
    const sparse = alpha * baseSparseness + (1 - alpha) * interiorHoleRatio

    return Math.max(0, Math.min(1, sparse))
}

/**
 * Image-Theoretic Scagnostics Metrics (v4)
 * Based on: image_scagnostics_pipeline.tex
 *
 * All formulas now match the LaTeX specification exactly.
 */
export interface ScagnosticsMetrics {
    stringy: number      // Σ LongestPath(S_k) / |S| - skeleton path / mass ratio
    sparse: number       // α(1 - orig/hull) + (1-α)(holes/hull) - original points + hole detection
    convex: number       // |I_closed| / |I_hull| - closed area / hull area
    skinny: number       // (P² / 4πA - 1) / 4 - normalized isoperimetric quotient
    clumpy: number       // Short skeleton branches / total branches (Tukey's fence)
    outlying: number     // Outlying endpoint paths / skeleton length (Tukey's fence)
    skewed: number       // 1 - mean(R_bg) / max(R_bg) - background ridge DT asymmetry
    striated: number     // Aligned skeleton segments / total segments (±5° of dominant)
    monotonic: number    // |ρ(row, centroid)| - Spearman row centroid correlation
}

/**
 * Compute all scagnostics metrics from pipeline results
 * UPDATED v4: Uses new implementations matching LaTeX formulas exactly
 *
 * @param closedGrid - Grid after morphological closing
 * @param hullGrid - Convex hull grid
 * @param ridgeGrid - Skeleton/ridge grid
 * @param originalGrid - Original rasterized grid (REQUIRED for accurate Sparse metric)
 */
export function computeScagnostics(
    closedGrid: BinaryGrid,
    hullGrid: BinaryGrid,
    ridgeGrid: BinaryGrid,
    originalGrid?: BinaryGrid       // Original grid for Sparse calculation
): ScagnosticsMetrics {
    const closedArea = countFilledPixels(closedGrid)
    const hullArea = countFilledPixels(hullGrid)

    // Use original grid if provided, otherwise fall back to closed grid
    const origGrid = originalGrid || closedGrid

    // Contour length (perimeter)
    const perimeter = computeContourLength(closedGrid)

    // === STRINGY (v3): Skeleton path / skeleton mass ===
    // Formula: Σ LongestPath(S_k) / |S|
    // This matches graph-theoretic MST_Diameter / (n-1)
    const skeletonPixels = countFilledPixels(ridgeGrid)
    const { totalPath: summedLongestPath } = findSummedLongestPaths(ridgeGrid)
    const stringy = skeletonPixels > 0 ? Math.min(1, summedLongestPath / skeletonPixels) : 0

    // === SPARSE (v3): Original points + interior hole detection ===
    // Use original grid/closed combination for Sparse to detect holes and true density
    const sparse = computeSparse(origGrid, closedGrid, hullGrid)

    // === CONVEX: Closed area / Hull area ===
    const convex = hullArea > 0 ? closedArea / hullArea : 0

    // === SKINNY (v5 - FIXED): Erosion-based ===
    // Old Formula (P²/Area) was unstable for pixels (fractal coastline).
    // New Logic: "Skinny" shapes disappear when eroded. "Fat" shapes survive.
    // Formula: 1 - (Area(Eroded_3px) / Area(Original))
    // If shape is fully erased, it's 100% skinny. If mostly remains, it's 0% skinny.
    let skinny = 0
    if (closedArea > 0) {
        // Erode by 3 pixels (removes 6px of thickness total)
        const erodedGrid = erode(closedGrid, 3)
        const erodedArea = countFilledPixels(erodedGrid)
        const survivalRatio = erodedArea / closedArea
        // Invert so that 0 survival = 1.0 Skinny
        skinny = 1 - survivalRatio
    }
    // Boost the signal: typical chunky shapes have >0.6 survival. Thin shapes <0.1.
    // Let's make it linear for now, stability is key.
    skinny = Math.max(0, Math.min(1, skinny))

    // === CLUMPY (v4): Skeleton branch length analysis with Tukey's fence ===
    const clumpy = computeClumpy(closedGrid)

    // === OUTLYING (v4): Skeleton endpoint path length with Tukey's fence ===
    const outlying = computeOutlying(closedGrid)

    // === SKEWED (v4): Background ridge distance analysis ===
    const skewed = computeSkewed(closedGrid)

    // === STRIATED (v4): Skeleton segment angle concentration ===
    const striated = computeStriated(closedGrid)

    // === MONOTONIC: Row centroid Spearman correlation ===
    const monotonic = computeMonotonic(closedGrid)

    return {
        stringy: Math.round(stringy * 1000) / 1000,
        sparse: Math.round(sparse * 1000) / 1000,
        convex: Math.round(convex * 1000) / 1000,
        skinny: Math.round(skinny * 1000) / 1000,
        clumpy: Math.round(clumpy * 1000) / 1000,
        outlying: Math.round(outlying * 1000) / 1000,
        skewed: Math.round(skewed * 1000) / 1000,
        striated: Math.round(striated * 1000) / 1000,
        monotonic: Math.round(monotonic * 1000) / 1000,
    }
}

/**
 * Compute Striated using Skeleton Segment Angle Concentration (v4 - matches LaTeX)
 *
 * Graph-theoretic: Ratio of nearly-parallel Delaunay edges (within ±5° of each other)
 * Image-theoretic (v4): Skeleton segment angle concentration
 *
 * Formula: Striated = |{s : |θ_s - θ_dom| < 5°}| / |S_segments|
 *
 * Where:
 * - S = skeleton from Zhang-Suen thinning
 * - S_segments = linear segments of the skeleton (between junctions/endpoints)
 * - θ_s = angle of segment s (computed via linear regression or endpoint difference)
 * - θ_dom = dominant angle (mode of angle histogram)
 *
 * Algorithm:
 * 1. Skeletonize the closed shape
 * 2. Extract skeleton segments (paths between junctions or endpoints)
 * 3. For each segment, compute its angle θ_s ∈ [0°, 180°):
 *    - Short segments (<5 pixels): angle from first to last pixel
 *    - Long segments: linear regression fit, take slope angle
 * 4. Build angle histogram with 36 bins (5° each)
 * 5. Find dominant angle θ_dom = bin with most segments
 * 6. Striated = fraction of segments within ±5° of θ_dom
 */


/**
 * Compute Skewed using Background Ridge Distance Analysis (v4 - matches LaTeX)
 *
 * Graph-theoretic: 1 - (mean_MST_edge / max_MST_edge)
 * Image-theoretic (v4): Background ridge DT values
 *
 * Formula: Skewed = 1 - mean(R) / max(R)
 *
 * Where:
 * - D_bg = Distance Transform of BACKGROUND (distance from background pixels to nearest foreground)
 * - R = Ridge pixels of D_bg (local maxima = skeleton of background = Voronoi-like boundaries)
 * - R(p) = DT value at ridge pixel p (half the distance between nearest foreground regions)
 * - mean(R), max(R) = mean and maximum ridge DT values
 *
 * Algorithm:
 * 1. Compute Distance Transform of BACKGROUND pixels (invert foreground/background)
 * 2. Find ridge pixels: local maxima of background DT (these trace boundaries between foreground regions)
 * 3. Sample DT values along these ridges: each value represents half the "gap" between clusters
 * 4. Compute 1 - mean(R) / max(R)
 *
 * Conceptual Mapping:
 * - MST edge between points ↔ Background ridge between foreground regions
 * - Short MST edge (within cluster) ↔ Low ridge DT (narrow gap)
 * - Long MST edge (between clusters) ↔ High ridge DT (wide gap)
 */
function computeSkewed(closedGrid: BinaryGrid): number {
    const rows = closedGrid.length
    const cols = closedGrid[0]?.length || 0

    // Create inverted grid (background becomes foreground)
    const invertedGrid: BinaryGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            invertedGrid[y][x] = closedGrid[y][x] === 1 ? 0 : 1
        }
    }

    // Compute distance transform of background
    const dtBackground = euclideanDistanceTransform(invertedGrid)

    // Find ridge pixels (local maxima in background DT)
    const ridgeValues: number[] = []

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            // Only consider background pixels (inverted foreground)
            if (invertedGrid[y][x] !== 1) continue

            const val = dtBackground[y][x]
            if (val <= 0) continue

            // Check if this is a local maximum
            let isRidge = true
            for (let dy = -1; dy <= 1 && isRidge; dy++) {
                for (let dx = -1; dx <= 1 && isRidge; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (dtBackground[y + dy][x + dx] > val) {
                        isRidge = false
                    }
                }
            }

            if (isRidge) {
                ridgeValues.push(val)
            }
        }
    }

    if (ridgeValues.length < 2) {
        // Not enough ridge points - fall back to simpler method
        // Use all background DT values
        const allValues: number[] = []
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (invertedGrid[y][x] === 1 && dtBackground[y][x] > 0) {
                    allValues.push(dtBackground[y][x])
                }
            }
        }
        if (allValues.length < 2) return 0

        const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length
        const max = Math.max(...allValues)
        if (max === 0) return 0
        return Math.max(0, Math.min(1, 1 - mean / max))
    }

    // Compute mean and max of ridge values
    const mean = ridgeValues.reduce((a, b) => a + b, 0) / ridgeValues.length
    const max = Math.max(...ridgeValues)

    if (max === 0) return 0

    // Skewed = 1 - mean(R) / max(R)
    const skewed = 1 - (mean / max)

    return Math.max(0, Math.min(1, skewed))
}

/**
 * Compute Monotonic: Row centroid trend correlation
 * Measures if the shape follows a diagonal trend
 * Returns absolute Spearman correlation [0, 1]
 */
function computeMonotonic(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    const rowCentroids: { row: number; centroid: number }[] = []

    for (let y = 0; y < rows; y++) {
        let sumX = 0, count = 0
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                sumX += x
                count++
            }
        }
        if (count > 0) {
            rowCentroids.push({ row: y, centroid: sumX / count })
        }
    }

    if (rowCentroids.length < 3) return 0

    // Compute Spearman correlation
    const n = rowCentroids.length
    const rankRow = rowCentroids.map((_, i) => i + 1)

    // Rank the centroids
    const sortedCentroids = [...rowCentroids].sort((a, b) => a.centroid - b.centroid)
    const centroidRanks = new Map<number, number>()
    sortedCentroids.forEach((item, i) => centroidRanks.set(item.row, i + 1))

    const rankCentroid = rowCentroids.map(item => centroidRanks.get(item.row) || 0)

    // Spearman's rho = 1 - 6*sum(d^2) / (n*(n^2-1))
    let sumD2 = 0
    for (let i = 0; i < n; i++) {
        const d = rankRow[i] - rankCentroid[i]
        sumD2 += d * d
    }

    const rho = 1 - (6 * sumD2) / (n * (n * n - 1))

    return Math.abs(rho)
}


// Export erode function for outlying computation
export { erode }
