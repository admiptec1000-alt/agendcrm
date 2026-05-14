from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query, Response, Header
from motor.motor_asyncio import AsyncIOMotorDatabase
from database import get_database
from auth import get_current_user, get_password_hash, verify_password, create_access_token, require_super_admin
from models import (
    LoginRequest, RegisterRequest, TokenResponse, UserRole, 
    CompanyStatus, PlanType, ThemeColors
)
import uuid
from datetime import datetime, timezone
import os
from dotenv import load_dotenv
import requests

load_dotenv()

router = APIRouter(prefix="/auth", tags=["auth"])


# Legacy permission aliases — when admins created profiles manually before the
# feature catalog was locked, they used verb-like names. Map them to concrete
# menu feature_keys so the sidebar/home actually shows something useful.
LEGACY_PERMISSION_ALIASES = {
    "ver_proprios_atendimentos": ["dashboard", "agenda", "own_appointments_only"],
    "concluir_atendimento": ["agenda"],
    "registrar_pagamento": ["agenda", "financeiro"],
}


def expand_legacy_permissions(perms: list) -> list:
    """Expand legacy verb-like permissions into real feature_keys."""
    out = set(perms or [])
    for p in list(out):
        if p in LEGACY_PERMISSION_ALIASES:
            out.update(LEGACY_PERMISSION_ALIASES[p])
    return sorted(out)


