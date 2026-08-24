# CLAUDE.md

## Workflow

- Never commit without explicit user confirmation for that specific commit.
- Never deploy without explicit user confirmation; verify changes locally first.

## Code Style

- Do not write comments for information that can be derived from the code itself.
- Do not proactively maintain backward compatibility with old logic.
- Prefer implementing functionality with libraries, but weigh whether the dependency is truly necessary and avoid over-engineering.
- Refactor duplicated or redundant code promptly when encountered.
