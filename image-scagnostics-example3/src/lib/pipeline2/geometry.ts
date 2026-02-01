/**
 * Geometry Module - Area, perimeter, convex hull, skinny calculations
 */
import type { Point, Polyline } from '../types'

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
            return a.distSq - b.distSq
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
 * Skinny = 1 - IQ where IQ = sqrt(4*pi*A) / P
 */
export function computeSkinnyIQ(area: number, perimeter: number): number {
    if (perimeter === 0) return 0
    const iq = Math.sqrt(4 * Math.PI * area) / perimeter
    return Math.max(0, Math.min(1, 1 - iq))
}