@router.post("/super-admin/login", response_model=TokenResponse)
async def super_admin_login(
    credentials: LoginRequest,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    admin = await db.super_admins.find_one({"email": credentials.email}, {"_id": 0})
    
    if not admin or not verify_password(credentials.password, admin["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou senha incorretos"
        )
    
    token_data = {"sub": admin["id"], "type": "super_admin", "role": "super_admin"}
    access_token = create_access_token(token_data)
    
    user_data = {k: v for k, v in admin.items() if k != "password"}
    
    return TokenResponse(
        access_token=access_token,
        user=user_data
    )

@router.post("/login", response_model=TokenResponse)
async def company_login(
    credentials: LoginRequest,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    user = await db.company_users.find_one({"email": credentials.email}, {"_id": 0})
    
    if not user or not verify_password(credentials.password, user["password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou senha incorretos"
        )
    
    # Get company info
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Empresa não encontrada"
        )
    
    if company["status"] == CompanyStatus.BLOCKED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Empresa bloqueada. Entre em contato com o suporte."
        )
    
    token_data = {
        "sub": user["id"],
        "type": "company_user",
        "role": user["role"],
        "company_id": user["company_id"]
    }
    access_token = create_access_token(token_data)
    
    user_data = {k: v for k, v in user.items() if k != "password"}
    user_data["company"] = company

    # Attach permissions for non-admin, "*" for admins
    if user.get("role") == "company_admin":
        user_data["permissions"] = ["*"]
    elif user.get("permission_profile_id"):
        pp = await db.permission_profiles.find_one(
            {"id": user["permission_profile_id"], "company_id": user["company_id"]},
            {"_id": 0, "permissions": 1, "name": 1}
        )
        if pp:
            user_data["permissions"] = expand_legacy_permissions(pp.get("permissions", []))
            user_data["permission_profile_name"] = pp.get("name")

    return TokenResponse(
        access_token=access_token,
        user=user_data
    )


@router.post("/register", response_model=TokenResponse)
async def register_company(
    data: RegisterRequest,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    # Check if email already exists
    existing_user = await db.company_users.find_one({"email": data.email})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email já cadastrado"
        )
    
    # Get business type features if provided
    features = []
    if data.business_type_id:
        bt = await db.business_types.find_one({"id": data.business_type_id})
        if bt:
            features = bt.get("features", [])

    # Validate referral code (if provided): only counts if it points to an
    # active partner. Invalid codes are silently dropped — no leakage.
    referred_by = None
    if data.referred_by:
        ref = await db.companies.find_one(
            {"referral_code": data.referred_by.upper().strip(), "is_partner": True},
            {"_id": 0, "referral_code": 1},
        )
        if ref:
            referred_by = ref["referral_code"]

    # Create company
    company_id = str(uuid.uuid4())
    company = {
        "id": company_id,
        "name": data.company_name or f"Empresa de {data.name}",
        "email": data.email,
        "status": CompanyStatus.TRIAL,
        "plan_type": data.plan_type,
        "business_type_id": data.business_type_id,
        "features": features,
        "theme_colors": ThemeColors().model_dump(),
        "referred_by": referred_by,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.companies.insert_one(company)
    
    # Create user
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "company_id": company_id,
        "name": data.name,
        "email": data.email,
        "password": get_password_hash(data.password),
        "role": UserRole.COMPANY_ADMIN,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.company_users.insert_one(user)
    
    # Create booking page - slug from company name
    import re, unicodedata
    normalized = unicodedata.normalize('NFD', company["name"])
    ascii_name = normalized.encode('ascii', 'ignore').decode('ascii')
    slug = re.sub(r'[^a-z0-9]+', '-', ascii_name.lower()).strip('-')[:30]
    
    company["subdomain"] = slug
    await db.companies.update_one({"id": company_id}, {"$set": {"subdomain": slug}})
    
    booking_page = {
        "id": str(uuid.uuid4()),
        "company_id": company_id,
        "slug": slug,
        "custom_domain": slug,
        "primary_color": company["theme_colors"]["primary"],
        "secondary_color": company["theme_colors"]["secondary"],
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.booking_pages.insert_one(booking_page)
    
    # Generate token
    token_data = {
        "sub": user_id,
        "type": "company_user",
        "role": UserRole.COMPANY_ADMIN,
        "company_id": company_id
    }
    access_token = create_access_token(token_data)
    
    user_data = {k: v for k, v in user.items() if k != "password"}
    user_data["company"] = {k: v for k, v in company.items() if k != "_id"}
    
    return TokenResponse(
        access_token=access_token,
        user=user_data
    )

@router.get("/me")
async def get_current_user_info(
    user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    if user.get("role") == "super_admin":
        # Attach the Super-Admin niche so the frontend sidebar can hide
        # modules the admin disabled in "Tipos de Negocio → Super Admin".
        # We pick the SINGLE business_type whose base_type is super_admin
        # — there's exactly one per install (seeded by `seed_business_types`
        # and backfilled on startup). If the operator unticked everything,
        # the frontend keeps Dashboard + Settings visible as a safety net.
        bt = await db.business_types.find_one(
            {"base_type": "super_admin", "is_active": True},
            {"_id": 0}
        )
        if bt:
            user["business_type"] = bt
        return user

    # Surface the impersonation marker so the frontend can show the
    # "Todos os módulos" SuperAdmin toggle ONLY on impersonated tabs —
    # never on real client sessions (which would leak the toggle to
    # everyone, like the bug reported on 2026-05-06).
    if user.get("impersonated_by"):
        user["is_impersonating"] = True

    # Get company info for regular users
    company = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0})
    user["company"] = company

    # If company has business_type_id, get features from type
    if company and company.get("business_type_id"):
        bt = await db.business_types.find_one({"id": company["business_type_id"]}, {"_id": 0})
        if bt:
            user["business_type"] = bt

    # Include permission keys for non-admin users
    if user.get("permission_profile_id"):
        pp = await db.permission_profiles.find_one(
            {"id": user["permission_profile_id"], "company_id": user["company_id"]},
            {"_id": 0, "permissions": 1, "name": 1}
        )
        if pp:
            user["permissions"] = expand_legacy_permissions(pp.get("permissions", []))
            user["permission_profile_name"] = pp.get("name")
    elif user.get("role") == "company_admin":
        user["permissions"] = ["*"]  # Admin sees all

    return user


# === PUBLIC ENDPOINTS FOR LANDING PAGE ===
@router.get("/business-types")
async def list_public_business_types(
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Public endpoint for landing page to list available business types
    that are explicitly flagged as `show_on_landing=True`. Filtering on the
    server avoids leaking internal-only BTs (operational catalogs, white-label
    setups, etc.) into the public sales page."""
    types = await db.business_types.find(
        {"is_active": True, "show_on_landing": True},
        {"_id": 0, "features": 0}
    ).to_list(1000)
    return types
