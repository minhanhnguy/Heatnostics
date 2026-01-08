import React from 'react';

interface ScoreGaugeProps {
    value: number;
    scoreType: "condition" | "distress" | "ride";
}

const ScoreGauge: React.FC<ScoreGaugeProps> = ({ value, scoreType }) => {
    return (
        <div className="p-4 border rounded bg-white shadow-sm">
            <h3 className="font-bold text-sm uppercase text-gray-500">{scoreType}</h3>
            <div className="text-2xl font-bold">{value}</div>
        </div>
    );
};

export default ScoreGauge;
