# PRISM Prototype Build Context

## Customer Profile
- **Company**: Safaricom Ethiopia
- **Vertical**: Telecom
- **Geography**: Addis Ababa, Ethiopia
- **Company Size**: ~3,500 est. (2025–26; lean greenfield operation launched 2022)
- **Pain Points**: State-backed Telebirr benefits from regulatory capture and government-mandated digital policy frameworks (including licensing conditions, agent network rules, and mobile money directives) that structurally constrain M-PESA Ethiopia's addressable market ceiling, despite 258% M-PESA user growth to 5.2 million active users in FY2026.,A publicly flagged $5 billion sector-wide capital investment gap (April 2026) imposes sustained capital intensity on network scaling, extending the path to profitability for a greenfield operator still reporting operating losses despite 58.3% FY2026 revenue growth.,ECA data localisation mandates requiring on-shore residency for subscriber data constrain deployment of cloud-native AI and ML infrastructure, complicating access to Vodacom/Vodafone's group-level pre-built telco AI models following the July 2026 consolidation.,Competing as the sole private challenger against Ethio Telecom's entrenched infrastructure, government-mandated interoperability rules, and state-reinforced brand trust creates asymmetric cost and market access disadvantages across both connectivity and mobile money segments.,Rapid subscriber growth (10M by July 2025; 12M by February 2026) is outpacing network capacity in a geographically large and infrastructure-sparse country, generating quality-of-service churn risk that erodes ARPU gains and undermines the company's premium positioning against the state incumbent.
- **Business Priorities**: Digital transformation
- **Existing Tech**: Not specified

## Use Case
- **Title**: AI-Powered Transformer Predictive Failure Prevention for Safaricom Ethiopia Network
- **Description**: Safaricom Ethiopia operates across 3,500+ sites nationwide with transformer failures currently detected reactively — the average fault detection delay of 72 hours means 40% of network outages originate from power equipment degradation, costing an estimated $2M+ annually in downtime, emergency repairs, and logistics, while a 14% fault rate on 25KVA units and 70% of root causes classified as 'unknown or undetected' expose a critical blind spot that manual inspection cycles cannot close. The proposed solution deploys smart IoT sensor units per transformer — capturing primary/secondary voltage, phase and neutral current, winding and oil temperature, oil level and moisture, vibration, and tap changer position — transmitting via NB-IoT/4G over encrypted MQTT to Dell PowerEdge edge nodes running local pre-processing before forwarding enriched telemetry to a cloud analytics tier on AWS or Azure. At the AI core, a multi-stage machine learning pipeline ingests high-frequency time-series streams through feature engineering (rolling statistics, cross-parameter correlation, Fourier decomposition for vibration), then applies an ensemble of Isolation Forest for multivariate point anomalies, LSTM autoencoders for temporal pattern deviation, and XGBoost-based risk scoring to assign four-tier severity levels — enabling predictive alerts 48–72 hours before failure onset with sub-30-second dispatch latency. Integration into Safaricom Ethiopia's existing Ericsson RAN-connected NOC tooling and M-PESA-adjacent operational platforms occurs via REST APIs and webhook-triggered work order creation, while push notifications and a mobile app deliver geo-tagged alerts with one-tap acknowledgement to field engineers across Addis Ababa and regional corridors. The quantified outcome is a projected 70% reduction in unplanned transformer failures, MTTR compressed from 72 hours to under 30 minutes, maintenance cost reduction of 25–30%, and a five-year cumulative saving of $21.2M against a $1.8M deployment cost — with break-even in 12–18 months and $9M in protected customer revenue across 50,000+ at-risk subscribers at $36 ARPU. Dell AI Factory running on PowerEdge R760 servers deployed as edge inference nodes at regional aggregation hubs provides sub-30-second local alerting independent of WAN availability — a decisive advantage over pure-cloud architectures in Ethiopia's connectivity landscape where backhaul unreliability is precisely the risk being managed. On-premises edge processing addresses Ethiopian data sovereignty expectations and aligns with ECA operational data residency guidance under Proclamation No. 1148/2019, while the solution maps directly to Ethiopian Electric Utility Corporation HV monitoring standards, IEC 60076 transformer management requirements, and ISO 55000 asset lifecycle documentation obligations. As Safaricom Ethiopia scales toward profitability under Vodacom Group ownership following the July 2026 acquisition, this system creates a replicable asset intelligence blueprint with cross-OpCo synergy potential across Vodacom and Vodafone networks, unlocking shared analytics benchmarking and group procurement savings estimated above $1M and positioning the Ethiopia operation as a group-wide centre of excellence for AI-driven infrastructure management.
- **Business Impact**: Significant operational improvement
- **Complexity**: medium
- **Demo Scenario**: Standard enterprise demo
- **Vertical**: Telecom


