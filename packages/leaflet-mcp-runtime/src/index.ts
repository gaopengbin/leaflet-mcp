/**
 * leaflet-mcp-runtime — MCP Server for Leaflet
 *
 * 架构：
 *   AI Agent <-> MCP Server (stdio) <-> WebSocket <-> Browser (leaflet-mcp-bridge)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

// ==================== WebSocket Bridge ====================

const WS_PORT = parseInt(process.env.LEAFLET_MCP_PORT ?? '9400')

const browserClients = new Map<string, WebSocket>()
const pendingRequests = new Map<string, {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}>()

let requestIdCounter = 0
const DEFAULT_SESSION_ID = process.env.DEFAULT_SESSION_ID ?? 'default'

function getDefaultBrowser(): WebSocket | null {
  if (browserClients.size === 0) return null
  const preferred = browserClients.get(DEFAULT_SESSION_ID)
  if (preferred && preferred.readyState === WebSocket.OPEN) return preferred
  return browserClients.values().next().value ?? null
}

function sendToBrowser(action: string, params: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = getDefaultBrowser()
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('No browser connected. Open your Leaflet app with the bridge loaded.'))
      return
    }
    const reqId = `req_${++requestIdCounter}`
    const timer = setTimeout(() => {
      pendingRequests.delete(reqId)
      reject(new Error(`Browser response timeout (${timeoutMs}ms)`))
    }, timeoutMs)
    pendingRequests.set(reqId, { resolve, reject, timer })
    ws.send(JSON.stringify({ jsonrpc: '2.0', id: reqId, method: action, params }))
  })
}

// ==================== HTTP + WebSocket Server ====================

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', clients: browserClients.size }))
    return
  }

  if (req.method === 'POST' && req.url === '/api/command') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const { action, params } = JSON.parse(body)
        const result = await sendToBrowser(action, params ?? {})
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, result }))
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: false, error: (err as Error).message }))
      }
    })
    return
  }

  res.writeHead(404)
  res.end('Not found')
})

const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const sessionId = url.searchParams.get('sessionId') ?? DEFAULT_SESSION_ID
  browserClients.set(sessionId, ws)
  process.stderr.write(`[leaflet-mcp] Browser connected (session: ${sessionId})\n`)

  ws.on('message', (raw: RawData) => {
    try {
      const msg = JSON.parse(raw.toString()) as { id?: string; result?: unknown; error?: { message: string } }
      if (msg.id && pendingRequests.has(msg.id)) {
        const pending = pendingRequests.get(msg.id)!
        pendingRequests.delete(msg.id)
        clearTimeout(pending.timer)
        if (msg.error) {
          pending.reject(new Error(msg.error.message))
        } else {
          pending.resolve(msg.result)
        }
      }
    } catch { /* ignore parse errors */ }
  })

  ws.on('close', () => {
    browserClients.delete(sessionId)
    process.stderr.write(`[leaflet-mcp] Browser disconnected (session: ${sessionId})\n`)
  })
})

httpServer.listen(WS_PORT, () => {
  process.stderr.write(`[leaflet-mcp] HTTP + WebSocket server on http://localhost:${WS_PORT}\n`)
})

// ==================== MCP Server ====================

const server = new McpServer({
  name: 'leaflet-mcp',
  version: '0.1.0',
}, {
  capabilities: { tools: {} },
})

// ==================== Toolsets ====================

const TOOLSETS: Record<string, string[]> = {
  view: ['flyTo', 'setView', 'getView', 'fitBounds', 'zoomIn', 'zoomOut'],
  layer: ['addTileLayer', 'removeLayer', 'listLayers', 'setLayerOpacity'],
  marker: ['addMarker', 'removeMarker', 'listMarkers'],
  geojson: ['addGeoJSON'],
  popup: ['openPopup', 'closePopup'],
}

