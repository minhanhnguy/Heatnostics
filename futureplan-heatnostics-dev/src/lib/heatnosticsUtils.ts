/**
 * Heatnostics Utilities - Grid-Based Geometric Measures for Heatmaps
 * 
 * Implements the three geometric approaches from "Developing Heatmap Scagnostics":
 * 1. Grid Support (Alpha Shape) - For data availability
 * 2. Morse-Smale Complex - For topology (peaks/valleys)
 * 3. EMD Transition - For temporal flow analysis
 */

// ============================================================
// TYPES
// ============================================================

export interface GridCell {
    row: number       // Year index (0 = oldest year)
    col: number       // Position index
    value: number     // Condition score
    isValid: boolean  // Whether cell has data
    length: number    // Segment length for this specific cell
}

export interface HeatmapGrid {
    cells: GridCell[][]        // 2D array [row][col]
    rows: number               // Number of years
    cols: number               // Number of positions
    years: number[]            // Actual year values
    positions: number[]        // Actual position start values
    positionEnds: number[]     // Actual position end values (for segment widths)
    minValue: number
    maxValue: number
    minPosition: number        // Min position for scaling
    maxPosition: number        // Max position for scaling
}

export interface CriticalPoint {
    row: number
    col: number
    value: number
    type: 'maximum' | 'minimum' | 'saddle'
}

export interface MorseSmaleResult {
    criticalPoints: CriticalPoint[]
    regions: { id: number; cells: [number, number][]; minima: CriticalPoint; maxima: CriticalPoint }[]
    ridges: { from: CriticalPoint; to: CriticalPoint; path: [number, number][] }[]
}

export interface EMDResult {
    totalFlux: number                           // Sum of all transport costs
    yearPairFluxes: { year1: number; year2: number; flux: number; drift: number }[]
    transportPaths: { from: number; to: number; year: number; mass: number }[][]
}

export interface GridSupportResult {
    porosity: number           // Hole area / Alpha Shape area (per PDF)
    fragmentation: number      // Number of connected data components
    components: { id: number; cells: [number, number][]; size: number }[]
    boundary: [number, number][]  // Outer boundary of valid cells
    hullArea: number           // Alpha shape area (not bounding box)
    holeArea: number           // Number of holes inside alpha shape
    eulerCharacteristic: number // Components - Holes
    alphaShape: [number, number][]  // Alpha shape polygon vertices [row, col]
    // New metrics
    distressIntensity: number  // Skewness of score distribution (negative = more damage hotspots)
    errorNoise: number         // High-frequency oscillation rate (0-1, higher = suspicious data)
    diagonalConnectivity: number // Ratio of diagonally-connected vs 4-connected components
}

// ============================================================
// GRID CONSTRUCTION
// ============================================================

/**
 * Convert PMIS features to a 2D heatmap grid
 * X-axis: Position (reference marker), Y-axis: Year
 * 
 * Uses ACTUAL segment positions, not arbitrary bins.
 * Each unique segment position becomes a column in the grid.
 */
