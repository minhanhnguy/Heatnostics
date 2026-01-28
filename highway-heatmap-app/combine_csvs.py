#!/usr/bin/env python3
"""
Combine PMIS_2024_trimmed.csv and Concrete_distresses.csv into a single file.
Handles different column orders by using pandas to align columns.
"""
import pandas as pd
import os

# File paths
script_dir = os.path.dirname(os.path.abspath(__file__))
files_dir = os.path.join(script_dir, 'public/files')

pmis_path = os.path.join(files_dir, 'PMIS_2024_trimmed.csv')
concrete_path = os.path.join(files_dir, 'Concrete_distresses.csv')
output_path = os.path.join(files_dir, 'PMIS_combined.csv')

print(f"Loading {pmis_path}...")
pmis_df = pd.read_csv(pmis_path, low_memory=False)
print(f"  Loaded {len(pmis_df)} rows")

print(f"Loading {concrete_path}...")
concrete_df = pd.read_csv(concrete_path, low_memory=False)
print(f"  Loaded {len(concrete_df)} rows")

# Combine the dataframes - pandas handles column alignment automatically
print("Combining dataframes...")
combined_df = pd.concat([pmis_df, concrete_df], ignore_index=True)
print(f"  Combined total: {len(combined_df)} rows")

# Save to output file
print(f"Saving to {output_path}...")
combined_df.to_csv(output_path, index=False)
print("Done!")
