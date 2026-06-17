import React from 'react';

export default function SignedOutContent() {
  return (
    <div className="w-full bg-[#F8F9FA] text-[#1A1F26]" style={{ fontFamily: 'Helvetica Neue, Helvetica, Arial, sans-serif' }}>
      {/* Hero Section */}
      <section className="relative min-h-[700px] h-[calc(100vh-64px)] flex items-center justify-center px-8"
        style={{
          background: 'radial-gradient(ellipse at 20% 50%, #2E6DA41A 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, #4A87BE14 0%, transparent 50%), radial-gradient(ellipse at 50% 80%, #5C7A9610 0%, transparent 60%), #F8F9FA'
        }}>
        <div className="max-w-[1440px] w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <div className="w-6 h-[1px] bg-[#4A87BE]" />
              <span className="text-[11px] uppercase tracking-[0.2em] text-[#2E6DA4]">Oceanographic Intelligence Platform</span>
            </div>
            <h1 className="text-6xl md:text-[96px] font-bold leading-none text-[#1A1F26] max-w-[700px]">
              Your Ocean Data.<br />Finally Understood.
            </h1>
            <p className="font-serif text-[18px] text-[#3D4A58] max-w-[520px] leading-[1.75]">
              Upload NetCDF files, visualize complex spatiotemporal datasets, query your data through natural language, and run rigorous statistical analyses. All in one platform built for the demands of modern oceanographic research.
            </p>
            <div className="flex items-center gap-6 mt-4">
              <button className="bg-linear-to-br from-[#2E6DA4] to-[#5C7A96] text-white font-bold px-10 py-4 rounded-sm shadow-[0_8px_32px_rgba(46,109,164,0.25)] hover:-translate-y-0.5 transition-transform">
                Start Analyzing Free
              </button>
              <button className="font-serif italic text-base text-[#3D4A58] hover:underline">
                Watch Demo
              </button>
            </div>
            <p className="font-serif italic text-[13px] text-[#7A8A9A] mt-8">
              Trusted by researchers at WHOI, Scripps Institution, and NOAA
            </p>
          </div>
          <div className="hidden lg:block relative p-1 border border-[#C8CDD4] rounded shadow-[0_0_80px_rgba(46,109,164,0.10)] h-[500px]">
            {/* Abstract visualization mockup */}
            {/* <div className="w-full h-full bg-[#E2E6EA] rounded-sm grid items-center justify-center overflow-hidden grid-cols-10 grid-rows-10 gap-1 p-2">
               {[...Array(100)].map((_, i) => (
                 <div key={i} className={`h-full w-full rounded-sm ${i % 3 === 0 ? 'bg-[#5C7A96]' : i % 5 === 0 ? 'bg-[#2E6DA4]' : 'bg-[#C8CDD4]'}`} style={{ opacity: Math.max(0.2, Math.random()) }} />
               ))}
            </div> */}
            <div className="w-full h-full rounded-sm grid items-center justify-center overflow-hidden">
              <img
                src="/landing.png"
                alt="OceoGeo Visualization Mockup"
                className="w-full h-full object-cover shadow-md"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Trusted By */}
      {/* <section className="bg-[#F0F2F4] border-y border-[#DDE1E6] py-8">
        <p className="text-center text-[11px] uppercase tracking-widest text-[#7A8A9A] mb-6">Trusted By Leading Research Institutions</p>
        <div className="flex flex-wrap justify-center gap-12 max-w-[1440px] mx-auto px-8 opacity-60">
          {["NOAA", "Scripps Institution of Oceanography", "WHOI", "NASA JPL", "ESA", "MBARI"].map(logo => (
            <span key={logo} className="font-light text-lg tracking-wide text-[#7A8A9A] hover:opacity-100 transition-opacity cursor-default">{logo}</span>
          ))}
        </div>
      </section> */}

      {/* Capabilities Overview */}
      <section className="bg-[#F8F9FA] py-40 px-8">
        <div className="max-w-[1440px] mx-auto">
          <div className="text-center mb-24">
             <span className="text-[11px] uppercase tracking-widest text-[#2E6DA4]">Core Capabilities</span>
             <h2 className="text-[56px] font-light text-[#1A1F26] max-w-[800px] mx-auto mt-4 mb-6 leading-tight">Built for the Complexity of Real Ocean Data</h2>
             <p className="font-serif text-[18px] text-[#3D4A58] max-w-[600px] mx-auto leading-[1.75]">
               NetCDF datasets carry decades of spatiotemporal information. OceoGeo gives you the tools to unlock that information through visualization, conversation, and rigorous statistical methods.
             </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="bg-white border border-[#C8CDD4] rounded-md p-10 hover:border-[#2E6DA4] hover:-translate-y-1 transition-all relative">
              <span className="absolute top-8 left-8 text-[64px] font-light text-[#E2E6EA] leading-none">01</span>
              <div className="relative z-10">
                <div className="w-10 h-10 mb-8 border-b-2 border-[#2E6DA4] flex flex-col justify-center gap-1">
                  <div className="w-full h-0.5 bg-[#2E6DA4]" />
                  <div className="w-full h-0.5 bg-[#2E6DA4]" />
                  <div className="w-full h-0.5 bg-[#2E6DA4]" />
                </div>
                <h3 className="text-2xl font-medium mb-4 text-[#1A1F26]">Advanced Visualizations</h3>
                <p className="font-serif text-[#3D4A58] mb-8 leading-relaxed">Render spatiotemporal NetCDF data as interactive heatmaps, contour plots, time-series animations, depth profiles, and 3D scalar fields.</p>
                <a href="#" className="text-sm font-medium text-[#2E6DA4] hover:underline">Explore Visualization Suite →</a>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="bg-white border border-[#C8CDD4] rounded-md p-10 hover:border-t-2 hover:border-t-[#5C7A96] hover:-translate-y-1 transition-all relative">
              <span className="absolute top-8 left-8 text-[64px] font-light text-[#E2E6EA] leading-none">02</span>
              <div className="relative z-10">
                 <div className="w-10 h-10 mb-8 rounded outline-2 outline-[#5C7A96] flex items-center justify-center">
                    <div className="w-4 h-2 bg-[#5C7A96]" />
                 </div>
                 <h3 className="text-2xl font-medium mb-4 text-[#1A1F26]">Chat With Your Data</h3>
                 <p className="font-serif text-[#3D4A58] mb-8 leading-relaxed">Ask questions in plain language. Query variable ranges, request statistical summaries, identify anomalies, and generate plots — all through a natural language interface trained on scientific context.</p>
                 <a href="#" className="text-sm font-medium text-[#2E6DA4] hover:underline">See Data Chat in Action →</a>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="bg-white border border-[#C8CDD4] rounded-md p-10 hover:border-[#2E6DA4] hover:-translate-y-1 transition-all relative">
              <span className="absolute top-8 left-8 text-[64px] font-light text-[#E2E6EA] leading-none">03</span>
              <div className="relative z-10">
                <div className="w-10 h-10 mb-8 flex items-end overflow-hidden border-b-2 border-[#7B9BB8]">
                  <div className="w-full h-6 bg-[#7B9BB8] rounded-t-full" />
                </div>
                <h3 className="text-2xl font-medium mb-4 text-[#1A1F26]">Statistical Analysis</h3>
                <p className="font-serif text-[#3D4A58] mb-8 leading-relaxed">Run EOF decomposition, spectral analysis, wavelet transforms, trend detection, correlation matrices, and climate index comparisons directly on your uploaded variables.</p>
                <a href="#" className="text-sm font-medium text-[#2E6DA4] hover:underline">View Statistical Methods →</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Statistical Analysis Deep Dive */}
      <section className="bg-[#F0F2F4] py-40 px-8">
        <div className="max-w-[1440px] mx-auto">
          <div className="text-center mb-24">
            <span className="text-[11px] uppercase tracking-widest text-[#2E6DA4]">Feature 03 — Statistical Analysis</span>
            <h2 className="text-[52px] font-light text-[#1A1F26] max-w-[720px] mx-auto mt-4 mb-6 leading-tight">Rigorous Methods. Reproducible Results.</h2>
            <p className="font-serif text-[18px] text-[#3D4A58] max-w-[600px] mx-auto leading-[1.75]">
              OceoGeo embeds a statistical engine built for oceanographic data. Run analyses directly on NetCDF variables — no data export, no external scripts.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-[2px] bg-[#DDE1E6]">
             {[
               { title: "EOF Decomposition", desc: "Extract dominant spatial and temporal modes from multi-dimensional variables. Visualize eigenvalues, spatial patterns, and principal component time series.", tag: "Dimensionality Reduction" },
               { title: "Spectral Analysis", desc: "Apply FFT-based power spectral density estimation to identify dominant periodicities such as seasonal cycles, ENSO signals, and tidal harmonics.", tag: "Frequency Domain" },
               { title: "Wavelet Transforms", desc: "Resolve non-stationary signals across time-frequency space. Identify when dominant periodicities emerge, intensify, or dissipate.", tag: "Time-Frequency" },
               { title: "Trend Detection", desc: "Apply linear regression, Mann-Kendall tests, and Sen slope estimation to detect and quantify long-term trends in oceanographic variables.", tag: "Time Series" },
               { title: "Correlation Matrices", desc: "Compute pairwise correlations across all uploaded variables with configurable lag windows and significance thresholds.", tag: "Multivariate" },
               { title: "Climate Index Comparison", desc: "Cross-correlate your data against built-in climate indices including ENSO, AMO, PDO, NAO, and IOD with lead-lag analysis.", tag: "Climate Science" },
             ].map((method, idx) => (
                <div key={idx} className="bg-white p-10 hover:bg-[#EBEEF1] hover:border-t-2 hover:border-t-[#2E6DA4] transition-all flex flex-col border border-transparent">
                  <span className="text-[10px] uppercase text-[#4A87BE] tracking-wider mb-4 font-bold">{method.tag}</span>
                  <h4 className="text-[22px] font-normal mb-3 text-[#1A1F26]">{method.title}</h4>
                  <p className="font-serif text-[15px] text-[#3D4A58] leading-relaxed">{method.desc}</p>
                </div>
             ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      {/* <section className="bg-[#F0F2F4] border-y border-[#DDE1E6] py-32 px-8">
        <div className="max-w-[1440px] mx-auto text-center">
           <div className="text-[96px] font-bold text-[#4A87BE] leading-none mb-4">"</div>
           <p className="font-serif italic text-3xl md:text-[36px] text-[#1A1F26] max-w-[800px] mx-auto mb-8 leading-[1.5]">
             OceoGeo reduced our data preprocessing and visualization workflow from three days of scripting to under an hour. The statistical analysis suite alone is worth adopting the platform.
           </p>
           <p className="text-[#3D4A58] font-medium">— Dr. Elena Vasquez</p>
           <p className="text-sm text-[#7A8A9A]">Physical Oceanographer, Scripps Institution of Oceanography</p>
        </div>
      </section> */}

      {/* Pricing Teaser */}
      <section className="bg-[#F8F9FA] py-32 px-8" id="pricing">
        <div className="max-w-[1440px] mx-auto">
          <div className="text-center mb-16">
            <span className="text-[11px] uppercase tracking-widest text-[#2E6DA4]">Pricing</span>
            <h2 className="text-[40px] font-light text-[#1A1F26] mt-4">From Individual Researchers to Entire Institutions</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-[1000px] mx-auto">
             <div className="bg-white border border-[#C8CDD4] rounded p-12 flex flex-col">
               <h3 className="text-2xl font-medium text-[#1A1F26]">Researcher</h3>
               <p className="text-4xl font-light mt-4 mb-2">Free</p>
               <p className="text-sm font-serif text-[#7A8A9A] mb-8">For individual scientists exploring the platform.</p>
               <button className="w-full border border-[#2E6DA4] text-[#4A87BE] py-3 rounded-sm hover:bg-[#2E6DA4] hover:text-white transition-colors mb-8 text-sm font-bold">Get Started Free</button>
               <ul className="text-[13px] text-[#3D4A58] space-y-4">
                 <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#4A87BE]" />5 NetCDF uploads per month</li>
                 <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#4A87BE]" />Core visualization types</li>
                 <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#4A87BE]" />Data chat — 50 queries per month</li>
               </ul>
             </div>

             <div className="bg-white border border-[#2E6DA4] shadow-[0_16px_64px_rgba(46,109,164,0.15)] rounded p-12 flex flex-col relative scale-[1.02]">
               <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#2E6DA4] text-white text-[10px] uppercase tracking-wider px-3 py-1 rounded-sm">Most Popular</span>
               <h3 className="text-2xl font-medium text-[#1A1F26]">Lab</h3>
               <p className="text-4xl font-light mt-4 mb-2">$49 / mo</p>
               <p className="text-sm font-serif text-[#7A8A9A] mb-8">For research groups and academic labs.</p>
               <button className="w-full bg-[#2E6DA4] text-white py-3 rounded-sm hover:bg-[#4A87BE] transition-colors mb-8 text-sm font-bold shadow-md">Start Lab Trial</button>
               <ul className="text-[13px] text-[#3D4A58] space-y-4">
                 <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#2E6DA4]" />Unlimited uploads (5GB each)</li>
                 <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#2E6DA4]" />Full visualization suite</li>
                 <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#2E6DA4]" />Unlimited data chat</li>
                 <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#2E6DA4]" />All statistical methods</li>
               </ul>
             </div>

             <div className="bg-white border border-[#C8CDD4] rounded p-12 flex flex-col">
               <h3 className="text-2xl font-medium text-[#1A1F26]">Institution</h3>
               <p className="text-4xl font-light mt-4 mb-2">Custom</p>
               <p className="text-sm font-serif text-[#7A8A9A] mb-8">For universities, agencies, and enterprises.</p>
               <button className="w-full border border-[#C8CDD4] text-[#3D4A58] py-3 rounded-sm hover:bg-[#F0F2F4] transition-colors mb-8 text-sm font-bold">Contact Sales</button>
               <ul className="text-[13px] text-[#3D4A58] space-y-4">
                 <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#4A87BE]" />Custom storage logic</li>
                 <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#4A87BE]" />SSO and access management</li>
                 <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 bg-[#4A87BE]" />API access</li>
               </ul>
             </div>
          </div>
        </div>
      </section>

      {/* CTA Final */}
      <section className="py-40 text-center px-8" style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(46,109,164,0.12) 0%, rgba(92,122,150,0.06) 40%, #F8F9FA 75%)' }}>
        <h2 className="text-[72px] font-light text-[#1A1F26] max-w-[700px] mx-auto leading-tight mb-4">Your Data Has Been Waiting for This</h2>
        <p className="font-serif italic text-xl text-[#3D4A58] mb-12">Upload your first NetCDF file and have results in minutes.</p>
        <button className="bg-linear-to-br from-[#2E6DA4] to-[#5C7A96] text-white font-bold text-lg px-14 py-5 rounded-sm shadow-[0_12px_36px_rgba(46,109,164,0.30)] hover:scale-[1.02] transition-transform">
          Begin Free — No Card Required
        </button>
        <p className="text-sm text-[#7A8A9A] mt-8">Used by researchers at over 40 institutions worldwide.</p>
      </section>

      {/* Footer */}
      <footer className="bg-[#F0F2F4] border-t border-[#C8CDD4] pt-20 pb-12 px-8">
        <div className="max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-5 gap-12">
           <div className="lg:col-span-2">
             <div className="flex items-center gap-2 mb-4">
               <div className="w-3 h-3 bg-[#4A87BE]" />
               <span className="font-light tracking-widest uppercase text-[#1A1F26]">OceoGeo</span>
             </div>
             <p className="font-serif italic text-[14px] text-[#7A8A9A]">Ocean data analysis, reimagined.</p>
           </div>
           
           <div>
             <h4 className="text-[11px] uppercase tracking-widest text-[#7A8A9A] font-medium mb-6">Platform</h4>
             <ul className="space-y-3 text-[13px] text-[#7A8A9A]">
               <li><a href="#" className="hover:text-[#4A87BE]">Visualization Suite</a></li>
               <li><a href="#" className="hover:text-[#4A87BE]">Data Chat</a></li>
               <li><a href="#" className="hover:text-[#4A87BE]">Statistical Analysis</a></li>
               <li><a href="#" className="hover:text-[#4A87BE]">API Access</a></li>
             </ul>
           </div>

           <div>
             <h4 className="text-[11px] uppercase tracking-widest text-[#7A8A9A] font-medium mb-6">Resources</h4>
             <ul className="space-y-3 text-[13px] text-[#7A8A9A]">
               <li><a href="#" className="hover:text-[#4A87BE]">Documentation</a></li>
               <li><a href="#" className="hover:text-[#4A87BE]">Tutorials</a></li>
               <li><a href="#" className="hover:text-[#4A87BE]">Sample Datasets</a></li>
             </ul>
           </div>

           <div>
             <h4 className="text-[11px] uppercase tracking-widest text-[#7A8A9A] font-medium mb-6">Legal</h4>
             <ul className="space-y-3 text-[13px] text-[#7A8A9A]">
               <li><a href="#" className="hover:text-[#4A87BE]">Privacy Policy</a></li>
               <li><a href="#" className="hover:text-[#4A87BE]">Terms of Service</a></li>
               <li><a href="#" className="hover:text-[#4A87BE]">Data Security</a></li>
             </ul>
           </div>
        </div>
        <div className="max-w-[1440px] mx-auto border-t border-[#DDE1E6] mt-16 pt-6 text-[12px] text-[#7A8A9A]">
          © 2025 OceoGeo Inc. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
