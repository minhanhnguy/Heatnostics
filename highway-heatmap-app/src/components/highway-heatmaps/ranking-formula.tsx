'use client'

import React from 'react'
import 'katex/dist/katex.min.css'
import { BlockMath, InlineMath } from 'react-katex'

/* =========================
   Per-mechanism notation blocks
   (each lists ONLY symbols used
   in that mechanism’s formula)
   ========================= */

const NotationAbsNet: React.FC = () => (
    <div className="mt-3 text-[13px] leading-relaxed">
        <div className="mb-1">Notation</div>
        <ul className="list-disc pl-5 space-y-1">
            <li><InlineMath math={`s`} />: a reference-marker span.</li>
            <li><InlineMath math={`L_s`} />: length of span <InlineMath math={`s`} /> (miles).</li>
            <li><InlineMath math={`t_1 < \\dots < t_{n_s}`} />: years available on span <InlineMath math={`s`} />.</li>
            <li><InlineMath math={`v_{s,t}`} />: chosen metric on span <InlineMath math={`s`} /> in year <InlineMath math={`t`} />.</li>
        </ul>
    </div>
)

const NotationSignedNet: React.FC = () => (
    <div className="mt-3 text-[13px] leading-relaxed">
        <div className="mb-1">Notation</div>
        <ul className="list-disc pl-5 space-y-1">
            <li><InlineMath math={`s`} />: a span; <InlineMath math={`L_s`} />: span length (miles).</li>
            <li><InlineMath math={`t_1 < \\dots < t_{n_s}`} /> with <InlineMath math={`n_s \\ge 2`} />.</li>
            <li><InlineMath math={`v_{s,t_1},\\ v_{s,t_{n_s}}`} />: earliest and latest metric on <InlineMath math={`s`} />.</li>
        </ul>
    </div>
)

const NotationSlope: React.FC = () => (
    <div className="mt-3 text-[13px] leading-relaxed">
        <div className="mb-1">Notation</div>
        <ul className="list-disc pl-5 space-y-1">
            <li><InlineMath math={`s`} />: a span; <InlineMath math={`L_s`} />: span length (miles).</li>
            <li><InlineMath math={`t_1 < \\dots < t_{n_s}`} /> (years), <InlineMath math={`n_s \\ge 2`} />.</li>
            <li><InlineMath math={`v_{s,t_i}`} />: metric at year <InlineMath math={`t_i`} /> on span <InlineMath math={`s`} />.</li>
            <li><InlineMath math={`\\beta_{1,s}`} />: least-squares slope for span <InlineMath math={`s`} /> (units/year).</li>
        </ul>
    </div>
)

const NotationImprovementPerCost: React.FC = () => (
    <div className="mt-3 text-[13px] leading-relaxed">
        <div className="mb-1">Notation</div>
        <ul className="list-disc pl-5 space-y-1">
            <li><InlineMath math={`s`} />: a span; <InlineMath math={`L_s`} />: span length (miles).</li>
            <li><InlineMath math={`t_1 < \\dots < t_{n_s}`} /> with <InlineMath math={`n_s \\ge 2`} />.</li>
            <li><InlineMath math={`v_{s,t_1},\\ v_{s,t_{n_s}}`} />: earliest and latest metric on <InlineMath math={`s`} />.</li>
            <li><InlineMath math={`c_{s,t_i}`} />: maintenance cost on <InlineMath math={`s`} /> in year <InlineMath math={`t_i`} />.</li>
        </ul>
    </div>
)

const NotationCondAadt: React.FC = () => (
    <div className="mt-3 text-[13px] leading-relaxed">
        <div className="mb-1">Notation</div>
        <ul className="list-disc pl-5 space-y-1">
            <li><InlineMath math={`s`} />: a span; <InlineMath math={`L_s`} />: span length (miles).</li>
            <li><InlineMath math={`v^{(\\text{cond})}_{s,\\text{latest}}`} />: latest Condition on <InlineMath math={`s`} />.</li>
            <li><InlineMath math={`A_{s,\\text{latest}}`} />: latest AADT on <InlineMath math={`s`} />.</li>
            <li><InlineMath math={`\\max\\{0,\\cdot\\}`} /> clips negatives; <InlineMath math={`\\ln(1+\\cdot)`} /> damps extremes.</li>
        </ul>
    </div>
)

