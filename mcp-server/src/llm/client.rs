use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::env;
use tracing::info;

use crate::api::gemini::{GeminiClient, ThinkingMode};

// ── LLM Client (provider-agnostic facade) ────────────────

/// Provider-agnostic LLM client. Wraps Gemini (Vertex AI / AI Studio)
/// and OpenRouter behind the same `generate` / `generate_text` interface
/// so clinical tools do not need to change.
#[derive(Clone)]
pub enum LlmClient {
    Gemini(GeminiClient),
    OpenRouter(OpenRouterClient),
}

impl LlmClient {
    /// Build from environment. Dispatches on `LLM_MODE`.
    pub fn from_env() -> Result<Self> {
        let mode = env::var("LLM_MODE").unwrap_or_else(|_| "vertex_ai".to_string());
        match mode.as_str() {
            "vertex_ai" | "ai_studio" => {
                let gemini = GeminiClient::from_env()?;
                Ok(LlmClient::Gemini(gemini))
            }
            "openrouter" => {
                let client = OpenRouterClient::from_env()?;
                Ok(LlmClient::OpenRouter(client))
            }
            other => {
                anyhow::bail!(
                    "Unknown LLM_MODE: {} (expected 'vertex_ai', 'ai_studio', or 'openrouter')",
                    other
                )
            }
        }
    }

    /// JSON-mode prompt (default thinking tier).
    pub async fn generate(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        match self {
            LlmClient::Gemini(g) => g.generate(system_prompt, user_prompt).await,
            LlmClient::OpenRouter(o) => o.generate(system_prompt, user_prompt).await,
        }
    }

    /// Free-form text prompt (default thinking tier).
    pub async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        match self {
            LlmClient::Gemini(g) => g.generate_text(system_prompt, user_prompt).await,
            LlmClient::OpenRouter(o) => o.generate_text(system_prompt, user_prompt).await,
        }
    }

    /// JSON-mode with explicit thinking tier (Gemini only; OpenRouter ignores).
    pub async fn generate_with_mode(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        mode: ThinkingMode,
    ) -> Result<String> {
        match self {
            LlmClient::Gemini(g) => g.generate_with_mode(system_prompt, user_prompt, mode).await,
            LlmClient::OpenRouter(o) => o.generate(system_prompt, user_prompt).await,
        }
    }

    /// Free-form text with explicit thinking tier (Gemini only; OpenRouter ignores).
    pub async fn generate_text_with_mode(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        mode: ThinkingMode,
    ) -> Result<String> {
        match self {
            LlmClient::Gemini(g) => {
                g.generate_text_with_mode(system_prompt, user_prompt, mode)
                    .await
            }
            LlmClient::OpenRouter(o) => o.generate_text(system_prompt, user_prompt).await,
        }
    }
}

// ── OpenRouter Client ─────────────────────────────────────

/// OpenRouter client. Sends requests to the OpenAI-compatible
/// `/v1/chat/completions` endpoint with ordered model fallback
/// handled server-side via the `models` array.
///
/// Privacy is controlled by `OPENROUTER_PRIVACY_MODE` and defaults to
/// `strict`. Strict mode requires ZDR; `training_opt_out` omits ZDR but
/// still denies data collection. Neither mode constitutes
/// HIPAA/regulatory compliance.
/// Do not enter real patient data.
#[derive(Clone)]
pub struct OpenRouterClient {
    http: Client,
    api_key: String,
    /// Ordered list of model IDs. OpenRouter tries each in order
    /// on the server side when the primary is unavailable.
    models: Vec<String>,
    privacy_mode: OpenRouterPrivacyMode,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OpenRouterPrivacyMode {
    Strict,
    TrainingOptOut,
}

impl OpenRouterPrivacyMode {
    fn from_env() -> Result<Self> {
        let value = env::var("OPENROUTER_PRIVACY_MODE")
            .unwrap_or_else(|_| "strict".to_string());
        Self::parse(&value)
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "strict" => Ok(Self::Strict),
            "training_opt_out" => Ok(Self::TrainingOptOut),
            other => anyhow::bail!(
                "Unknown OPENROUTER_PRIVACY_MODE: {} (expected 'strict' or 'training_opt_out')",
                other
            ),
        }
    }

    fn provider(self) -> OrProvider {
        OrProvider {
            zdr: match self {
                Self::Strict => Some(true),
                Self::TrainingOptOut => None,
            },
            data_collection: "deny".to_string(),
            allow_fallbacks: true,
            require_parameters: true,
        }
    }
}

#[derive(Debug, Serialize)]
struct OrRequest {
    models: Vec<String>,
    messages: Vec<OrMessage>,
    temperature: f64,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<OrResponseFormat>,
    provider: OrProvider,
}

#[derive(Debug, Serialize)]
struct OrMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct OrResponseFormat {
    #[serde(rename = "type")]
    format_type: String,
}

#[derive(Debug, Serialize)]
struct OrProvider {
    #[serde(skip_serializing_if = "Option::is_none")]
    zdr: Option<bool>,
    data_collection: String,
    allow_fallbacks: bool,
    require_parameters: bool,
}

