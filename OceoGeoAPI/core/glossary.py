# Physical definitions and typical ranges for standard Oceanographic variables. 
# Injected into the prompt so the LLM has grounded facts and does not hallucinate ranges.

GLOSSARY = {
    "temperature": {
        "unit": "°C",
        "physical_meaning": "A measure of the thermal energy in the water column. It is the primary driver (alongside salinity) of seawater density and ocean stratification.",
        "typical_surface_range": "-2°C to 30°C",
        "typical_deep_range": "0°C to 5°C",
        "anomaly_note": "Temperatures consistently above 30°C or below -2°C (the freezing point of typical seawater) are highly anomalous or indicate sensor error. Temperature inversions (warming with depth) can occur if the deeper water is significantly more saline.",
        "references": ["Argo User Manual", "Talley et al., Descriptive Physical Oceanography"]
    },
    "salinity": {
        "unit": "PSU (Practical Salinity Unit)",
        "physical_meaning": "A measure of dissolved salts in seawater. It is determined by the balance of evaporation and precipitation at the surface, and by water mass mixing at depth.",
        "typical_open_ocean_range": "33 to 37 PSU",
        "anomaly_note": "Values above 37 PSU are typical only in highly evaporative marginal seas (like the Mediterranean or Red Sea). Values below 33 PSU occur near river plumes, in the Arctic/Antarctic due to ice melt, or in very heavy precipitation zones.",
        "references": ["TEOS-10 standard"]
    },
    "pressure": {
        "unit": "dbar (decibar)",
        "physical_meaning": "The hydrostatic pressure exerted by the overlying water column. In oceanography, 1 dbar is approximately equal to 1 meter of depth.",
        "typical_argo_range": "0 to 2000 dbar",
        "typical_deep_argo_range": "Up to 6000 dbar",
        "anomaly_note": "Negative pressures indicate a sensor calibration issue (often a drifting surface offset). Pressures significantly exceeding the float's rated depth indicate catastrophic failure or bad data.",
        "references": ["Argo Quality Control Manual"]
    },
    "sound velocity": {
        "unit": "m/s",
        "physical_meaning": "The speed at which sound waves travel through seawater. It is a function of temperature, salinity, and pressure. Small variations in sound velocity mathematically trace differences in these three core parameters.",
        "typical_range": "1450 to 1550 m/s",
        "anomaly_note": "A distinct minimum in sound velocity (often around 1000m depth) forms the SOFAR (Sound Fixing and Ranging) channel, a waveguide where sound can travel thousands of kilometers.",
        "references": ["Chen-Millero equation", "Del Grosso equation"]
    },
    "mixed layer depth": {
        "unit": "meters",
        "physical_meaning": "The depth of the surface layer of the ocean that has been mixed by wind, waves, and surface heat fluxes, resulting in nearly uniform density.",
        "typical_range": "10 to 200 meters (highly seasonal)",
        "anomaly_note": "Deep mixed layers (>500m) occur in winter in specific high-latitude regions (e.g., Labrador Sea, Weddell Sea) due to intense cooling and convection.",
        "references": ["de Boyer Montégut et al., 2004"]
    },
    "doxy": {
        "unit": "µmol/kg or µmol/L",
        "physical_meaning": "Dissolved oxygen concentration. It reflects air-sea exchange, photosynthesis, respiration, ventilation, and water-mass age.",
        "typical_surface_range": "180 to 350 µmol/kg",
        "typical_deep_range": "20 to 250 µmol/kg depending on basin and oxygen-minimum zones",
        "anomaly_note": "Near-zero values may indicate oxygen-minimum zones or sensor/processing issues; supersaturated surface values can occur during blooms or strong cooling.",
        "references": ["BGC-Argo User Manual", "Argo Quality Control Manual"]
    },
    "chla": {
        "unit": "mg/m³",
        "physical_meaning": "Chlorophyll-a concentration, a proxy for phytoplankton biomass and biological productivity.",
        "typical_surface_range": "0.01 to 10 mg/m³",
        "typical_deep_range": "Usually near zero except at deep chlorophyll maxima",
        "anomaly_note": "Very high spikes can be real bloom signals, non-photochemical quenching effects, fluorescence calibration issues, or particle contamination.",
        "references": ["BGC-Argo User Manual"]
    },
    "bbp": {
        "unit": "m⁻¹",
        "physical_meaning": "Particle backscattering coefficient, a proxy for suspended particles and particulate organic carbon.",
        "typical_open_ocean_range": "~0.0001 to 0.01 m⁻¹",
        "anomaly_note": "Sharp spikes may indicate particles, bubbles, biofouling, or sensor artifacts and should be interpreted with QC flags.",
        "references": ["BGC-Argo User Manual"]
    },
    "nitrate": {
        "unit": "µmol/kg",
        "physical_meaning": "Nitrate concentration, a major nutrient that supports phytoplankton growth and traces remineralization and water-mass processes.",
        "typical_surface_range": "Near 0 to 30 µmol/kg depending on region and season",
        "typical_deep_range": "10 to 45 µmol/kg",
        "anomaly_note": "Negative values are generally non-physical and suggest calibration or processing problems.",
        "references": ["BGC-Argo User Manual"]
    },
    "ph": {
        "unit": "total scale pH",
        "physical_meaning": "A measure of seawater acidity linked to the marine carbonate system and ocean acidification.",
        "typical_open_ocean_range": "~7.6 to 8.3",
        "anomaly_note": "Values outside typical ocean ranges may indicate sensor drift, calibration issues, or extreme biogeochemical conditions.",
        "references": ["BGC-Argo User Manual", "TEOS-10 standard"]
    }
}
