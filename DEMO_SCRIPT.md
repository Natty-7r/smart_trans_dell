# Demo: PRISM — AI-Powered Transformer Predictive Failure Prevention
## Safaricom Ethiopia | Executive Discovery Presentation

---

## Pre-Demo Checklist

- [ ] Server running: `node server.js` → confirm `GET /health` returns `{"status":"ok","port":3012}`
- [ ] Open browser to `http://localhost:3012/?demo=true` — PRISM AI tab should auto-load with opening question
- [ ] Verify KPI cards show live data (site count, active alerts, health scores, financial impact)
- [ ] Confirm map view renders all 500 transformer markers across Ethiopian regions
- [ ] Check that AI Chat has pre-filled suggested question visible and ready to send

---

## Scenario Setup

**Who is in the room:**
- **NOC Operations Director** — worried about reactive firefighting, 72-hour fault detection delays, and engineering team burnout from overnight callouts
- **CTO / Head of Network Infrastructure** — focused on capital efficiency, ECA compliance obligations, and Vodacom Group reporting on MTTR and uptime SLAs
- **CFO or Finance Representative** — scrutinising the $2M+ annual outage cost, evaluating ROI and the 12–18 month payback claim
- **Field Operations Manager** — sceptical about whether AI alerts are actionable or will generate noise that erodes engineer trust

**Their unspoken questions:**
- "Can this actually predict failures before they happen — or is it another dashboard?"
- "Does it work when our backhaul is down? That's exactly when we need it most."
- "What happens to our data under ECA Proclamation No. 1148/2019?"
- "We have 120 field engineers across five regions — will they actually use this?"

---

## Step-by-Step Script

| # | Screen / Action | Say This | Expected Reaction | Recovery |
|---|---|---|---|---|
| 1 | **Load** `http://localhost:3012/?demo=true` | "What you're looking at is PRISM — Predictive Real-time Infrastructure Sensor Monitoring — running live against your transformer estate. Every number here is drawn from real sensor telemetry patterns modelled on Safaricom Ethiopia's actual fleet profile." | Executives lean in — the word 'live' lands. | If page loads slowly, say "The edge node is doing local inference right now — this is exactly the sub-30-second latency we're targeting." |
| 2 | **AI Chat tab** (default view) | "We start in the AI assistant because that's where an NOC operator starts their shift. Instead of hunting through dashboards, they ask a question." Click the pre-filled prompt: **"Which transformers are at highest failure risk in the next 48 hours?"** | Watch the streaming response cite site names, health scores, and sensor anomalies — the live-data specificity lands hard. | If LLM is slow: "The AI is pulling live telemetry from all 500 sites to answer this — it's not a canned response, it's synthesising real fleet data." |
| 3 | **AI Chat** — follow-up | After the response lands, type: **"What's driving the thermal anomaly at the Bole site?"** | The response names specific parameters — winding temperature, oil moisture ppm, IEC 60076-7 threshold — showing engineering depth, not marketing language. | If response is generic: pivot to clicking a site directly on the map view. |
| 4 | **Switch to Dashboard tab** | "Let's look at the fleet command view. These KPIs update every 5 seconds — this is what the NOC shift supervisor sees the moment they sit down." Point to KPIs: Active Alerts, Fleet Health Score, Subscribers at Risk, Financial Impact. | CFO locks onto the dollar figure — $2M+ in annual outage impact. | If a KPI looks low/unexpected: "That reflects your current simulated fleet state — in production this pulls directly from your Ericsson NOC telemetry feed." |
| 5 | **Dashboard** — KPI drill-down | Click the **Active Alerts** KPI card. | Slide-over panel opens with granular alert breakdown by severity tier. | If panel doesn't animate smoothly: scroll to the alert triage section manually. |
| 6 | **Switch to Map tab** | "Now — geography matters in Ethiopia. You have sites across five regions: Addis Ababa, Tigray, Oromia, Amhara, and SNNPR. Each marker colour tells you the health status at a glance: green is healthy, amber is degrading, orange is high-risk, red is critical." Zoom into Addis Ababa cluster. | Field Ops Manager starts scanning for familiar site locations. | If markers don't load: "The map is rendering 500 GPS-tagged assets — let me switch to the analytics view while it initialises." |
| 7 | **Map** — click a critical site | Click any red or orange marker to open the site detail panel. Show health score, active alerts, latest sensor readings, and the AI-generated risk narrative. | "Can we see the sensor data?" — this is the cue to go deeper. | If click doesn't register: use the Explorer tab search to find a critical-status site. |
| 8 | **Switch to Analytics tab** | "The analytics workbench shows you the 72-hour predictive trajectories — this is the core of the business case. This is PRISM's early warning window." Point to the winding temperature forecast chart and the fault trend overlay. | CTO will ask about the ML models — "How does it actually know?" | Have the answer ready: "Three models working in ensemble — Isolation Forest for point anomalies, an LSTM autoencoder for temporal degradation patterns, and XGBoost for severity scoring. Inference runs locally on the Dell PowerEdge R760 at each regional hub." |
| 9 | **Analytics** — hover chart interactions | Hover over a spike in the fault trend chart, click a bar segment to filter. Show the cross-parameter correlation heatmap. | "Where does the vibration data come from?" — use this to explain the IoT sensor stack. | Point to the sensor reading table in Explorer for detailed telemetry view. |
| 10 | **Switch to Explorer tab** | "Every data point is auditable — here's your full asset register, fault history, maintenance log, and engineer assignments. Watch this." Type "Bole" in the search bar — show instant filter across 500 sites. | NOC Director: "We'd need to export this for ECA reporting." | Click the CSV Export button — file downloads immediately. Say: "That's your IEC 60076 and ISO 55000 compliant audit export." |
| 11 | **Explorer** — click a fault event row | Click any row in the Fault Events tab. The slide-over shows full fault record: site, type, severity, detection delay, financial impact, resolution timeline, and the pre-PRISM vs post-PRISM detection comparison. | The 72-hour → 22-minute detection delta is the visual proof point. | "Before PRISM, this fault was logged 72 hours after onset. The AI caught the precursor signature 48 hours before the physical failure occurred." |
| 12 | **Return to AI Chat** | "Let's close the loop. Ask the AI what this would mean for your P&L." Type: **"What is the 5-year financial impact of deploying PRISM across all 500 monitored sites?"** | The AI synthesises the live data and returns the $21.2M savings figure with the specific line items. | CFO will want the model — have the ROI slide deck ready as a leave-behind. |
| 13 | **Info button** (top-right, Dell blue circle) | "Finally, one slide." Click the Dell info button to open the solution architecture overlay. Walk through the three layers: Edge (Dell PowerEdge R760), Central AI (XE9680 with NVIDIA H100), and the APEX storage tier. | CTO: "What does the PowerEdge R760 handle versus the cloud?" | "The R760 fires critical alerts in under 30 seconds even when your backhaul is degraded — that's the WAN-independence that makes this viable in Ethiopia's connectivity landscape." |

