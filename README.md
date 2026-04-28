<div align="center">

  <h1>Leaflet MCP</h1>

  <p><strong>AI-Powered Leaflet Map Control via Model Context Protocol</strong></p>

  <p>Connect any MCP-compatible AI agent to <a href="https://leafletjs.com/">Leaflet</a> — view, tile layers, markers, GeoJSON, popups, all through natural language.</p>

  <p>
    <a href="https://www.npmjs.com/package/leaflet-mcp-runtime"><img src="https://img.shields.io/npm/v/leaflet-mcp-runtime.svg" alt="npm version"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://github.com/gaopengbin/leaflet-mcp"><img src="https://img.shields.io/github/stars/gaopengbin/leaflet-mcp?style=flat" alt="GitHub stars"></a>
  </p>

  <p>
    <a href="README.zh-CN.md">中文文档</a>
  </p>
</div>

---

## Architecture

```
+----------------+   stdio    +--------------------+  WebSocket  +--------------------+
|   AI Agent     | <--------> |  leaflet-mcp-      | <---------> |  leaflet-mcp-      |
|   (Claude,     |    MCP     |  runtime           |   JSON-RPC  |  bridge            |
|    Cursor...)  |            |  (Node.js)         |    2.0      |  (Browser)         |
+----------------+            +--------------------+             +--------------------+
                                                                         |
                                                                  +------v------+
                                                                  |   Leaflet   |
                                                                  |     Map     |
                                                                  +-------------+
```

## Packages

| Package | Description |
|---------|-------------|
| [leaflet-mcp-runtime](packages/leaflet-mcp-runtime/) | MCP Server (stdio) — tools across 5 toolsets, WebSocket bridge to browser |
| [leaflet-mcp-bridge](packages/leaflet-mcp-bridge/) | Browser SDK — receives commands via WebSocket and controls Leaflet map |

## Quick Start

### 1. Install & Build

```bash
git clone https://github.com/gaopengbin/leaflet-mcp.git
cd leaflet-mcp
npm install
npm run build
```

### 2. Start the MCP Runtime

```bash
npx leaflet-mcp-runtime
# => HTTP + WebSocket server on http://localhost:9400
# => MCP Server running (stdio), tools registered
```

### 3. Connect Browser

Open `examples/minimal/index.html` in a browser. The bridge auto-connects to `ws://localhost:9400`.

Or integrate the bridge in your own app:

```typescript
import L from 'leaflet'
import { LeafletBridge } from 'leaflet-mcp-bridge'

const map = L.map('map').setView([20, 0], 3)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map)

const bridge = new LeafletBridge(map)
bridge.connect('ws://localhost:9400')
```

## Toolsets

| Toolset | Tools | Default |
|---------|-------|---------|
| view | flyTo, setView, getView, fitBounds, zoomIn, zoomOut | Yes |
| layer | addTileLayer, removeLayer, listLayers, setLayerOpacity | Yes |
| marker | addMarker, removeMarker, listMarkers | Yes |
| geojson | addGeoJSON | Yes |
| popup | openPopup, closePopup | Yes |

## Coordinate Convention

The MCP API uses `{ longitude, latitude }` (longitude first) for cross-project consistency
with [cesium-mcp](https://github.com/gaopengbin/cesium-mcp), [mapbox-mcp](https://github.com/gaopengbin/mapbox-mcp),
and [openlayers-mcp](https://github.com/gaopengbin/openlayers-mcp). The bridge converts to
Leaflet's native `[lat, lng]` order internally.

## MCP Client Configuration

Claude Desktop / Cursor / etc. — add to your MCP config:

```json
{
  "mcpServers": {
    "leaflet": {
      "command": "npx",
      "args": ["-y", "leaflet-mcp-runtime"]
    }
  }
}
```

## Related Projects

- [cesium-mcp](https://github.com/gaopengbin/cesium-mcp) — 3D globe (CesiumJS)
- [mapbox-mcp](https://github.com/gaopengbin/mapbox-mcp) — 2D/3D vector maps (Mapbox GL JS)
- [openlayers-mcp](https://github.com/gaopengbin/openlayers-mcp) — full-featured 2D maps (OpenLayers)

## License

MIT © gaopengbin