export function buildHeatmapGrid(
    features: Array<{ properties: Record<string, any> }>,
    positionBins?: number, // Ignored - kept for API compatibility
    yearRange?: [number, number]
): HeatmapGrid {
    // Extract all valid points with their actual positions and lengths
    const points: { position: number; length: number; year: number; score: number }[] = []

    for (const f of features) {
        const props = f.properties
        const score = Number(props.TX_CONDITION_SCORE)
        if (isNaN(score) || score <= 0) continue

        const markerNbr = Number(props.TX_BEG_REF_MARKER_NBR) || 0
        const markerDisp = Number(props.TX_BEG_REF_MRKR_DISP) || 0
        const position = Math.round((markerNbr + markerDisp) * 100) / 100 // Round to 2 decimals
        const length = Number(props.TX_LENGTH) || 0.5 // Default to 0.5 if no length
        const year = Number(props.EFF_YEAR) || 0
        if (year === 0) continue

        points.push({ position, length, year, score })
    }

    if (points.length === 0) {
        return {
            cells: [],
            rows: 0,
            cols: 0,
            years: [],
            positions: [],
            positionEnds: [],
            minValue: 0,
            maxValue: 0,
            minPosition: 0,
            maxPosition: 0
        }
    }

    // Get unique years
    const uniqueYears = [...new Set(points.map(p => p.year))].sort((a, b) => a - b)
    const minYear = yearRange?.[0] ?? Math.min(...uniqueYears)
    const maxYear = yearRange?.[1] ?? Math.max(...uniqueYears)
    const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)

    // Get unique ACTUAL positions and sort them
    const uniquePositions = [...new Set(points.map(p => p.position))].sort((a, b) => a - b)

    // Compute end positions for each unique start position
    // Use the typical length at each position
    const positionLengths = new Map<number, number>()
    for (const p of points) {
        if (!positionLengths.has(p.position) || p.length > positionLengths.get(p.position)!) {
            positionLengths.set(p.position, p.length)
        }
    }
    const positionEnds = uniquePositions.map(pos => pos + (positionLengths.get(pos) || 0.5))

    // Get overall position range
    const minPosition = Math.min(...uniquePositions)
    const maxPosition = Math.max(...positionEnds)

    // Initialize grid with empty cells
    const cells: GridCell[][] = years.map((_, row) =>
        uniquePositions.map((_, col) => ({
            row,
            col,
            value: 0,
            isValid: false,
            length: 0  // Will be set per-cell during aggregation
        }))
    )

    // Create position lookup map for O(1) column lookup
    const positionToCol = new Map<number, number>()
    uniquePositions.forEach((pos, idx) => positionToCol.set(pos, idx))

    // Aggregate values and lengths into grid cells
    const cellCounts: number[][] = years.map(() => uniquePositions.map(() => 0))
    const cellSums: number[][] = years.map(() => uniquePositions.map(() => 0))
    const cellLengths: number[][] = years.map(() => uniquePositions.map(() => 0))

    for (const p of points) {
        const rowIdx = p.year - minYear
        const colIdx = positionToCol.get(p.position)

        if (rowIdx >= 0 && rowIdx < years.length && colIdx !== undefined) {
            cellCounts[rowIdx][colIdx]++
            cellSums[rowIdx][colIdx] += p.score
            // Use the max length if multiple segments at same year/position
            cellLengths[rowIdx][colIdx] = Math.max(cellLengths[rowIdx][colIdx], p.length)
        }
    }

    // Compute average values and set lengths
    let minValue = Infinity
    let maxValue = -Infinity

    for (let row = 0; row < years.length; row++) {
        for (let col = 0; col < uniquePositions.length; col++) {
            if (cellCounts[row][col] > 0) {
                const avgValue = cellSums[row][col] / cellCounts[row][col]
                cells[row][col].value = avgValue
                cells[row][col].isValid = true
                cells[row][col].length = cellLengths[row][col] || 0.5  // Default to 0.5 if no length
                minValue = Math.min(minValue, avgValue)
                maxValue = Math.max(maxValue, avgValue)
            }
        }
    }

    return {
        cells,
        rows: years.length,
        cols: uniquePositions.length,
        years,
        positions: uniquePositions,
        positionEnds,
        minValue: minValue === Infinity ? 0 : minValue,
        maxValue: maxValue === -Infinity ? 0 : maxValue,
        minPosition,
        maxPosition
    }
}

// ============================================================
// GRID SUPPORT (Alpha Shape / Porosity)
// ============================================================

/**
 * Compute skewness of a distribution (distress intensity)
 * Negative skew = more damage hotspots (tail towards low scores)
 * Positive skew = mostly damaged with some good spots
 */
function computeSkewness(values: number[]): number {
    if (values.length < 3) return 0

    const n = values.length
    const mean = values.reduce((s, v) => s + v, 0) / n
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n
    const stddev = Math.sqrt(variance)

    if (stddev === 0) return 0

    const skew = values.reduce((s, v) => s + ((v - mean) / stddev) ** 3, 0) / n
    return skew
}

/**
 * Compute error noise as oscillation rate
 * High values (near 1) indicate suspicious high-frequency changes
 * Low values (near 0) indicate smooth, realistic data
 */
