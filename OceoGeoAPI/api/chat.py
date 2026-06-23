## chat api
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.ChatService import ChatService

router = APIRouter()
service = ChatService()


class ChatRequest(BaseModel):
    message: str
    user_id: str
    project_id: int
    context: dict | None = None


@router.post("/send_message")
async def send_message(request: ChatRequest):
    try:
        response = service.process_message(
            message=request.message,
            user_id=request.user_id,
            project_id=request.project_id,
            context=request.context,
        )
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))