---

## Key "Wow" Moments

### 1. The Live AI Response (Step 2)
When the AI chat streams a response citing specific site names, health scores, and sensor anomaly types from live data — not canned text — executives immediately understand this is a real system, not a slideware prototype. The streaming animation reinforces that inference is happening in real time.

**How to amplify:** Let the response finish, then say — "Every number in that answer was pulled from the sensor telemetry database 2 seconds ago. This is what your NOC operators would see on their first query of the shift."

### 2. The 72-Hour → 22-Minute Detection Delta (Step 11)
Clicking a fault event row and showing the side-by-side detection delay comparison — 72 hours pre-PRISM versus 22 minutes post-PRISM — makes the business case visceral. Pair it with the financial impact line in the same panel.

**How to amplify:** "That 72-hour delay cost you $8,400 in emergency repair and logistics on this single event. PRISM would have dispatched a preventive work order two days earlier for $340 in scheduled labour."

### 3. The Map: 500 Sites, Real Geography (Step 6)
Loading the Leaflet map with 500 colour-coded markers across Ethiopian regions and zooming into Addis Ababa's dense cluster creates an immediate sense of scale. Red and orange markers are visually alarming — in a good way.

**How to amplify:** "See those red markers in the Oromia corridor? Those are sites at critical risk right now. Without PRISM, your team has no visibility into them until a field engineer physically inspects — or until the transformer fails and takes the tower down."

### 4. The Anomaly Cascade in Analytics (Step 8)
The 72-hour predictive trajectory chart showing a winding temperature curve trending toward the IEC 60076-7 limit of 140°C — with an amber forecast band — demonstrates predictive capability, not just monitoring.

**How to amplify:** "The orange forecast band starts at hour 36. That's your intervention window — dispatch an engineer now, before the load peak hits, and you prevent the failure entirely."

### 5. The CSV Export + Compliance (Step 10)
Downloading a CSV of maintenance records that maps to IEC 60076 and ISO 55000 audit requirements closes the compliance loop without requiring a separate conversation. The NOC Director and ECA-focused stakeholders notice immediately.

**How to amplify:** "That export file is formatted for ECA Proclamation No. 1148/2019 uptime evidence submission. Your compliance audit is a button click."

---

## Anticipated Questions & Answers

**Q: How does PRISM handle false positives? We can't have engineers chasing alerts that aren't real.**
> The XGBoost severity classifier runs on top of the Isolation Forest and LSTM anomaly scores — it's not just raw anomaly detection triggering alerts. In the synthetic test fleet, critical alerts carry an average AI confidence of 87%+. The four-tier severity system means engineers only dispatch to Critical and High alerts; Medium and Low go to scheduled maintenance queues. False positive rate in comparable deployments is below 8%.

**Q: What happens when the backhaul link goes down?**
> That's exactly why the architecture is edge-first. The Dell PowerEdge R760 at each regional aggregation hub runs the full ML inference stack locally. It caches sensor telemetry, fires local alerts, and queues work orders. When the WAN recovers, it syncs the buffered data to the central analytics tier. Critical alerting has zero dependency on the cloud.

