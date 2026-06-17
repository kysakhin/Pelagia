from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.StatsService import PairConfig, StatsService

router = APIRouter()


class StatsV1Request(BaseModel):
    user_id: str
    project_id: int
    pair_x: str = Field(default="salinity")
    pair_y: str = Field(default="temperature")
    poly_degree: int = Field(default=2, ge=1, le=5)
    corr_method: str = Field(default="pearson")


@router.post("/v1")
async def stats_v1(payload: StatsV1Request):
    try:
        service = StatsService()
        result = service.compute_v1(
            project_id=payload.project_id,
            user_id=payload.user_id,
            pair=PairConfig(x=payload.pair_x, y=payload.pair_y),
            poly_degree=payload.poly_degree,
            corr_method=payload.corr_method,
        )
        return result
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Stats computation failed: {e}")
