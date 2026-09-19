"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { PatientForm } from "@/components/forms/PatientForm";
import { LoadingScreen } from "@/components/ui/LoadingScreen";
import { GridBackground } from "@/components/effects/GridBackground";
import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/types";
import { clearSnapshot, writeSnapshot } from "@/lib/reportSnapshot";
import { PRE_GENERATED_DEMO_REQUEST, PRE_GENERATED_DEMO_RESULT } from "@/lib/preGeneratedDemo";

const Scene = dynamic(
  () => import("@/components/3d/Scene").then((m) => ({ default: m.Scene })),
  { ssr: false },
);
const FloatingParticles = dynamic(
  () =>
    import("@/components/3d/FloatingParticles").then((m) => ({
      default: m.FloatingParticles,
    })),
  { ssr: false },
);

export default function AnalyzePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `?demo=1` (the "Load Demo Case" CTA on the landing page) PREFILLS the
  // first synthetic profile into the form. It does NOT auto-submit — the
  // user reviews the medications and patient context, then clicks
  // "Analyze" themselves. Visiting /analyze never triggers a surprise
  // Gemini call; running the analysis stays an explicit action.
  const [prefill, setPrefill] = useState<AnalyzeRequest | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("demoReport") === "1") {
      writeSnapshot(sessionStorage, PRE_GENERATED_DEMO_REQUEST, PRE_GENERATED_DEMO_RESULT, "pre_generated_synthetic");
      router.replace("/report");
    } else if (params.get("demo") === "1" && SAMPLE_PROFILES.length > 0) {
      setPrefill(SAMPLE_PROFILES[0].request);
      window.history.replaceState({}, "", "/analyze");
    }
  }, [router]);

  const openPreGeneratedDemo = () => {
    clearSnapshot(sessionStorage);
    writeSnapshot(sessionStorage, PRE_GENERATED_DEMO_REQUEST, PRE_GENERATED_DEMO_RESULT, "pre_generated_synthetic");
    router.push("/report");
  };

  const handleSubmit = async (request: AnalyzeRequest) => {
    setIsLoading(true);
    setError(null);
    // A NEW analysis supersedes any prior report: clear the active snapshot
    // (and the pre-fix legacy analysis keys) before running, so a stale
    // completed analysis can never survive into the new run. If this run
    // fails, no report is available — that is honest.
    try {
      clearSnapshot(sessionStorage);
    } catch {
      // ignore storage errors; the snapshot is replaced on success anyway
    }

    try {
      const resp = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!resp.ok) {
        if (resp.status === 504 || resp.status === 408) {
          throw new Error("The free-provider analysis is taking too long. No report was saved. Retry, reduce the medication list, or open the clearly labeled pre-generated synthetic demo report below.");
        }
        throw new Error("The live analysis could not be completed. No report was saved; please retry shortly.");
      }

      const data: AnalyzeResponse = await resp.json();
      // Store request + response as ONE coherent analysis snapshot so the
      // report page can never mix an older response with the current request.
      writeSnapshot(sessionStorage, request, data);
      router.push("/report");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      setIsLoading(false);
    }
  };

  return (
    <>
      <GridBackground />

      {/* Ambient 3D particle background */}
      <div className="fixed inset-0 z-0 pointer-events-none opacity-35">
        <Scene camera={{ position: [0, 0, 6], fov: 60 }}>
          <FloatingParticles count={120} spread={14} size={0.018} />
        </Scene>
      </div>

      <AnimatePresence>
        {isLoading && <LoadingScreen message="Running RxNexus analysis..." />}
      </AnimatePresence>

      <div className="relative z-10 min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-10"
          >
            {/* Status badge */}
            <div
              className="inline-flex items-center gap-2 mb-5 px-4 py-1.5 rounded-full"
              style={{
                background: "var(--primary-dim)",
                border: "1px solid rgba(0, 229, 255, 0.15)",
              }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  background: "var(--primary)",
                  animation: "pulseGlow 2s ease-in-out infinite",
                }}
              />
              <span
                className="text-xs font-medium tracking-wider uppercase"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--primary)",
                }}
              >
                Clinical Analysis
              </span>
            </div>
            <motion.h1
              className="font-display font-bold text-3xl sm:text-4xl mb-3"
              style={{
                background: "linear-gradient(135deg, #00e5ff 0%, #38bdf8 40%, #7c4dff 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter: "drop-shadow(0 4px 12px rgba(0, 229, 255, 0.35)) drop-shadow(0 0 30px rgba(0, 229, 255, 0.15))",
              }}
              whileHover={{
                filter: "drop-shadow(0 4px 16px rgba(0, 229, 255, 0.5)) drop-shadow(0 0 40px rgba(0, 229, 255, 0.25))",
                scale: 1.02,
              }}
              transition={{ duration: 0.3 }}
            >
              Polypharmacy Analysis
            </motion.h1>
            <p className="text-text-secondary text-sm max-w-md mx-auto leading-relaxed">
              Enter medications and clinical context. RxNexus will build an
              interaction graph, compute personalized risk, model temporal
              cascades, flag renal dose adjustments, screen for geriatric
              appropriateness, and generate a deprescribing plan.
            </p>
            <p
              className="text-xs mt-3 max-w-md mx-auto"
              style={{ color: "var(--text-muted)" }}
            >
              Demonstration prototype — do not enter real patient data.
            </p>
          </motion.div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-6 p-4 rounded-xl"
                style={{
                  background: "rgba(255, 23, 68, 0.06)",
                  border: "1px solid rgba(255, 23, 68, 0.15)",
                }}
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg" style={{ color: "var(--danger)" }}>
                    ⚠
                  </span>
                  <div className="flex-1">
                    <h3
                      className="font-display font-semibold text-sm mb-1"
                      style={{ color: "var(--danger)" }}
                    >
                      Analysis Failed
                    </h3>
                    <p className="text-text-secondary text-sm">{error}</p>
                    <button
                      onClick={() => setError(null)}
                      className="mt-2 text-xs underline"
                      style={{ color: "var(--danger)" }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="glass-panel p-6 sm:p-8"
          >
            <PatientForm
              key={prefill ? "demo" : "blank"}
              onSubmit={handleSubmit}
              isLoading={isLoading}
              initialValue={prefill ?? undefined}
            />
          </motion.div>

          {/* Sample profiles */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-8 text-center"
          >
            <p className="text-text-muted text-xs mb-3">
              Quick test with synthetic profiles:
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SAMPLE_PROFILES.map((p) => (
                <button
                  key={p.label}
                  onClick={() => handleSubmit(p.request)}
                  disabled={isLoading}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono transition-all disabled:opacity-50 glow-border"
                  style={{
                    background: "var(--surface)",
                    color: "var(--text-muted)",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={openPreGeneratedDemo} disabled={isLoading} className="btn-secondary mt-4 disabled:opacity-50">
              Open Pre-generated Synthetic Demo Report
            </button>
            <p className="text-[11px] text-text-muted mt-2">
              Instant checked-in fixture; clearly separated from live OpenRouter analysis.
            </p>
          </motion.div>
        </div>
      </div>
    </>
  );
}

const SAMPLE_PROFILES: { label: string; request: AnalyzeRequest }[] = [
  {
    label: "72F CKD3 — 6 drugs",
    request: {
      medications: [
        "warfarin",
        "aspirin",
        "omeprazole",
        "amlodipine",
        "furosemide",
        "digoxin",
      ],
      patient: {
        age: 72,
        sex: "female",
        weight_kg: 58,
        height_cm: 155,
        ckd_stage: 3,
        hepatic_impairment: false,
        smoking: false,
        alcohol_use: "none",
        comorbidities: ["hypertension", "atrial fibrillation", "heart failure"],
        allergies: [],
      },
    },
  },
  {
    label: "81M Poly — 8 drugs",
    request: {
      medications: [
        "warfarin",
        "aspirin",
        "fish oil",
        "simvastatin",
        "metoprolol",
        "lisinopril",
        "metformin",
        "gabapentin",
      ],
      patient: {
        age: 81,
        sex: "male",
        weight_kg: 72,
        height_cm: 170,
        ckd_stage: 2,
        hepatic_impairment: false,
        smoking: false,
        alcohol_use: "occasional",
        comorbidities: [
          "type 2 diabetes",
          "hypertension",
          "atrial fibrillation",
          "peripheral neuropathy",
        ],
        allergies: ["penicillin"],
      },
    },
  },
  {
    label: "65F Anticholinergic",
    request: {
      medications: [
        "amitriptyline",
        "diphenhydramine",
        "oxybutynin",
        "quetiapine",
        "sertraline",
      ],
      patient: {
        age: 65,
        sex: "female",
        weight_kg: 70,
        height_cm: 163,
        ckd_stage: 0,
        hepatic_impairment: false,
        smoking: false,
        alcohol_use: "none",
        comorbidities: ["depression", "insomnia", "overactive bladder"],
        allergies: [],
      },
    },
  },
];