function computeOscillationRate(values: number[]): number {
    if (values.length < 3) return 0

    let oscillations = 0
    for (let i = 1; i < values.length - 1; i++) {
        const diff1 = values[i] - values[i - 1]  // Previous direction
        const diff2 = values[i + 1] - values[i]  // Next direction

        // Sign change = oscillation (peak or valley)
        if ((diff1 > 0 && diff2 < 0) || (diff1 < 0 && diff2 > 0)) {
            oscillations++
        }
    }

    // Normalize by maximum possible oscillations
    return oscillations / (values.length - 2)
}

/**
 * Compute connected components using 4-connected flood fill (no diagonals)
 * Used to compare with 8-connected to detect diagonal-only connections
 */
function floodFill4Connected(
    grid: HeatmapGrid,
    startRow: number,
    startCol: number,
    visited: boolean[][]
): [number, number][] {
    const component: [number, number][] = []
    const stack: [number, number][] = [[startRow, startCol]]
    // Only 4-directional neighbors (no diagonals)
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]]

    while (stack.length > 0) {
        const [row, col] = stack.pop()!

        if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) continue
        if (visited[row][col]) continue
        if (!grid.cells[row][col].isValid) continue

        visited[row][col] = true
        component.push([row, col])

        for (const [dr, dc] of directions) {
            stack.push([row + dr, col + dc])
        }
    }

    return component
}

/**
 * Compute connected components using flood fill (8-connected including diagonals)
 */
function floodFill(
    grid: HeatmapGrid,
    startRow: number,
    startCol: number,
    visited: boolean[][]
): [number, number][] {
    const component: [number, number][] = []
    const stack: [number, number][] = [[startRow, startCol]]
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]

    while (stack.length > 0) {
        const [row, col] = stack.pop()!

        if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) continue
        if (visited[row][col]) continue
        if (!grid.cells[row][col].isValid) continue

        visited[row][col] = true
        component.push([row, col])

        for (const [dr, dc] of directions) {
            stack.push([row + dr, col + dc])
        }
    }

    return component
}

/**
 * Compute Grid Support metrics (Porosity, Fragmentation)
 * 
 * Per "Developing Heatmap Scagnostics" PDF:
 * - Porosity = Hole area / Alpha Shape area (ratio of holes INSIDE the concave boundary)
 * - Fragmentation = Number of connected data components
 * - Euler Characteristic = Components - Holes
 * 
 * Uses a row-wise concave hull (alpha shape) instead of bounding box.
 */
