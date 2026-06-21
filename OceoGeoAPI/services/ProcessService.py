import io
import re

import numpy as np
import pandas as pd
import xarray as xr
from core.processor import extract_file_metadata, extract_profiles, get_data_variables
from fastapi import UploadFile
from services.NeondbService import NeonDBService


class ProcessService:
    """
    Parses an ARGO NetCDF file and inserts the data into the Neon PostgreSQL database.
    """

    def __init__(self):
        self.db = NeonDBService()

    async def process_netcdf(self, file: UploadFile, user_id: str, project_id: int, selected_params: str = "") -> dict:
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
        profiles = extract_profiles(ds, selected_params)

        # 2. Write to DB
        with self.db.get_connection() as conn:
            cursor = conn.cursor()

            # Verify the user actually owns this project
            self.db.verify_project_ownership(cursor, project_id, user_id)

            # Insert into files table
            file_id = self.db.insert_file_record(
                cursor, project_id, file.filename, metadata, file_size_bytes
            )

            profiles_inserted = 0
            measurements_inserted = 0
            param_counts = {}

            # Insert into profiles and measurements tables
            for profile in profiles:
                profile_id = self.db.insert_profile_record(cursor, file_id, profile)
                profiles_inserted += 1

                measurements = [
                    {**m, "profile_id": profile_id}
                    for m in profile.get("measurements", [])
                ]
                self.db.insert_measurements_batch(cursor, measurements)
                measurements_inserted += len(measurements)
            
                # Tally up extra parameters inserted
                for m in measurements:
                    extras = m.get("extras", {})
                    for key, val in extras.items():
                        if val is not None:
                            param_counts[key] = param_counts.get(key, 0) + 1
            
            # Insert extras parameters if any
            if param_counts:
                self.db.upsert_project_parameters(cursor, project_id, param_counts)


        return {
            "file_id": file_id,
            "profiles_inserted": profiles_inserted,
            "measurements_inserted": measurements_inserted,
        }

    def clean_available_parameters(self, data_variables):
        available_bases = set()

        ignore_patterns = [
            r"^HISTORY_",  # Processing history arrays
            r"^PROFILE_",  # Profile-level QC summaries
            r"^SCIENTIFIC_CALIB_",  # Calibration equations/coefficients
            r"^STATION_",  # Station parameters
            r"DATE|JULD|POSITION",  # Time and location (already handled in profiles table)
            r"^DATA_|DC_",  # Data center and file metadata
            r".*_VERSION",  # Version info
            r".*_NUMBER",  # Instance/ID numbers
            r".*_NO",  # Numbers again
            r".*_NAME",  # PI name/Project name
            r"^PLATFORM_",  # Platform type
            r"WMO_INST_TYPE",  # World Meteorological Organization instrument type
            r".*_dPRES",  # Pressure data
        ]

        for var in data_variables:
            if any(re.search(pattern, var) for pattern in ignore_patterns):
                continue

            base_name = re.sub(
                r"(_QC|_ADJUSTED|_ADJUSTED_QC|_ERROR|_ADJUSTED_ERROR)$", "", var
            )
            available_bases.add(base_name)

        return sorted(list(available_bases))

    async def scan_netcdf(self, file: UploadFile) -> dict:
        """
        Scans a NetCDF file for core parameters and available extras.
        Returns a summary of the file's contents.
        Does not write anything to the database.
        Should be fast (<1 second for any file size).
        """
        data_variables = await get_data_variables(file)

        core_base = {"PRES", "TEMP", "PSAL"}
        bgc_base = {
            "BBP700",
            "CHLA",
            "DOXY",
            "NITRATE",
            "PH_IN_SITU_TOTAL",
            "CDOM",
            "DOWN_IRRADIANCE",
            "UP_RADIANCE",
            "BISULFIDE",
            "TURBIDITY",
        }

        available_bases = set(self.clean_available_parameters(data_variables))

        frontend_core = sorted(available_bases & core_base)
        frontend_bgc = sorted(available_bases & bgc_base)

        # default parameters being extracted anyway
        default_params = {
            "DIRECTION",
            "LATITUDE",
            "LONGITUDE",
            "POSITION_QC",
            "OBSERVED_AT",
            "DATA_CENTER",
            "PLATFORM_NUMBER",
            "PLATFORM_TYPE",
        }

        frontend_extras = sorted(
            available_bases - core_base - bgc_base - default_params
        )

        return {
            "core_params": frontend_core,
            "bgc_params": frontend_bgc,
            "available_extras": frontend_extras,
        }

    # ── Private helpers ───────────────────────────────────────────────────────
