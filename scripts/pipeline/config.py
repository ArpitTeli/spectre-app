"""SPECTRE Training Pipeline Configuration.

API keys are loaded from environment variables or a .env file.
Model selection and pipeline settings are configurable.
"""

import os
from pathlib import Path

# Try to load from .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent.parent / ".env")
except ImportError:
    pass

# API Keys (from environment variables)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

# Model selection
TEACHER_MODEL = os.getenv("TEACHER_MODEL", "claude-3-5-sonnet-20241022")
JUDGE_A_MODEL = os.getenv("JUDGE_A_MODEL", "claude-3-5-haiku-20241022")
JUDGE_B_MODEL = os.getenv("JUDGE_B_MODEL", "gpt-4o-mini")

# Pipeline settings
TARGET_EXAMPLES = int(os.getenv("TARGET_EXAMPLES", "1000"))
DB_PATH = Path(__file__).parent / "spectre_training.db"
MAP_NAME = os.getenv("MAP_NAME", "stratis")

# Generation settings
MAX_RETRIES = 3
BATCH_SIZE = 10  # examples per API batch call

# Paths
SCRIPTS_DIR = Path(__file__).parent.parent
MAPS_DIR = SCRIPTS_DIR.parent / "public" / "maps"

# Unit types available in the system
UNIT_TYPES = [
    "mbt", "ifv", "apc", "mrap", "light", "truck",
    "spg", "spaa", "eng",
    "infantry", "helicopter", "boat"
]

# Validate API keys
def validate_config():
    """Check that required API keys are set."""
    errors = []
    
    # Check teacher model provider
    if "claude" in TEACHER_MODEL.lower() and not ANTHROPIC_API_KEY:
        errors.append("ANTHROPIC_API_KEY required for Claude teacher model")
    elif "gpt" in TEACHER_MODEL.lower() and not OPENAI_API_KEY:
        errors.append("OPENAI_API_KEY required for GPT teacher model")
    
    # Check judge models
    if "claude" in JUDGE_A_MODEL.lower() and not ANTHROPIC_API_KEY:
        errors.append("ANTHROPIC_API_KEY required for Claude judge A")
    elif "gpt" in JUDGE_A_MODEL.lower() and not OPENAI_API_KEY:
        errors.append("OPENAI_API_KEY required for GPT judge A")
    
    if "claude" in JUDGE_B_MODEL.lower() and not ANTHROPIC_API_KEY:
        errors.append("ANTHROPIC_API_KEY required for Claude judge B")
    elif "gpt" in JUDGE_B_MODEL.lower() and not OPENAI_API_KEY:
        errors.append("OPENAI_API_KEY required for GPT judge B")
    
    if errors:
        raise ValueError("Configuration errors:\n" + "\n".join(errors))
    
    return True
