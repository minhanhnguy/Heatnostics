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
 * Find the longest path through the ridge network
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
 * Compute Stringy metric using Distance Transform + Ridge Detection
 * Better MST semantic match than skeletonization
 * 
 * Stringy = Longest ridge path / Bounding diagonal
 * 
 * Complexity: O(W×H) - faster than skeleton's O(W×H×k)
 */
export function computeStringyDT(closedGrid: BinaryGrid): { stringy: number; ridgeGrid: BinaryGrid } {
    const rows = closedGrid.length
    const cols = closedGrid[0]?.length || 0

    // Step 1: Euclidean Distance Transform - O(W×H)
    const dt = euclideanDistanceTransform(closedGrid)

    // Step 2: Find ridge pixels (local maxima) - O(W×H)
    const ridgeGrid = findRidgePixels(dt, closedGrid)

    // Step 3: Find longest path through ridges - O(k×W×H) where k is bounded
    const longestPath = findLongestRidgePath(ridgeGrid)

    // Step 4: Compute bounding diagonal for normalization
    let minX = cols, maxX = 0, minY = rows, maxY = 0
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (closedGrid[y][x] === 1) {
                minX = Math.min(minX, x)
                maxX = Math.max(maxX, x)
                minY = Math.min(minY, y)
                maxY = Math.max(maxY, y)
            }
        }
    }
    const boundingDiagonal = Math.sqrt(
        Math.pow(maxX - minX, 2) + Math.pow(maxY - minY, 2)
    ) || 1

    // Normalize stringy to [0, 1]
    const stringy = Math.min(1, longestPath / boundingDiagonal)

    return { stringy, ridgeGrid }
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
 * Count connected components using flood fill
 */
function countConnectedComponents(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const visited: boolean[][] = Array.from({ length: rows }, () => Array(cols).fill(false))
    let count = 0

    const floodFill = (startY: number, startX: number) => {
        const stack: [number, number][] = [[startY, startX]]
        while (stack.length > 0) {
            const [y, x] = stack.pop()!
            if (y < 0 || y >= rows || x < 0 || x >= cols) continue
            if (visited[y][x] || grid[y][x] !== 1) continue
            visited[y][x] = true
            stack.push([y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1])
        }
    }

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1 && !visited[y][x]) {
                floodFill(y, x)
                count++
            }
        }
    }
    return count
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
 * Find skeleton endpoints (pixels with exactly 1 neighbor)
 */
function findSkeletonEndpoints(skeleton: BinaryGrid): [number, number][] {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
    const endpoints: [number, number][] = []

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (skeleton[y][x] !== 1) continue

            // Count 8-connected neighbors
            let neighborCount = 0
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (skeleton[y + dy][x + dx] === 1) neighborCount++
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
 * BFS to find longest path from a given starting point in skeleton
 * Returns the farthest distance found
 */
function bfsLongestPath(skeleton: BinaryGrid, startY: number, startX: number): number {
    const rows = skeleton.length
    const cols = skeleton[0]?.length || 0
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
                    !visited[ny][nx] && skeleton[ny][nx] === 1) {
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
 * Find the longest path through the skeleton (like MST diameter)
 * This captures the "stringy" semantic: elongated linear patterns
 */
function findLongestSkeletonPath(skeleton: BinaryGrid): number {
    const endpoints = findSkeletonEndpoints(skeleton)

    if (endpoints.length === 0) {
        // No clear endpoints - find any skeleton pixel and do BFS twice
        const rows = skeleton.length
        const cols = skeleton[0]?.length || 0
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                if (skeleton[y][x] === 1) {
                    return bfsLongestPath(skeleton, y, x)
                }
            }
        }
        return 0
    }

    // Standard approach: BFS from first endpoint to find farthest point
    // Then BFS from that point to find the true longest path
    const [startY, startX] = endpoints[0]
    let maxDist = 0

    // Find longest path from any endpoint
    for (const [ey, ex] of endpoints.slice(0, Math.min(endpoints.length, 10))) {
        const dist = bfsLongestPath(skeleton, ey, ex)
        maxDist = Math.max(maxDist, dist)
    }

    return maxDist
}

