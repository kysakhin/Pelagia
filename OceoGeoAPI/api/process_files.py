from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from services.ProcessService import ProcessService

router = APIRouter()

MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB


@router.post("/process")
async def process_file(
    file: UploadFile = File(...),
    user_id: str = Form(...),
    project_id: int = Form(...),   # SERIAL integer in the `projects` table
    selected_params: str = Form(default=""),
):
    """
    Process an uploaded ARGO NetCDF file and store the parsed data in Neon DB.

    Form fields:
        file         .nc / .netcdf / .nc4 file
        user_id      Clerk user ID (TEXT, for logging / ownership validation)
        project_id   Integer PK from the `projects` table

    Returns:
        file_id, profiles_inserted, measurements_inserted
    """
    allowed_extensions = {".nc", ".netcdf", ".nc4"}
    filename = file.filename or ""
    suffix = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""

    if suffix not in allowed_extensions:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{suffix}'. Expected one of {allowed_extensions}.",
        )

    # ── File-size guard ───────────────────────────────────────────────────
    if file.size is not None and file.size > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"File too large ({file.size / (1024 * 1024):.1f} MB). "
                f"Maximum allowed size is {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB."
            ),
        )

    try:
        service = ProcessService()
        result = await service.process_netcdf(file, user_id=user_id, project_id=project_id, selected_params=selected_params)
        return {
            "status": "success",
            "filename": file.filename,
            "user_id": user_id,
            "project_id": project_id,
            **result,
        }
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing file: {e}")


@router.post("/scan")
async def scan_file(
    file: UploadFile = File(...),
):
    """
    Scans a NetCDF file for core parameters and available extras.
    Returns a summary of the file's contents.
    Does not write anything to the database.
    Should be fast (<1 second for any file size).
    """
    try:
        service = ProcessService()
        result = await service.scan_netcdf(file)

        if not result:
            raise ValueError("No data variables found in the file")

        return {
            "status": "success",
            "filename": file.filename,
            "core_params": result["core_params"],
            "bgc_params": result["bgc_params"],
            "available_extras": result["available_extras"],
        }
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error scanning file: {e}")