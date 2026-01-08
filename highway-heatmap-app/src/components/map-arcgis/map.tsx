import React from 'react';

const DynamicMapComponent: React.FC<any> = (props) => {
    // Simulate onMapLoaded call after mount
    React.useEffect(() => {
        if (props.onMapLoaded) {
            // Mock map and view objects
            const mockMap = { findLayerById: () => null, add: () => { } };
            const mockView = {
                map: mockMap,
                when: (cb: any) => cb(),
                on: () => ({ remove: () => { } }),
                constraints: {},
                popup: { dockEnabled: false, dockOptions: {}, autoCloseEnabled: false },
                highlightOptions: {},
                padding: {},
                goTo: () => Promise.resolve()
            };
            props.onMapLoaded(mockMap, mockView);
        }
    }, []);

    return (
        <div className="w-full h-full bg-gray-200 flex items-center justify-center">
            Map Component Placeholder (ArcGIS Map would render here)
        </div>
    );
};

export default DynamicMapComponent;