export function computeGridSupport(grid: HeatmapGrid): GridSupportResult {
    if (grid.rows === 0 || grid.cols === 0) {
        return {
            porosity: 1, fragmentation: 0, components: [], boundary: [],
            hullArea: 0, holeArea: 0, eulerCharacteristic: 0, alphaShape: [],
            distressIntensity: 0, errorNoise: 0, diagonalConnectivity: 0
        }
    }

    // Find connected components of VALID cells
    const visited: boolean[][] = Array(grid.rows).fill(null).map(() => Array(grid.cols).fill(false))
    const components: { id: number; cells: [number, number][]; size: number }[] = []

    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            if (!visited[row][col] && grid.cells[row][col].isValid) {
                const cells = floodFill(grid, row, col, visited)
                if (cells.length > 0) {
                    components.push({
                        id: components.length,
                        cells,
                        size: cells.length
                    })
                }
            }
        }
    }

    if (components.length === 0) {
        return {
            porosity: 1, fragmentation: 0, components: [], boundary: [],
            hullArea: 0, holeArea: 0, eulerCharacteristic: 0, alphaShape: [],
            distressIntensity: 0, errorNoise: 0, diagonalConnectivity: 0
        }
    }

    // Compute row-wise concave hull (alpha shape)
    // For each row, find leftmost and rightmost valid column
    const rowExtents = new Map<number, { minCol: number; maxCol: number }>()

    for (let row = 0; row < grid.rows; row++) {
        let minCol = -1
        let maxCol = -1
        for (let col = 0; col < grid.cols; col++) {
            if (grid.cells[row][col].isValid) {
                if (minCol === -1) minCol = col
                maxCol = col
            }
        }
        if (minCol !== -1) {
            rowExtents.set(row, { minCol, maxCol })
        }
    }

    // Build alpha shape polygon (for visualization and area calculation)
    const alphaShape: [number, number][] = []
    const sortedRows = [...rowExtents.keys()].sort((a, b) => a - b)

    // Left edge (top to bottom)
    for (const row of sortedRows) {
        const extent = rowExtents.get(row)!
        alphaShape.push([row, extent.minCol])
    }
    // Right edge (bottom to top)
    for (let i = sortedRows.length - 1; i >= 0; i--) {
        const row = sortedRows[i]
        const extent = rowExtents.get(row)!
        alphaShape.push([row, extent.maxCol])
    }

    // Calculate alpha shape area (sum of cells within the concave hull per row)
    let hullArea = 0
    for (const [, extent] of rowExtents) {
        hullArea += (extent.maxCol - extent.minCol + 1)
    }

    // Count holes inside the alpha shape (invalid cells within each row's extent)
    let holeArea = 0
    for (const [row, extent] of rowExtents) {
        for (let col = extent.minCol; col <= extent.maxCol; col++) {
            if (!grid.cells[row][col].isValid) {
                holeArea++
            }
        }
    }

    // Porosity = Hole area / Alpha Shape area (per PDF)
    const porosity = hullArea > 0 ? holeArea / hullArea : 0

    // Euler Characteristic = Components - Hole Components
    // Count connected hole components within alpha shape
    const holeVisited: boolean[][] = Array(grid.rows).fill(null).map(() => Array(grid.cols).fill(false))
    let holeComponents = 0

    for (const [row, extent] of rowExtents) {
        for (let col = extent.minCol; col <= extent.maxCol; col++) {
            if (!holeVisited[row][col] && !grid.cells[row][col].isValid) {
                // Flood fill for hole (only within alpha shape bounds)
                const stack: [number, number][] = [[row, col]]
                while (stack.length > 0) {
                    const [r, c] = stack.pop()!
                    const rowExt = rowExtents.get(r)
                    if (!rowExt) continue
                    if (c < rowExt.minCol || c > rowExt.maxCol) continue
                    if (holeVisited[r][c]) continue
                    if (grid.cells[r][c].isValid) continue
                    holeVisited[r][c] = true
                    stack.push([r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1])
                }
                holeComponents++
            }
        }
    }

    const eulerCharacteristic = components.length - holeComponents

    // Extract boundary of largest component
    let boundary: [number, number][] = []
    if (components.length > 0) {
        const largest = components.reduce((a, b) => a.size > b.size ? a : b)
        boundary = extractBoundary(grid, largest.cells)
    }

    // =============================================
    // NEW METRICS: Distress Intensity, Error Noise, Diagonal Connectivity
    // =============================================

    // Collect all valid scores for distress intensity and error noise
    const allScores: number[] = []
    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            if (grid.cells[row][col].isValid) {
                allScores.push(grid.cells[row][col].value)
            }
        }
    }

    // Distress Intensity = skewness of score distribution
    // Negative = more damage hotspots (tail towards low scores)
    const distressIntensity = computeSkewness(allScores)

    // Error Noise = oscillation rate per row, averaged
    // High values indicate suspicious high-frequency changes
    let totalOscillation = 0
    let rowsWithData = 0
    for (let row = 0; row < grid.rows; row++) {
        const rowScores: number[] = []
        for (let col = 0; col < grid.cols; col++) {
            if (grid.cells[row][col].isValid) {
                rowScores.push(grid.cells[row][col].value)
            }
        }
        if (rowScores.length >= 3) {
            totalOscillation += computeOscillationRate(rowScores)
            rowsWithData++
        }
    }
    const errorNoise = rowsWithData > 0 ? totalOscillation / rowsWithData : 0

    // Diagonal Connectivity = ratio of 4-connected components to 8-connected components
    // If equal, data is well-connected horizontally/vertically (ratio = 1)
    // If 4-connected has more components, data relies on diagonal connections (ratio > 1)
    const visited4: boolean[][] = Array(grid.rows).fill(null).map(() => Array(grid.cols).fill(false))
    let components4Count = 0
    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            if (!visited4[row][col] && grid.cells[row][col].isValid) {
                const cells = floodFill4Connected(grid, row, col, visited4)
                if (cells.length > 0) {
                    components4Count++
                }
            }
        }
    }
    // Ratio: higher means more diagonal-only connections
    const diagonalConnectivity = components.length > 0
        ? (components4Count - components.length) / components4Count
        : 0

    return {
        porosity,
        fragmentation: components.length,
        components: components.sort((a, b) => b.size - a.size),
        boundary,
        hullArea,
        holeArea,
        eulerCharacteristic,
        alphaShape,
        distressIntensity,
        errorNoise,
        diagonalConnectivity
    }
}

