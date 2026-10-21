"""Public announcements and authenticated announcement management."""

from datetime import date, datetime, timezone
import logging
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from pymongo.errors import PyMongoError

from ..database import announcements_collection
from .auth import require_teacher

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/announcements", tags=["announcements"])


class AnnouncementInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    message: str = Field(min_length=1, max_length=1000)
    starts_on: Optional[date] = None
    expires_on: date

    @model_validator(mode="after")
    def validate_dates(self):
        if self.starts_on and self.starts_on > self.expires_on:
            raise ValueError("Start date must be on or before expiration date")
        return self

    def document(self) -> Dict[str, Any]:
        return {
            "message": self.message,
            "starts_on": self.starts_on.isoformat() if self.starts_on else None,
            "expires_on": self.expires_on.isoformat()
        }


class Announcement(AnnouncementInput):
    id: str


def announcement_id(value: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise HTTPException(status_code=404, detail="Announcement not found")
    return ObjectId(value)


def serialize(document: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(document["_id"]),
        "message": document["message"],
        "starts_on": document.get("starts_on"),
        "expires_on": document["expires_on"]
    }


@router.get("", response_model=List[Announcement])
def get_announcements(response: Response):
    """List currently active announcements, including the expiration day (UTC)."""
    today = datetime.now(timezone.utc).date().isoformat()
    response.headers["Cache-Control"] = "no-store"
    try:
        documents = announcements_collection.find({
            "expires_on": {"$gte": today},
            "$or": [{"starts_on": None}, {"starts_on": {"$lte": today}}]
        }).sort([("expires_on", 1), ("_id", -1)])
        return [serialize(document) for document in documents]
    except PyMongoError:
        logger.exception("Failed to load public announcements")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable") from None


@router.get("/manage", response_model=List[Announcement], dependencies=[Depends(require_teacher)])
def list_announcements(response: Response):
    """List every announcement, including scheduled and expired messages."""
    response.headers["Cache-Control"] = "no-store"
    try:
        return [serialize(document) for document in announcements_collection.find().sort("_id", -1)]
    except PyMongoError:
        logger.exception("Failed to list announcements for management")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable") from None


@router.post("", status_code=201, response_model=Announcement, dependencies=[Depends(require_teacher)])
def create_announcement(announcement: AnnouncementInput):
    """Create an announcement with a required expiration date."""
    document = announcement.document()
    try:
        announcements_collection.insert_one(document)
        return serialize(document)
    except PyMongoError:
        logger.exception("Failed to create announcement")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable") from None


@router.put("/{id}", response_model=Announcement, dependencies=[Depends(require_teacher)])
def update_announcement(id: str, announcement: AnnouncementInput):
    """Replace an announcement's message and schedule."""
    key = announcement_id(id)
    document = announcement.document()
    try:
        result = announcements_collection.update_one({"_id": key}, {"$set": document})
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Announcement not found")
        return {**document, "id": id}
    except PyMongoError:
        logger.exception("Failed to update announcement")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable") from None


@router.delete("/{id}", status_code=204, dependencies=[Depends(require_teacher)])
def delete_announcement(id: str):
    """Permanently delete an announcement."""
    key = announcement_id(id)
    try:
        result = announcements_collection.delete_one({"_id": key})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Announcement not found")
    except PyMongoError:
        logger.exception("Failed to delete announcement")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable") from None
