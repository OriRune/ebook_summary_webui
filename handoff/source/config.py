"""Local config storage (API key, UI preferences) — kept in the user's home
directory, never bundled with the project or sent anywhere except (for the API
key) directly to Anthropic's API."""

from __future__ import annotations

import json
import os

_CONFIG_DIR = os.path.join(os.path.expanduser('~'), '.ebook_flashcards')
_CONFIG_PATH = os.path.join(_CONFIG_DIR, 'config.json')


def _load_config() -> dict:
    """Read the whole config dict, tolerating a missing/corrupt file."""
    if os.path.exists(_CONFIG_PATH):
        try:
            with open(_CONFIG_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_config(data: dict) -> None:
    """Write the whole config dict, preserving the 0600 permissions."""
    os.makedirs(_CONFIG_DIR, exist_ok=True)
    with open(_CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f)
    try:
        os.chmod(_CONFIG_PATH, 0o600)
    except OSError:
        pass


def load_api_key() -> str:
    if os.path.exists(_CONFIG_PATH):
        return _load_config().get('anthropic_api_key', '') or ''
    return os.environ.get('ANTHROPIC_API_KEY', '')


def save_api_key(api_key: str) -> None:
    data = _load_config()
    data['anthropic_api_key'] = api_key.strip()
    _save_config(data)


def load_groq_api_key() -> str:
    if os.path.exists(_CONFIG_PATH):
        return _load_config().get('groq_api_key', '') or ''
    return os.environ.get('GROQ_API_KEY', '')


def save_groq_api_key(api_key: str) -> None:
    data = _load_config()
    data['groq_api_key'] = api_key.strip()
    _save_config(data)


def load_dark_mode() -> bool:
    """Whether the GUI should start in dark mode. Defaults to off (light)."""
    return bool(_load_config().get('dark_mode', False))


def save_dark_mode(enabled: bool) -> None:
    data = _load_config()
    data['dark_mode'] = bool(enabled)
    _save_config(data)
