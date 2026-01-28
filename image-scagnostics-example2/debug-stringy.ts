import * as fs from 'fs';
import * as path from 'path';
import {
    adaptiveMorphologicalClosing,
    contourConvexHull,
    computeStringyDT,
    countFilledPixels,
    type BinaryGrid
} from './src/lib/imageProcessing';

function getBoundingBox(grid: BinaryGrid) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < (grid[0]?.length || 0); x++) {
            if (grid[y][x] === 1) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            }
        }
    }
    return { minX, maxX, minY, maxY };
}

const GRID_SIZE = 256;
const CLOSING_RADIUS = 4;

interface ValidationScatterplot {
    name: string;
    category: string;
    n_points: number;
    points: [number, number][];
}

interface ValidationDataset {
    grid_size: number;
    scatterplots: ValidationScatterplot[];
}

function rasterizePoints(points: [number, number][], sourceGridSize: number, targetGridSize: number): BinaryGrid {
    const grid: BinaryGrid = Array.from({ length: targetGridSize }, () => Array(targetGridSize).fill(0));
    const scale = targetGridSize / sourceGridSize;
    for (const [x, y] of points) {
        const gx = Math.floor(x * scale);
        const gy = targetGridSize - 1 - Math.floor(y * scale);
        const clampedX = Math.max(0, Math.min(targetGridSize - 1, gx));
        const clampedY = Math.max(0, Math.min(targetGridSize - 1, gy));
        grid[clampedY][clampedX] = 1;
    }
    return grid;
}

function findLongestRidgePath(ridgeGrid: BinaryGrid): number {
    const rows = ridgeGrid.length;
    const cols = ridgeGrid[0]?.length || 0;
    const ridgePixels: [number, number][] = [];
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            if (ridgeGrid[y][x] === 1) ridgePixels.push([y, x]);
        }
    }
    if (ridgePixels.length < 2) return ridgePixels.length;

    // Build adjacency for 8-connected ridge pixels
    const pixelIndex = new Map<string, number>();
    ridgePixels.forEach(([y, x], i) => pixelIndex.set(`${y},${x}`, i));

    const adj: number[][] = ridgePixels.map(() => []);
    for (let i = 0; i < ridgePixels.length; i++) {
        const [y, x] = ridgePixels[i];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dy === 0 && dx === 0) continue;
                const key = `${y + dy},${x + dx}`;
                const j = pixelIndex.get(key);
                if (j !== undefined) adj[i].push(j);
            }
        }
    }

    // BFS to find longest path from each endpoint
    const endpoints = ridgePixels.map((_, i) => i).filter(i => adj[i].length <= 2);
    let maxPath = 0;

    for (const start of endpoints.slice(0, 5)) { // Check first 5 endpoints
        const dist = new Array(ridgePixels.length).fill(-1);
        dist[start] = 0;
        const queue = [start];
        let farthest = start;

        while (queue.length > 0) {
            const u = queue.shift()!;
            for (const v of adj[u]) {
                if (dist[v] === -1) {
                    dist[v] = dist[u] + 1;
                    queue.push(v);
                    if (dist[v] > dist[farthest]) farthest = v;
                }
            }
        }
        maxPath = Math.max(maxPath, dist[farthest]);
    }

    return maxPath;
}

const dataPath = path.join(__dirname, 'public', 'validation_dataset.json');
const dataset: ValidationDataset = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

console.log('\n=== STRINGY DEBUG ===\n');

for (const sp of dataset.scatterplots.filter(s => s.category === 'stringy')) {
    const binaryGrid = rasterizePoints(sp.points, dataset.grid_size, GRID_SIZE);
    const { closedGrid } = adaptiveMorphologicalClosing(binaryGrid, CLOSING_RADIUS);
    const { ridgeGrid } = computeStringyDT(closedGrid, binaryGrid, sp.n_points);

    const bbox = getBoundingBox(closedGrid);
    const boundingDiagonal = Math.sqrt(
        Math.pow(bbox.maxX - bbox.minX, 2) + Math.pow(bbox.maxY - bbox.minY, 2)
    ) || 1;

    const longestPath = findLongestRidgePath(ridgeGrid);
    const skeletonPixels = countFilledPixels(ridgeGrid);
    const closedArea = countFilledPixels(closedGrid);
    const originalPixels = countFilledPixels(binaryGrid);

    const baseStringy = Math.min(1, longestPath / boundingDiagonal);
    const thicknessRatio = closedArea > 0 ? skeletonPixels / closedArea : 1;
    const thicknessPenalty = Math.max(0, 1 - thicknessRatio * 2);
    const finalStringy = baseStringy * (1 - thicknessPenalty * 0.6);

    console.log(`${sp.name}:`);
    console.log(`  Original pixels: ${originalPixels}`);
    console.log(`  Closed area: ${closedArea}`);
    console.log(`  Skeleton pixels: ${skeletonPixels}`);
    console.log(`  Bounding diagonal: ${boundingDiagonal.toFixed(2)}`);
    console.log(`  Longest path: ${longestPath}`);
    console.log(`  Base stringy (path/diag): ${baseStringy.toFixed(3)}`);
    console.log(`  Thickness ratio (skel/closed): ${thicknessRatio.toFixed(3)}`);
    console.log(`  Thickness penalty: ${thicknessPenalty.toFixed(3)}`);
    console.log(`  Final stringy: ${finalStringy.toFixed(3)}`);
    console.log('');
}
