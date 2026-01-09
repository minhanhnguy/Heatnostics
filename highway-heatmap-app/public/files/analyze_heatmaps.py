import pandas as pd
import argparse

def analyze_heatmaps(file_path, threshold_n=5, score_col='TX_CONDITION_SCORE'):
    print(f"Loading data from {file_path}...")
    try:
        df = pd.read_csv(file_path, low_memory=False)
    except FileNotFoundError:
        print(f"Error: File not found at {file_path}")
        return

    # Filter for valid rows if necessary (e.g. check if highway/county exists)
    df = df.dropna(subset=['TX_SIGNED_HIGHWAY_RDBD_ID', 'COUNTY'])
    
    # Ensure score column is numeric
    df[score_col] = pd.to_numeric(df[score_col], errors='coerce')

    print("Grouping by Highway and County...")
    # Group by Highway and County
    grouped = df.groupby(['TX_SIGNED_HIGHWAY_RDBD_ID', 'COUNTY'])

    no_cells_below_50_count = 0
    below_n_threshold_count = 0
    total_groups = 0

    print(f"Analyzing {len(grouped)} heatmaps...")

    for name, group in grouped:
        total_groups += 1
        
        # 1. Check if any cell has score < 50
        # Filter for valid scores first
        valid_scores = group[score_col].dropna()
        scores_below_50 = valid_scores[valid_scores < 50]
        
        if len(scores_below_50) == 0:
            no_cells_below_50_count += 1

        # 2. Check if N (number of valid data points) is below threshold
        # Assuming N refers to number of rows with valid score?
        # Or just number of rows in the group?
        # Usually for heatmap generation, we care about valid data points.
        n_points = len(valid_scores)
        if n_points < threshold_n:
            below_n_threshold_count += 1

    print("-" * 30)
    print(f"Total Heatmaps (Highway-County pairs): {total_groups}")
    print(f"Heatmaps with NO cells with score < 50: {no_cells_below_50_count} ({no_cells_below_50_count/total_groups*100:.2f}%)")
    print(f"Heatmaps with N < {threshold_n} (valid points): {below_n_threshold_count} ({below_n_threshold_count/total_groups*100:.2f}%)")
    print("-" * 30)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Analyze PMIS Heatmap Data")
    parser.add_argument("--file", type=str, default="./PMIS_2024_trimmed.csv", help="Path to CSV file")
    parser.add_argument("--n", type=int, default=5, help="Threshold for N (number of points)")
    args = parser.parse_args()

    analyze_heatmaps(args.file, args.n)
