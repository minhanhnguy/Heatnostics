/**
 * Image Scagnostics Pipeline 2 - Public API
 * 
 * This module re-exports all public functions from the internal modules.
 * All implementation details are in the `pipeline2/` subdirectory.
 */

// Re-export types from types.ts
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
} from './types'

// Re-export data conversion utilities
export { pointsToFloatGrid, pointsToBinaryGrid } from './dataConversion'

// Re-export smoothing functions
export { gaussianBlur } from './pipeline2/smoothing'

// Re-export segmentation functions
export { getPercentileValue, multiThresholdSegmentation } from './pipeline2/segmentation'

// Re-export contour extraction
export { marchingSquares } from './pipeline2/contour'

// Re-export geometry functions
export { computeContinuousArea, computeContinuousPerimeter, computeConvexHull } from './pipeline2/geometry'

// Re-export distance transform
export { euclideanDistanceTransform } from './pipeline2/distanceTransform'

// Re-export skeleton functions
export {
    zhangSuenThinning,
    computeSkeletonLongestPathData,
    computeSkeletonLongestPath,
    pruneSkeletonBranches,
    analyzeSkeletonTopology,
    computeSkeletonArcLength,
    type SkeletonTopology
} from './pipeline2/skeleton'

// Re-export blob/connected component functions
export { countConnectedComponents, countFilledCells } from './pipeline2/blobs'

// Re-export main scagnostics computation
export { computeAllScagnostics } from './pipeline2/scagnostics'

// Note: ridgeGraph.ts module is available but not exported (experimental)
