# Orbit Core — Claude Code Manual

This document explains how Claude Code is configured to work with the orbit-core project, including contextual instructions (CLAUDE.md files) and custom slash commands.

---

## 1. CLAUDE.md Files (Contextual Instructions)

CLAUDE.md files provide automatic context to Claude Code when working in specific directories. They are loaded automatically — no action needed.

### How it works

When you open Claude Code inside the orbit-core repo (or any subdirectory), Claude automatically reads the nearest CLAUDE.md file(s) in the directory hierarchy. This gives Claude knowledge about conventions, file structure, and patterns specific to that part of the codebase.

### Files created

| File | Scope | What it provides |
|------|-------|-----------------|
| `CLAUDE.md` (root) | Entire project | Tech stack, commands, conventions, architecture overview, key files |
| `packages/api/CLAUDE.md` | API package | Route structure, middleware chain, auth patterns, DB conventions |
| `packages/ui/CLAUDE.md` | UI package | App.tsx structure, orbit-viz.js, styling, auth flow |
| `packages/storage-pg/CLAUDE.md` | Database | Migration naming, next number, table reference, how to create migrations |
| `connectors/CLAUDE.md` | Connectors | Push/pull patterns, Python conventions, state management |
| `deploy/CLAUDE.md` | Deployment | Production deploy sequence, Docker Swarm, nginx configs, cron |

### Benefits

- Claude knows the correct commands (`pnpm`, not `npm`)
- Claude follows existing patterns (raw SQL, not ORM; batch ingest; etc.)
- Claude uses the right migration numbering
- Claude knows production service names and deploy quirks
- Context is scoped — working on the API doesn't load UI details

---

## 2. Slash Commands (Custom Skills)

Slash commands are reusable workflows triggered by typing `/<command>` in Claude Code. They automate repetitive tasks.

### Available Commands

#### `/orbit-deploy` — Production Deploy Checklist
Runs pre-flight checks (typecheck + build), shows what will be deployed, and generates the deploy commands to run manually on the server. Does NOT deploy automatically — safety first.

**Usage:**
```
/orbit-deploy
```

#### `/orbit-migration` — Create New SQL Migration
Automatically determines the next migration number, asks what the migration should do, generates idempotent SQL, and creates the file in the correct location.

**Usage:**
```
/orbit-migration
/orbit-migration add retention_policies table
```

#### `/orbit-connector` — Scaffold New Push Connector
Generates a complete Python push connector following the established pattern (state tracking, log rotation detection, batch POST, cron setup). Uses `connectors/nagios/` as reference.

**Usage:**
```
/orbit-connector
/orbit-connector zabbix
```

#### `/orbit-benchmark` — Run EPS Stress Test
Generates and runs a Node.js stress test against the ingest API. Tests multiple batch sizes, measures EPS/latency, and compares against known production benchmarks (~21K EPS sustained).

**Usage:**
```
/orbit-benchmark
```

#### `/orbit-route` — Add New API Route
Scaffolds a new Express route file following existing patterns, registers it in `index.ts`, and suggests migrations if needed.

**Usage:**
```
/orbit-route
/orbit-route reports
```

#### `/orbit-status` — Project Status Overview
Shows a comprehensive overview: git state, code health (typecheck + lint), migration status, and pending roadmap items. Good for starting a work session.

**Usage:**
```
/orbit-status
```

#### `/orbit-plugin` — AI Plugin Generator (pre-existing)
Calls the orbit-core AI endpoint to generate a complete connector plugin (spec + Python agent + README) from a natural language description of the data source.

**Usage:**
```
/orbit-plugin
```

---

## 3. How to Use

### Starting a session
1. `cd ~/orbit-core`
2. Run `claude` to start Claude Code
3. Type `/orbit-status` for a project overview
4. Start working — Claude already knows the project context

### Adding a feature (example flow)
```
/orbit-route webhooks          # scaffold the route
/orbit-migration               # create DB migration if needed
# ... develop and test ...
/orbit-deploy                  # pre-flight + deploy checklist
```

### Creating a new connector
```
/orbit-connector crowdstrike   # scaffold Python shipper
# ... customize parsing logic ...
/orbit-deploy                  # deploy to production
```

---

## 4. File Locations

```
orbit-core/
├── CLAUDE.md                              # Root context (always loaded)
├── packages/api/CLAUDE.md                 # API context
├── packages/ui/CLAUDE.md                  # UI context
├── packages/storage-pg/CLAUDE.md          # DB/migrations context
├── connectors/CLAUDE.md                   # Connectors context
├── deploy/CLAUDE.md                       # Deploy context
└── docs/claude-code-manual.md             # This manual

~/.claude/
├── commands/
│   └── orbit-plugin.md                    # Global: AI plugin generator
└── projects/-Users-rodrigomenchio-orbit-core/
    └── commands/
        ├── orbit-deploy.md                # Project: deploy checklist
        ├── orbit-migration.md             # Project: SQL migration
        ├── orbit-connector.md             # Project: connector scaffold
        ├── orbit-benchmark.md             # Project: EPS stress test
        ├── orbit-route.md                 # Project: API route scaffold
        └── orbit-status.md                # Project: status overview
```

---

## 5. Customizing

### Adding a new CLAUDE.md
Create a `CLAUDE.md` in any directory to give Claude context about that area. Keep it concise — focus on conventions, patterns, and gotchas.

### Adding a new slash command
Create a markdown file in `~/.claude/projects/-Users-rodrigomenchio-orbit-core/commands/`:
- Filename becomes the command name (e.g., `orbit-test.md` → `/orbit-test`)
- Use a `# Title` header and `## Behavior` section with numbered steps
- Claude follows the steps as instructions when the command is invoked

### Editing existing commands
All command files are plain markdown — edit them directly to adjust behavior.
