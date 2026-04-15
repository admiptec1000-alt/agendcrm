from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response, Header, Query
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user
import uuid
import os
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/upload", tags=["upload"])

STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "agentcrm"

storage_key = None

def init_storage():
    global storage_key
    if storage_key:
        return storage_key
    
    try:
        resp = requests.post(
            f"{STORAGE_URL}/init",
            json={"emergent_key": EMERGENT_KEY},
            timeout=30
        )
        resp.raise_for_status()
        storage_key = resp.json()["storage_key"]
        return storage_key
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao inicializar storage: {str(e)}")

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    try:
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao fazer upload: {str(e)}")

def get_object(path: str) -> tuple:
    key = init_storage()
    try:
        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key},
            timeout=60
        )
        resp.raise_for_status()
        return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao baixar arquivo: {str(e)}")

@router.post("/")
async def upload_file(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Validate file
    if not file.filename:
        raise HTTPException(status_code=400, detail="Nome do arquivo inválido")
    
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    file_id = str(uuid.uuid4())
    path = f"{APP_NAME}/uploads/{user['company_id']}/{file_id}.{ext}"
    
    # Read file content
    content = await file.read()
    
    # Upload to object storage
    result = put_object(path, content, file.content_type or "application/octet-stream")
    
    # Save reference in database
    file_doc = {
        "id": file_id,
        "company_id": user["company_id"],
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": file.content_type,
        "size": result["size"],
        "is_deleted": False,
        "uploaded_by": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.files.insert_one(file_doc)
    
    return {
        "id": file_id,
        "path": result["path"],
        "filename": file.filename,
        "size": result["size"],
        "url": f"/api/upload/files/{result['path']}"
    }

@router.get("/files/{path:path}")
async def download_file(
    path: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    authorization: str = Header(None),
    auth: str = Query(None)
):
    # Check if file exists in database
    file_doc = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not file_doc:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    
    # Get file from storage
    data, content_type = get_object(path)
    
    return Response(
        content=data,
        media_type=file_doc.get("content_type", content_type),
        headers={
            "Content-Disposition": f'inline; filename="{file_doc.get("original_filename", "file")}"'
        }
    )

@router.delete("/files/{file_id}")
async def delete_file(
    file_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Soft delete (mark as deleted)
    result = await db.files.update_one(
        {"id": file_id, "company_id": user["company_id"]},
        {"$set": {"is_deleted": True}}
    )
    
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado")
    
    return {"message": "Arquivo deletado com sucesso"}
