import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { redirect } from "next/navigation";
import ClientBasicCharts from "./ClientBasicCharts";

export default async function BasicCharts({ projectId }: { projectId: number }) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  // Fetch a robust subset of data for Basic Charts to avoid overloading the browser
  // using PostgreSQL TABLESAMPLE if possible, or simple limit logic
  
  const chartDataRows = await sql`
     SELECT 
      m.profile_id,
      COALESCE(m.pressure_adjusted, m.pressure) as pressure,
      COALESCE(m.temperature_adjusted, m.temperature) as temperature,
      COALESCE(m.salinity_adjusted, m.salinity) as salinity,
      p.latitude,
      p.longitude,
      p.observed_at as date
    FROM files f
    JOIN projects pr ON pr.project_id = f.project_id
    JOIN profiles p ON p.file_id = f.file_id
    JOIN measurements m ON m.profile_id = p.profile_id
    WHERE f.project_id = ${projectId} AND pr.user_id = ${userId}
    LIMIT 2500
  `;

  return <ClientBasicCharts data={chartDataRows as any[]} />;
}