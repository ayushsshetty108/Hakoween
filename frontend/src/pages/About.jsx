import { ArrowDown, Braces, CloudRain, Database, MapPin, Waves } from 'lucide-react'
import { PageHeader, Panel, StatusChip } from '../components.jsx'

export default function About() {
  return <>
    <PageHeader eyebrow="FLOODCAST PLATFORM" title="River intelligence, with provenance" subtitle="A hydrological decision-support prototype connecting observed streamflow, basin context, and station-held-out machine learning." actions={<StatusChip tone="blue">RESEARCH PROTOTYPE</StatusChip>}/>
    <div className="about-intro">
      <div><span className="eyebrow">THE CHALLENGE</span><h2>Understand how rivers respond to a changing watershed.</h2><p>FLOODCAST brings together daily streamflow and environmental predictors to estimate discharge at held-out gauges. Its web workspace keeps historical measurements, model outputs, and live readings separate so users can understand what each value means.</p></div>
      <div className="about-callout"><Waves size={21}/><b>Predictions are not flood warnings.</b><span>Operational alerting requires verified local thresholds, validation, and an authoritative alert feed.</span></div>
    </div>
    <Panel title="Data-to-insight architecture" subtitle="Inputs and outputs retain their source and temporal context">
      <div className="architecture-flow">
        <Arch icon={MapPin} title="Source data" detail="USGS · Open-Meteo · StreamStats"/>
        <ArrowDown className="architecture-arrow"/>
        <Arch icon={Database} title="Feature pipeline" detail="Observed flow, weather, catchment"/>
        <ArrowDown className="architecture-arrow"/>
        <Arch icon={Braces} title="Discharge model" detail="HGB + CatBoost + LightGBM blend"/>
        <ArrowDown className="architecture-arrow"/>
        <Arch icon={Waves} title="Workspace output" detail="Prediction CSV · analytics · validation"/>
      </div>
    </Panel>
    <div className="workspace-two-col">
      <Panel title="Data sources" subtitle="Source descriptions and known limitations">
        <div className="about-source-list">
          <Source title="USGS Water Data" detail="Station metadata and historical daily mean discharge; live continuous readings are requested through the public feed in development or the configured backend."/>
          <Source title="Open-Meteo" detail="Weather model history and coordinate-based weather estimates. A weather-model value is not a direct basin-wide observation."/>
          <Source title="USGS StreamStats" detail="Catchment attributes when returned and validated. Incomplete or unverified delineations remain unavailable."/>
        </div>
      </Panel>
      <Panel title="Model validation" subtitle="Station-held-out evaluation">
        <div className="about-source-list">
          <Source title="Grouped out-of-fold predictions" detail="The project holds out stations during validation to assess transfer to unseen gauges; reported scores are not training-set fit metrics."/>
          <Source title="Scoring metrics" detail="Overall RMSE 40%, extreme-event RMSE 30%, MAE 20%, and R² 10%. Official leaderboard normalization ranges are not included in local reports."/>
          <Source title="Model family" detail="A fixed blend of histogram gradient boosting, CatBoost, and LightGBM; raw discharge is the selected prediction target."/>
        </div>
      </Panel>
    </div>
    <Panel title="Limitations" subtitle="Read before interpreting values">
      <ul className="about-limitations">
        <li>Predicted discharge is a model estimate and does not constitute an official flood forecast or warning.</li>
        <li>Historical daily means are not real-time observations; live continuous feeds may be delayed or unavailable.</li>
        <li>Generalization to arbitrary basins is not established by the available station-held-out experiments.</li>
        <li>Model uncertainty, confidence intervals, and explainability are displayed only if a connected backend provides them.</li>
        <li>Development dataset endpoints are read-only and local to the Vite server; production requires authenticated or otherwise controlled data APIs.</li>
      </ul>
    </Panel>
  </>
}

function Arch({ icon: Icon, title, detail }) {
  return <div className="architecture-node"><span><Icon size={19}/></span><b>{title}</b><small>{detail}</small></div>
}
function Source({ title, detail }) { return <div className="about-source"><CloudRain size={15}/><div><b>{title}</b><p>{detail}</p></div></div> }
