import { lazy, Suspense, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar, Topbar, Loading } from './components.jsx'
import { NAV } from './navigation.js'

const Overview = lazy(() => import('./pages/Overview.jsx'))
const Monitoring = lazy(() => import('./pages/Monitoring.jsx'))
const Predictions = lazy(() => import('./pages/Predictions.jsx'))
const Weather = lazy(() => import('./pages/Weather.jsx'))
const Catchment = lazy(() => import('./pages/Catchment.jsx'))
const Performance = lazy(() => import('./pages/Performance.jsx'))

export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  return <div className="app-shell">
    <Sidebar mobileOpen={mobileOpen} close={() => setMobileOpen(false)} />
    {mobileOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
    <main className="main-area"><Topbar onMenu={() => setMobileOpen(true)} />
      <div className="page-wrap"><AnimatePresence mode="wait"><motion.div key={location.pathname} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .18 }}>
        <Suspense fallback={<Loading />}><Routes>
          <Route path="/" element={<Overview />} /><Route path="/monitoring" element={<Monitoring />} /><Route path="/predictions" element={<Predictions />} />
          <Route path="/weather" element={<Weather />} /><Route path="/catchment" element={<Catchment />} /><Route path="/performance" element={<Performance />} />
          <Route path="*" element={<NotFound />} />
        </Routes></Suspense>
      </motion.div></AnimatePresence></div>
      <footer className="footer"><span>FLOODCAST <i>·</i> Environmental intelligence</span><span>Data is presented with its source and coverage limits</span></footer>
    </main>
  </div>
}

function NotFound() { return <section className="empty-page"><span className="eyebrow">404 · OFF COURSE</span><h1>That station isn’t on this map.</h1><p>The page you’re looking for may have moved.</p><a className="button-primary" href="/">Return to overview</a></section> }
