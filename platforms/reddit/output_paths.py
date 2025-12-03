import os


def resolve_output_dir() -> str:
    """
    Resolve the canonical output directory for Reddit artifacts.
    Priority:
    1) Environment variable REDDIT_OUTPUT_DIR
    2) project_root/output/reddit (default)
    """
    env_dir = os.getenv("REDDIT_OUTPUT_DIR")
    if env_dir:
        return os.path.abspath(env_dir)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    return os.path.join(project_root, "output", "reddit")