/**
 * Extract boundary cells from a component
 */
function extractBoundary(grid: HeatmapGrid, cells: [number, number][]): [number, number][] {
    const cellSet = new Set(cells.map(([r, c]) => `${r},${c}`))
    const boundary: [number, number][] = []
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]]

    for (const [row, col] of cells) {
        for (const [dr, dc] of directions) {
            const nr = row + dr
            const nc = col + dc
            const key = `${nr},${nc}`

            // If neighbor is outside grid or not in component, this is a boundary cell
            if (nr < 0 || nr >= grid.rows || nc < 0 || nc >= grid.cols || !cellSet.has(key)) {
                boundary.push([row, col])
                break
            }
        }
    }

    return boundary
}

/**
 * Compute Alpha Shape as a row-wise concave hull.
 * For each row, finds the leftmost and rightmost valid cells,
 * creating a polygon that tightly wraps around the data.
 * 
 * Returns an array of [row, col] points forming the hull polygon (clockwise).
 */
export function computeAlphaShapePolygon(grid: HeatmapGrid): { polygon: [number, number][]; area: number } {
    if (grid.rows === 0 || grid.cols === 0) {
        return { polygon: [], area: 0 }
    }

    // For each row, find leftmost and rightmost valid column
    const rowExtents: { row: number; minCol: number; maxCol: number }[] = []

    for (let row = 0; row < grid.rows; row++) {
        let minCol = -1
        let maxCol = -1
        for (let col = 0; col < grid.cols; col++) {
            if (grid.cells[row][col].isValid) {
                if (minCol === -1) minCol = col
                maxCol = col
            }
        }
        if (minCol !== -1) {
            rowExtents.push({ row, minCol, maxCol })
        }
    }

    if (rowExtents.length === 0) {
        return { polygon: [], area: 0 }
    }

    // Build polygon: go down the left edge, then up the right edge
    const leftEdge: [number, number][] = []
    const rightEdge: [number, number][] = []

    for (const { row, minCol, maxCol } of rowExtents) {
        leftEdge.push([row, minCol])
        rightEdge.push([row, maxCol])
    }

    // Polygon is: left edge top-to-bottom, then right edge bottom-to-top
    const polygon: [number, number][] = [
        ...leftEdge,
        ...rightEdge.reverse()
    ]

    // Calculate area using shoelace formula (in grid units)
    // Each cell in the row contributes (maxCol - minCol + 1) to the area
    let area = 0
    for (const { minCol, maxCol } of rowExtents) {
        area += (maxCol - minCol + 1)
    }

    return { polygon, area }
}

/**
 * Count holes inside the alpha shape polygon.
 * A hole is an invalid cell that is "inside" the concave hull.
 */
function countHolesInAlphaShape(grid: HeatmapGrid, rowExtents: Map<number, { minCol: number; maxCol: number }>): number {
    let holes = 0

    for (const [row, extent] of rowExtents.entries()) {
        for (let col = extent.minCol; col <= extent.maxCol; col++) {
            if (!grid.cells[row][col].isValid) {
                holes++
            }
        }
    }

    return holes
}

// ============================================================
// MORSE-SMALE COMPLEX
// ============================================================

/**
 * Get 8-connected neighbors for a cell
 */
function getNeighbors(row: number, col: number, rows: number, cols: number): [number, number][] {
    const neighbors: [number, number][] = []
    const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]

    for (const [dr, dc] of directions) {
        const nr = row + dr
        const nc = col + dc
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
            neighbors.push([nr, nc])
        }
    }

    return neighbors
}

