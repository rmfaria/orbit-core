We just shipped something we've been working on for a while: AI-generated dashboards that actually use your real data.

Here's the problem with most AI dashboard builders — they hallucinate. They invent metric names, guess asset IDs, and produce beautiful charts that query nothing.

Orbit Core v1.6.4 takes a different approach.

Before the AI generates a single line of HTML, it reads your database. A RAG (Retrieval-Augmented Generation) engine pulls the full catalog:

- Every monitored asset with its type and status
- Every metric with namespace, value ranges (min/max), and units
- Every event source with kinds, agents, and severity distribution
- Active connectors and their data flow status

The AI then receives an explicit allowlist: "You may ONLY use these exact identifiers." No guessing. No inventing. If the user asks for data that doesn't exist, the AI picks the closest real match and explains the substitution.

The result: dashboards built from one sentence that actually render real data on the first try.

What's in v1.6.4:

- RAG catalog endpoint with 5-minute intelligent cache (7 parallel SQL queries)
- Metric value ranges in AI prompts — gauges now auto-set correct min/max
- Strict allowlists for asset_ids, namespaces, and metric names
- AuthGate login screen restored (removed hardcoded API key auto-seed)
- Wazuh shipper reliability improvements (timeout 25s to 60s)
- Infrastructure hardening from a real production incident (full post-mortem documented)

10 visualization types, all auto-selected by the AI: line charts, area charts, gauges, KPIs, bar charts, event tables, EPS charts, donuts, multi-series comparisons, and responsive grid layouts.

One prompt in, production-ready dashboard out.

Self-hosted. Your data never leaves your server. Apache-2.0.

https://orbit-core.org

#CyberSecurity #Observability #OpenSource #AI #RAG #SIEM #Dashboard #DevSecOps #Wazuh #InfoSec
