import { Activity, AlertTriangle, BrainCircuit, CloudSun, Compass, Database, Info, LayoutDashboard, Map, Table2, Waves } from 'lucide-react'

export const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/live-map', label: 'Live map', icon: Map },
  { to: '/stations', label: 'Stations', icon: Activity },
  { to: '/predictions', label: 'Predictions', icon: Waves },
  { to: '/analytics', label: 'Analytics', icon: Compass },
  { to: '/flood-alerts', label: 'Flood alerts', icon: AlertTriangle },
  { to: '/model-performance', label: 'Model performance', icon: BrainCircuit },
  { to: '/data-explorer', label: 'Data explorer', icon: Table2 },
  { to: '/about', label: 'About FLOODCAST', icon: Info },
  { to: '/weather', label: 'Weather intelligence', icon: CloudSun },
  { to: '/catchment', label: 'Catchment analytics', icon: Database },
]
