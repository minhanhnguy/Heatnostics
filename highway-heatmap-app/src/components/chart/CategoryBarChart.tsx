import React from 'react';

interface CategoryBarChartProps {
    value: number;
    dataType: "aadt" | "cost";
    allValues: number[];
}

const CategoryBarChart: React.FC<CategoryBarChartProps> = ({ value, dataType }) => {
    return (
        <div className="p-4 border rounded bg-white shadow-sm">
            <h3 className="font-bold text-sm uppercase text-gray-500">{dataType}</h3>
            <div className="text-2xl font-bold">{value}</div>
        </div>
    );
};

export default CategoryBarChart;
