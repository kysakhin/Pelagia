## chat api
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from services.ChatService import ChatService

router = APIRouter()
service = ChatService()


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = ""
    intent: str | None = None
    sql_query: str | None = None


class ChatRequest(BaseModel):
    message: str
    user_id: str
    project_id: int
    context: dict | None = None
    # Recent prior turns of this conversation, oldest first.
    history: list[HistoryTurn] = Field(default_factory=list, max_length=20)


@router.post("/send_message")
async def send_message(request: ChatRequest):
    try:
        response = service.process_message(
            message=request.message,
            user_id=request.user_id,
            project_id=request.project_id,
            context=request.context,
            history=[turn.model_dump() for turn in request.history],
        )
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))