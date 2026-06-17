# Getting Started

## Installation
Dependencies: Node.js, pnpm

To install Node.js, go to [Node.js Download](https://nodejs.org/en/download). Scroll down to "Or get a prebuilt Node.js" and select the appropriate version for your operating system. And install the .msi file.
To install pnpm, run the following command in your terminal:

```bash
npm install -g pnpm
```

First time setup:
Make sure you're in the right folder, then run the following command in your terminal to install the dependencies:

```bash
pnpm install
```
Note: You might have to run this command whenever you pull new changes from the repository, as new dependencies might have been added.

Then, run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

# Developing Guide
The project is structured as a typical Next.js application, with the following key directories:
- `app/`: Contains the main application code, including pages, components, and styles.
- `components/`: Contains reusable React components used throughout the application.
- `lib/`: Contains utility functions and modules for database interactions, authentication, and other backend logic.
- `hooks/`: Contains custom React hooks for managing state and side effects in the application.
- `public/`: Contains static assets such as images and icons.
- `types/`: Contains TypeScript type definitions for the application.
- `prisma/`: Contains the Prisma schema and migration files for the PostgreSQL database.

When developing new features or fixing bugs, follow these steps:
1. Pull the latest changes from the main branch to ensure you're working with the most up-to-date code:
```bash
git checkout main
git pull origin main
```
2. Create a new branch for your work:
```bash
git checkout -b feature/your-feature-name
```
3. Make your changes and commit them with messages:
```bash
git add .
git commit -m "Add feature X to improve Y"
```
4. Push your branch to the remote repository:
```bash
git push origin feature/your-feature-name
```
5. Create a pull request on GitHub to merge your changes into the main branch.


# AI context:
OceoGeoApp is a web application that allows users to upload NetCDF files grouped into projects, visualize the data using different kinds of charts, interact with an AI chatbot to ask questions about the data, view advanced statistics for power users like researchers while allowing the general public to easily understand with simplified visualizations. The application is build using Next.js, and TypeScript, and uses a PostgreSQL database to store user data, the AI chatbot is managed by a different repository, and the frontend communicates with it through API calls.


# Development plan

## Phase 1: Basic Functionality
- [x] Setup database schema for users, projects and other necessary tables
- [x] Setup RLS for the database
- [ ] Setup database triggers and functions for common ops
- [x] Implement user authentication and authorization
- [ ] Implement project creation and management
- [x] Implement file upload functionality for NetCDF files

## Phase 2: Data Viz
- [ ] Implement basic data visualization using charts and graphs
- [ ] Implement interactive visualizations for better user experience
- [ ] Optimize data processing and visualization for large datasets

## Phase 3: AI Chatbot Integration
- [ ] Integrate AI chatbot for user queries about the data
- [ ] Implement API calls to communicate with the AI chatbot
- [ ] Test and optimize chatbot responses for accuracy and relevance

## Phase 4: Advanced Features
- [ ] Implement advanced statistics and analytics for power users
- [ ] Implement simplified visualizations for general public
- [ ] Optimize performance and scalability of the application

## Database Optimization Note
Currently, the application calculates project statistics (like minimum, average, and maximum temperatures, as well as unique locations) by running a live aggregation query across the `measurements` table via the `app/projects/[id]/page.tsx` server component. Since the `measurements` table grows extremely fast (often thousands of rows per single NetCDF file dive cycle), running live calculations can degrade dashboard performance considerably on massive projects. Before moving to production with significant data volumes, consider converting these live calculations into a PostgreSQL `MATERIALIZED VIEW` (refreshed asynchronously) or maintaining pre-aggregated statistic rows via database triggers during file processing.
