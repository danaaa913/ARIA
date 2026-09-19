use anyhow::Result;
use serde_json::Value;

use crate::api::{InteractionSourceStatus, OpenFdaClient, RxNormClient};
use crate::llm::{LlmClient, INTERACTION_SYSTEM_PROMPT};
use crate::models::{Drug, InteractionReport, PatientContext};

/// Detect pairwise and N-drug interactions from a medication list.
pub async fn check_interactions(
    drugs: &[Drug],
    patient_context: &PatientContext,
    rxnorm: &RxNormClient,
    openfda: &OpenFdaClient,
    llm: &LlmClient,
) -> Result<InteractionReport> {
    // Step 1: Gather interaction data from RxNorm for each drug pair
    let mut rxnorm_data = Vec::new();
    let mut resolved_cuis: Vec<(String, String)> = Vec::new();
    let mut source_available = true;
    let mut source_message = "RxNav interaction response received.".to_string();

    for drug in drugs {
        if let Some(result) = rxnorm.resolve_rxcui(&drug.name).await? {
            resolved_cuis.push((drug.name.clone(), result.rxcui));
        }
    }

    // Check pairwise interactions via RxNorm
    for i in 0..resolved_cuis.len() {
        for j in (i + 1)..resolved_cuis.len() {
            let lookup = rxnorm
                .get_interactions(&resolved_cuis[i].1, &resolved_cuis[j].1)
                .await?;
            if lookup.status == InteractionSourceStatus::Unavailable {
                source_available = false;
                source_message = lookup.message;
            }
            for interaction in lookup.interactions {
                rxnorm_data.push(serde_json::json!({
                    "drug_a": resolved_cuis[i].0,
                    "drug_b": resolved_cuis[j].0,
                    "severity": interaction.severity,
                    "description": interaction.description,
                }));
            }
        }
    }

    // Step 2: Gather FDA label warnings for each drug
    let mut fda_data = Vec::new();
    for drug in drugs {
        if let Some(label) = openfda.get_drug_label(&drug.name).await? {
            if let Some(ref interactions) = label.drug_interactions {
                fda_data.push(serde_json::json!({
                    "drug": drug.name,
                    "fda_interactions": interactions,
                }));
            }
        }
    }

    // Step 3: Use Gemini to reason over all collected data
    let structured_interaction_count = rxnorm_data.len();
    let drug_names: Vec<&str> = drugs.iter().map(|d| d.name.as_str()).collect();
    let user_prompt = serde_json::json!({
        "medications": drug_names,
        "patient_context": patient_context,
        "rxnorm_interactions": rxnorm_data,
        "fda_label_data": fda_data,
    })
    .to_string();

    let response = llm.generate(INTERACTION_SYSTEM_PROMPT, &user_prompt).await?;

    // Parse the Gemini response
    let parsed: Value = serde_json::from_str(&response)
        .unwrap_or_else(|_| serde_json::json!({"interactions": [], "summary": "Failed to parse LLM response"}));

    let interactions: Vec<crate::models::Interaction> = parsed
        .get("interactions")
        .and_then(|i| serde_json::from_value(i.clone()).ok())
        .unwrap_or_default();

    let critical_count = interactions
        .iter()
        .filter(|i| i.severity == crate::models::Severity::Critical)
        .count();
    let high_count = interactions
        .iter()
        .filter(|i| i.severity == crate::models::Severity::High)
        .count();

    let review_concern_count = interactions.len();
    Ok(InteractionReport {
        total_interactions: interactions.len(),
        critical_count,
        high_count,
        summary: parsed
            .get("summary")
            .and_then(|s| s.as_str())
            .unwrap_or("Analysis complete.")
            .to_string(),
        interactions,
        structured_interaction_count,
        review_concern_count,
        structured_source_status: if source_available { "available" } else { "unavailable" }.to_string(),
        structured_source_message: source_message,
    })
}
