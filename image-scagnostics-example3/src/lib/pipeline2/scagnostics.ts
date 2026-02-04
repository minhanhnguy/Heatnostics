/**
 * Scagnostics Module - Main scagnostic metrics computation
 */
import type { FloatGrid, BinaryGrid, Polyline, AllScagnostics } from '../types'
import { computeContinuousArea, computeContinuousPerimeter, computeSkinnyIQ } from './geometry'
import { computeSkeletonLongestPath, computeSkeletonArcLength } from './skeleton'
import { computeStructureTensor, computeCircularVariance } from './orientation'
import { watershedBlobSegmentation, computeClumpyFromBlobs, countConnectedComponents, countFilledCells } from './blobs'
import { spearmanCorrelation, computeOutlyingMahalanobis, computeSkewedPrincipalAxis, sampleSkeletonPath } from './statistics'

function computeStringySimple(longestPath: number, totalSkeletonLength: number): number {
    if (totalSkeletonLength <= 0) return 0
    return Math.min(1, longestPath / totalSkeletonLength)
}

/**
 * Compute all 9 scagnostic metrics
 * Now accepts a pre-computed skeleton to ensure consistency with display
 */
export function computeAllScagnostics(
    floatGrid: FloatGrid,
    binaryGrid: BinaryGrid,
    contours: Polyline[],
    convexHull: Polyline,
    skeleton: BinaryGrid  // Pre-computed skeleton (same one used for display)
): AllScagnostics {
    const gridSize = floatGrid.length

    // Basic geometry from all contours
    const area = contours.reduce((sum, c) => sum + computeContinuousArea(c), 0)
    const perimeter = contours.reduce((sum, c) => sum + computeContinuousPerimeter(c), 0)
    const hullArea = computeContinuousArea(convexHull)

    // Use the provided skeleton (no need to recompute)
    const skeletonArcLength = computeSkeletonArcLength(skeleton)

    // Structure tensor for striated
    const { orientation } = computeStructureTensor(floatGrid, 5)
    const circularVar = computeCircularVariance(orientation, binaryGrid)

    // Blob segmentation for clumpy
    const filledPixels = countFilledCells(binaryGrid)
    const blobs = watershedBlobSegmentation(floatGrid, binaryGrid, 5)

    // 1. STRINGY
    const longestPath = computeSkeletonLongestPath(skeleton)
    const stringy = computeStringySimple(longestPath, skeletonArcLength)

    // 2. SPARSE
    const sparse = hullArea > 0 ? Math.max(0, Math.min(1, 1 - filledPixels / hullArea)) : 0

    // 3. CONVEX
    const convex = hullArea > 0 ? Math.min(1, area / hullArea) : 1

    // 4. SKINNY (using isoperimetric quotient only)
    const skinny = computeSkinnyIQ(area, perimeter)

    // 5. CLUMPY
    const numComponents = countConnectedComponents(binaryGrid)
    const blobClumpy = computeClumpyFromBlobs(blobs, filledPixels)
    const componentClumpy = numComponents > 1 ? 1 - (1 / numComponents) : 0
    const clumpy = Math.max(blobClumpy, componentClumpy)

    // 6. OUTLYING
    const outlyingMahalanobis = computeOutlyingMahalanobis(floatGrid, binaryGrid)
    const outlying = outlyingMahalanobis

    // 7. STRIATED
    const striated = Math.max(0, Math.min(1, 1 - circularVar))

    // 8. SKEWED
    const skewed = computeSkewedPrincipalAxis(floatGrid, binaryGrid)

    // 9. MONOTONIC
    const samples = sampleSkeletonPath(skeleton, 50)
    let monotonic = 0
    if (samples.length >= 10) {
        const xCoords = samples.map(p => p.x)
        const yCoords = samples.map(p => p.y)
        const positions = samples.map((_, i) => i)
        const rhoX = Math.abs(spearmanCorrelation(positions, xCoords))
        const rhoY = Math.abs(spearmanCorrelation(positions, yCoords))
        monotonic = Math.max(rhoX, rhoY)
    }

    return {
        stringy, sparse, convex, skinny, clumpy,
        outlying, striated, skewed, monotonic
    }
}
