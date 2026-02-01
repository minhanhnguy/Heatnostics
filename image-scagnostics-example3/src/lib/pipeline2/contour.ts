/**
 * Contour Module - Marching Squares subpixel contour extraction
 */
import type { FloatGrid, Point, Polyline } from '../types'

// Edge indices: 0=top, 1=right, 2=bottom, 3=left
// For each cell code (0-15), define which edges are connected
// Format: [entryEdge, exitEdge] pairs - when entering from entryEdge, exit via exitEdge
const EDGE_TABLE: Record<number, [number, number][]> = {
    0: [],           // All outside - no contour
    1: [[2, 3]],     // BL inside
    2: [[1, 2]],     // BR inside
    3: [[1, 3]],     // BL+BR inside
    4: [[0, 1]],     // TR inside
    5: [[0, 3], [1, 2]], // TR+BL inside (saddle - ambiguous)
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

function getExitEdge(code: number, entryEdge: number): number {
    const pairs = EDGE_TABLE[code]
    for (const [entry, exit] of pairs) {
        if (entry === entryEdge) return exit
        if (exit === entryEdge) return entry
    }
    return -1
}

function getAdjacentCell(x: number, y: number, edge: number): { x: number; y: number; entryEdge: number } {
    switch (edge) {
        case 0: return { x, y: y - 1, entryEdge: 2 }
        case 1: return { x: x + 1, y, entryEdge: 3 }
        case 2: return { x, y: y + 1, entryEdge: 0 }
        case 3: return { x: x - 1, y, entryEdge: 1 }
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
    const visitedEdges = new Set<string>()

    const getCell = (x: number, y: number): number => {
        if (x < 0 || y < 0 || x >= cols - 1 || y >= rows - 1) return -1
        let code = 0
        if (grid[y][x] >= threshold) code |= 8
        if (grid[y][x + 1] >= threshold) code |= 4
        if (grid[y + 1][x + 1] >= threshold) code |= 2
        if (grid[y + 1][x] >= threshold) code |= 1
        return code
    }

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
            case 0: return lerp(tl, tr, x, y, x + 1, y)
            case 1: return lerp(tr, br, x + 1, y, x + 1, y + 1)
            case 2: return lerp(bl, br, x, y + 1, x + 1, y + 1)
            case 3: return lerp(tl, bl, x, y, x, y + 1)
            default: return { x: x + 0.5, y: y + 0.5 }
        }
    }

    const getStartingEdges = (code: number): number[] => {
        const edges: number[] = []
        const pairs = EDGE_TABLE[code]
        for (const [e1, e2] of pairs) {
            edges.push(e1, e2)
        }
        return [...new Set(edges)]
    }

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
            if (visitedEdges.has(edgeKey)) break
            visitedEdges.add(edgeKey)

            const exitEdge = getExitEdge(code, entryEdge)
            if (exitEdge === -1) break

            const point = getEdgePoint(x, y, exitEdge)
            contour.push(point)

            visitedEdges.add(`${x},${y},${exitEdge}`)

            const next = getAdjacentCell(x, y, exitEdge)
            x = next.x
            y = next.y
            entryEdge = next.entryEdge

            if (x === startX && y === startY && entryEdge === startEdge) break
        }

        return contour
    }

    for (let y = 0; y < rows - 1; y++) {
        for (let x = 0; x < cols - 1; x++) {
            const code = getCell(x, y)
            if (code === 0 || code === 15 || code === -1) continue

            const startingEdges = getStartingEdges(code)

            for (const edge of startingEdges) {
                const edgeKey = `${x},${y},${edge}`
                if (visitedEdges.has(edgeKey)) continue

                const contour = traceContour(x, y, edge)

                if (contour.length >= 3) {
                    contours.push(contour)
                }
            }
        }
    }

    return contours
}
