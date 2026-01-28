/**
 * Script to compute scagnostics for all validation dataset patterns
 * and export to CSV file
 * 
 * Run with: npx ts-node scripts/export_scagnostics.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Import the image processing functions
import {
    adaptiveMorphologicalClosing,
    contourConvexHull,
    computeStringyDT,
    computeScagnostics,
} from '../src/lib/imageProcessing';

interface ValidationScatterplot {
    name: string;
    category: string;
    description: string;
    expected_high: string[];
    expected_low: string[];
    n_points: number;
    points: [number, number][];
}

interface ValidationDataset {
    name: string;
    description: string;
    version: string;
    grid_size: number;
    metrics: string[];
    categories: string[];
    total_scatterplots: number;
    scatterplots: ValidationScatterplot[];
}

const GRID_SIZE = 64;
const CLOSING_RADIUS = 4;

// Rasterize points to binary grid
function rasterizePoints(
    points: [number, number][],
    sourceGridSize: number,
    targetGridSize: number
): number[][] {
    const grid: number[][] = Array.from({ length: targetGridSize }, () =>
        Array(targetGridSize).fill(0)
    );

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

async function main() {
    // Load validation dataset
    const dataPath = path.join(__dirname, '../public/validation_dataset.json');
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    const dataset: ValidationDataset = JSON.parse(rawData);

    console.log(`Processing ${dataset.total_scatterplots} scatterplots...`);

    // CSV header
    const csvRows: string[] = [
        'name,category,n_points,stringy,sparse,convex,skinny,clumpy,outlying,skewed,striated,monotonic'
    ];

    // Process each scatterplot
    for (const sp of dataset.scatterplots) {
        // Rasterize
        const binaryGrid = rasterizePoints(sp.points, dataset.grid_size, GRID_SIZE);

        // Compute pipeline
        const { closedGrid } = adaptiveMorphologicalClosing(binaryGrid, CLOSING_RADIUS);
        const hullGrid = contourConvexHull(closedGrid);
        const { ridgeGrid } = computeStringyDT(closedGrid, binaryGrid, sp.n_points);
        const metrics = computeScagnostics(closedGrid, hullGrid, ridgeGrid);

        // Format row
        const row = [
            sp.name,
            sp.category,
            sp.n_points,
            metrics.stringy.toFixed(3),
            metrics.sparse.toFixed(3),
            metrics.convex.toFixed(3),
            metrics.skinny.toFixed(3),
            metrics.clumpy.toFixed(3),
            metrics.outlying.toFixed(3),
            metrics.skewed.toFixed(3),
            metrics.striated.toFixed(3),
            metrics.monotonic.toFixed(3),
        ].join(',');

        csvRows.push(row);
        console.log(`  ✓ ${sp.name} (${sp.category})`);
    }

    // Write CSV
    const outputPath = path.join(__dirname, '../scagnostics_results.csv');
    fs.writeFileSync(outputPath, csvRows.join('\n'));
    console.log(`\nWritten to: ${outputPath}`);
}

main().catch(console.error);