## Information Model
{
  "rank": 1,
  "business_impact": "5-year cumulative savings of $21.2M representing a 58% cost reduction vs. unmonitored baseline of $36.5M; $9M in protected customer revenue from 50,000+ at-risk subscribers at $36 ARPU; $400K–$600K direct failure cost avoidance annually; $255K emergency repair savings; $160K logistics and dispatch savings; 70% reduction in unplanned outages; MTTR from 72 hours to under 30 minutes; 25–30% maintenance cost reduction; transformer lifespan extension of 20–30% reducing $6K–$10K per-unit replacement exposure across the 1,787-unit installed estate; $500K+ avoided per major transformer replacement cycle; 12–18 month payback period; $1M+ group synergy value across Vodacom/Vodafone OpCos",
  "complexity": "medium",
  "regulatory_implications": [
    "Ethiopian Communications Authority (ECA) — network uptime and SLA reporting obligations under Telecom Sector Reform Proclamation No. 1148/2019; automated audit-trail export satisfies ECA uptime evidence requirements",
    "Ethiopian Electric Utility Corporation (EEUC) — HV transformer monitoring, performance documentation, and incident reporting standards for licensed telecom infrastructure operators",
    "IEC 60076 — International standard for power transformer performance, thermal limits, and insulation condition assessment; sensor parameter thresholds calibrated against IEC 60076-7 thermal model",
    "ISO 55000 — Asset management lifecycle documentation, condition-based maintenance planning, and risk assessment audit trail required for enterprise infrastructure governance",
    "Ethiopian Personal Data Protection Proclamation — operational telemetry processed on-premises satisfies data residency expectations; no customer PII traverses the system reducing compliance exposure",
    "Vodacom Group data governance and cross-OpCo data sharing framework — group-level analytics sharing with Vodacom/Vodafone requires contractual data sharing agreements and anonymisation controls before cross-border transmission"
  ],
  "dell_positioning": {
    "hardware": "Dell PowerEdge R760 (2x Intel Xeon Scalable 6th Gen, 512GB DDR5, 4x 3.84TB NVMe SSD) deployed as regional edge inference nodes at 4–6 Safaricom Ethiopia aggregation hubs — runs MQTT broker, local ML inference, TimescaleDB replica, and alert dispatch with sub-30-second end-to-end latency independent of WAN connectivity; Dell PowerEdge XE9680 (8x NVIDIA H100 80GB SXM5) at Safaricom Ethiopia central data facility for nightly full-fleet model retraining on 250K+ daily sensor readings; Dell PowerSwitch S5248F-ON for OT/IT network segmentation isolating sensor VLAN from corporate network at each hub site; Dell VxRail for hyperconverged failover at primary NOC site ensuring platform HA",
    "software": "Dell OpenManage Enterprise for centralised PowerEdge fleet health monitoring and proactive hardware alerting; Dell APEX Data Storage Services providing elastic object storage tier for raw telemetry archival and regulatory audit exports; NVIDIA AI Enterprise on PowerEdge XE9680 for GPU-accelerated LSTM and XGBoost model training with MLflow experiment tracking; Dell Streaming Data Platform orchestrating MQTT-to-TimescaleDB ingestion pipeline with at-least-once delivery guarantees",
    "services": "Dell ProDeploy Plus for edge node rack-and-stack, network configuration, and OS hardening across all Addis Ababa and regional hub sites; Dell ProSupport Plus with 4-hour on-site response SLA matching Safaricom Ethiopia's own network SLA commitments to ECA; Dell Residency Services providing 90-day embedded ML engineer engagement for alert threshold calibration, model drift monitoring, and NOC team knowledge transfer; Dell Education Services for structured ML Operations upskilling programme for Safaricom Ethiopia infrastructure team",
    "win_themes": [
      "Edge-first resilience — Dell PowerEdge at regional hubs fires critical alerts in under 30 seconds even during WAN degradation, eliminating the cloud-dependency paradox where the monitoring system fails precisely when the network is most at risk",
      "Data sovereignty and ECA compliance — full on-premises processing keeps operational telemetry in-country, satisfying Ethiopian regulatory expectations without sacrificing analytics depth or requiring costly data egress",
      "Total cost of ownership superiority — Dell AI Factory capex model versus continuous cloud inference and egress costs produces materially better 5-year economics at 3,500-site scale, directly improving Safaricom Ethiopia's path to profitability under Vodacom Group scrutiny",
      "Group-scale replicability — a standardised Dell PowerEdge hardware blueprint deployable across Vodacom and Vodafone OpCo sites creates a group-level architecture win, procurement leverage, and shared IP value that extends the Dell relationship well beyond the Ethiopia engagement"
    ]
  },
  "competitive_differentiation": "HPE and Cisco offer edge compute platforms but lack integrated AI Factory blueprints purpose-built for high-density IoT telemetry workloads at telecom infrastructure scale; hyperscaler-only approaches (AWS IoT Greengrass, Azure IoT Edge) introduce cloud dependency for critical alert dispatch — operationally unacceptable when WAN backhaul instability is itself a symptom of the transformer failure being monitored; IBM Maximo Asset Management requires multi-month implementation cycles incompatible with Safaricom Ethiopia's 60-day pilot mandate and lean IT organisation; Dell uniquely combines PowerEdge edge nodes for latency-deterministic local inference, NVIDIA-accelerated central retraining on XE9680, APEX storage elasticity for regulatory archival, and ProSupport SLAs that contractually match Safaricom Ethiopia's own ECA uptime commitments — delivering a single-vendor accountability model that minimises integration risk for a 3,500-person pre-profitability operation where IT staffing depth is constrained and every dollar of operational spend is scrutinised by Vodacom Group.",
  "vertical": "Telecom"
}

