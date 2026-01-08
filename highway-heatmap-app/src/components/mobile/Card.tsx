import React from 'react';

interface CardProps {
    children?: React.ReactNode;
    highway?: string;
    location?: string;
    currentMetric?: string;
    metricLabel?: string;
    segmentData?: any[];
    onMapClick?: () => void;
    onChartClick?: () => void;
    isMapAvailable?: boolean;
    isActive?: boolean;
    index?: number;
}

const Card: React.FC<CardProps> = ({ children, highway, location }) => {
    return (
        <div className="bg-white p-4 rounded shadow mb-4">
            <div className="font-bold">{highway} - {location}</div>
            {children}
        </div>
    );
};

export default Card;
