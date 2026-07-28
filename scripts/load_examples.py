"""Load examples from Cloud Code JSON output into the database."""

import json
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

from pipeline.config import TEACHER_MODEL
from pipeline.db import init_db, get_db, insert_example, update_teacher_output, update_final_status


def load_json_file(filepath):
    """Load examples from a JSON file."""
    with open(filepath) as f:
        data = json.load(f)
    
    if isinstance(data, dict):
        data = [data]
    
    return data


def load_examples(examples, trust_teacher=True):
    """Load examples into the database.
    
    Args:
        examples: list of dicts with scenario_params, state_json, teacher_output
        trust_teacher: if True, mark as accepted (trusted Opus output)
    """
    init_db()
    conn = get_db()
    
    loaded = 0
    for ex in examples:
        scenario_params = ex.get("scenario_params", {})
        state_json = ex.get("state_json", {})
        teacher_output = ex.get("teacher_output", {})
        
        # Insert
        example_id = insert_example(conn, scenario_params, state_json)
        
        # Store teacher output
        update_teacher_output(conn, example_id, TEACHER_MODEL, teacher_output, "")
        
        # If trusted, mark as accepted (skip geo filter + judge)
        if trust_teacher:
            update_final_status(conn, example_id, "accepted")
        
        loaded += 1
        print(f"  Loaded example {loaded}: {scenario_params.get('objective', '?')} with {scenario_params.get('friendly_count', '?')} friendly")
    
    conn.close()
    return loaded


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python load_examples.py <json_file> [--trust]")
        print("  --trust: mark examples as accepted (skip judging)")
        sys.exit(1)
    
    filepath = sys.argv[1]
    trust = "--trust" in sys.argv
    
    print(f"Loading from {filepath} (trust={trust})...")
    examples = load_json_file(filepath)
    count = load_examples(examples, trust_teacher=trust)
    print(f"\nLoaded {count} examples")