const TOOLSET_DESCRIPTIONS: Record<string, string> = {
  view: 'Camera/view controls (flyTo, setView, getView, fitBounds, zoom)',
  layer: 'Tile layer management (OSM, XYZ tiles)',
  marker: 'Marker CRUD (add/remove/list with optional popups)',
  geojson: 'GeoJSON overlay (lines, polygons, point collections)',
  popup: 'Standalone popup (open/close at coordinates)',
}

const DEFAULT_TOOLSETS = ['view', 'layer', 'marker', 'geojson', 'popup']

const _tsEnv = process.env.LEAFLET_TOOLSETS?.trim()
const _allMode = _tsEnv === 'all'
const _enabledSets = new Set<string>(
  _allMode ? Object.keys(TOOLSETS)
    : _tsEnv ? _tsEnv.split(',').map(s => s.trim()).filter(s => s in TOOLSETS)
    : DEFAULT_TOOLSETS,
)

const _enabledTools = new Set<string>()
for (const setName of _enabledSets) {
  for (const tool of TOOLSETS[setName]!) _enabledTools.add(tool)
}

const _toolDefs = new Map<string, unknown[]>()

const _registerTool = ((...args: unknown[]) => {
  const name = args[0] as string
  _toolDefs.set(name, args)
  if (_enabledTools.has(name)) {
    ;(server.tool as Function).apply(server, args)
  }
}) as typeof server.tool

function _enableToolset(setName: string): string[] {
  const tools = TOOLSETS[setName]
  if (!tools) return []
  const added: string[] = []
  for (const toolName of tools) {
    if (!_enabledTools.has(toolName)) {
      _enabledTools.add(toolName)
      const def = _toolDefs.get(toolName)
      if (def) {
        ;(server.tool as Function).apply(server, def)
        added.push(toolName)
      }
    }
  }
  _enabledSets.add(setName)
  return added
}

// ==================== Meta Tools ====================

server.tool(
  'list_toolsets',
  'List all available toolsets and their status',
  {},
  async () => {
    const list = Object.entries(TOOLSETS).map(([name, tools]) => ({
      name,
      description: TOOLSET_DESCRIPTIONS[name] ?? '',
      enabled: _enabledSets.has(name),
      toolCount: tools.length,
      tools,
    }))
    return { content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }] }
  },
)

server.tool(
  'enable_toolset',
  'Enable a toolset to register its tools',
  { name: z.string().describe('Toolset name') },
  async ({ name }) => {
    if (!(name in TOOLSETS)) {
      return { content: [{ type: 'text' as const, text: `Unknown toolset: ${name}. Available: ${Object.keys(TOOLSETS).join(', ')}` }] }
    }
    if (_enabledSets.has(name)) {
      return { content: [{ type: 'text' as const, text: `Toolset "${name}" is already enabled.` }] }
    }
    const added = _enableToolset(name)
    return { content: [{ type: 'text' as const, text: `Enabled toolset "${name}". Registered ${added.length} tools: ${added.join(', ')}` }] }
  },
)

// ==================== View Tools ====================