/* =========================
   Public API
   ========================= */

export const getMechanismHelp = (id: string): React.ReactNode => {
    switch (id) {
        /** 1) ABSOLUTE SUM OF DIFFERENCES (year-to-year, span-weighted) */
        case 'sum-of-differences':
            return (
                <div className="w-[560px] max-w-none">
                    <p className="font-bold mb-1">Absolute differences</p>
                    <p className="mb-2 text-[13px]">
                        This ranking mechanism adds up every year-to-year difference. More change over time means a higher rank, and longer spans count more.
                    </p>
                    <BlockMath math={String.raw`
            \text{Score}
            \;=\;
            \sum_{s} L_s \,\sum_{i=2}^{n_s} \left|\, v_{s,t_i} - v_{s,t_{i-1}} \right|
          `} />
                    <NotationAbsNet />
                </div>
            )

        /** 2) NET DIRECTIONAL CHANGE (span-weighted) */
        case 'improvement-over-time':
            return (
                <div className="w-[560px] max-w-none">
                    <p className="font-bold mb-1">Net change</p>
                    <p className="mb-2 text-[13px]">
                        This ranking mechanism uses the difference between the latest year and the beginning year; the middle years are ignored (any ups and downs in between cancel out). Longer spans count more.
                    </p>
                    <BlockMath math={String.raw`
            \text{Score}
            \;=\;
            \sum_{s} L_s \,\big( v_{s,t_{n_s}} - v_{s,t_1} \big)
          `} />
                    <NotationSignedNet />
                </div>
            )

        /** 4) GAIN FOR THE MONEY (span-weighted) */
        case 'improvement-per-cost':
            return (
                <div className="w-[560px] max-w-none">
                    <p className="font-bold mb-1">Improvement per Cost</p>
                    <p className="mb-2 text-[13px]">
                        This ranking mechanism is based on how much improvement for what is spent. More gain with less cost ranks higher; spans with no valid spend are skipped.
                    </p>
                    <BlockMath math={String.raw`
            \text{Score} \;=\; \sum_{s}
            \frac{\,L_s\,\big(v_{s,t_{n_s}} - v_{s,t_1}\big)\,}
                 {\,\sum_{i=1}^{n_s} c_{s,t_i}\,}
            \quad\text{(include only if denominator }{>}\,0\text{)}
          `} />
                    <NotationImprovementPerCost />
                </div>
            )

        /** 5) USER IMPACT OF POOR CONDITION (span-weighted) */
        case 'condition-aadt-exposure':
            return (
                <div className="w-[560px] max-w-none">
                    <p className="font-bold mb-1">Condition × AADT exposure</p>
                    <p className="mb-2 text-[13px]">
                        This ranking mechanism determines the surfaces miles where many drivers face low condition. Busier places with worse condition rank higher; very large traffic is toned down using ln() fucntion.
                    </p>
                    <BlockMath math={String.raw`
            \text{Score}
            \;=\;
            \sum_{s} L_s \cdot
            \underbrace{\max\!\big\{0,\,100 - v^{(\text{cond})}_{s,\text{latest}}\big\}}_{\text{deficiency}}
            \cdot \ln\!\Big(1 + \max\!\big\{0,\,A_{s,\text{latest}}\big\}\Big)
          `} />
                    <NotationCondAadt />
                </div>
            )

        /** A–Z (manual sorting) — compact helper panel (unchanged) */
        case 'alpha-az':
        default:
            return (
                <div className="w-[200px] max-w-none">
                    <p className="font-bold mb-1">A–Z sorting</p>
                    <p className="mb-2 text-[13px]">
                        Alphabetical order by Highway, then by County.
                    </p>
                </div>
            )
    }
}
