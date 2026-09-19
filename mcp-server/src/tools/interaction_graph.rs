use anyhow::Result;
use std::collections::HashSet;

use crate::api::{DrugBankClient, InteractionSourceStatus, RxNormClient};
use crate::llm::{LlmClient, GRAPH_SYSTEM_PROMPT};
use crate::models::{Drug, InteractionGraph};

/// Build an N-drug interaction graph with hub identification and emergent interaction detection.
pub async fn build_interaction_graph(
    drugs: &[Drug],
    rxnorm: &RxNormClient,
    drugbank: &DrugBankClient,
    llm: &LlmClient,
) -> Result<InteractionGraph> {
    // Step 1: Resolve all RxCUIs
    let mut resolved: Vec<(String, Option<String>)> = Vec::new();
    for drug in drugs {
        let rxcui = if let Some(ref cui) = drug.rxcui {
            Some(cui.clone())
        } else {
            rxnorm
                .resolve_rxcui(&drug.name)
                .await?
                .map(|r| r.rxcui)
        };
        resolved.push((drug.name.clone(), rxcui));
    }

    // Step 2: Collect all pairwise interaction data
    let mut pairwise_data = Vec::new();
    let mut supported_pairs: HashSet<(String, String)> = HashSet::new();
    let mut source_available = true;
    let mut source_message = "RxNav interaction response received.".to_string();
    for i in 0..resolved.len() {
        for j in (i + 1)..resolved.len() {
            if let (Some(ref cui_a), Some(ref cui_b)) = (&resolved[i].1, &resolved[j].1) {
                let lookup = rxnorm.get_interactions(cui_a, cui_b).await?;
                if lookup.status == InteractionSourceStatus::Unavailable {
                    source_available = false;
                    source_message = lookup.message;
                }
                for interaction in &lookup.interactions {
                    supported_pairs.insert(normalized_pair(&resolved[i].0, &resolved[j].0));
                    pairwise_data.push(serde_json::json!({
                        "drug_a": resolved[i].0,
                        "drug_b": resolved[j].0,
                        "severity": interaction.severity,
                        "description": interaction.description,
                    }));
                }
            }

            // Also check CYP overlap from DrugBank
            let cyp_overlap = drugbank.check_cyp_overlap(&resolved[i].0, &resolved[j].0);
            if !cyp_overlap.is_empty() {
                supported_pairs.insert(normalized_pair(&resolved[i].0, &resolved[j].0));
                pairwise_data.push(serde_json::json!({
                    "drug_a": resolved[i].0,
                    "drug_b": resolved[j].0,
                    "cyp_overlap": cyp_overlap,
                    "source": "drugbank_cyp_analysis",
                }));
            }
        }
    }

    // Step 3: Collect pharmacology data for each drug
    let mut pharmacology = Vec::new();
    for drug in drugs {
        if let Some(pharm) = drugbank.get_pharmacology(&drug.name).await? {
            pharmacology.push(serde_json::json!({
                "name": pharm.name,
                "cyp_enzymes": pharm.cyp_enzymes,
                "half_life": pharm.half_life,
                "protein_binding": pharm.protein_binding,
                "clearance_route": pharm.clearance_route,
            }));
        }
    }

    // Step 4: Use Gemini to build the full graph analysis
    let drug_names: Vec<&str> = drugs.iter().map(|d| d.name.as_str()).collect();
    let user_prompt = serde_json::json!({
        "medications": drug_names,
        "total_drugs": drugs.len(),
        "possible_pairs": drugs.len() * (drugs.len() - 1) / 2,
        "pairwise_interactions": pairwise_data,
        "pharmacology_data": pharmacology,
    })
    .to_string();

    let response = llm.generate(GRAPH_SYSTEM_PROMPT, &user_prompt).await?;

    let parsed: serde_json::Value = serde_json::from_str(&response).unwrap_or_else(|_| {
        serde_json::json!({
            "nodes": [],
            "edges": [],
            "hub_drugs": [],
            "emergent_interactions": [],
            "graph_density": 0.0
        })
    });

    let mut nodes: Vec<crate::models::GraphNode> = parsed
        .get("nodes")
        .and_then(|n| serde_json::from_value(n.clone()).ok())
        .unwrap_or_default();
    let generated_edges: Vec<crate::models::GraphEdge> = parsed
        .get("edges")
        .and_then(|e| serde_json::from_value(e.clone()).ok())
        .unwrap_or_default();
    let edges = filter_supported_edges(generated_edges, &supported_pairs);
    let mut hub_drugs: Vec<String> = parsed
        .get("hub_drugs")
        .and_then(|h| serde_json::from_value(h.clone()).ok())
        .unwrap_or_default();
    let emergent_interactions = parsed
        .get("emergent_interactions")
        .and_then(|e| serde_json::from_value(e.clone()).ok())
        .unwrap_or_default();
    let total_edges = edges.len();
    let node_count = nodes.len();
    for node in &mut nodes {
        node.degree = edges
            .iter()
            .filter(|edge| {
                edge.source.eq_ignore_ascii_case(&node.drug_name)
                    || edge.target.eq_ignore_ascii_case(&node.drug_name)
            })
            .count();
        node.is_hub = node.degree >= 2;
        node.hub_score = if node_count > 1 {
            node.degree as f64 / (node_count - 1) as f64
        } else {
            0.0
        };
    }
    hub_drugs.retain(|hub| {
        nodes
            .iter()
            .any(|node| node.is_hub && node.drug_name.eq_ignore_ascii_case(hub))
    });
    let graph_density = if node_count > 1 {
        (2 * total_edges) as f64 / (node_count * (node_count - 1)) as f64
    } else {
        0.0
    };

    Ok(InteractionGraph {
        nodes,
        edges,
        hub_drugs,
        emergent_interactions,
        total_edges,
        graph_density,
        structured_source_status: if source_available { "available" } else { "unavailable" }.to_string(),
        structured_source_message: source_message,
    })
}

fn normalized_pair(a: &str, b: &str) -> (String, String) {
    let mut pair = [a.trim().to_lowercase(), b.trim().to_lowercase()];
    pair.sort();
    (pair[0].clone(), pair[1].clone())
}

fn filter_supported_edges(
    edges: Vec<crate::models::GraphEdge>,
    supported_pairs: &HashSet<(String, String)>,
) -> Vec<crate::models::GraphEdge> {
    edges
        .into_iter()
        .filter(|edge| supported_pairs.contains(&normalized_pair(&edge.source, &edge.target)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{GraphEdge, Severity};

    #[test]
    fn graph_only_keeps_edges_supported_by_structured_data() {
        let edges = vec![
            GraphEdge { source: "Warfarin".into(), target: "Fluconazole".into(), severity: Severity::High, interaction_type: "pharmacokinetic".into(), weight: 0.8 },
            GraphEdge { source: "Warfarin".into(), target: "Metformin".into(), severity: Severity::Moderate, interaction_type: "combined".into(), weight: 0.5 },
        ];
        let supported = HashSet::from([normalized_pair("fluconazole", "warfarin")]);
        let filtered = filter_supported_edges(edges, &supported);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].target, "Fluconazole");
    }
}