/**
 * Identify critical points (maxima, minima, saddles) in the grid
 */
export function findCriticalPoints(grid: HeatmapGrid): CriticalPoint[] {
    const criticalPoints: CriticalPoint[] = []

    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            const cell = grid.cells[row][col]
            if (!cell.isValid) continue

            const neighbors = getNeighbors(row, col, grid.rows, grid.cols)
                .filter(([r, c]) => grid.cells[r][c].isValid)

            if (neighbors.length === 0) continue

            let higherCount = 0
            let lowerCount = 0

            for (const [nr, nc] of neighbors) {
                const nVal = grid.cells[nr][nc].value
                if (nVal > cell.value) higherCount++
                else if (nVal < cell.value) lowerCount++
            }

            // Maximum: all neighbors are lower or equal
            if (higherCount === 0 && lowerCount > 0) {
                criticalPoints.push({ row, col, value: cell.value, type: 'maximum' })
            }
            // Minimum: all neighbors are higher or equal
            else if (lowerCount === 0 && higherCount > 0) {
                criticalPoints.push({ row, col, value: cell.value, type: 'minimum' })
            }
            // Saddle detection (simplified): mixed higher/lower with specific pattern
            else if (higherCount > 0 && lowerCount > 0) {
                // Simple saddle detection: count sign changes around the cell
                let signChanges = 0
                const orderedNeighbors = [
                    [row - 1, col - 1], [row - 1, col], [row - 1, col + 1],
                    [row, col + 1], [row + 1, col + 1], [row + 1, col],
                    [row + 1, col - 1], [row, col - 1]
                ].filter(([r, c]) => r >= 0 && r < grid.rows && c >= 0 && c < grid.cols && grid.cells[r][c].isValid)

                let prevSign = 0
                for (let i = 0; i < orderedNeighbors.length; i++) {
                    const [nr, nc] = orderedNeighbors[i]
                    const diff = grid.cells[nr][nc].value - cell.value
                    const sign = diff > 0 ? 1 : (diff < 0 ? -1 : 0)
                    if (sign !== 0 && prevSign !== 0 && sign !== prevSign) {
                        signChanges++
                    }
                    if (sign !== 0) prevSign = sign
                }

                // Check wrap-around
                if (orderedNeighbors.length >= 2) {
                    const firstDiff = grid.cells[orderedNeighbors[0][0]][orderedNeighbors[0][1]].value - cell.value
                    const firstSign = firstDiff > 0 ? 1 : (firstDiff < 0 ? -1 : 0)
                    if (prevSign !== 0 && firstSign !== 0 && prevSign !== firstSign) {
                        signChanges++
                    }
                }

                // Saddle point has >= 4 sign changes
                if (signChanges >= 4) {
                    criticalPoints.push({ row, col, value: cell.value, type: 'saddle' })
                }
            }
        }
    }

    return criticalPoints
}

/**
 * Trace gradient path from a cell to a critical point
 */
function traceGradientPath(
    grid: HeatmapGrid,
    startRow: number,
    startCol: number,
    ascending: boolean
): [number, number][] {
    const path: [number, number][] = [[startRow, startCol]]
    let currentRow = startRow
    let currentCol = startCol
    const maxSteps = grid.rows * grid.cols

    for (let step = 0; step < maxSteps; step++) {
        const neighbors = getNeighbors(currentRow, currentCol, grid.rows, grid.cols)
            .filter(([r, c]) => grid.cells[r][c].isValid)

        if (neighbors.length === 0) break

        let bestNeighbor: [number, number] | null = null
        let bestValue = grid.cells[currentRow][currentCol].value

        for (const [nr, nc] of neighbors) {
            const nVal = grid.cells[nr][nc].value
            if (ascending ? nVal > bestValue : nVal < bestValue) {
                bestValue = nVal
                bestNeighbor = [nr, nc]
            }
        }

        if (!bestNeighbor) break // Reached critical point

        currentRow = bestNeighbor[0]
        currentCol = bestNeighbor[1]
        path.push([currentRow, currentCol])
    }

    return path
}