_registerTool(
  'flyTo',
  'Fly to a location with animation',
  {
    longitude: z.number().describe('Longitude (-180 to 180)'),
    latitude: z.number().describe('Latitude (-90 to 90)'),
    zoom: z.number().optional().describe('Zoom level (Leaflet typical 0-19)'),
    duration: z.number().optional().describe('Animation duration in ms (default 2000)'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('flyTo', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'setView',
  'Set view instantly (no animation)',
  {
    longitude: z.number().describe('Longitude'),
    latitude: z.number().describe('Latitude'),
    zoom: z.number().optional().describe('Zoom level'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('setView', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'getView',
  'Get current view state (center, zoom, bounds)',
  {},
  async () => {
    const result = await sendToBrowser('getView', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'fitBounds',
  'Fit view to a geographic bounding box',
  {
    west: z.number().describe('West longitude'),
    south: z.number().describe('South latitude'),
    east: z.number().describe('East longitude'),
    north: z.number().describe('North latitude'),
    padding: z.number().optional().describe('Pixel padding around bounds'),
    maxZoom: z.number().optional().describe('Maximum zoom level after fit'),
    animate: z.boolean().optional().describe('Animate the fit (default true)'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('fitBounds', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'zoomIn',
  'Zoom in one level',
  {},
  async () => {
    const result = await sendToBrowser('zoomIn', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'zoomOut',
  'Zoom out one level',
  {},
  async () => {
    const result = await sendToBrowser('zoomOut', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Layer Tools ====================

_registerTool(
  'addTileLayer',
  'Add a tile layer (OSM by default, or custom XYZ URL)',
  {
    type: z.enum(['osm', 'xyz']).optional().describe('Tile source type (default osm)'),
    url: z.string().optional().describe('Tile URL template like "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"'),
    attribution: z.string().optional().describe('Attribution text'),
    name: z.string().optional().describe('Display name'),
    id: z.string().optional().describe('Layer ID'),
    opacity: z.number().optional().describe('Opacity (0-1)'),
    maxZoom: z.number().optional().describe('Max zoom (default 19)'),
    subdomains: z.string().optional().describe('Subdomain string for {s} placeholder, default "abc"'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('addTileLayer', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'removeLayer',
  'Remove a layer by ID',
  { id: z.string().describe('Layer ID') },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('removeLayer', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'listLayers',
  'List all layers added through the bridge',
  {},
  async () => {
    const result = await sendToBrowser('listLayers', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'setLayerOpacity',
  'Set tile layer opacity',
  {
    id: z.string().describe('Layer ID'),
    opacity: z.number().describe('Opacity (0-1)'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('setLayerOpacity', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Marker Tools ====================

_registerTool(
  'addMarker',
  'Add a marker at the given coordinates with optional popup',
  {
    longitude: z.number().describe('Longitude'),
    latitude: z.number().describe('Latitude'),
    title: z.string().optional().describe('Hover tooltip text'),
    popup: z.string().optional().describe('Popup HTML content (shown on click)'),
    iconUrl: z.string().optional().describe('Custom icon image URL'),
    id: z.string().optional().describe('Marker ID'),
    draggable: z.boolean().optional().describe('Allow user dragging'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('addMarker', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'removeMarker',
  'Remove a marker by ID',
  { id: z.string().describe('Marker ID') },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('removeMarker', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'listMarkers',
  'List all markers added through the bridge',
  {},
  async () => {
    const result = await sendToBrowser('listMarkers', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== GeoJSON Tools ====================

_registerTool(
  'addGeoJSON',
  'Add GeoJSON data as a styled layer',
  {
    data: z.any().describe('GeoJSON FeatureCollection or Feature'),
    name: z.string().optional().describe('Layer name'),
    id: z.string().optional().describe('Layer ID'),
    style: z.object({
      color: z.string().optional(),
      weight: z.number().optional(),
      opacity: z.number().optional(),
      fillColor: z.string().optional(),
      fillOpacity: z.number().optional(),
    }).optional().describe('Path style'),
    popupProperty: z.string().optional().describe('Feature property name to use as popup content'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('addGeoJSON', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Popup Tools ====================

_registerTool(
  'openPopup',
  'Open a standalone popup at coordinates (no marker required)',
  {
    longitude: z.number().describe('Longitude'),
    latitude: z.number().describe('Latitude'),
    html: z.string().describe('Popup HTML content'),
    closeOnClick: z.boolean().optional().describe('Close on map click (default true)'),
  },
  async (params: Record<string, unknown>) => {
    const result = await sendToBrowser('openPopup', params)
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

_registerTool(
  'closePopup',
  'Close the currently open popup (if any)',
  {},
  async () => {
    const result = await sendToBrowser('closePopup', {})
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
  },
)

// ==================== Start ====================

const toolCount = _enabledTools.size
process.stderr.write(`[leaflet-mcp] MCP Server starting — ${toolCount} tools registered\n`)

const transport = new StdioServerTransport()
server.connect(transport)
