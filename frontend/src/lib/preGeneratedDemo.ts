import type { AnalyzeRequest, AnalyzeResponse } from "./types";

export const PRE_GENERATED_DEMO_REQUEST: AnalyzeRequest = {
  medications: ["warfarin", "aspirin", "omeprazole", "amlodipine", "furosemide", "digoxin"],
  patient: { age: 72, sex: "female", weight_kg: 58, height_cm: 155, ckd_stage: 3,
    hepatic_impairment: false, smoking: false, alcohol_use: "none",
    comorbidities: ["hypertension", "atrial fibrillation", "heart failure"], allergies: [] },
};

/** Checked-in synthetic fixture. Only deterministic repository-backed rules are included. */
export const PRE_GENERATED_DEMO_RESULT: AnalyzeResponse = {
  report: {
    patient_summary: "Synthetic 72-year-old female with CKD stage 3 and a six-medication regimen. This pre-generated demonstration includes deterministic rule-based review only.",
    medication_count: 6,
    interaction_summary: "Live interaction analysis is intentionally not included in this pre-generated fixture.",
    critical_findings: [
      "Renal review is warranted for furosemide monitoring and digoxin dose/interval review.",
      "The deterministic geriatric screen flagged aspirin, digoxin and long-term full-dose PPI use for indication-specific review.",
    ],
    risk_scores: [],
    renal_assessment: {
      ckd_stage: 3, estimated_egfr_range: "30–59",
      flagged: [
        { drug: "furosemide", renal_handling: "loop diuretic; not dose-reduced in CKD", action: "monitor", recommendation: "No routine dose reduction. Monitor electrolytes and volume status; hypokalaemia or hypomagnesaemia can increase digoxin toxicity risk.", egfr_threshold: 90 },
        { drug: "digoxin", renal_handling: "renally cleared (~70%), narrow therapeutic index", action: "reduce", recommendation: "Review maintenance dose and/or dosing interval; monitor serum digoxin level and potassium.", egfr_threshold: 60 },
      ],
      ok: ["warfarin", "aspirin", "omeprazole", "amlodipine"],
      summary: "Two medications warrant renal review at the CKD stage 3 estimate: furosemide and digoxin.",
      disclaimer: "Decision support only. eGFR is estimated from CKD stage, not measured; verify against current renal dosing references and clinical context.",
    },
    appropriateness: {
      age: 72, screened: true,
      pim_flags: [
        { drug: "aspirin", framework: "stopp", criterion: "STOPP v3: antiplatelet without an established indication", rationale: "For primary prevention in older adults, bleeding risk may outweigh benefit.", recommendation: "Review the indication and individual bleeding risk." },
        { drug: "digoxin", framework: "stopp", criterion: "STOPP v3: digoxin as first-line in heart failure with preserved ejection fraction", rationale: "Limited benefit with a narrow therapeutic index, especially with renal impairment.", recommendation: "Review indication, renal function, dose and serum level." },
        { drug: "proton pump inhibitor", framework: "stopp", criterion: "STOPP v3: PPI at full therapeutic dose for more than 8 weeks without a maintenance indication", rationale: "Long-term full-dose therapy warrants indication and duration review.", recommendation: "Review duration and use the lowest effective dose if still indicated." },
      ],
      omissions: [
        { omission: "ACE inhibitor or ARB", criterion: "START v3: ACE inhibitor (or ARB) in heart failure and/or ischaemic heart disease", triggered_by: "heart failure", rationale: "RAAS inhibition can improve outcomes when clinically indicated.", recommendation: "Review indication and contraindications; monitor renal function and potassium if initiated." },
        { omission: "beta-blocker", criterion: "START v3: beta-blocker in stable systolic heart failure and/or post-myocardial infarction", triggered_by: "heart failure", rationale: "Evidence-based beta-blockers can improve outcomes in appropriate patients.", recommendation: "Review phenotype, indication and contraindications before considering therapy." },
      ],
      summary: "The deterministic geriatric screen returned three medication-review flags and two potential prescribing omissions; each requires indication-specific clinical verification.",
      disclaimer: "Decision support only. Criteria are paraphrased from AGS Beers (2023) and STOPP/START v3 (2023); verify against current criteria and the full clinical picture.",
    },
    evidence_citations: [], overall_risk_level: "not assessed",
    report_text: "Pre-generated synthetic demonstration. Live interaction, risk, graph, temporal and deprescribing outputs were not run and are not represented here.",
  },
  interaction_graph: null, temporal_model: null, deprescribing_plan: null, raw_interactions: null,
  errors: ["Pre-generated synthetic demonstration: live provider-dependent sections were not run."],
};
