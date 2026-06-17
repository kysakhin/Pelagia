# Pelagia

An AI-powered geospatial platform for oceanographic data analysis. Upload Argo float data (NetCDF) and query it using natural language. Visualize trends, create charts, and explore oceanographic parameters with ease.

## Features

- **AI-Powered Analysis**: Ask questions in natural language and get SQL queries instantly
- **Chat Interface**: Converse with your data in a ChatGPT-like interface
- **Dynamic Chart Generation**: Automatically generate charts based on your queries
- **Data Visualization**: Visualize temperature, salinity, and other oceanographic parameters
- **Project-Based Workflows**: Organize your data into projects for better management
- **Interactive Dashboard**: Explore basic statistics and distributions of your data

## Installation

See [README.md - web](./oceo-geo-web/README.md) and [README.md - API](./OceoGeoAPI/README.md) for detailed installation instructions.

## Usage

### Uploading Data

1. Go to the Projects tab and click **Create New Project**
2. Upload one or more Argo NetCDF files
3. The system will process and index the data automatically

### Chatting with Your Data

1. Open the **Chat** tab
2. Select a project from the dropdown
3. Ask questions in natural language:
   - "What is the average temperature?"
   - "Show me temperature vs depth"
   - "Plot dissolved oxygen vs depth"
   - "Compare temperature and salinity"

## Technologies Used

### Frontend
- **Next.js 16** - React framework
- **Tailwind CSS** - Styling
- **Drizzle ORM** - Type-safe database queries
- **Recharts** - Charting library
- **Lucide Icons** - Icon set
- **Clerk** - Authentication

### Backend
- **FastAPI** - Python web framework
- **PostgreSQL** - Database
- **OpenRouter** - AI model provider
- **NetCDF** - Data format

## Project Structure

```
.├── db/                 # Database configuration
├── docs/               # Documentation
├── oceo-geo-web/       # Next.js frontend
├── OceoGeoAPI/         # FastAPI backend
└── .env                # Environment variables
```

## License

Private project - All rights reserved

