We stress-tested Orbit Core in production. Here are the real numbers.

Single writer, sequential batches:
- 21,000 events per second sustained
- Sweet spot: 1K–2K events per batch, ~50ms average latency

4 parallel writers:
- 42,500 EPS peak throughput
- ~190ms on the slowest batch

745,000 total events ingested during the test. Zero data loss.

The setup: a single PostgreSQL instance behind a REST API. No Kafka. No message queue. No distributed cluster. Just one Node.js process doing bulk INSERTs.

Batch size matters more than you think:
- 100 events/batch → 5,700 EPS
- 500 → 12,000
- 1,000 → 20,000
- 2,000 → 21,000 (plateau)

After 4 parallel writers, adding more doesn't help — PostgreSQL becomes the bottleneck. Honest about the limits.

This is an observability platform that ingests Wazuh, FortiGate, Nagios, Suricata, and OpenTelemetry into a single pane of glass. Self-hosted. Your data stays on your server.

Free forever. Apache-2.0.

https://orbit-core.org

#CyberSecurity #Observability #SIEM #OpenSource #Performance #Benchmark #DevSecOps #InfoSec #Wazuh #PostgreSQL