## Synthetic Data Requirements
{
  "entities": [
    "TransformerSite",
    "SensorReading",
    "FaultEvent",
    "MaintenanceRecord",
    "AlertLog",
    "FieldEngineer"
  ],
  "record_counts": {
    "TransformerSite": 500,
    "SensorReading": 250000,
    "FaultEvent": 1200,
    "MaintenanceRecord": 3500,
    "AlertLog": 8000,
    "FieldEngineer": 120
  },
  "data_characteristics": "Time-series sensor telemetry sampled every 30 seconds per site: primary voltage (210–240V), secondary voltage (220–240V), phase currents (0–200A), neutral current, winding temperature (30–120°C with pre-failure spike trajectories to 140°C), oil temperature (25–100°C), ambient temperature (15–40°C reflecting Addis Ababa climate range), oil level (60–100%), moisture-in-oil (5–50 ppm), vibration RMS (0–10 mm/s with harmonic anomalies), tap changer position (1–17), load factor (0–120%). Fault events include timestamps, fault type labels (overheating 18%, insulation breakdown 8%, oil contamination 4%, external short circuit 0%, unknown 70%), transformer ID, unit rating (25KVA at 14% fault rate and 50KVA at 4% fault rate), severity tier, detection-to-resolution elapsed time, and financial impact per event. Maintenance records carry planned vs. emergency classification, cost ($200–$8,000 per event), technician ID, parts replaced, and site access notes. Geographic coordinates distributed across Addis Ababa and four regional corridor clusters (Tigray, Oromia, Amhara, SNNPR) with realistic GPS coordinates. Anomaly injection seeds: 35 sites with slow thermal degradation curves, 12 sites with oil moisture drift, 8 sites with vibration harmonic onset, 5 sites with imminent critical failure within the synthetic 90-day window.",
  "pii_sensitivity": "low"
}

## Tech Stack Requirements
{
  "frontend": "React 18 SPA with Leaflet.js GIS map rendering 500 transformer site markers with live health-badge colour coding (green/amber/orange/red critical), real-time telemetry panel with Chart.js time-series sparklines per parameter, four-tier alert triage queue with severity badges and one-click acknowledgement, 72-hour predictive risk trajectory chart, historical fault overlay toggle, and a mobile-responsive field engineer view simulating push notification receipt and photo-capture workflow",
  "backend": "Python 3.11 FastAPI serving REST and WebSocket endpoints for live dashboard streaming; Celery plus Redis for async multi-channel alert dispatch (SMS, email, push); scikit-learn Isolation Forest and PyTorch LSTM autoencoder for inference; XGBoost risk classifier for four-tier severity scoring; Prophet for 72-hour thermal and load forecasting; Mosquitto MQTT broker simulating IoT sensor ingest; Pandas and NumPy feature engineering pipeline computing rolling means, standard deviations, rate-of-change, and cross-sensor correlation coefficients",
  "database": "TimescaleDB (PostgreSQL extension) for compressed time-series sensor storage with hypertable partitioning by site ID and hour achieving 90%+ compression on historical telemetry; PostgreSQL relational tables for transformer asset master data, fault history, maintenance records, and engineer assignments; Redis for real-time alert state machine, WebSocket session state, and dashboard cache with 5-second TTL",
  "ai_models": [
    "Isolation Forest (scikit-learn) — multivariate point anomaly detection across 12 simultaneous sensor channels",
    "LSTM Autoencoder (PyTorch) — 24-hour sequence reconstruction error scoring for temporal degradation pattern detection",
    "XGBoost Classifier — four-tier severity risk scoring (Critical/High/Medium/Low) from engineered feature vectors",
    "Prophet (Meta/Facebook) — 72-hour winding temperature and load factor forecasting for proactive scheduling"
  ],
  "rag_required": false,
  "streaming_required": true,
  "visualization_required": true
}

