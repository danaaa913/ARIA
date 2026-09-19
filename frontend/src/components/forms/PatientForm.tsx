"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DrugInput } from "./DrugInput";
import { PatientContextForm } from "./PatientContextForm";
import type { PatientContext, AnalyzeRequest } from "@/lib/types";

interface PatientFormProps {
  onSubmit: (request: AnalyzeRequest) => void;
  isLoading?: boolean;
  initialValue?: AnalyzeRequest;
}

const DEFAULT_PATIENT: PatientContext = {
  age: 50,
  sex: "unknown",
  weight_kg: undefined,
  height_cm: undefined,
  ckd_stage: 0,
  hepatic_impairment: false,
  smoking: false,
  alcohol_use: "none",
  comorbidities: [],
  allergies: [],
};

export function PatientForm({ onSubmit, isLoading = false, initialValue }: PatientFormProps) {
  const [drugs, setDrugs] = useState<string[]>(
    (initialValue?.medications ?? ["", ""]).map((m) =>
      typeof m === "string" ? m : m.name,
    ),
  );
  const [patient, setPatient] = useState<PatientContext>(initialValue?.patient ?? DEFAULT_PATIENT);

  const addDrug = () => setDrugs([...drugs, ""]);

  const removeDrug = (index: number) => {
    if (drugs.length <= 2) return;
    setDrugs(drugs.filter((_, i) => i !== index));
  };

  const updateDrug = (index: number, value: string) => {
    const updated = [...drugs];
    updated[index] = value;
    setDrugs(updated);
  };

  const handleSubmit = () => {
    const validDrugs = drugs.filter((d) => d.trim().length > 0);
    if (validDrugs.length < 2) return;
    onSubmit({ medications: validDrugs, patient });
  };

  const validDrugCount = drugs.filter((d) => d.trim().length > 0).length;
  const canSubmit = validDrugCount >= 2 && !isLoading;

  return (
    <div className="space-y-8">
      {/* ── Patient Context Section (clinical context drives the risk
          model, so it leads the input flow) ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2
            className="font-display font-semibold text-xl"
            style={{ color: "var(--text)" }}
          >
            Patient Context
          </h2>
          <span
            className="text-xs px-2.5 py-1 rounded-full"
            style={{
              fontFamily: "var(--font-mono)",
              background: "var(--primary-dim)",
              color: "var(--primary)",
              border: "1px solid rgba(0, 229, 255, 0.15)",
            }}
          >
            01
          </span>
        </div>
        <PatientContextForm value={patient} onChange={setPatient} />
      </section>

      {/* ── Medication Regimen Section ── */}
      <section>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2
            className="font-display font-semibold text-xl"
            style={{ color: "var(--text)" }}
          >
            Medication Regimen
          </h2>
          <div className="flex items-center gap-2">
            <span
              className="text-sm px-3 py-1 rounded-full"
              style={{
                fontFamily: "var(--font-mono)",
                background: "var(--primary-dim)",
                color: "var(--primary)",
                border: "1px solid rgba(0, 229, 255, 0.15)",
              }}
            >
              {validDrugCount} drug{validDrugCount !== 1 ? "s" : ""}
            </span>
            <span
              className="text-xs px-2.5 py-1 rounded-full"
              style={{
                fontFamily: "var(--font-mono)",
                background: "rgba(8, 20, 37, 0.6)",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
              }}
            >
              02
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <AnimatePresence>
            {drugs.map((drug, i) => (
              <DrugInput
                key={i}
                index={i}
                value={drug}
                onChange={(v) => updateDrug(i, v)}
                onRemove={() => removeDrug(i)}
              />
            ))}
          </AnimatePresence>
        </div>

        <button
          onClick={addDrug}
          className="mt-3 w-full py-3 rounded-lg text-sm font-medium transition-all"
          style={{
            background: "rgba(0, 229, 255, 0.04)",
            border: "1px dashed rgba(0, 229, 255, 0.18)",
            color: "var(--primary)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.4)";
            e.currentTarget.style.background = "rgba(0, 229, 255, 0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.18)";
            e.currentTarget.style.background = "rgba(0, 229, 255, 0.04)";
          }}
        >
          + Add Medication
        </button>

        {validDrugCount < 2 && (
          <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
            Enter at least 2 medications to start analysis
          </p>
        )}
      </section>

      {/* ── Submit ── */}
      <motion.button
        onClick={handleSubmit}
        disabled={!canSubmit}
        whileHover={canSubmit ? { scale: 1.01 } : {}}
        whileTap={canSubmit ? { scale: 0.99 } : {}}
        className="w-full py-4 rounded-xl font-display font-semibold text-sm transition-all duration-200"
        style={{
          background: canSubmit
            ? "linear-gradient(135deg, var(--primary), var(--teal))"
            : "var(--surface)",
          color: canSubmit ? "var(--background)" : "var(--text-muted)",
          border: canSubmit ? "none" : "1px solid var(--border)",
          boxShadow: canSubmit
            ? "0 8px 30px rgba(0, 229, 255, 0.2)"
            : "none",
          cursor: canSubmit ? "pointer" : "not-allowed",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <LoadingSpinner />
            Analyzing Interactions...
          </span>
        ) : (
          "Analyze Medication Regimen"
        )}
      </motion.button>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
