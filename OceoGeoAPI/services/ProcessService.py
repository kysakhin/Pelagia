import io
import numpy as np
import pandas as pd
import xarray as xr
from fastapi import UploadFile

from services.NeondbService import NeonDBService
from core.processor import extract_file_metadata, extract_measurements, extract_profile_header, extract_profiles


class ProcessService:
    """
    Parses an ARGO NetCDF file and inserts the data into the Neon PostgreSQL database.
    """

    def __init__(self):
        self.db = NeonDBService()

    async def process_netcdf(self, file: UploadFile, user_id: str, project_id: int) -> dict:
        """
        Main entry point. Reads the uploaded NetCDF file, parses it,
        and writes files/profiles/measurements to Neon DB.

        project_id is an integer FK into the `projects` table.
        user_id is kept for logging/validation; ownership is enforced via
        the projects -> users FK chain already in the DB.
        """
        if not file.filename:
            raise ValueError("File must have a filename")
        
        raw_bytes = await file.read()
        file_size_bytes = len(raw_bytes)
        ds = xr.open_dataset(io.BytesIO(raw_bytes))

        # 1. Parse
        metadata = extract_file_metadata(ds)
        profiles = extract_profiles(ds)

        # 2. Write to DB
        with self.db.get_connection() as conn:
            cursor = conn.cursor()

            # Verify the user actually owns this project
            self.db.verify_project_ownership(cursor, project_id, user_id)

            file_id = self.db.insert_file_record(
                cursor, project_id, file.filename, metadata, file_size_bytes
            )

            profiles_inserted = 0
            measurements_inserted = 0

            for profile in profiles:
                profile_id = self.db.insert_profile_record(cursor, file_id, profile)
                profiles_inserted += 1

                measurements = [
                    {**m, "profile_id": profile_id}
                    for m in profile.get("measurements", [])
                ]
                self.db.insert_measurements_batch(cursor, measurements)
                measurements_inserted += len(measurements)

        return {
            "file_id": file_id,
            "profiles_inserted": profiles_inserted,
            "measurements_inserted": measurements_inserted,
        }

    # ── Private helpers ───────────────────────────────────────────────────────