/**
 * Compute erosion survival ratio (for Clumpy)
 * Dense clusters survive multiple erosions, sparse areas disappear
 * This captures the "clumpy" semantic: presence of tight clusters
 */
function erosionSurvivalRatio(closedGrid: BinaryGrid, radius: number = 2): number {
    const originalArea = countFilledPixels(closedGrid)
    if (originalArea === 0) return 0

    // Apply stronger erosion
    const erodedOnce = erode(closedGrid, radius)
    const erodedArea = countFilledPixels(erodedOnce)

    // Survival ratio: what fraction survives erosion?
    // High survival = dense compact regions (clumpy)
    // Low survival = sparse scattered points (not clumpy)
    const survivalRatio = erodedArea / originalArea

    return survivalRatio
}

/**
 * Image-Theoretic Scagnostics Metrics
 * Based on: image_scagnostics_pipeline.tex
 * Updated: Now uses Distance Transform + Ridge Detection for Stringy (better MST match)
 */
export interface ScagnosticsMetrics {
    stringy: number      // Longest ridge path / Diagonal (via Distance Transform - better MST match)
    sparse: number       // 1 - (Closed area / Hull area)
    convex: number       // Closed area / Hull area
    skinny: number       // Perimeter² / (4π × Area)
    clumpy: number       // Erosion survival ratio (like short MST edges)
    outlying: number     // Erosion residue ratio
    skewed: number       // 1 - mean(D)/max(D) - Distance Transform distribution asymmetry (same as graph)
    striated: number     // Row fill variance (inverse)
    monotonic: number    // Row centroid correlation
}

/**
 * Compute all scagnostics metrics from pipeline results
 * Now uses Distance Transform + Ridge Detection for Stringy and Skewed
 */
export function computeScagnostics(
    closedGrid: BinaryGrid,
    hullGrid: BinaryGrid,
    ridgeGrid: BinaryGrid,
    distanceTransform?: number[][]  // Optional: pass for improved Skewed calculation
): ScagnosticsMetrics {
    const closedArea = countFilledPixels(closedGrid)
    const hullArea = countFilledPixels(hullGrid)

    const rows = closedGrid.length
    const cols = closedGrid[0]?.length || 0

    // Compute distance transform if not provided
    const dt = distanceTransform || euclideanDistanceTransform(closedGrid)

    // Bounding diagonal
    const bbox = getBoundingBox(closedGrid)
    const boundingDiagonal = Math.sqrt(
        Math.pow(bbox.maxX - bbox.minX, 2) + Math.pow(bbox.maxY - bbox.minY, 2)
    ) || 1

    // Contour length (perimeter)
    const perimeter = computeContourLength(closedGrid)

    // === Stringy = Longest ridge path / Diagonal (via Distance Transform) ===
    const longestPath = findLongestRidgePath(ridgeGrid)
    const stringy = boundingDiagonal > 0 ? Math.min(1, longestPath / boundingDiagonal) : 0

    // Convex and Sparse
    const convex = hullArea > 0 ? closedArea / hullArea : 0
    const sparse = 1 - convex

    // Skinny (normalized to [0,1])
    const skinnyRaw = closedArea > 0 ? (perimeter * perimeter) / (4 * Math.PI * closedArea) : 0
    const skinny = Math.min(1, skinnyRaw / 50)  // Normalize by typical max value

    // === Clumpy = Erosion survival ratio ===
    const clumpy = erosionSurvivalRatio(closedGrid, 2)

    // Outlying = Erosion residue ratio
    const erodedGrid = erode(closedGrid, 1)
    const erodedArea = countFilledPixels(erodedGrid)
    const erosionResidue = closedArea - erodedArea
    const outlying = closedArea > 0 ? erosionResidue / closedArea : 0

    // === UPDATED: Skewed = Distance Transform distribution asymmetry ===
    // Now equivalent to graph-theoretic: 1 - (mean_edge / max_edge)
    const skewed = computeSkewed(closedGrid, dt)

    // === Striated = Row fill variance ===
    const striated = computeStriated(closedGrid)

    // === Monotonic = Row centroid correlation ===
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
 * Compute Skewed: Distance Transform distribution asymmetry
 * 
 * Graph-theoretic: 1 - (mean_MST_edge / max_MST_edge)
 * Image-theoretic: 1 - (mean_distance / max_distance)
 * 
 * This measures asymmetry of "thickness" distribution:
 * - High skewed = many thin regions with a few very thick areas
 * - Low skewed = uniform thickness throughout
 * 
 * Now equivalent to graph-theoretic MST edge length asymmetry!
 */
function computeSkewed(grid: BinaryGrid, dt: number[][]): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    // Collect all distance values for foreground pixels
    const distances: number[] = []
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1 && dt[y][x] > 0) {
                distances.push(dt[y][x])
            }
        }
    }

    if (distances.length < 2) return 0

    // Compute mean and max
    const sum = distances.reduce((a, b) => a + b, 0)
    const mean = sum / distances.length
    const max = Math.max(...distances)

    if (max === 0) return 0

    // Skewed = 1 - (mean / max)
    // Same formula as graph-theoretic: 1 - (mean_edge / max_edge)
    const skewed = 1 - (mean / max)

    return Math.max(0, Math.min(1, skewed))
}

