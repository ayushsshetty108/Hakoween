import { ArrowUpRight, CloudSun, Compass, MapPinned } from 'lucide-react'
import { Link } from 'react-router-dom'

const stories = [
  { title: 'Rivers in motion', eyebrow: 'STATION MONITORING', description: 'Explore the four USGS gauges and their latest available daily means.', image: '/images/river-floodplain.jpg', alt: 'A broad river bends through a green floodplain', to: '/monitoring', icon: MapPinned },
  { title: 'Reservoir systems', eyebrow: 'CATCHMENT ANALYTICS', description: 'Compare drainage area, terrain, land cover, and precipitation.', image: '/images/reservoir-dam.jpg', alt: 'A reservoir and dam set into a dry watershed', to: '/catchment', icon: Compass },
  { title: 'Weather over water', eyebrow: 'WEATHER INTELLIGENCE', description: 'Read precipitation and temperature alongside observed flow.', image: '/images/reservoir-morning.jpg', alt: 'Morning light over a forested reservoir', to: '/weather', icon: CloudSun },
]

export default function LandscapeSection() {
  return <section className="landscape-section">
    <div className="section-intro"><div><span className="section-kicker">A CLOSER LOOK</span><h2>Water is shaped by its whole landscape.</h2><p>Move from the gauge to the basin, terrain, and weather around it.</p></div><span className="imagery-note">Illustrative landscape imagery</span></div>
    <div className="landscape-grid">{stories.map(({title,eyebrow,description,image,alt,to,icon:Icon})=><Link className="landscape-card" to={to} key={title}>
      <div className="landscape-image"><img src={image} alt={alt} loading="lazy"/><span className="landscape-kicker"><Icon size={13}/>{eyebrow}</span><span className="image-arrow"><ArrowUpRight size={17}/></span></div>
      <div className="landscape-copy"><h3>{title}</h3><p>{description}</p></div>
    </Link>)}</div>
  </section>
}