## Style & Layout Requirements
- Use Tailwind CSS (CDN) or inline CSS for styling
- **Prototype type**: data-analytics
- **Layout variant**: analytics-workbench — top bar with time picker, collapsible filter panel, Grafana-style chart grid
- Fonts: Inter (Google Fonts), Segoe UI, system-ui, sans-serif
- Mobile-responsive layout (minimum 1280px)
- EVERY PROTOTYPE MUST HAVE A DISTINCT VISUAL IDENTITY — follow the layout variant above, do not default to a generic left-sidebar dashboard
- Dell blue (#0076CE) used only for branding/info elements, not as the primary accent

## Regulatory Context
[]

## Performance Targets
- API response: <200ms for data queries
- LLM streaming: Begin within 1 second
- Initial page load: <2 seconds
- Synthetic data: 150–300 records per entity is sufficient for a compelling demo

## Port Assignment
This prototype serves on port **3012**

## Critical Rules
1. Generate ALL synthetic data as JSON files in /data/ FIRST — 50–100 realistic records per entity. Use a generator script, not hand-written JSON.
2. Every file must be 100% complete — absolutely NO TODOs, stubs, or placeholders
3. The demo must work end-to-end without any manual configuration
4. Use CommonJS (require/module.exports) not ES modules for Node.js files
5. server.js must be in the root directory and must start with: node server.js
6. GET /health must return { "status": "ok", "port": 3012 }
7. All synthetic data must be sector-specific and realistic (not "John Doe", not "ACME Corp")
8. LLM integration must gracefully handle Ollama unavailability (fall back to Anthropic SDK)
9. Console must be free of uncaught errors after startup
10. The prototype IS the demo — it runs live in front of the customer

## UI Quality Standards — NON-NEGOTIABLE
11. The UI must look like a real SaaS product — comparable to Datadog, Tableau, ServiceNow
12. Every table row must be clickable for a detailed drill-down view with slide-over panel
13. Every chart segment/bar must be interactive (hover tooltips at minimum, click-to-filter preferred)
14. Dashboard must have 4-6 KPI cards with trend indicators, sparklines, and click-to-drill-down
15. Data Explorer must have search, sort, filter, pagination, and CSV export — all working
16. AI Chat must query real database stats before calling the LLM — responses must cite real numbers
17. Use skeleton loaders (pulsing placeholders) not just spinners
18. Professional colour scheme — use the **layout variant** colour palette, Dell blue (#0076CE) for branding only
19. Navigation pattern follows the layout variant — DO NOT default to a generic left sidebar if the layout specifies otherwise
20. Mobile-responsive down to 1280px width

## DEMO IMPACT — CRITICAL
21. The frontend IS the demo. It must visually impress C-level executives within 5 seconds of loading.
22. Show real-time AI operations on data: live scoring, anomaly detection, predictions updating in real time
23. Display rich synthetic data everywhere — populated tables, charts with realistic trends, activity feeds
24. Include animated transitions: data loading, chart rendering, status changes, number counters
25. Dashboard must feel ALIVE: auto-refreshing stats, real-time event feeds, pulsing status indicators
26. Every screen must show meaningful data — NO empty states on first load
27. Use data storytelling: highlight anomalies, trends, outliers with visual callouts and colour coding
28. Include at least one "wow factor" interaction: waterfall chart, SHAP explainability viz, live prediction, or real-time data stream

## ITERATIVE WORKFLOW
29. Projects are NOT one-shot — architects may return to add more use cases after initial delivery
30. Each new use case build triggers a fresh artefact generation cycle for that use case
31. Artefacts can be regenerated independently via the Deliver screen at any time
32. The pipeline flows: Discovery → Research → Use Cases → Build → Deliver, and cycles back as needed
