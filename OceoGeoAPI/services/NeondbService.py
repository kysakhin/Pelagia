import os
from contextlib import contextmanager

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

class NeonDBService:
    """Handles all interactions with the Neon PostgreSQL database.

    Assumes the schema is already provisioned. Column names and foreign keys
    match the existing Neon DB schema exactly.
    """

    def __init__(self):
        self.connection_string = os.getenv("NEON_DEV_DATABASE_URL")
        if not self.connection_string:
            raise RuntimeError("NEON_DATABASE_URL environment variable not set")

    @contextmanager
    def get_connection(self):
        conn = psycopg2.connect(self.connection_string)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ── ownership ─────────────────────────────────────────────────────────────

    def verify_project_ownership(self, cursor, project_id: int, user_id: str) -> None:
        """
        Verify that user_id owns the given project_id.
        Raises LookupError if the project does not exist.
        Raises PermissionError if the user does not own it.
        """
        cursor.execute(
            "SELECT user_id FROM projects WHERE project_id = %s",
            (project_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise LookupError(f"Project {project_id} does not exist")
        if row[0] != user_id:
            raise PermissionError(f"User does not own project {project_id}")

    # ── files ─────────────────────────────────────────────────────────────────

    def insert_file_record(
        self,
        cursor,
        project_id: int,
        filename: str,
        metadata: dict,
        file_size_bytes: int | None = None,
    ) -> int:
        """
        Insert a row into `files` and return the generated file_id.

        project_id must already exist in `projects` (validated by the FK).
        metadata keys used: platform_number, data_centre
        """
        cursor.execute(
            """
            INSERT INTO files (project_id, filename, platform_number, data_centre, file_size_bytes)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING file_id
            """,
            (
                project_id,
                filename,
                metadata.get("platform_number"),
                metadata.get("data_centre"),
                file_size_bytes,
            ),
        )
        return cursor.fetchone()[0]

    # ── profiles ──────────────────────────────────────────────────────────────

    def insert_profile_record(self, cursor, file_id: int, profile: dict) -> int:
        """
        Insert a row into `profiles` and return the generated profile_id.

        profile keys: cycle_number, direction, latitude, longitude,
                      position_qc, observed_at (ISO string or None)
        """
        cursor.execute(
            """
            INSERT INTO profiles (file_id, cycle_number, direction, latitude, longitude,
                                  position_qc, observed_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING profile_id
            """,
            (
                file_id,
                profile.get("cycle_number"),
                profile.get("direction"),
                profile.get("latitude"),
                profile.get("longitude"),
                profile.get("position_qc"),
                profile.get("observed_at"),  # TIMESTAMP — psycopg2 accepts ISO strings
            ),
        )
        return cursor.fetchone()[0]

    # ── measurements ──────────────────────────────────────────────────────────

    def insert_measurements_batch(self, cursor, measurements: list[dict]):
        """
        Bulk-insert measurement rows using execute_values (500 rows per page).

        Each dict must contain a 'profile_id' key plus the measurement columns.
        """
        if not measurements:
            return

        psycopg2.extras.execute_values(
            cursor,
            """
            INSERT INTO measurements (
                profile_id,
                depth_level,
                pressure,             pressure_qc,
                pressure_adjusted,    pressure_adjusted_qc,
                temperature,          temperature_qc,
                temperature_adjusted, temperature_adjusted_qc,
                salinity,             salinity_qc,
                salinity_adjusted,    salinity_adjusted_qc,
                extras
            ) VALUES %s
            """,
            [
                (
                    m["profile_id"],
                    m.get("depth_level"),
                    m.get("pressure"),
                    m.get("pressure_qc"),
                    m.get("pressure_adjusted"),
                    m.get("pressure_adjusted_qc"),
                    m.get("temperature"),
                    m.get("temperature_qc"),
                    m.get("temperature_adjusted"),
                    m.get("temperature_adjusted_qc"),
                    m.get("salinity"),
                    m.get("salinity_qc"),
                    m.get("salinity_adjusted"),
                    m.get("salinity_adjusted_qc"),
                    psycopg2.extras.Json(m.get("extras", {})),
                )
                for m in measurements
            ],
            page_size=500,
        )

    # ── project_parameters ────────────────────────────────────────────────────

    def upsert_project_parameters(self, cursor, project_id: int, param_counts: dict[str, int]):
        """
        Upsert parameter counts for a project.
        """
        if not param_counts:
            return

        psycopg2.extras.execute_values(
            cursor,
            """
            INSERT INTO project_parameters (project_id, parameter_name, measurement_count)
            VALUES %s
            ON CONFLICT (project_id, parameter_name)
            DO UPDATE SET measurement_count = project_parameters.measurement_count + EXCLUDED.measurement_count
            """,
            [(project_id, param, count) for param, count in param_counts.items()]
        )

    # ── read queries (chat agent) ─────────────────────────────────────────────

    def execute_select(self, query: str, params: tuple = ()) -> list[dict]:
        """
        Run a read-only SELECT query and return rows as a list of dicts.

        Uses RealDictCursor so each row is an OrderedDict keyed by column name.
        The caller is responsible for ensuring the query is a valid SELECT.
        """
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(query, params)
                return [dict(row) for row in cur.fetchall()]
