'use client'

import React from 'react'

interface InfoTooltipProps {
    ariaLabel?: string
    children: React.ReactNode
    size?: 'sm' | 'lg' | 'wide'
    panelClassName?: string
    placement?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center'
    tall?: boolean
}

/**
 * Hover/focus tooltip with a "?" icon.
 * Wider version with vertical scroll and no horizontal scroll.
 */
const InfoTooltip: React.FC<InfoTooltipProps> = ({
    ariaLabel = 'More info',
    children,
    size = 'wide',
    panelClassName = '',
    placement = 'bottom-right',
    tall = true,
}) => {
    // Width presets — now *much* wider
    const sizeClass =
        size === 'sm'
            ? 'w-64'
            : size === 'lg'
                ? 'w-96'
                : 'w-auto max-w-[95vw] md:max-w-[70rem]' // 70rem ≈ 1120px wide

    const heightClass = tall
        ? 'max-h-[80vh] overflow-y-auto overflow-x-hidden overscroll-contain'
        : 'max-h-none overflow-visible overflow-x-hidden'

    const placementClass =
        placement === 'bottom-right'
            ? 'right-0 top-full mt-2 translate-x-0'
            : placement === 'bottom-left'
                ? 'left-0 top-full mt-2 -translate-x-0'
                : placement === 'top-right'
                    ? 'right-0 bottom-full mb-2 translate-x-0'
                    : placement === 'top-left'
                        ? 'left-0 bottom-full mb-2 -translate-x-0'
                        : 'left-1/2 top-full mt-2 -translate-x-1/2'

    return (
        <div className="relative inline-flex items-center group">
            <button
                type="button"
                aria-label={ariaLabel}
                className="w-5 h-5 rounded-full border border-gray-300 text-gray-600 text-xs font-bold
                   flex items-center justify-center hover:bg-gray-100 focus:outline-none"
                tabIndex={0}
            >
                ?
            </button>

            {/* Tooltip bubble */}
            <div
                role="tooltip"
                className={[
                    'absolute z-50 hidden group-hover:block group-focus-within:block',
                    'rounded-md border border-gray-200 bg-white p-5 text-sm text-gray-700 shadow-lg',
                    'pointer-events-auto whitespace-normal',
                    'break-words [word-break:anywhere]',
                    sizeClass,
                    heightClass,
                    placementClass,
                    panelClassName,
                ].join(' ')}
            >
                <div className="min-w-0">{children}</div>
            </div>
        </div>
    )
}

export default InfoTooltip
