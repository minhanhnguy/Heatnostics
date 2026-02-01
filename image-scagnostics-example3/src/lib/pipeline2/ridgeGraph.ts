/**
 * Ridge Graph Module - Gradient-based graph construction
 * 
 * This module constructs a graph from the density field by:
 * 1. Computing gradient field ∇I(x,y) from the smoothed image
 * 2. Identifying critical points (local maxima become graph nodes)
 * 3. Tracing ridge lines via gradient descent to connect nodes
 * 4. Extracting edge lengths as geodesic distances along ridges
 */
import type { FloatGrid, Point } from '../types'

/**
 * Represents a node in the ridge graph (a local maximum)
 */
export interface RidgeNode {
    id: number
    position: Point
    value: number  // Density value at this peak
}

/**
 * Represents an edge in the ridge graph (a ridge line connecting two maxima)
 */
export interface RidgeEdge {
    from: number   // Node ID
    to: number     // Node ID
    path: Point[]  // The actual ridge path
    length: number // Geodesic length along the ridge
    weight: number // Can be used for average density along path
}

/**
 * The complete ridge graph structure
 */
export interface RidgeGraph {
    nodes: RidgeNode[]
    edges: RidgeEdge[]
    totalLength: number  // Sum of all edge lengths
    longestPath: number  // Longest path in the graph
}

/**
 * Compute gradient field from a smoothed density grid
 * Returns Ix (horizontal gradient) and Iy (vertical gradient)
 */
export function computeGradientField(grid: FloatGrid): {
    Ix: FloatGrid
    Iy: FloatGrid
    magnitude: FloatGrid
} {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    const Ix: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    const Iy: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))
    const magnitude: FloatGrid = Array.from({ length: rows }, () => Array(cols).fill(0))

    // Sobel-like central differences
    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            // Central difference gradients
            Ix[y][x] = (grid[y][x + 1] - grid[y][x - 1]) / 2
            Iy[y][x] = (grid[y + 1][x] - grid[y - 1][x]) / 2
            magnitude[y][x] = Math.sqrt(Ix[y][x] ** 2 + Iy[y][x] ** 2)
        }
    }

    return { Ix, Iy, magnitude }
}

/**
 * Find local maxima in the density grid (these become graph nodes)
 * Uses non-maximum suppression with 8-connectivity
 */
export function findLocalMaxima(grid: FloatGrid, minValue: number = 0.1): RidgeNode[] {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const nodes: RidgeNode[] = []
    let nodeId = 0

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            const val = grid[y][x]
            if (val < minValue) continue

            // Check if this is a local maximum (8-neighborhood)
            let isMax = true
            for (let dy = -1; dy <= 1 && isMax; dy++) {
                for (let dx = -1; dx <= 1 && isMax; dx++) {
                    if (dy === 0 && dx === 0) continue
                    if (grid[y + dy][x + dx] >= val) {
                        // Tie-breaker: prefer lower y, then lower x
                        if (grid[y + dy][x + dx] > val ||
                            (dy < 0) || (dy === 0 && dx < 0)) {
                            isMax = false
                        }
                    }
                }
            }

            if (isMax) {
                nodes.push({
                    id: nodeId++,
                    position: { x, y },
                    value: val
                })
            }
        }
    }

    return nodes
}

/**
 * Trace a path from a starting point following gradient descent
 * until we reach another local maximum or a boundary
 */
function traceGradientDescent(
    startX: number,
    startY: number,
    grid: FloatGrid,
    Ix: FloatGrid,
    Iy: FloatGrid,
    nodePositions: Map<string, number>  // "x,y" -> node ID
): { path: Point[]; endNodeId: number | null; length: number } {
    const rows = grid.length
    const cols = grid[0]?.length || 0
    const path: Point[] = [{ x: startX, y: startY }]

    let cx = startX
    let cy = startY
    let length = 0
    const visited = new Set<string>()
    visited.add(`${Math.round(cx)},${Math.round(cy)}`)

    const maxIterations = rows * cols
    let iterations = 0

    while (iterations < maxIterations) {
        iterations++

        // Check if we've reached a node
        const roundedKey = `${Math.round(cx)},${Math.round(cy)}`
        const nodeId = nodePositions.get(roundedKey)
        if (nodeId !== undefined && path.length > 1) {
            return { path, endNodeId: nodeId, length }
        }

        // Get gradient at current position (bilinear interpolation)
        const ix = Math.floor(cx)
        const iy = Math.floor(cy)

        if (ix < 1 || ix >= cols - 2 || iy < 1 || iy >= rows - 2) {
            break // Hit boundary
        }

        // Gradient points toward increasing values, so we follow the gradient (ascent)
        // to find connected peaks. But we want ridge lines, which follow the 
        // perpendicular to the gradient (along the ridge top).

        // For simplicity, we use gradient ascent to find the peak each point belongs to
        const gx = Ix[iy][ix]
        const gy = Iy[iy][ix]
        const gmag = Math.sqrt(gx * gx + gy * gy)

        if (gmag < 0.001) {
            // At a critical point (local max, min, or saddle)
            break
        }

        // Step in gradient direction (gradient ascent)
        const stepSize = 0.5
        const nx = cx + stepSize * gx / gmag
        const ny = cy + stepSize * gy / gmag

        // Check bounds
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) break

        const newKey = `${Math.round(nx)},${Math.round(ny)}`
        if (visited.has(newKey) && path.length > 3) {
            break // Avoid loops
        }
        visited.add(newKey)

        // Calculate step length
        length += Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2)

        cx = nx
        cy = ny
        path.push({ x: cx, y: cy })
    }

    // Check final position for node
    const finalKey = `${Math.round(cx)},${Math.round(cy)}`
    const endNodeId = nodePositions.get(finalKey) ?? null

    return { path, endNodeId, length }
}

