"use client";

import type { AnswerMetadata, ConceptRef } from "@/types";

// Shows what an answer was based on: data-quality warnings, the ontology
// concepts it used, and the methods/references behind them.

const KIND_LABEL: Record<ConceptRef["kind"], string> = {
  variable: "Variable",
  coordinate: "Coordinate",
  derived: "Derived",
  feature: "Feature",
  water_mass: "Water mass",
  region: "Region",
};

const KIND_STYLE: Record<ConceptRef["kind"], string> = {
  variable: "border-[#C9DCEC] bg-[#F2F7FB] text-[#3A6E9A]",
  coordinate: "border-[#DDE1E6] bg-[#F8F9FA] text-[#5A6A7A]",
  derived: "border-[#CFE3D6] bg-[#F3F9F5] text-[#3E7A55]",
  feature: "border-[#E3D9C6] bg-[#FBF8F2] text-[#86683A]",
  water_mass: "border-[#D9D2EA] bg-[#F7F5FB] text-[#62529A]",
  region: "border-[#DDE1E6] bg-[#F8F9FA] text-[#5A6A7A]",
};

export default function AnswerProvenance({ meta }: { meta?: AnswerMetadata | null }) {
  if (!meta) return null;
  const { concepts = [], methods = [], quality_flags: flags = [] } = meta;
  if (!concepts.length && !methods.length && !flags.length) return null;

  return (
    <div className="mt-4 flex flex-col gap-3">
      {flags.length > 0 && (
        <div className="border border-[#EAD7A8] bg-[#FDF8EC] text-[#7A5A12] rounded-sm px-4 py-3 text-[12.5px] leading-relaxed">
          <div className="text-[10px] uppercase tracking-widest font-semibold mb-1">Data quality</div>
          <ul className="list-disc ml-4 space-y-0.5">
            {flags.map((f, i) => (
              <li key={i}>{f.replace(/`/g, "")}</li>
            ))}
          </ul>
        </div>
      )}

      {concepts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-widest text-[#7A8A9A] mr-1">Based on</span>
          {concepts.map((c) => (
            <span
              key={c.id}
              title={KIND_LABEL[c.kind] ?? c.kind}
              className={`border rounded-sm px-2 py-0.5 text-[11px] ${KIND_STYLE[c.kind] ?? KIND_STYLE.coordinate}`}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}

      {methods.length > 0 && (
        <details className="group">
          <summary className="text-[11px] uppercase tracking-widest text-[#7A8A9A] cursor-pointer select-none hover:text-[#4A87BE] transition-colors list-none flex items-center gap-2">
            <span className="group-open:hidden">Method &amp; sources</span>
            <span className="hidden group-open:inline">Hide method</span>
            <span className="text-[#C8CDD4]">—</span>
          </summary>
          <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-[#3D4A58]">
            {methods.map((m, i) => {
              const sep = m.indexOf(": ");
              return (
                <li key={i} className="border-l-2 border-[#DDE1E6] pl-3">
                  {sep > 0 ? (
                    <>
                      <span className="font-semibold text-[#1A1F26]">{m.slice(0, sep)}</span>
                      {": "}
                      {m.slice(sep + 2)}
                    </>
                  ) : (
                    m
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
