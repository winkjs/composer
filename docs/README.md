# wink-composer ♫

**Composable Streaming Intelligence**

### [![Stability](https://img.shields.io/badge/stability-1--experimental-orange.svg)](https://nodejs.org/api/documentation.html#documentation_stability_index)

## ✨ Real-time analytics that sparks joy

[<img align="right" src="https://decisively.github.io/wink-logos/logo-title.png" width="100px" >](http://winkjs.org/)

WinkComposer is an upcoming open-source framework that makes building streaming intelligence playfully simple. Connect intuitive nodes, experiment freely, perfect it in an iteration or two. From edge-ready AI algorithms to built-in resilience, everything you need for production comes standard. No complexity, no black boxes - just the joy of creating exactly what you need.

## Why Composability Matters

**🎯 Create What You Need** — With composability, you're the inventor: Correlate vibration with weather? Done. Detect micro-trends before they become macro? Built. 

**💫 Countless Possibilities** — Dozens of nodes → Endless pipelines. Like few music notes creating captivating symphonies.

**🌱 Evolve Naturally** — Start: `sensor → threshold → alert`. Grow: Add intelligence: `sensor → normalize → smooth → detect → confirm → alert`. Unconstrained by vendor feature lists.

**🔍 Total Transparency** — See which node triggered, what threshold crossed, why it alerted. Every decision is explainable.

## Build Exactly What You Need

Build precise analytics for your unique patterns:

```javascript
// Detect bearing failure in rotating equipment
vibration → isolateSignal → extractPeaks → measureIntensity →
      trackChanges → triggerAlert

// Monitor chemical process quality
temperature → removeNoise → smoothFast → smoothSlow → findDivergence →
      detectChange → waitForPersistence

// Find correlated sensor behaviors
[sensor1, sensor2] → trackCorrelation → compareToNormal → raiseFlag

// Calculate real-time OEE
machine → trackState → sumTime → countOutput →
      checkQuality → calculateScore
```

Each node is simple:
- `removeNoise`: Median of last few values (removes sensor spikes).
- `smoothFast`: Average of last 10 values (recent trend).
- `smoothSlow`: Average of last 100 values (baseline trend).
- `findDivergence`: Fast trend - slow trend (unusual behavior?).
- `trackCorrelation`: Smart correlation (learns relationships between sensors)

_Node names and details are illustrative - actual implementations may vary._

Every arrow is a conscious choice. Every node has a purpose. No magic, just simple intuitive math.


## Your Analytics Journey

**Start Simple**  
`sensor → threshold → alert`

**Evolve Naturally**  
`sensor → validate → normalize → threshold → debounce → alert`

**Scale Intelligently**  
`sensor → [parallel: statistics | patterns | anomalies] → correlate → decide → act`

Your analytics grow with your understanding, and are never limited by any tool's feature list.

## Designed for the Real World

### Industrial IoT
From simple threshold monitoring to complex predictive maintenance - compose what fits your equipment, your patterns, your physics. **Move intelligence to the edge** with analytics that run on industrial Raspberry Pis. Works alongside your existing systems to handle your unique requirements.

### Financial Services  
Build fraud detection you can explain to auditors. Every decision traceable, every threshold justified.

### Smart Infrastructure
Energy optimization with transparent logic. See why the system made each decision.

## Production-Grade Resilience
Real streams have noise. Sensors fail. Networks hiccup. WinkComposer handles it all:

- **Node-level fault isolation** - One bad reading doesn't crash your pipeline
- **Automatic state recovery** - Snapshot and restore without missing a beat
- **Built-in observability** - Know what's happening in every node, every partition
- **Adaptive execution** - Maintains responsiveness under varying load


## Core Principles

| Principle | What it means |
|-----------|---------------|
| **Atomic Operations** | Each node does one thing perfectly |
| **Pure Functions** | Predictable, testable, composable |
| **Transparent Logic** | Understand every decision |
| **Production Ready** | Built for high-throughput streaming with microsecond-scale latency |
| **AI-Native Intelligence** | From statistical learning nodes to LLM reasoning - intelligence at every level |
| **Built for Reality** | Node-level fault isolation, automatic recovery, and comprehensive observability |

## What's Coming

### 🎉 **Opening Our Doors in 2025**
WinkComposer is transitioning to open source development in 2025. Join the [early conversation](https://github.com/winkjs/wink-composer/discussions) and help shape the future of composable streaming analytics. You can even reach out directly at wink@graype.in.

**Together, we're building:**

- **Rich Node Library**: Statistical, filtering, detection, transformation, and control nodes
- **Edge-Ready Intelligence**: Advanced algorithms like smart correlation, change point detection, and regression inference - AI-like capabilities without heavyweight frameworks
- **Pipeline Builder**: Define your analytics flows declaratively (visual tools planned)
- **Edge-Ready Performance**: Process data efficiently, even on resource-constrained devices (**tested on Raspberry Pi**)
- **Knowledge Graph Integration**: Build digital twins with Neo4j/ArangoDB for contextual intelligence
- **AI-Native Reasoning**: When patterns emerge, LLMs explain why. When anomalies occur, get actionable recommendations. Open-source models keep intelligence at the edge.


## The Vision

Finally, build solutions that fit your exact problems, not the other way around.

Every industry has unique patterns. Every process has specific physics. Every business has particular rules. WinkComposer gives you the building blocks to create exactly what you need.

Domain-specific platforms excel at standard use cases. WinkComposer shines when you need something unique, beyond standard use cases. Standard use cases always included - they're just the beginning of what's possible!



## About winkJS

WinkComposer joins the winkJS family - production-grade open-source packages for Natural Language Processing, Machine Learning, and Statistical Analysis in JavaScript. Built for reliability with ~100% test coverage.


## Copyright & License

**Wink Composer** is copyright 2017-25 [GRAYPE Systems Private Limited](https://graype.in/).

It is licensed under the terms of the MIT License.
