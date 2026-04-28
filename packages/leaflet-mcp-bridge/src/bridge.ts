import L from 'leaflet'
import type {
  BridgeCommand,
  BridgeResult,
  FlyToParams,
  SetViewParams,
  ViewState,
  FitBoundsParams,
  AddTileLayerParams,
  LayerInfo,
  AddMarkerParams,
  MarkerInfo,
  AddGeoJSONParams,
  OpenPopupParams,
} from './types'

let _idCounter = 0
function genId(prefix = 'lf'): string {
  return `${prefix}_${++_idCounter}_${Date.now().toString(36)}`
}

/**
 * LeafletBridge -- AI Agent 操控 Leaflet 的统一执行层
 *
 * Coordinate convention: API uses { longitude, latitude } (lon-first) for
 * cross-project consistency with cesium-mcp / mapbox-mcp / openlayers-mcp.
 * Internally converts to Leaflet's [lat, lng] LatLng tuples.
 */
export class LeafletBridge {
  private _map: L.Map
  private _ws: WebSocket | null = null
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _layers = new Map<string, { layer: L.Layer; meta: { name: string; type: string } }>()
  private _markers = new Map<string, { marker: L.Marker; title: string }>()

  constructor(map: L.Map) {
    this._map = map
  }

  get map(): L.Map { return this._map }

  // ==================== WebSocket ====================