/**
 * Compute Morse-Smale Complex
 */
export function computeMorseSmale(grid: HeatmapGrid): MorseSmaleResult {
    if (grid.rows === 0 || grid.cols === 0) {
        return { criticalPoints: [], regions: [], ridges: [] }
    }

    const criticalPoints = findCriticalPoints(grid)
    const maxima = criticalPoints.filter(p => p.type === 'maximum')
    const minima = criticalPoints.filter(p => p.type === 'minimum')

    // Assign each cell to a region based on gradient flow
    const cellToMaxima: (CriticalPoint | null)[][] = Array(grid.rows).fill(null).map(() =>
        Array(grid.cols).fill(null)
    )
    const cellToMinima: (CriticalPoint | null)[][] = Array(grid.rows).fill(null).map(() =>
        Array(grid.cols).fill(null)
    )

    // Trace ascending gradient from each valid cell
    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            if (!grid.cells[row][col].isValid) continue

            const ascPath = traceGradientPath(grid, row, col, true)
            const lastAsc = ascPath[ascPath.length - 1]
            const nearMax = maxima.find(m => m.row === lastAsc[0] && m.col === lastAsc[1])
            if (nearMax) cellToMaxima[row][col] = nearMax

            const descPath = traceGradientPath(grid, row, col, false)
            const lastDesc = descPath[descPath.length - 1]
            const nearMin = minima.find(m => m.row === lastDesc[0] && m.col === lastDesc[1])
            if (nearMin) cellToMinima[row][col] = nearMin
        }
    }

    // Build regions (pairs of maxima-minima)
    const regionMap = new Map<string, [number, number][]>()

    for (let row = 0; row < grid.rows; row++) {
        for (let col = 0; col < grid.cols; col++) {
            const max = cellToMaxima[row][col]
            const min = cellToMinima[row][col]
            if (max && min) {
                const key = `${max.row},${max.col}-${min.row},${min.col}`
                if (!regionMap.has(key)) regionMap.set(key, [])
                regionMap.get(key)!.push([row, col])
            }
        }
    }

    const regions: MorseSmaleResult['regions'] = []
    let regionId = 0
    for (const [key, cells] of regionMap) {
        const [maxKey, minKey] = key.split('-')
        const [maxRow, maxCol] = maxKey.split(',').map(Number)
        const [minRow, minCol] = minKey.split(',').map(Number)

        const max = maxima.find(m => m.row === maxRow && m.col === maxCol)
        const min = minima.find(m => m.row === minRow && m.col === minCol)

        if (max && min) {
            regions.push({ id: regionId++, cells, minima: min, maxima: max })
        }
    }

    // Build ridges: connect maxima to saddles, saddles to minima
    const saddles = criticalPoints.filter(p => p.type === 'saddle')
    const ridges: MorseSmaleResult['ridges'] = []

    for (const saddle of saddles) {
        // Find connected maxima and minima via gradient
        const ascPath = traceGradientPath(grid, saddle.row, saddle.col, true)
        const lastAsc = ascPath[ascPath.length - 1]
        const connMax = maxima.find(m => m.row === lastAsc[0] && m.col === lastAsc[1])

        const descPath = traceGradientPath(grid, saddle.row, saddle.col, false)
        const lastDesc = descPath[descPath.length - 1]
        const connMin = minima.find(m => m.row === lastDesc[0] && m.col === lastDesc[1])

        if (connMax) {
            ridges.push({ from: saddle, to: connMax, path: ascPath })
        }
        if (connMin) {
            ridges.push({ from: saddle, to: connMin, path: descPath })
        }
    }

    return { criticalPoints, regions, ridges }
}

// ============================================================
// EMD TRANSITION
// ============================================================

/**
 * Compute Earth Mover's Distance between two 1D distributions
 * Using simplified 1D Wasserstein distance
 */