/**
 * Compute Striated: Detects horizontal banding patterns
 * 
 * Graph-theoretic: Ratio of nearly-parallel Delaunay edges
 * Image-theoretic: Combines two measures:
 *   1. Row fill consistency (low CV = similar fills per row)
 *   2. Horizontal spread ratio (wide rows = horizontal bands)
 * 
 * Returns 1 if highly striated (horizontal bands), 0 if irregular
 */
function computeStriated(grid: BinaryGrid): number {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    // Collect row fills AND row spans
    const rowFills: number[] = []
    const rowSpans: number[] = []  // Width of filled region in each row

    for (let y = 0; y < rows; y++) {
        let rowCount = 0
        let minX = cols, maxX = 0

        for (let x = 0; x < cols; x++) {
            if (grid[y][x] === 1) {
                rowCount++
                minX = Math.min(minX, x)
                maxX = Math.max(maxX, x)
            }
        }

        if (rowCount > 0) {
            rowFills.push(rowCount)
            rowSpans.push(maxX - minX + 1)
        }
    }

    if (rowFills.length < 2) return 0

    // Method 1: CV of row fills (consistency measure)
    const mean = rowFills.reduce((a, b) => a + b, 0) / rowFills.length
    const variance = rowFills.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / rowFills.length
    const coeffOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 0
    const cvScore = Math.max(0, 1 - coeffOfVariation)

    // Method 2: Horizontal spread ratio (wide rows = horizontal bands)
    // High span relative to grid width indicates horizontal extent
    const avgSpan = rowSpans.reduce((a, b) => a + b, 0) / rowSpans.length
    const horizontalRatio = avgSpan / cols

    // Method 3: Fill density per row (higher density = more striated)
    // Ratio of points to span in each row
    const densities = rowFills.map((fill, i) => rowSpans[i] > 0 ? fill / rowSpans[i] : 0)
    const avgDensity = densities.reduce((a, b) => a + b, 0) / densities.length

    // Combine: high CV score + high horizontal ratio + moderate density
    // Weight horizontal ratio heavily for striated detection
    const combinedScore = cvScore * 0.4 + horizontalRatio * 0.5 + avgDensity * 0.1

    return Math.max(0, Math.min(1, combinedScore))
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
