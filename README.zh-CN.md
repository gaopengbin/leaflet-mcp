<div align="center">

  <h1>Leaflet MCP</h1>

  <p><strong>通过 Model Context Protocol 用 AI 控制 Leaflet 地图</strong></p>

  <p>把任何兼容 MCP 的 AI Agent 接到 <a href="https://leafletjs.com/">Leaflet</a>——视图、瓦片图层、标记、GeoJSON、弹窗，全部用自然语言完成。</p>

  <p>
    <a href="https://www.npmjs.com/package/leaflet-mcp-runtime"><img src="https://img.shields.io/npm/v/leaflet-mcp-runtime.svg" alt="npm version"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
    <a href="https://github.com/gaopengbin/leaflet-mcp"><img src="https://img.shields.io/github/stars/gaopengbin/leaflet-mcp?style=flat" alt="GitHub stars"></a>
  </p>

  <p>
    <a href="README.md">English</a>
  </p>
</div>

---

## 架构

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

## 包结构

| 包 | 说明 |
|----|------|
| [leaflet-mcp-runtime](packages/leaflet-mcp-runtime/) | MCP 服务（stdio）—— 5 个工具集，桥接浏览器 |
| [leaflet-mcp-bridge](packages/leaflet-mcp-bridge/) | 浏览器 SDK —— 通过 WebSocket 接收命令并操作 Leaflet 地图 |

## 快速开始

### 1. 安装并构建

```bash
git clone https://github.com/gaopengbin/leaflet-mcp.git
cd leaflet-mcp
npm install
npm run build
```

### 2. 启动 MCP 运行时

```bash
npx leaflet-mcp-runtime
# => HTTP + WebSocket 服务监听 http://localhost:9400
# => MCP Server (stdio) 启动，工具已注册
```

### 3. 连接浏览器

直接打开 `examples/minimal/index.html`，bridge 自动连接 `ws://localhost:9400`。

或在自己的应用中集成：

```typescript
import L from 'leaflet'
import { LeafletBridge } from 'leaflet-mcp-bridge'

const map = L.map('map').setView([20, 0], 3)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map)

const bridge = new LeafletBridge(map)
bridge.connect('ws://localhost:9400')
```

## 工具集

| 工具集 | 工具 | 默认启用 |
|--------|------|----------|
| view | flyTo, setView, getView, fitBounds, zoomIn, zoomOut | 是 |
| layer | addTileLayer, removeLayer, listLayers, setLayerOpacity | 是 |
| marker | addMarker, removeMarker, listMarkers | 是 |
| geojson | addGeoJSON | 是 |
| popup | openPopup, closePopup | 是 |

## 坐标约定

MCP API 统一使用 `{ longitude, latitude }`（经度在前），与 [cesium-mcp](https://github.com/gaopengbin/cesium-mcp)、
[mapbox-mcp](https://github.com/gaopengbin/mapbox-mcp)、[openlayers-mcp](https://github.com/gaopengbin/openlayers-mcp)
保持一致。Bridge 内部会自动转成 Leaflet 原生的 `[lat, lng]` 顺序。

## MCP 客户端配置

Claude Desktop / Cursor 等客户端，在 MCP 配置中添加：

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

## 相关项目

- [cesium-mcp](https://github.com/gaopengbin/cesium-mcp) —— 3D 地球（CesiumJS）
- [mapbox-mcp](https://github.com/gaopengbin/mapbox-mcp) —— 2D/3D 矢量地图（Mapbox GL JS）
- [openlayers-mcp](https://github.com/gaopengbin/openlayers-mcp) —— 功能全面的 2D 地图（OpenLayers）

## 许可证

MIT © gaopengbin
