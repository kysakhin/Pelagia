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
    }
}
