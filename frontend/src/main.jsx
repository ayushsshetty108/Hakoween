import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import App from './App.jsx'
import { LiveStationsProvider } from './hooks/LiveStationsContext.jsx'
import { WorkspaceStateProvider } from './hooks/WorkspaceState.jsx'

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })

createRoot(document.getElementById('root')).render(<React.StrictMode><QueryClientProvider client={queryClient}><WorkspaceStateProvider><LiveStationsProvider><BrowserRouter><App /></BrowserRouter></LiveStationsProvider></WorkspaceStateProvider></QueryClientProvider></React.StrictMode>)
