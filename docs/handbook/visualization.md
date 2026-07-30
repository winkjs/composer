# Visualization — From Pipeline to Dashboard

Composer computes at wire speed. Grafana polls the historian. The two never talk directly — QuestDB is the integration surface between them.

```text
Pipeline ──persistIf──► QuestDB ◄──query── Grafana
```

This is how every serious industrial system works: the computation engine runs in real time, the display is seconds behind. No special integration code is needed — any flow that writes to QuestDB is automatically visible in Grafana.

---

## Semantics Are the Contract

The asset class JSON controls what gets persisted. Every column you want in Grafana must be declared here. There is one exception: the `assetId` column. Composer adds it automatically from your `.assetId()` field (explained below).

```json
{
  "columns": {
    "pressure":    { "type": "DOUBLE", "insight": "operational" },
    "conviction":  { "type": "DOUBLE", "insight": "analytics" },
    "healthState": { "type": "SYMBOL", "insight": "analytics" },
    "cpk":         { "type": "DOUBLE", "insight": "analytics" }
  }
}
```

Add a column to semantics → it appears in QuestDB → Grafana can query it. Remove it → it stops being persisted. The pipeline, storage, and dashboard stay in sync because they all read from the same contract. See [Semantics](./semantics/index.md) for the full specification.

### The `assetId` Column

Every persisted table has one column you do not declare: `assetId`. Composer fills it with the partition id. The partition id is the value of the field you named in `.assetId()`. This is the column the query examples below filter on, as in `WHERE assetId = 'pump-1'`.

The writer never reads this value from your record. A record field named `assetId` is ignored. The column always receives the partition id. Some insights carry an identity that is not the partition (a line-level rollup, for example). Such an insight must come from a flow whose `.assetId()` field carries that identity. You cannot relabel identity in the record.

Composer tells you when this mistake happens. If a persisted record carries an `assetId` field that differs from the partition id, the storage adapter reports it through `onWarning`, once per insight type. And declaring your own `assetId` column in a persisted insight type stops the flow at startup with an `INVALID_CONFIG` error that names the fix.

One warning about demo runs. A terminal or capture emitter keeps every record field, including an ignored `assetId` field. A demo can therefore look right while QuestDB stores the partition id. When identity matters, check the QuestDB table itself.

---

## Your First Dashboard

### 1. Define What to Persist

In the asset class JSON, declare every computed field you want visible in Grafana. Use `insight: "analytics"` for computed metrics and `insight: "operational"` for raw sensor values.

### 2. Run the Stack

```bash
docker compose up -d   # QuestDB + Mosquitto + Grafana
node your-pipeline.js  # Composer reads sensors, writes to QuestDB
```

### 3. Import the Dashboard

Grafana → Dashboards → Import → Upload JSON → select the dashboard file.

Or use provisioning: drop the JSON into `grafana/dashboards/` and Grafana auto-loads it on startup (see [Grafana Provisioning](#grafana-provisioning) below).

### 4. See Live Data

Open Grafana at `http://localhost:3000`. Set auto-refresh to 5 seconds. Every computed field — conviction, Cpk, health state, evidence per source — updates in near real time.

---

## Best Practices

### Persist Computed Results

Composer writes **computed analytics** (conviction, EWMA, Cpk, health state) to QuestDB — not just raw sensor readings. Grafana never needs to compute anything. It displays what Composer already calculated.

```text
Avoid:  persist raw → Grafana computes rolling avg in SQL → slow, wrong, fragile
Do:     Composer computes rolling avg → persist result → Grafana displays it
```

### 5-Second Refresh Is Fine

Computation is real-time inside Composer (sub-millisecond per message). The dashboard polling QuestDB every 5 seconds adds display latency, not analytics latency. No operator needs sub-second refresh on a conviction score that changes over minutes.

### One Table per Logical Concern

Separate operational data from analytics from events. This keeps queries fast and dashboards clean.

| Table | Contents | Typical Row Rate |
|-------|----------|------------------|
| `{asset}_operational` | Raw sensor readings (pressure, temperature, current) | Every message |
| `{asset}_analytics` | Computed metrics (conviction, Cpk, evidence, health state) | Every message or on change |
| `{asset}_events` | Discrete events (wash cycles, alarm state changes, mode transitions) | On occurrence |

### QuestDB Query Patterns

| Need | Pattern | Example |
|------|---------|---------|
| Current values | `LATEST ON` | `SELECT * FROM pump_health LATEST ON timestamp PARTITION BY assetId` |
| Time-series trends | `SAMPLE BY` | `SELECT avg(pressure) FROM pump_health WHERE timestamp > dateadd('h', -24, now()) SAMPLE BY 5m` |
| Event history | Standard `WHERE` | `SELECT * FROM wash_events WHERE assetId = 'pump-1' ORDER BY timestamp DESC LIMIT 50` |

### Version Dashboard Alongside Pipeline

The dashboard JSON and pipeline code depend on the same column names. Keep them together, commit them together. When a new node adds a computed field, update the semantics, pipeline, and dashboard in one change.

```
my-pipeline/
├── pipeline.js                 # The Composer flow
├── semantics/
│   └── asset-classes/
│       └── my-asset.json       # Column contract
├── grafana-dashboard.json      # Dashboard definition
└── README.md
```

See `src/examples/rwm-grafana-showcase/` for a complete working example with all four artifacts.

---

## Grafana Provisioning

Provisioning auto-configures Grafana on startup — no manual clicks. Mount these YAML files as Docker volumes.

**Data source:**
```yaml
# grafana/provisioning/datasources/questdb.yml
apiVersion: 1
datasources:
  - name: QuestDB
    type: questdb-questdb-datasource
    url: http://questdb:9000
    isDefault: true
```

**Dashboard directory:**
```yaml
# grafana/provisioning/dashboards/dashboards.yml
apiVersion: 1
providers:
  - name: winkComposer
    type: file
    options:
      path: /etc/grafana/dashboards
```

Drop dashboard JSONs into the provisioned directory. Grafana loads them on startup. This is the recommended approach for both development and production deployments.

---

## Dashboard Templates

Pre-built dashboard JSONs for common use cases:

| Template | Key Panels | Best For |
|----------|-----------|----------|
| **Pump Health** | Conviction gauge, evidence bars, pressure/current trends, Cpk, health state timeline | Rotating equipment, water/wastewater |
| **Energy Monitor** | kWh per unit, shift comparison, baseline deviation | Any plant |
| **Multi-Asset Overview** | Status cards for N assets, drill-down via Grafana variables | Fleet or plant-wide view |
| **Anomaly Detection** | Conviction trend, state change annotations, multi-asset overlay | Any health monitoring scenario |

Each template uses Grafana variables for asset selection and time range presets for shift views. Customize by editing the JSON — panel layout, thresholds, colors, and queries are all declarative.

---

## What Grafana Is and Isn't For

### Use Grafana for
- Historical trends and time-series charts
- Gauge and stat panels for current values
- Alerting (Telegram, email, SMS via contact points)
- Multi-user access with role-based permissions
- PDF export and scheduled reports

### Do Not Use Grafana for
- **Live P&ID / synoptic process diagrams** — use an SVG synoptic renderer that polls QuestDB directly
- **Sub-second real-time display** — Grafana's minimum auto-refresh is 1 second; use MQTT or SSE for that edge case
- **Write-back / process control** — Grafana is read-only by design

The architecture for a complete deployment: Grafana for analytics dashboards on the desk, SVG synoptic for process overview on the wall. Two screens, two tools, one data source.
