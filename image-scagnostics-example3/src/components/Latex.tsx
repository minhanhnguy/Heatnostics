"use client"

import { useEffect, useRef } from "react"
import katex from "katex"
import "katex/dist/katex.min.css"

interface LatexProps {
    children: string
    displayMode?: boolean
    className?: string
}

export default function Latex({ children, displayMode = false, className = "" }: LatexProps) {
    const containerRef = useRef<HTMLSpanElement>(null)

    useEffect(() => {
        if (containerRef.current) {
            katex.render(children, containerRef.current, {
                displayMode,
                throwOnError: false,
                trust: true
            })
        }
    }, [children, displayMode])

    return <span ref={containerRef} className={className} />
}
