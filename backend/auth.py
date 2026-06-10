from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from motor.motor_asyncio import AsyncIOMotorDatabase
import os
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "your-secret-key-change-this-in-production-very-important")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_token(token: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> Dict[str, Any]:
    from database import get_database
    db = await get_database()
    token = credentials.credentials
    payload = decode_token(token)
    
    user_id = payload.get("sub")
    user_type = payload.get("type", "company_user")
    
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    
    if user_type == "super_admin":
        collection = db.super_admins
    else:
        collection = db.company_users
    
    user = await collection.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )

    # 2026-02-28 — Hydrate permissions from permission_profiles for company_users.
    # Sem isso, `user.get("permissions")` retorna [] em rotas como
    # `_user_can_view_all_tickets` (crm_routes.py:42) e o flag granular do
    # perfil (ex: "view_all_tickets") nunca toma efeito. Admins continuam
    # com ["*"] implicito.
    if user_type != "super_admin":
        role = (user.get("role") or "").lower()
        if role in ("company_admin", "super_admin"):
            user["permissions"] = ["*"]
        elif user.get("permission_profile_id"):
            try:
                pp = await db.permission_profiles.find_one(
                    {"id": user["permission_profile_id"], "company_id": user.get("company_id")},
                    {"_id": 0, "permissions": 1, "name": 1},
                )
                if pp:
                    user["permissions"] = pp.get("permissions") or []
                    user["permission_profile_name"] = pp.get("name")
            except Exception as _e:
                # Best-effort: nao quebra auth se a colecao de perfis falhar.
                pass

    # Inject SA system company_id so SA users can use tenant-scoped routes
    # (channels, tickets, atendimentos). Created on server startup; see
    # server.py::_ensure_super_admin_system_company. 2026-02-16 (J).
    if user_type == "super_admin" and not user.get("company_id"):
        user["company_id"] = "_super_admin_system_"

    # Surface the JWT impersonation claim onto the loaded user record so
    # downstream endpoints (e.g. /auth/me) can echo it to the frontend.
    # Without this, the claim from POST /super-admin/companies/{id}/impersonate
    # is silently dropped because we always re-hydrate from DB.
    if payload.get("impersonated_by"):
        user["impersonated_by"] = payload["impersonated_by"]

    return user

async def require_super_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    # Accept multiple legacy/variant role identifiers for super admin because
    # older seeds and migrations sometimes stored 'admin', 'superadmin', or
    # set an explicit boolean flag. This keeps the panel working without
    # requiring a DB migration.
    role = (user.get("role") or "").lower().replace(" ", "_").replace("-", "_")
    is_super = (
        role in ("super_admin", "superadmin", "root")
        or user.get("is_super_admin") is True
        or user.get("is_superadmin") is True
    )
    if not is_super:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Super admin access required (got role='{user.get('role')}')"
        )
    return user

async def require_company_admin(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    if user.get("role") not in ["company_admin", "super_admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Company admin access required"
        )
    return user
