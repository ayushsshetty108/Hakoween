import { lazy, Suspense, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar, Topbar, Loading } from './components.jsx'
import { NAV } from './navigation.js'

const Overview = lazy(() => import('./pages/Overview.jsx'))
const Monitoring = lazy(() => import('./pages/Monitoring.jsx'))
const Stations = lazy(() => import('./pages/Stations.jsx'))
const Predictions = lazy(() => import('./pages/PredictionOutput.jsx'))
const Analytics = lazy(() => import('./pages/Analytics.jsx'))
const FloodAlerts = lazy(() => import('./pages/FloodAlerts.jsx'))
const Performance = lazy(() => import('./pages/ModelPerformance.jsx'))
const DataExplorer = lazy(() => import('./pages/DataExplorer.jsx'))
const About = lazy(() => import('./pages/About.jsx'))
const Weather = lazy(() => import('./pages/Weather.jsx'))
const Catchment = lazy(() => import('./pages/Catchment.jsx'))

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  return <div className="app-shell">
    <Sidebar mobileOpen={mobileOpen} close={() => setMobileOpen(false)} />
    {mobileOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
    <main className="main-area"><Topbar onMenu={() => setMobileOpen(true)} />
      <div className="page-wrap"><AnimatePresence mode="wait"><motion.div key={location.pathname} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .18 }}>
        <Suspense fallback={<Loading/>}><Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace/>}/>
          <Route path="/dashboard" element={<Overview/>}/>
          <Route path="/live-map" element={<Monitoring/>}/>
          <Route path="/stations" element={<Stations/>}/>
          <Route path="/stations/:stationId" element={<Stations/>}/>
          <Route path="/predictions" element={<Predictions/>}/>
          <Route path="/analytics" element={<Analytics/>}/>
          <Route path="/flood-alerts" element={<FloodAlerts/>}/>
          <Route path="/model-performance" element={<Performance/>}/>
          <Route path="/data-explorer" element={<DataExplorer/>}/>
          <Route path="/about" element={<About/>}/>
          <Route path="/weather" element={<Weather/>}/>
          <Route path="/catchment" element={<Catchment/>}/>
          <Route path="/monitoring" element={<Navigate to="/live-map" replace/>}/>
          <Route path="/performance" element={<Navigate to="/model-performance" replace/>}/>
          <Route path="*" element={<NotFound/>}/>
        </Routes></Suspense>
      </motion.div></AnimatePresence></div>
      <footer className="footer"><span>FLOODCAST <i>·</i> Environmental intelligence</span><span>Data is presented with its source and coverage limits</span></footer>
    </main>
  </div>
}

function NotFound() {
  return <section className="empty-page"><span className="eyebrow">404 · OFF COURSE</span><h1>That station isn’t on this map.</h1><p>The page you’re looking for may have moved.</p><Link className="button-primary" to="/dashboard">Return to dashboard</Link></section>
}
