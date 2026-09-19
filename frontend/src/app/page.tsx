"use client";

import { useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { motion, useScroll, useTransform } from "framer-motion";
import { GridBackground } from "@/components/effects/GridBackground";
import { ParticleField } from "@/components/effects/ParticleField";

const Scene = dynamic(
  () => import("@/components/3d/Scene").then((m) => ({ default: m.Scene })),
  { ssr: false },
);
const HeroBackground = dynamic(
  () =>
    import("@/components/3d/HeroBackground").then((m) => ({
      default: m.HeroBackground,
    })),
  { ssr: false },
);

// Sourced, clickable evidence anchors used in the "Why RxNexus?" section.
const stats = [
  // WHO 2024 publication "Global burden of preventable medication-related
  // harm in health care: a systematic review" (ISBN 9789240088887, released
  // May 2024) reports the $42B annual cost of medication-related harm. This
  // is the same figure WHO has cited since their 2019 medication safety
  // fact file, now updated in this systematic review.
  { value: "$42B", label: "Annual cost of medication errors worldwide", source: "WHO, 2024", url: "https://www.who.int/publications/i/item/9789240088887" },
  // Felisberto et al. 2024 (Health Informatics Journal) is a systematic
  // review and meta-analysis of 16 studies across 11+ countries reporting
  // a pooled drug-drug interaction alert override rate of 90% (CI 85–95%).
  { value: "90%+", label: "Drug alerts overridden by clinicians globally", source: "Felisberto et al., 2024", url: "https://pubmed.ncbi.nlm.nih.gov/38899788/" },
  { value: "39%", label: "Adults 60+ taking five or more medications", source: "Wang et al., 2024", url: "https://pubmed.ncbi.nlm.nih.gov/39135518/" },
  { value: "52%", label: "Polypharmacy rate among hospital inpatients", source: "Kim et al., 2024", url: "https://pubmed.ncbi.nlm.nih.gov/38733922/" },
];

const whyItems = [
  { icon: "🕸", title: "Polypharmacy Complexity", desc: "Medication regimens behave as an interconnected system — combinations can produce effects no pairwise check can see." },
  { icon: "👤", title: "Patient-Specific Risk", desc: "Risk is adjusted for age, kidney function, hepatic state, and clinical history — not a one-size-fits-all alert." },
  { icon: "🎯", title: "Alert Prioritization", desc: "Findings are ranked into clinical review priorities so clinicians focus on what matters first." },
];

const analyzesItems = [
  { icon: "🔀", title: "Drug-Drug Interactions", desc: "Pairwise and multi-drug interaction detection across the full regimen." },
  { icon: "👤", title: "Patient Factors", desc: "Age, renal and hepatic function, comorbidities, and weight inform every score." },
  { icon: "⚖", title: "Cumulative Burden", desc: "Anticholinergic, sedative, and QT burden scores from validated clinical metrics." },
  { icon: "🫘", title: "Renal Considerations", desc: "CKD/eGFR-aware dose, avoidance, and monitoring flags." },
  { icon: "🧬", title: "Mechanistic Explanations", desc: "Why an interaction matters explained at the pathway level." },
  { icon: "📚", title: "Evidence", desc: "A–D evidence grades with confidence scores and PubMed citations." },
];

// "How it works" pipeline — input, analysis, outputs, outcome.
const pipelineInputs = ["Patient Data", "Medication List"];
const pipelineOutputs = ["Interaction Graph", "Patient-Specific Risk", "Cumulative Burden", "Risk Timeline"];

/* ── Section heading helper ── */
function SectionHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      className="text-center mb-14"
    >
      <p className="text-[10px] tracking-[0.25em] uppercase mb-3" style={{ color: "var(--primary)", fontFamily: "var(--font-mono)" }}>
        {eyebrow}
      </p>
      <h2 className="text-3xl sm:text-4xl font-bold text-gradient mb-3" style={{ fontFamily: "var(--font-display)" }}>
        {title}
      </h2>
      <p className="text-text-secondary max-w-xl mx-auto">{sub}</p>
    </motion.div>
  );
}

