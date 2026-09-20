# Repository-local .NET skills

Vendored from [Aaronontheweb/dotnet-skills](https://github.com/Aaronontheweb/dotnet-skills/tree/e426ed93a9f3215cd21b277fdfa6bfccd3457945) at `e426ed93a9f3215cd21b277fdfa6bfccd3457945`. All 37 skills and their supporting files are included unchanged. See `DOTNET-SKILLS-LICENSE` for the upstream MIT license and `dotnet-skills.lock.json` for file hashes.

Codex discovers these repository skills on the next turn. Upstream directory names are retained; the skill identifier is the `name` in each SKILL.md. Claude-specific agents and marketplace configuration are not installed.

Use the relevant guidance selectively. Root AGENTS.md governs this repository's workflow and observability. In particular, upstream Aspire examples do not replace our Alchemy ownership model. Some upstream cross-skill links use historical paths; resolve them by frontmatter name in this directory.

To update, review a new upstream commit, use the skill-installer helper with `--ref <commit>` and `--dest <temporary-directory>`, compare the results, then replace the vendor directories and regenerate the lockfile. Do not overwrite local changes silently or execute upstream installation scripts without reviewing them.