/**
 * Trace ridge lines between local maxima using watershed-like approach
 * Each pixel is assigned to the peak it flows to via gradient ascent
 */
export function buildRidgeGraph(grid: FloatGrid, minPeakValue: number = 0.1): RidgeGraph {
    const rows = grid.length
    const cols = grid[0]?.length || 0

    // Step 1: Compute gradient field
    const { Ix, Iy } = computeGradientField(grid)

    // Step 2: Find local maxima (nodes)
    const nodes = findLocalMaxima(grid, minPeakValue)

    if (nodes.length === 0) {
        return { nodes: [], edges: [], totalLength: 0, longestPath: 0 }
    }

    // Create position lookup for fast node finding
    const nodePositions = new Map<string, number>()
    for (const node of nodes) {
        nodePositions.set(`${node.position.x},${node.position.y}`, node.id)
    }

    // Step 3: Assign each pixel to a peak via gradient ascent
    const peakAssignment: number[][] = Array.from({ length: rows }, () =>
        Array(cols).fill(-1)
    )

    for (const node of nodes) {
        peakAssignment[node.position.y][node.position.x] = node.id
    }

    // Flood-fill style gradient ascent from all pixels
    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            if (grid[y][x] <= 0 || peakAssignment[y][x] !== -1) continue

            // Trace gradient ascent to find which peak this pixel belongs to
            let cx = x, cy = y
            const path: Point[] = [{ x: cx, y: cy }]
            const maxSteps = rows + cols

            for (let step = 0; step < maxSteps; step++) {
                const ix = Math.floor(cx)
                const iy = Math.floor(cy)

                if (ix < 1 || ix >= cols - 2 || iy < 1 || iy >= rows - 2) break
                if (peakAssignment[iy][ix] !== -1) {
                    // Found assigned peak - assign entire path
                    const peakId = peakAssignment[iy][ix]
                    for (const p of path) {
                        const py = Math.floor(p.y)
                        const px = Math.floor(p.x)
                        if (py >= 0 && py < rows && px >= 0 && px < cols) {
                            peakAssignment[py][px] = peakId
                        }
                    }
                    break
                }

                // Gradient ascent step
                const gx = Ix[iy][ix]
                const gy = Iy[iy][ix]
                const gmag = Math.sqrt(gx * gx + gy * gy)

                if (gmag < 0.001) break

                cx += 0.5 * gx / gmag
                cy += 0.5 * gy / gmag
                path.push({ x: cx, y: cy })
            }
        }
    }

    // Step 4: Find edges by looking at adjacent pixels with different peak assignments
    const edgeMap = new Map<string, { from: number; to: number; points: Point[] }>()

    for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
            const peakA = peakAssignment[y][x]
            if (peakA === -1) continue

            // Check 4-neighbors for different peak assignments
            const neighbors = [
                { dy: 0, dx: 1 },
                { dy: 1, dx: 0 }
            ]

            for (const { dy, dx } of neighbors) {
                const ny = y + dy
                const nx = x + dx
                const peakB = peakAssignment[ny]?.[nx]

                if (peakB !== undefined && peakB !== -1 && peakB !== peakA) {
                    // Found boundary between two peak regions
                    const minPeak = Math.min(peakA, peakB)
                    const maxPeak = Math.max(peakA, peakB)
                    const edgeKey = `${minPeak}-${maxPeak}`

                    if (!edgeMap.has(edgeKey)) {
                        edgeMap.set(edgeKey, {
                            from: minPeak,
                            to: maxPeak,
                            points: []
                        })
                    }
                    edgeMap.get(edgeKey)!.points.push({ x, y })
                }
            }
        }
    }

    // Step 5: Convert edge boundaries to ridge edges
    const edges: RidgeEdge[] = []

    for (const [, { from, to, points }] of edgeMap) {
        if (points.length === 0) continue

        // Find the path between the two peaks through the boundary
        const fromNode = nodes.find(n => n.id === from)!
        const toNode = nodes.find(n => n.id === to)!

        // Calculate geodesic distance along the ridge (through boundary points)
        const boundaryCenter = {
            x: points.reduce((s, p) => s + p.x, 0) / points.length,
            y: points.reduce((s, p) => s + p.y, 0) / points.length
        }

        const distFromToCenter = Math.sqrt(
            (fromNode.position.x - boundaryCenter.x) ** 2 +
            (fromNode.position.y - boundaryCenter.y) ** 2
        )
        const distCenterToEnd = Math.sqrt(
            (boundaryCenter.x - toNode.position.x) ** 2 +
            (boundaryCenter.y - toNode.position.y) ** 2
        )
        const length = distFromToCenter + distCenterToEnd

        // Average density along path as weight
        let sumDensity = 0
        for (const p of points) {
            sumDensity += grid[p.y][p.x]
        }
        const weight = points.length > 0 ? sumDensity / points.length : 0

        edges.push({
            from,
            to,
            path: [fromNode.position, boundaryCenter, toNode.position],
            length,
            weight
        })
    }

    // Calculate graph statistics
    const totalLength = edges.reduce((sum, e) => sum + e.length, 0)

    // Find longest path using BFS/DFS (simplified: just max edge for now)
    const longestPath = computeLongestPathInGraph(nodes, edges)

    return { nodes, edges, totalLength, longestPath }
}

