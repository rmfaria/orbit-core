We enabled 9 threat intelligence feeds on a production MISP instance yesterday.

Within 2 minutes, the correlation engine found real hits.

Here's what happened: Orbit Core's threat-intel worker runs every 2 minutes inside the API. It extracts IPs, domains, hashes, and URLs from every incoming event — Wazuh, Suricata, FortiGate, Apache logs — and batch-checks them against 67,944 active indicators.

5 malicious IPs were detected hitting a web server in the last hour alone:

- 45.149.173.233 — 18 hits (active scanner, Blocklist.de listed)
- 207.211.167.189 — 9 hits
- 203.55.131.5 — 2 hits
- 45.131.195.17 — 1 hit
- 89.42.231.182 — 1 hit

All matched automatically. No manual lookup. No copy-pasting into VirusTotal. The worker found them in the Wazuh event stream by cross-referencing the source IP field against known bad IPs from abuse.ch, Blocklist.de, and CI Army feeds.

The feeds powering this:

- abuse.ch Feodo Tracker (botnet C2 IPs)
- abuse.ch SSLBL (malicious SSL certificates)
- abuse.ch URLhaus (11,865 malware distribution URLs)
- abuse.ch ThreatFox (1,984 malware IoCs)
- Blocklist.de (28,790 brute-force attacker IPs)
- CI Army (15,000 top attacking IPs)
- OpenPhish (300 phishing URLs)
- CIRCL OSINT + Botvrij.eu (historical APT campaigns)

67,944 indicators. 44,541 IPs. 12,863 URLs. 5,000 domains. All correlated against live traffic in real time.

The pipeline: MISP pulls feeds every 5 minutes → Python connector ships IoCs to Orbit Core → correlation worker matches against live events every 2 minutes → ioc.hit events fire automatically → Threat Intel dashboard shows everything.

One database. One UI. No second vendor. No second bill.

Self-hosted. Your threat intel stays on your infrastructure. Apache-2.0.

https://orbit-core.org

#CyberSecurity #ThreatIntelligence #MISP #IoC #Observability #OpenSource #SIEM #Wazuh #InfoSec #SOC #DevSecOps #ThreatHunting