export default function HomePage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.2], [1, 0.96]);

  return (
    <div ref={containerRef} className="relative">
      <GridBackground />
      <ParticleField count={35} />

      {/* ═══ Hero ═══ */}
      <motion.section
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative min-h-screen flex flex-col items-center justify-center px-6 overflow-hidden"
      >
        {/* 3D Background — molecules, DNA helix, particles */}
        <div className="absolute inset-0 z-0" style={{ height: "100vh" }}>
          <Scene camera={{ position: [0, 0, 8], fov: 55 }}>
            <HeroBackground />
          </Scene>
        </div>

        {/* Radial vignette */}
        <div
          className="absolute inset-0 z-[1] pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 25%, var(--background) 75%)",
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto">
          {/* Floating medical cross */}
          <motion.div
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="mb-8"
            style={{ animation: "float 4s ease-in-out infinite" }}
          >
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, rgba(0,229,255,0.12), rgba(124,77,255,0.12))",
                border: "1px solid var(--border-glow)",
                boxShadow: "var(--glow-cyan)",
              }}
            >
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#00e5ff"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
          </motion.div>

          {/* Wordmark */}
          <motion.h1
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="select-none"
            style={{ fontFamily: "var(--font-display)", fontWeight: 800, lineHeight: 1 }}
          >
            <span
              style={{
                fontSize: "clamp(3.5rem, 10vw, 7.5rem)",
                background: "linear-gradient(135deg, #00e5ff 0%, #38bdf8 45%, #7c4dff 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                filter: "drop-shadow(0 4px 12px rgba(0, 229, 255, 0.4)) drop-shadow(0 0 40px rgba(0, 229, 255, 0.2))",
              }}
            >
              RxNexus
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.35 }}
            className="mt-5 mb-8 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1"
          >
            <span className="text-lg sm:text-xl md:text-2xl tracking-wide font-light text-text-secondary" style={{ fontFamily: "var(--font-body)" }}>
              Patient-Specific{" "}
              <span className="font-bold text-gradient-health">Polypharmacy</span>{" "}
              Intelligence
            </span>
          </motion.div>

          {/* Value statement */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
            className="text-text-secondary text-base sm:text-lg leading-relaxed max-w-2xl mx-auto mb-10"
          >
            Analyze complex medication regimens as an interconnected system,
            combining drug interactions with patient-specific clinical context.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.75 }}
            className="flex flex-col sm:flex-row gap-4"
          >
            <Link href="/analyze">
              <button className="btn-primary">Analyze Medication Regimen</button>
            </Link>
            <Link href="/analyze?demo=1">
              <button className="btn-secondary">Load Demo Case</button>
            </Link>
            <Link href="/analyze?demoReport=1">
              <button className="btn-secondary">Open Pre-generated Demo Report</button>
            </Link>
          </motion.div>
        </div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.5 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10"
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ repeat: Infinity, duration: 1.8, ease: "easeInOut" }}
            className="w-6 h-10 rounded-full border border-[var(--border-glow)] flex items-start justify-center pt-2"
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: "var(--primary)",
                boxShadow: "0 0 8px var(--primary)",
              }}
            />
          </motion.div>
        </motion.div>
      </motion.section>

      {/* ═══ Why RxNexus? ═══ */}
      <section className="relative py-28 px-6 grid-bg">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="Clinical Decision Support"
            title="Why RxNexus?"
            sub="Static interaction checkers ignore patient context and flood clinicians with noise. RxNexus treats the whole regimen as one system."
          />

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.1 } },
            }}
            className="grid grid-cols-1 md:grid-cols-3 gap-5"
          >
            {whyItems.map((item, i) => (
              <motion.div
                key={i}
                variants={{
                  hidden: { opacity: 0, y: 30 },
                  visible: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.5 }}
                className="rounded-xl bg-surface/60 glow-border p-6"
              >
                <div className="text-3xl mb-4">{item.icon}</div>
                <h3 className="font-display font-semibold text-[0.95rem] mb-2" style={{ color: "#00e5ff" }}>
                  {item.title}
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </motion.div>

          {/* Sourced evidence anchors */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.1 } },
            }}
            className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5"
          >
            {stats.map((stat, i) => (
              <motion.a
                key={i}
                href={stat.url}
                target="_blank"
                rel="noopener noreferrer"
                variants={{
                  hidden: { opacity: 0, y: 30 },
                  visible: { opacity: 1, y: 0 },
                }}
                transition={{ duration: 0.5 }}
                className="rounded-xl bg-surface/60 glow-border p-6 text-center block cursor-pointer"
                style={{ textDecoration: "none" }}
              >
                <p className="text-3xl sm:text-4xl font-bold mb-3 text-gradient" style={{ fontFamily: "var(--font-display)" }}>
                  {stat.value}
                </p>
                <p className="text-sm text-text-secondary leading-relaxed mb-2">{stat.label}</p>
                <p className="text-[10px] text-text-muted tracking-wider flex items-center justify-center gap-1" style={{ fontFamily: "var(--font-mono)" }}>
                  {stat.source}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </p>
              </motion.a>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══ What it analyzes ═══ */}
      <section className="relative py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <SectionHeading
            eyebrow="Scope of Analysis"
            title="What it analyzes"
            sub="A single patient-specific analysis that covers interactions, patient factors, and cumulative risk."
          />

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.08 } },
            }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
          >
            {analyzesItems.map((item, i) => (
              <motion.div
                key={i}
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0 },
                }}
                className="rounded-xl bg-surface/50 glow-border p-6 group"
              >
                <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-300">{item.icon}</div>
                <h3 className="font-display font-semibold text-[0.95rem] mb-2" style={{ color: "#00e5ff" }}>
                  {item.title}
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ═══ How it works ═══ */}
      <section className="relative py-28 px-6 grid-bg">
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            eyebrow="Pipeline"
            title="How it works"
            sub="From patient data and a medication list to evidence-based clinical review priorities."
          />

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.12 } },
            }}
            className="space-y-6"
          >
            {/* Inputs → Analysis */}
            <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="flex flex-wrap items-center justify-center gap-3">
              {pipelineInputs.map((chip, i) => (
                <span key={chip} className="rounded-full px-5 py-2.5 text-sm font-medium glow-border" style={{ background: "var(--surface)", color: "var(--text)" }}>
                  {chip}
                  {i === 0 && <span className="ml-3 text-text-muted">+</span>}
                </span>
              ))}
              <Arrow />
              <AnalysisChip label="Polypharmacy Analysis" />
            </motion.div>

            {/* Outputs */}
            <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="flex flex-wrap items-center justify-center gap-3">
              {pipelineOutputs.map((chip, i) => (
                <span key={chip} className="flex items-center gap-3">
                  {i > 0 && <Arrow />}
                  <span className="rounded-lg px-4 py-2 text-xs sm:text-sm font-medium" style={{ background: "var(--primary-dim)", border: "1px solid rgba(0,229,255,0.22)", color: "var(--text)" }}>
                    {chip}
                  </span>
                </span>
              ))}
            </motion.div>

            {/* Outcome */}
            <motion.div variants={{ hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0 } }} className="flex flex-col items-center gap-3">
              <Arrow />
              <span
                className="inline-flex flex-col sm:flex-row items-center gap-2 rounded-xl px-6 py-4 text-center"
                style={{
                  background: "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(6,182,212,0.12))",
                  border: "1px solid rgba(16,185,129,0.3)",
                }}
              >
                <span className="font-display font-semibold text-sm sm:text-base" style={{ color: "#34d399" }}>
                  Evidence-Based Clinical Review Priorities
                </span>
                <span className="text-xs text-text-muted">Decision-support only · Requires clinician evaluation</span>
              </span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="relative py-28 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="glass-panel p-12"
          >
            <h2 className="text-2xl sm:text-3xl font-bold mb-4" style={{ fontFamily: "var(--font-display)" }}>
              <span className="text-gradient">Ready to Analyze?</span>
            </h2>
            <p className="text-text-secondary mb-8 max-w-lg mx-auto">
              Enter a medication list and patient context. RxNexus will screen
              every interaction, compute patient-specific risk and burden, and
              produce a structured clinical review report.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <Link href="/analyze">
                <button className="btn-primary">Analyze Medication Regimen</button>
              </Link>
              <Link href="/analyze?demo=1">
                <button className="btn-secondary">Load Demo Case</button>
              </Link>
              <Link href="/analyze?demoReport=1">
                <button className="btn-secondary">Open Pre-generated Demo Report</button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="py-10 px-6 border-t border-[var(--border)]">
        <div className="max-w-6xl mx-auto flex flex-col items-center justify-between gap-4 text-xs text-text-muted">
          <p style={{ fontFamily: "var(--font-mono)" }}>
            RxNexus &copy; {new Date().getFullYear()}
          </p>
          <p className="max-w-2xl text-center leading-relaxed">
            RxNexus is based on the open-source{" "}
            <a
              href="https://github.com/wiqi-lee/ARIA"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-[#00e5ff] transition-colors"
            >
              ARIA project
            </a>{" "}
            by Wiqi Lee (MIT) and is adapted for an educational/exhibition
            clinical decision-support prototype.
          </p>
          <p>Built with Rust, Python, Gemini 2.5, and React Three Fiber</p>
        </div>
      </footer>
    </div>
  );
}

/* ── Pipeline arrows ── */
function Arrow() {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" fill="none" aria-hidden="true">
      <path d="M0 6h19" stroke="rgba(0,229,255,0.45)" strokeWidth="1.5" />
      <path d="M15 1l6 5-6 5" stroke="rgba(0,229,255,0.45)" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

/* ── Analysis pipeline chip ── */
function AnalysisChip({ label }: { label: string }) {
  return (
    <span
      className="rounded-full px-6 py-2.5 text-sm font-display font-semibold"
      style={{
        background: "linear-gradient(135deg, rgba(0,229,255,0.16), rgba(124,77,255,0.16))",
        border: "1px solid rgba(0,229,255,0.3)",
        color: "var(--text)",
      }}
    >
      {label}
    </span>
  );
}
