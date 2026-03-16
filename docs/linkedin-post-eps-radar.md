Imagine seeing the EPS consumption of every data source in a single chart.

That's what the Orbit Core radar view does. One glance and you know:

- Which sources are generating the most events right now
- How the 1-minute EPS compares to the total volume
- Whether a connector is silent, steady, or spiking

In this screenshot: Wazuh leads at 2.1 EPS (1m average), followed by OTLP at 1.3. Nagios and macOS netstat are quieter — under 1 EPS each. The Wazuh API connectors (SCA, inventory, MITRE) show periodic bursts when they pull structured data from two separate environments.

Below the radar: real-time EPS cards for each source at 10s, 1m, and 5m intervals. No dashboards to build. No queries to write. It's just there.

This is what multi-source observability should look like. Wazuh, Nagios, OpenTelemetry, Suricata, FortiGate — all normalized into one view. You see the rhythm of your infrastructure at a glance.

The correlation engine runs in the background (94 beats, last check 4 minutes ago). The alert engine runs every 40 seconds (501 beats, zero errors). Both visible as health cards at the top.

Everything self-hosted. Everything on your hardware. No cloud dependency.

Free forever. Apache-2.0.

https://orbit-core.org

#CyberSecurity #Observability #SIEM #EPS #OpenSource #Wazuh #Nagios #OpenTelemetry #InfoSec #SOC #DevSecOps
