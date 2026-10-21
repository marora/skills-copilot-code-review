"""
Authentication endpoints for the High School Management System API
"""

from datetime import datetime, timedelta, timezone
import hashlib
import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from pymongo.errors import PyMongoError
from typing import Dict, Any

from ..database import sessions_collection, teachers_collection, verify_password

logger = logging.getLogger(__name__)
SESSION_COOKIE = "school_session"
SESSION_SECONDS = 12 * 60 * 60

router = APIRouter(
    prefix="/auth",
    tags=["auth"]
)

class LoginCredentials(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1024)


def session_id(request: Request) -> str:
    token = request.cookies.get(SESSION_COOKIE, "")
    return hashlib.sha256(token.encode()).hexdigest()


def require_teacher(request: Request) -> Dict[str, Any]:
    """Authenticate using an unexpired, server-issued session."""
    try:
        session = sessions_collection.find_one({
            "_id": session_id(request),
            "expires_at": {"$gt": datetime.now(timezone.utc)}
        })
        teacher = teachers_collection.find_one({"_id": session["username"]}) if session else None
    except PyMongoError:
        logger.exception("Failed to validate teacher session")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable") from None
    if not teacher:
        raise HTTPException(status_code=401, detail="Sign in required")
    return {
        "username": teacher["username"],
        "display_name": teacher["display_name"],
        "role": teacher["role"]
    }


@router.post("/login")
def login(credentials: LoginCredentials, request: Request, response: Response) -> Dict[str, Any]:
    """Login a teacher account"""
    try:
        teacher = teachers_collection.find_one({"_id": credentials.username})
        if not teacher or not verify_password(teacher.get("password", ""), credentials.password):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        token = secrets.token_urlsafe(32)
        sessions_collection.insert_one({
            "_id": hashlib.sha256(token.encode()).hexdigest(),
            "username": teacher["username"],
            "expires_at": datetime.now(timezone.utc) + timedelta(seconds=SESSION_SECONDS)
        })
        sessions_collection.delete_one({"_id": session_id(request)})
    except PyMongoError:
        logger.exception("Failed to create teacher session")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable") from None
    response.set_cookie(
        SESSION_COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
        secure=request.url.scheme == "https", samesite="strict", path="/"
    )
    response.headers["Cache-Control"] = "no-store"

    # Return teacher information (excluding password)
    return {
        "username": teacher["username"],
        "display_name": teacher["display_name"],
        "role": teacher["role"]
    }


@router.get("/check-session")
def check_session(response: Response, teacher: Dict[str, Any] = Depends(require_teacher)) -> Dict[str, Any]:
    """Return the teacher associated with the session cookie."""
    response.headers["Cache-Control"] = "no-store"
    return teacher


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    """Revoke the current session."""
    try:
        sessions_collection.delete_one({"_id": session_id(request)})
    except PyMongoError:
        logger.exception("Failed to revoke teacher session")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable") from None
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="strict")
