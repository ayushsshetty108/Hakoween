import { Activity, BrainCircuit, CloudSun, Compass, LayoutDashboard, Waves } from 'lucide-react'

export const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/monitoring', label: 'Station monitoring', icon: Activity },
  { to: '/predictions', label: 'Discharge predictions', icon: Waves },
  { to: '/weather', label: 'Weather intelligence', icon: CloudSun },
  { to: '/catchment', label: 'Catchment analytics', icon: Compass },
  { to: '/performance', label: 'Model performance', icon: BrainCircuit },
]
