from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api import chat
from api import process_files
from api import stats

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this as needed for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix= "/chat", tags=["chat"])
app.include_router(process_files.router, prefix="/files", tags=["files"])
app.include_router(stats.router, prefix="/stats", tags=["stats"])


@app.get("/")
async def root():
    return {"message":"OceoGeo API is up !! "}
