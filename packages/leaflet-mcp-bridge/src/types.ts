// GeoJSON types (avoid dependency on @types/geojson)
interface GeoJSONFeature {
  type: 'Feature'
  geometry: { type: string; coordinates: unknown }
  properties?: Record<string, unknown> | null
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

// ==================== Command Types ====================

export interface BridgeCommand {
  action: string
  params: Record<string, unknown>
}

export interface BridgeResult {
  success: boolean
  data?: unknown
  error?: string
}

// ==================== View ====================

export interface FlyToParams {
  longitude: number
  latitude: number
  zoom?: number
  duration?: number
}

export interface SetViewParams {
  longitude: number
  latitude: number
  zoom?: number
}

export interface ViewState {
  center: [number, number]    // [lon, lat]
  zoom: number
  bounds: [number, number, number, number]  // [west, south, east, north]
}

export interface FitBoundsParams {
  west: number
  south: number
  east: number
  north: number
  padding?: number
  maxZoom?: number
  animate?: boolean
}

// ==================== Layer ====================

export interface AddTileLayerParams {
  id?: string
  name?: string
  type?: 'osm' | 'xyz'
  url?: string
  attribution?: string
  opacity?: number
  maxZoom?: number
  subdomains?: string
}

export interface LayerInfo {
  id: string
  name: string
  type: string
  visible: boolean
  opacity: number
}

// ==================== Marker ====================

export interface AddMarkerParams {
  id?: string
  longitude: number
  latitude: number
  title?: string
  popup?: string
  iconUrl?: string
  iconSize?: [number, number]
  iconAnchor?: [number, number]
  draggable?: boolean
}

export interface MarkerInfo {
  id: string
  position: [number, number]   // [lon, lat]
  title: string
  popup: string | null
}

// ==================== GeoJSON ====================

export interface AddGeoJSONParams {
  id?: string
  name?: string
  data: GeoJSONFeatureCollection | GeoJSONFeature
  style?: {
    color?: string
    weight?: number
    opacity?: number
    fillColor?: string
    fillOpacity?: number
  }
  popupProperty?: string
}

// ==================== Popup ====================

export interface OpenPopupParams {
  longitude: number
  latitude: number
  html: string
  closeOnClick?: boolean
}