/**
 * Compute the longest path in the ridge graph
 * Uses DFS from each node to find the maximum path length
 */
function computeLongestPathInGraph(nodes: RidgeNode[], edges: RidgeEdge[]): number {
    if (nodes.length === 0 || edges.length === 0) return 0

    // Build adjacency list
    const adj = new Map<number, { to: number; length: number }[]>()
    for (const node of nodes) {
        adj.set(node.id, [])
    }
    for (const edge of edges) {
        adj.get(edge.from)?.push({ to: edge.to, length: edge.length })
        adj.get(edge.to)?.push({ to: edge.from, length: edge.length })
    }

    // Find leaf nodes (degree 1)
    const leaves = nodes.filter(n => (adj.get(n.id)?.length || 0) === 1)
    const startNodes = leaves.length > 0 ? leaves : nodes

    let maxPath = 0

    for (const startNode of startNodes) {
        // DFS to find longest path from this node
        const visited = new Set<number>()
        const path = dfsLongestPath(startNode.id, adj, visited)
        maxPath = Math.max(maxPath, path)
    }

    return maxPath
}

function dfsLongestPath(
    nodeId: number,
    adj: Map<number, { to: number; length: number }[]>,
    visited: Set<number>
): number {
    visited.add(nodeId)
    let maxLength = 0

    for (const neighbor of adj.get(nodeId) || []) {
        if (!visited.has(neighbor.to)) {
            const pathLength = neighbor.length + dfsLongestPath(neighbor.to, adj, new Set(visited))
            maxLength = Math.max(maxLength, pathLength)
        }
    }

    return maxLength
}

/**
 * Compute stringy metric from ridge graph
 * Stringy = longest_path_length / total_edge_length
 */
export function computeStringyFromRidgeGraph(graph: RidgeGraph): number {
    if (graph.totalLength <= 0) return 0
    return Math.min(1, graph.longestPath / graph.totalLength)
}

/**
 * Compute graph-based metrics that can be derived from the ridge graph
 */
export function computeRidgeGraphMetrics(graph: RidgeGraph): {
    stringy: number
    branchiness: number
    connectivity: number
    avgEdgeLength: number
} {
    const numNodes = graph.nodes.length
    const numEdges = graph.edges.length

    // Stringy: longest path / total length
    const stringy = computeStringyFromRidgeGraph(graph)

    // Branchiness: ratio of internal nodes (degree > 2) to total nodes
    const adj = new Map<number, number>()
    for (const node of graph.nodes) adj.set(node.id, 0)
    for (const edge of graph.edges) {
        adj.set(edge.from, (adj.get(edge.from) || 0) + 1)
        adj.set(edge.to, (adj.get(edge.to) || 0) + 1)
    }
    const internalNodes = Array.from(adj.values()).filter(d => d > 2).length
    const branchiness = numNodes > 0 ? internalNodes / numNodes : 0

    // Connectivity: edges / maximum possible edges (for a tree: n-1)
    const maxEdges = numNodes > 1 ? numNodes - 1 : 1
    const connectivity = numEdges / maxEdges

    // Average edge length
    const avgEdgeLength = numEdges > 0 ? graph.totalLength / numEdges : 0

    return { stringy, branchiness, connectivity, avgEdgeLength }
}
