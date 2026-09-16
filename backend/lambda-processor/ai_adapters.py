"""
Multi-provider AI adapters for Lambda PDF processing.
Resolves vendor model IDs via model_catalog and supports:
  - anthropic: native PDF document blocks (existing path)
  - openai / gemini: text extracted from PDF via PyPDF2
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from model_catalog import resolve_model

try:
    from anthropic import Anthropic
except ImportError:  # pragma: no cover
    Anthropic = None  # type: ignore


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise
        return json.loads(match.group(0))


def pdf_bytes_to_text(pdf_bytes: bytes, max_chars: int = 180_000) -> str:
    """Best-effort text extraction for non-Anthropic providers."""
    from PyPDF2 import PdfReader
    import io

    reader = PdfReader(io.BytesIO(pdf_bytes))
    parts: list[str] = []
    total = 0
    for i, page in enumerate(reader.pages):
        try:
            page_text = page.extract_text() or ""
        except Exception:
            page_text = ""
        block = f"[Page {i + 1}]\n{page_text}"
        if total + len(block) > max_chars:
            remaining = max_chars - total
            if remaining > 0:
                parts.append(block[:remaining])
            parts.append("\n[truncated]")
            break
        parts.append(block)
        total += len(block)
    return "\n\n".join(parts)


def _http_json(url: str, headers: dict[str, str], body: dict[str, Any]) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"HTTP {e.code}: {err}") from e


def call_openai_text(system: str, user: str, model: str, api_key: str) -> tuple[str, dict[str, int]]:
    data = _http_json(
        "https://api.openai.com/v1/chat/completions",
        {"Authorization": f"Bearer {api_key}"},
        {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_completion_tokens": 8192,
        },
    )
    text = data.get("choices", [{}])[0].get("message", {}).get("content") or ""
    usage = data.get("usage") or {}
    return text, {
        "input_tokens": int(usage.get("prompt_tokens") or 0),
        "output_tokens": int(usage.get("completion_tokens") or 0),
        "cache_creation_tokens": 0,
        "cache_read_tokens": 0,
    }


def call_gemini_text(system: str, user: str, model: str, api_key: str) -> tuple[str, dict[str, int]]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    data = _http_json(
        url,
        {"x-goog-api-key": api_key},
        {
            "contents": [{"role": "user", "parts": [{"text": f"{system}\n\n{user}"}]}],
            "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.2},
        },
    )
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    meta = data.get("usageMetadata") or {}
    return text, {
        "input_tokens": int(meta.get("promptTokenCount") or 0),
        "output_tokens": int(meta.get("candidatesTokenCount") or 0),
        "cache_creation_tokens": 0,
        "cache_read_tokens": 0,
    }


def call_anthropic_pdf(
    pdf_base64: str,
    system: str,
    user: str,
    model: str,
    api_key: str,
) -> tuple[str, dict[str, int]]:
    if Anthropic is None:
        raise RuntimeError("anthropic SDK not installed")
    client = Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=8192,
        system=system,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_base64,
                        },
                    },
                    {"type": "text", "text": user},
                ],
            }
        ],
    )
    text = ""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            text += block.text
    usage = {
        "input_tokens": int(getattr(response.usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(response.usage, "output_tokens", 0) or 0),
        "cache_creation_tokens": int(
            getattr(response.usage, "cache_creation_input_tokens", 0) or 0
        ),
        "cache_read_tokens": int(getattr(response.usage, "cache_read_input_tokens", 0) or 0),
    }
    return text, usage


FINDINGS_SYSTEM = (
    "You are an expert home inspector analyst. Extract findings as valid JSON only."
)
FINDINGS_USER_TEMPLATE = """Analyze this inspection report content and extract all findings.

Respond with valid JSON:
{{
  "findings": [
    {{
      "system_category": "string",
      "severity": "critical|major|minor|informational",
      "title": "string",
      "description": "string",
      "plain_language_summary": "string",
      "evidence": {{"page_numbers": [], "quotes": []}},
      "confidence": 0.0
    }}
  ]
}}

REPORT CONTENT:
{content}
"""


def resolve_runtime(
    event: dict[str, Any] | None = None,
) -> tuple[str, str, bool]:
    """
    Returns (provider, vendor_model_id, managed_only).
    Defaults to anthropic managed catalog default when unset.
    """
    event = event or {}
    provider = (
        event.get("aiProvider")
        or event.get("provider")
        or os.environ.get("AI_PROVIDER")
        or "anthropic"
    ).lower()
    if provider == "claude":
        provider = "anthropic"
    selected = event.get("selectedModelId") or event.get("selected_model_id")
    managed_only = event.get("managedOnly")
    if managed_only is None:
        managed_only = event.get("managed_only")
    if managed_only is None:
        managed_only = True
    managed_only = bool(managed_only)
    entry = resolve_model(provider, selected, managed_only=managed_only)
    return provider, entry["vendor_model_id"], managed_only


def extract_findings_multi(
    *,
    pdf_base64: str | None,
    pdf_bytes: bytes | None,
    report_id: str,
    event: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int], str]:
    """
    Extract findings using the resolved provider.
    Returns (findings, usage, model_used).
    """
    provider, model, _ = resolve_runtime(event)
    print(f"[ai_adapters] report={report_id} provider={provider} model={model}")

    user = FINDINGS_USER_TEMPLATE.format(content="(see attached PDF)")
    if provider == "anthropic":
        if not pdf_base64:
            raise ValueError("pdf_base64 required for anthropic")
        api_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_API_KEY_BYOK")
        if not api_key:
            raise RuntimeError("ANTHROPIC_API_KEY missing")
        # Prefer event lease key when present (BYOK)
        api_key = (event or {}).get("apiKey") or api_key
        text, usage = call_anthropic_pdf(
            pdf_base64, FINDINGS_SYSTEM, user.replace("(see attached PDF)", "See attached PDF document."), model, api_key
        )
    elif provider == "openai":
        if not pdf_bytes:
            raise ValueError("pdf_bytes required for openai")
        api_key = (event or {}).get("apiKey") or os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY missing")
        content = pdf_bytes_to_text(pdf_bytes)
        text, usage = call_openai_text(
            FINDINGS_SYSTEM, FINDINGS_USER_TEMPLATE.format(content=content), model, api_key
        )
    elif provider == "gemini":
        if not pdf_bytes:
            raise ValueError("pdf_bytes required for gemini")
        api_key = (event or {}).get("apiKey") or os.environ.get("GEMINI_API_KEY") or os.environ.get(
            "GOOGLE_AI_API_KEY"
        )
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY missing")
        content = pdf_bytes_to_text(pdf_bytes)
        text, usage = call_gemini_text(
            FINDINGS_SYSTEM, FINDINGS_USER_TEMPLATE.format(content=content), model, api_key
        )
    else:
        raise ValueError(f"Unsupported provider: {provider}")

    parsed = _extract_json(text)
    findings = parsed.get("findings") or []
    if not isinstance(findings, list):
        findings = []
    return findings, usage, model