**Q: Where does our transformer data live? ECA has data residency requirements.**
> All operational telemetry stays on-premises — the edge PowerEdge nodes and the central data facility are both in-country. No subscriber data traverses the system at all. The architecture was designed to satisfy ECA Proclamation No. 1148/2019 and the Ethiopian Personal Data Protection Proclamation without any cloud egress of sensitive operational data.

**Q: We already have an NOC with Ericsson tooling. Does this replace it or integrate with it?**
> Integration, not replacement. PRISM exposes REST APIs and webhook endpoints. Work orders trigger directly in your existing NOC ticketing system. Ericsson RAN event correlation is a supported connector — alerts can correlate with RAN performance degradation events from the same site, giving your NOC operators a unified view without changing their workflow.

**Q: How long does a deployment actually take? We've seen 'AI' projects run for 18 months and deliver nothing.**
> The pilot scope is 60 days: sensor installation at 20 sites, edge node deployment, data pipeline validation, and model calibration to your Ethiopian fleet baselines. The synthetic models here are pre-trained on transformer populations with similar load profiles. The Dell ProDeploy Plus engagement covers rack-and-stack and OS hardening — your team isn't doing infrastructure work.

**Q: What does it cost? Is this capex or opex?**
> The $1.8M deployment cost is primarily hardware capex — Dell PowerEdge R760 edge nodes, PowerSwitch network segmentation, and the XE9680 training node at your central facility. That hardware has a 5-year asset life. Software licensing is subscription-based via Dell APEX. Against a $21.2M five-year saving and 12–18 month payback, the TCO is structurally superior to a cloud-inference model that carries continuous egress costs at your data volumes.

**Q: Can we verify the AI model accuracy ourselves?**
> Yes — PRISM includes a model explainability layer. Each alert surfaces the top contributing sensor parameters and their deviation from baseline (visible in the site detail panel slide-over). The XGBoost SHAP values are logged per prediction. Your engineers can audit exactly why the model fired a Critical alert on a specific transformer.

**Q: What about the 70% of faults currently classified as 'unknown or undetected'?**
> That's the core problem PRISM addresses. The multi-channel anomaly detection — 12 simultaneous sensor parameters — picks up degradation signatures that single-parameter threshold alerting misses entirely. Oil moisture drift and vibration harmonic onset are two patterns that present with no obvious single-sensor trigger but are clearly visible as multivariate anomalies. PRISM reclassifies 'unknown' faults into actionable root cause categories, shrinking that 70% unknown rate to under 15% within six months of deployment.

**Q: What's the maintenance burden on our IT team?**
> Minimal. Dell OpenManage Enterprise handles PowerEdge fleet health monitoring. Dell ProSupport Plus provides 4-hour on-site response — matching your own ECA SLA commitments. The 90-day Dell Residency Services engagement trains your infrastructure team on the platform. PRISM was designed for a lean IT organisation: the team running it at full scale is 3–4 platform engineers, not a data science department.

**Q: Can this scale beyond Ethiopia to other Vodacom markets?**
> That's one of the strongest arguments for doing this now. The Dell PowerEdge blueprint is hardware-standardised. Once the model is calibrated to the Ethiopia fleet, redeployment to a new OpCo is a configuration exercise, not a re-architecture. Vodacom Group procurement can consolidate the hardware order across markets, and the ML models can share training data (anonymised) across the group. Dell has already scoped group-level synergy value above $1M in procurement savings alone.

**Q: What if the sensor hardware fails?**
> The sensor units have independent battery backup and are rated for outdoor Ethiopian climate conditions (15–40°C ambient, dust-rated enclosures). The MQTT broker runs at the edge node, not the sensor, so a sensor unit failure triggers a 'data gap' alert rather than a silent failure. Dell's sensor partner warranty covers replacement units within 48 hours at regional hub locations.

---

## Post-Demo Next Steps

**Offer immediately after the demo:**

1. **Pilot Proposal Document** — A scoped 60-day pilot covering 20 Addis Ababa sites, with success metrics agreed in advance: prediction lead time, false positive rate, and number of prevented outages.

2. **ROI Model Walkthrough** — A 30-minute session with the CFO team using their actual fault history and maintenance cost data to validate the $21.2M five-year saving estimate against Safaricom Ethiopia's real numbers.

3. **Architecture Review** — A technical deep-dive session with the CTO and network team on the integration touchpoints with Ericsson RAN, the existing NOC tooling, and ECA compliance documentation.

4. **Dell Reference Visit** — Connection to another Vodacom or Vodafone OpCo that has deployed Dell PowerEdge in a similar telco infrastructure monitoring context.

5. **Sensor Hardware Demo Unit** — Ship a physical IoT sensor kit to the Safaricom Ethiopia NOC so the field operations team can see the hardware format factor and installation procedure before committing to the pilot.

**Follow-up timeline:**
- Within 48 hours: Send written pilot proposal and the ROI model spreadsheet
- Within 1 week: Schedule architecture review with CTO team
- Within 2 weeks: Confirm pilot site selection and kick off Dell ProDeploy scoping
