"use client";

import Link from "next/link";
import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/types";

export function PreGeneratedDemoReport({ request, result }: { request: AnalyzeRequest; result: AnalyzeResponse }) {
  const renal = result.report?.renal_assessment;
  const appropriate = result.report?.appropriateness;
  const medicines = request.medications.map((m) => typeof m === "string" ? m : m.name);
  return (
    <main className="min-h-screen pt-24 pb-16 px-4 relative z-10">
      <div className="max-w-5xl mx-auto space-y-6">
        <section className="rounded-2xl p-6 sm:p-8" style={{ background: "rgba(124,77,255,.12)", border: "2px solid rgba(167,139,250,.65)" }}>
          <p className="text-xs font-mono uppercase tracking-[.2em] text-violet-300 mb-3">Pre-generated · Synthetic demonstration data</p>
          <h1 className="font-display font-bold text-3xl mb-3">Deterministic Demo Report</h1>
          <p className="text-text-secondary max-w-3xl">This checked-in exhibition fixture is not a live OpenRouter result. It shows only repository-backed deterministic renal and geriatric rules. Provider-dependent sections are explicitly unavailable.</p>
        </section>
        <section className="glass-panel p-6">
          <h2 className="font-display font-semibold text-xl mb-2">Synthetic case</h2>
          <p className="text-sm text-text-secondary mb-4">72-year-old female · CKD stage 3 · hypertension · atrial fibrillation · heart failure</p>
          <div className="flex flex-wrap gap-2">{medicines.map((m) => <span key={m} className="px-2.5 py-1 rounded-lg text-xs font-mono glow-border">{m}</span>)}</div>
        </section>
        <div className="grid md:grid-cols-2 gap-6">
          <section className="glass-panel p-6">
            <p className="text-xs uppercase tracking-wider text-cyan-300 mb-2">Deterministic renal review</p>
            <h2 className="font-display font-semibold text-xl mb-4">{renal?.flagged.length ?? 0} medications flagged</h2>
            <div className="space-y-3">{(renal?.flagged ?? []).map((f) => <article key={f.drug} className="rounded-xl p-4 bg-slate-950/35 border border-cyan-400/20"><strong className="capitalize">{f.drug}</strong><span className="float-right text-xs uppercase text-amber-300">{f.action}</span><p className="text-sm text-text-secondary mt-2">{f.recommendation}</p></article>)}</div>
            <p className="text-xs text-text-muted mt-4">{renal?.disclaimer}</p>
          </section>
          <section className="glass-panel p-6">
            <p className="text-xs uppercase tracking-wider text-violet-300 mb-2">Deterministic geriatric screen</p>
            <h2 className="font-display font-semibold text-xl mb-4">{appropriate?.pim_flags.length ?? 0} review flags · {appropriate?.omissions.length ?? 0} possible omissions</h2>
            <div className="space-y-3">{(appropriate?.pim_flags ?? []).map((f) => <article key={`${f.framework}-${f.drug}`} className="rounded-xl p-4 bg-slate-950/35 border border-violet-400/20"><strong className="capitalize text-sm">{f.drug}</strong><p className="text-xs text-text-secondary mt-1">{f.criterion}</p></article>)}</div>
            <p className="text-xs text-text-muted mt-4">{appropriate?.disclaimer}</p>
          </section>
        </div>
        <section className="glass-panel p-6 border border-amber-400/25"><h2 className="font-display font-semibold text-lg mb-2">Not represented in this fixture</h2><p className="text-sm text-text-secondary">Live interaction findings, overall clinical risk score, interaction graph, temporal cascade and deprescribing plan. Run a live analysis to request those sections.</p></section>
        <div className="flex flex-col sm:flex-row gap-3"><Link href="/analyze?demo=1"><button className="btn-primary">Load Demo Case for Live Analysis</button></Link><Link href="/analyze"><button className="btn-secondary">Start Another Analysis</button></Link></div>
      </div>
    </main>
  );
}
