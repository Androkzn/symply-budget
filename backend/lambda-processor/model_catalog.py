"""
Server-controlled model catalog mirror (lockstep with backend/src/ai/model-catalog.ts).
Lambda must re-resolve selected_model_id against this map at lease consume.
"""

from __future__ import annotations

from typing import Any

# Registry key → vendor model ID. Keep ≤5 chat options per provider.
MODEL_CATALOG: list[dict[str, Any]] = [
    # OpenAI
    {
        "id": "openai.gpt-5.6-sol",
        "provider": "openai",
        "vendor_model_id": "gpt-5.6-sol",
        "is_default": False,
        "managed_visible": False,
    },
    {
        "id": "openai.gpt-5.6-terra",
        "provider": "openai",
        "vendor_model_id": "gpt-5.6-terra",
        "is_default": True,
        "managed_visible": True,
    },
    {
        "id": "openai.gpt-5.6-luna",
        "provider": "openai",
        "vendor_model_id": "gpt-5.6-luna",
        "is_default": False,
        "managed_visible": True,
    },
    # Anthropic
    {
        "id": "anthropic.claude-fable-5",
        "provider": "anthropic",
        "vendor_model_id": "claude-fable-5",
        "is_default": False,
        "managed_visible": False,
    },
    {
        "id": "anthropic.claude-opus-4-8",
        "provider": "anthropic",
        "vendor_model_id": "claude-opus-4-8",
        "is_default": False,
        "managed_visible": False,
    },
    {
        "id": "anthropic.claude-sonnet-5",
        "provider": "anthropic",
        "vendor_model_id": "claude-sonnet-5",
        "is_default": True,
        "managed_visible": True,
    },
    {
        "id": "anthropic.claude-haiku-4-5",
        "provider": "anthropic",
        "vendor_model_id": "claude-haiku-4-5",
        "is_default": False,
        "managed_visible": True,
    },
    # Gemini
    {
        "id": "gemini.3.1-pro",
        "provider": "gemini",
        "vendor_model_id": "gemini-3.1-pro-preview",
        "is_default": False,
        "managed_visible": False,
    },
    {
        "id": "gemini.3.5-flash",
        "provider": "gemini",
        "vendor_model_id": "gemini-3.5-flash",
        "is_default": True,
        "managed_visible": True,
    },
    {
        "id": "gemini.3-flash",
        "provider": "gemini",
        "vendor_model_id": "gemini-3-flash-preview",
        "is_default": False,
        "managed_visible": True,
    },
    {
        "id": "gemini.3.1-flash-lite",
        "provider": "gemini",
        "vendor_model_id": "gemini-3.1-flash-lite",
        "is_default": False,
        "managed_visible": True,
    },
]

SPECIALTY_MODELS = {
    "openai": {
        "image_generation": "gpt-image-1",
        "realtime_audio": "gpt-realtime-2.1",
    },
    "anthropic": {},
    "gemini": {
        "embeddings": "gemini-embedding-2",
    },
}


def get_default(provider: str, managed_only: bool = False) -> dict[str, Any] | None:
    entries = [
        e
        for e in MODEL_CATALOG
        if e["provider"] == provider and (not managed_only or e["managed_visible"])
    ]
    for e in entries:
        if e["is_default"]:
            return e
    return entries[0] if entries else None


def resolve_model(
    provider: str,
    selected_model_id: str | None,
    *,
    managed_only: bool = False,
) -> dict[str, Any]:
    """Re-resolve registry key → vendor model; fall back to provider default."""
    entries = [
        e
        for e in MODEL_CATALOG
        if e["provider"] == provider and (not managed_only or e["managed_visible"])
    ]
    if not entries:
        raise ValueError(f"No catalog entries for provider={provider}")

    default = get_default(provider, managed_only=managed_only) or entries[0]
    if not selected_model_id:
        return default

    for e in entries:
        if e["id"] == selected_model_id:
            return e
    return default


def assert_catalog_valid() -> None:
    providers = ("openai", "anthropic", "gemini")
    for p in providers:
        entries = [e for e in MODEL_CATALOG if e["provider"] == p]
        if len(entries) > 5:
            raise ValueError(f"{p} has {len(entries)} models (max 5)")
        defaults = [e for e in entries if e["is_default"]]
        if entries and len(defaults) != 1:
            raise ValueError(f"{p} must have exactly one default")


assert_catalog_valid()