  connect(url = 'ws://localhost:9400'): void {
    if (this._ws?.readyState === WebSocket.OPEN) return
    const ws = new WebSocket(url)
    this._ws = ws

    ws.onopen = () => {
      console.log('[LeafletBridge] Connected to', url)
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer)
        this._reconnectTimer = null
      }
    }

    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { jsonrpc: string; id?: string; method?: string; params?: Record<string, unknown> }
        if (msg.method) {
          const result = await this.execute({ action: msg.method, params: msg.params ?? {} })
          if (msg.id) {
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }))
          }
        }
      } catch (err) {
        console.error('[LeafletBridge] message error:', err)
      }
    }

    ws.onclose = () => {
      console.log('[LeafletBridge] Disconnected, retry in 3s...')
      this._reconnectTimer = setTimeout(() => this.connect(url), 3000)
    }

    ws.onerror = (err) => {
      console.error('[LeafletBridge] WS error:', err)
      ws.close()
    }
  }

  disconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    this._ws?.close()
    this._ws = null
  }

  // ==================== Command Dispatch ====================

  async execute(cmd: BridgeCommand): Promise<BridgeResult> {
    try {
      const data = await this._dispatch(cmd.action, cmd.params)
      return { success: true, data }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  private async _dispatch(action: string, params: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      // View
      case 'flyTo': return this.flyTo(params as unknown as FlyToParams)
      case 'setView': return this.setView(params as unknown as SetViewParams)
      case 'getView': return this.getView()
      case 'fitBounds': return this.fitBounds(params as unknown as FitBoundsParams)
      case 'zoomIn': return this.zoomIn()
      case 'zoomOut': return this.zoomOut()

      // Layer
      case 'addTileLayer': return this.addTileLayer(params as unknown as AddTileLayerParams)
      case 'removeLayer': return this.removeLayer(params as { id: string })
      case 'listLayers': return this.listLayers()
      case 'setLayerOpacity': return this.setLayerOpacity(params as { id: string; opacity: number })

      // Marker
      case 'addMarker': return this.addMarker(params as unknown as AddMarkerParams)
      case 'removeMarker': return this.removeMarker(params as { id: string })
      case 'listMarkers': return this.listMarkers()

      // GeoJSON
      case 'addGeoJSON': return this.addGeoJSON(params as unknown as AddGeoJSONParams)

      // Popup
      case 'openPopup': return this.openPopup(params as unknown as OpenPopupParams)
      case 'closePopup': return this.closePopup()

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  }

  // ==================== View Methods ====================

  flyTo(p: FlyToParams): ViewState {
    this._map.flyTo(
      [p.latitude, p.longitude],
      p.zoom ?? this._map.getZoom(),
      { duration: (p.duration ?? 2000) / 1000 },
    )
    return this.getView()
  }

  setView(p: SetViewParams): ViewState {
    this._map.setView([p.latitude, p.longitude], p.zoom ?? this._map.getZoom())
    return this.getView()
  }

  getView(): ViewState {
    const c = this._map.getCenter()
    const b = this._map.getBounds()
    return {
      center: [c.lng, c.lat],
      zoom: this._map.getZoom(),
      bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
    }
  }

  fitBounds(p: FitBoundsParams): ViewState {
    const bounds = L.latLngBounds([p.south, p.west], [p.north, p.east])
    this._map.fitBounds(bounds, {
      padding: p.padding != null ? [p.padding, p.padding] : undefined,
      maxZoom: p.maxZoom,
      animate: p.animate ?? true,
    })
    return this.getView()
  }

  zoomIn(): ViewState {
    this._map.zoomIn(1)
    return this.getView()
  }

  zoomOut(): ViewState {
    this._map.zoomOut(1)
    return this.getView()
  }

  // ==================== Layer Methods ====================

  addTileLayer(p: AddTileLayerParams): { layerId: string } {
    const id = p.id ?? genId('tile')
    const type = p.type ?? 'osm'
    let url: string
    let attribution: string | undefined = p.attribution

    if (type === 'osm' || !p.url) {
      url = p.url ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
      attribution = attribution ?? '&copy; OpenStreetMap contributors'
    } else {
      url = p.url
    }

    const layer = L.tileLayer(url, {
      attribution,
      opacity: p.opacity ?? 1,
      maxZoom: p.maxZoom ?? 19,
      subdomains: p.subdomains ?? 'abc',
    })
    layer.addTo(this._map)
    this._layers.set(id, { layer, meta: { name: p.name ?? id, type: 'tile' } })
    return { layerId: id }
  }

  removeLayer(p: { id: string }): boolean {
    const entry = this._layers.get(p.id)
    if (!entry) return false
    this._map.removeLayer(entry.layer)
    this._layers.delete(p.id)
    return true
  }

  listLayers(): LayerInfo[] {
    return Array.from(this._layers.entries()).map(([id, { layer, meta }]) => {
      const opacity = (layer as L.TileLayer).options?.opacity ?? 1
      return {
        id,
        name: meta.name,
        type: meta.type,
        visible: this._map.hasLayer(layer),
        opacity,
      }
    })
  }

  setLayerOpacity(p: { id: string; opacity: number }): boolean {
    const entry = this._layers.get(p.id)
    if (!entry) return false
    const layer = entry.layer as L.TileLayer
    if (typeof layer.setOpacity === 'function') {
      layer.setOpacity(p.opacity)
      return true
    }
    return false
  }

  // ==================== Marker Methods ====================

  addMarker(p: AddMarkerParams): { markerId: string } {
    const id = p.id ?? genId('marker')
    let icon: L.Icon | undefined
    if (p.iconUrl) {
      icon = L.icon({
        iconUrl: p.iconUrl,
        iconSize: p.iconSize ?? [25, 41],
        iconAnchor: p.iconAnchor ?? [12, 41],
      })
    }
    const marker = L.marker([p.latitude, p.longitude], {
      title: p.title,
      icon,
      draggable: p.draggable ?? false,
    })
    if (p.popup) marker.bindPopup(p.popup)
    marker.addTo(this._map)
    this._markers.set(id, { marker, title: p.title ?? '' })
    return { markerId: id }
  }

  removeMarker(p: { id: string }): boolean {
    const entry = this._markers.get(p.id)
    if (!entry) return false
    this._map.removeLayer(entry.marker)
    this._markers.delete(p.id)
    return true
  }

  listMarkers(): MarkerInfo[] {
    return Array.from(this._markers.entries()).map(([id, { marker, title }]) => {
      const ll = marker.getLatLng()
      const popupContent = marker.getPopup()?.getContent()
      return {
        id,
        position: [ll.lng, ll.lat],
        title,
        popup: typeof popupContent === 'string' ? popupContent : null,
      }
    })
  }

  // ==================== GeoJSON Methods ====================

  addGeoJSON(p: AddGeoJSONParams): { layerId: string; featureCount: number } {
    const id = p.id ?? genId('geojson')
    const layer = L.geoJSON(p.data as GeoJSON.GeoJsonObject, {
      style: p.style
        ? () => ({
            color: p.style!.color ?? '#3B82F6',
            weight: p.style!.weight ?? 2,
            opacity: p.style!.opacity ?? 1,
            fillColor: p.style!.fillColor ?? p.style!.color ?? '#3B82F6',
            fillOpacity: p.style!.fillOpacity ?? 0.4,
          })
        : undefined,
      onEachFeature: p.popupProperty
        ? (feature, lyr) => {
            const v = feature.properties?.[p.popupProperty!]
            if (v != null) lyr.bindPopup(String(v))
          }
        : undefined,
    })
    layer.addTo(this._map)
    this._layers.set(id, { layer, meta: { name: p.name ?? id, type: 'geojson' } })
    let count = 0
    layer.eachLayer(() => { count++ })
    return { layerId: id, featureCount: count }
  }

  // ==================== Popup Methods ====================

  openPopup(p: OpenPopupParams): { ok: true } {
    L.popup({ closeOnClick: p.closeOnClick ?? true })
      .setLatLng([p.latitude, p.longitude])
      .setContent(p.html)
      .openOn(this._map)
    return { ok: true }
  }

  closePopup(): { ok: true } {
    this._map.closePopup()
    return { ok: true }
  }
}