#[derive(Debug, Deserialize)]
struct OrResponse {
    choices: Option<Vec<OrChoice>>,
    model: Option<String>,
    provider: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OrChoice {
    message: Option<OrChoiceMessage>,
}

#[derive(Debug, Deserialize)]
struct OrChoiceMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OrErrorResponse {
    error: Option<OrErrorDetail>,
}

#[derive(Debug, Deserialize)]
struct OrErrorDetail {
    message: Option<String>,
    code: Option<i64>,
}

impl OpenRouterClient {
    pub fn from_env() -> Result<Self> {
        let api_key = env::var("OPENROUTER_API_KEY")
            .context("LLM_MODE=openrouter but OPENROUTER_API_KEY is unset")?;
        if api_key.trim().is_empty() {
            anyhow::bail!("OPENROUTER_API_KEY is empty");
        }

        let raw = env::var("OPENROUTER_MODELS")
            .context("LLM_MODE=openrouter but OPENROUTER_MODELS is unset")?;
        let models: Vec<String> = raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if models.is_empty() {
            anyhow::bail!(
                "OPENROUTER_MODELS is empty. Provide a comma-separated list of model IDs."
            );
        }

        let privacy_mode = OpenRouterPrivacyMode::from_env()?;

        info!(
            model_count = models.len(),
            primary = %models[0],
            privacy_mode = ?privacy_mode,
            "OpenRouter client initialized"
        );

        Ok(Self {
            http: Client::new(),
            api_key,
            models,
            privacy_mode,
        })
    }

    /// JSON-mode prompt. Sets `response_format` to `json_object`.
    pub async fn generate(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        self.send(
            system_prompt,
            user_prompt,
            0.2,
            Some(OrResponseFormat {
                format_type: "json_object".to_string(),
            }),
        )
        .await
    }

    /// Free-form text prompt (no response_format constraint).
    pub async fn generate_text(&self, system_prompt: &str, user_prompt: &str) -> Result<String> {
        self.send(system_prompt, user_prompt, 0.3, None).await
    }

    async fn send(
        &self,
        system_prompt: &str,
        user_prompt: &str,
        temperature: f64,
        response_format: Option<OrResponseFormat>,
    ) -> Result<String> {
        let messages = vec![
            OrMessage {
                role: "system".to_string(),
                content: system_prompt.to_string(),
            },
            OrMessage {
                role: "user".to_string(),
                content: user_prompt.to_string(),
            },
        ];

        let request = OrRequest {
            models: self.models.clone(),
            messages,
            temperature,
            max_tokens: 8192,
            response_format,
            provider: self.privacy_mode.provider(),
        };

        let resp = self
            .http
            .post("https://openrouter.ai/api/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .header("X-Title", "RxNexus")
            .json(&request)
            .send()
            .await
            .context("OpenRouter request failed")?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if !status.is_success() {
            let parsed: Option<OrErrorResponse> = serde_json::from_str(&body).ok();
            let detail = parsed
                .and_then(|e| e.error)
                .and_then(|e| e.message)
                .unwrap_or_else(|| body.clone());

            match status.as_u16() {
                401 => anyhow::bail!("OpenRouter: invalid or missing API key (401)"),
                402 => anyhow::bail!("OpenRouter: payment/budget issue (402)"),
                429 => anyhow::bail!("OpenRouter: rate limit exceeded (429)"),
                500..=599 => anyhow::bail!("OpenRouter: upstream failure ({}): {}", status, detail),
                _ => anyhow::bail!("OpenRouter error {}: {}", status, detail),
            }
        }

        let data: OrResponse =
            serde_json::from_str(&body).context("Failed to parse OpenRouter response as JSON")?;

        let text = data
            .choices
            .and_then(|c| c.into_iter().next())
            .and_then(|c| c.message)
            .and_then(|m| m.content)
            .unwrap_or_default();

        if text.trim().is_empty() {
            anyhow::bail!("OpenRouter returned empty content");
        }

        if let Some(model) = &data.model {
            info!("OpenRouter request succeeded; model={}", model);
        }

        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn privacy_mode_rejects_unknown_values() {
        assert!(OpenRouterPrivacyMode::parse("permissive").is_err());
    }

    #[test]
    fn strict_provider_serializes_zdr() {
        let value = serde_json::to_value(OpenRouterPrivacyMode::Strict.provider()).unwrap();
        assert_eq!(value["zdr"], true);
        assert_eq!(value["data_collection"], "deny");
        assert_eq!(value["allow_fallbacks"], true);
        assert_eq!(value["require_parameters"], true);
    }

    #[test]
    fn training_opt_out_provider_omits_zdr() {
        let value =
            serde_json::to_value(OpenRouterPrivacyMode::TrainingOptOut.provider()).unwrap();
        assert!(value.get("zdr").is_none());
        assert_eq!(value["data_collection"], "deny");
        assert_eq!(value["allow_fallbacks"], true);
        assert_eq!(value["require_parameters"], true);
    }
}