function computeEMD1D(dist1: number[], dist2: number[]): { distance: number; drift: number } {
    // Normalize distributions
    const sum1 = dist1.reduce((s, v) => s + v, 0) || 1
    const sum2 = dist2.reduce((s, v) => s + v, 0) || 1

    const norm1 = dist1.map(v => v / sum1)
    const norm2 = dist2.map(v => v / sum2)

    // Compute CDF
    const cdf1: number[] = []
    const cdf2: number[] = []
    let cumSum1 = 0, cumSum2 = 0

    for (let i = 0; i < norm1.length; i++) {
        cumSum1 += norm1[i]
        cumSum2 += norm2[i]
        cdf1.push(cumSum1)
        cdf2.push(cumSum2)
    }

    // EMD = integral of |CDF1 - CDF2|
    let emd = 0
    let signedDrift = 0 // Positive = mass moved right, Negative = mass moved left

    for (let i = 0; i < cdf1.length; i++) {
        const diff = cdf1[i] - cdf2[i]
        emd += Math.abs(diff)
        signedDrift += diff
    }

    // Normalize by number of bins
    emd /= cdf1.length
    signedDrift /= cdf1.length

    return { distance: emd, drift: signedDrift }
}

/**
 * Compute EMD Transition metrics between consecutive years
 */
export function computeEMDTransition(grid: HeatmapGrid): EMDResult {
    if (grid.rows < 2) {
        return { totalFlux: 0, yearPairFluxes: [], transportPaths: [] }
    }

    const yearPairFluxes: EMDResult['yearPairFluxes'] = []
    const transportPaths: EMDResult['transportPaths'] = []
    let totalFlux = 0

    for (let row = 0; row < grid.rows - 1; row++) {
        // Extract distribution for this year and next year (column values)
        const dist1 = grid.cells[row].map(c => c.isValid ? c.value : 0)
        const dist2 = grid.cells[row + 1].map(c => c.isValid ? c.value : 0)

        const { distance, drift } = computeEMD1D(dist1, dist2)

        yearPairFluxes.push({
            year1: grid.years[row],
            year2: grid.years[row + 1],
            flux: distance,
            drift
        })

        totalFlux += distance

        // Create simplified transport paths for visualization
        const paths: { from: number; to: number; year: number; mass: number }[] = []
        for (let col = 0; col < grid.cols; col++) {
            if (grid.cells[row][col].isValid && grid.cells[row + 1][col].isValid) {
                const valueDiff = Math.abs(grid.cells[row + 1][col].value - grid.cells[row][col].value)
                if (valueDiff > 0) {
                    paths.push({
                        from: col,
                        to: col,
                        year: grid.years[row],
                        mass: valueDiff
                    })
                }
            }
        }
        transportPaths.push(paths)
    }

    return {
        totalFlux: totalFlux / (grid.rows - 1), // Average flux per year transition
        yearPairFluxes,
        transportPaths
    }
}

// ============================================================
// HEATNOSTICS SUMMARY
// ============================================================

export interface HeatnosticsResult {
    gridSupport: GridSupportResult
    morseSmale: MorseSmaleResult
    emdTransition: EMDResult
}

/**
 * Compute all Heatnostics metrics for a set of features
 * NOTE: No score filtering is applied - all valid scores are included
 */
export function computeHeatnostics(
    features: Array<{ properties: Record<string, any> }>
): HeatnosticsResult {
    const grid = buildHeatmapGrid(features)

    return {
        gridSupport: computeGridSupport(grid),
        morseSmale: computeMorseSmale(grid),
        emdTransition: computeEMDTransition(grid)
    }
}

/**
 * Heatnostics metric labels for display
 */
export const HEATNOSTICS_LABELS = [
    { key: 'porosity', label: 'Porosity', category: 'support' },
    { key: 'fragmentation', label: 'Fragmentation', category: 'support' },
    { key: 'distressIntensity', label: 'Distress Intensity', category: 'support' },
    { key: 'errorNoise', label: 'Error Noise', category: 'support' },
    { key: 'diagonalConnectivity', label: 'Diagonal Connectivity', category: 'support' },
    { key: 'peaks', label: 'Peaks', category: 'morseSmale' },
    { key: 'valleys', label: 'Valleys', category: 'morseSmale' },
    { key: 'flux', label: 'Transition Flux', category: 'emd' },
    { key: 'drift', label: 'Drift', category: 'emd' }
]
