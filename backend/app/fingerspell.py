from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

SUPPORTED = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZ")


class FingerspellRequest(BaseModel):
    text: str
    lang: Literal["isl", "asl"]


class Letter(BaseModel):
    char: str
    clip_url: str


class FingerspellResponse(BaseModel):
    lang: Literal["isl", "asl"]
    letters: list[Letter]
    skipped: list[str]


@router.post("/fingerspell", response_model=FingerspellResponse)
def fingerspell(req: FingerspellRequest) -> FingerspellResponse:
    letters: list[Letter] = []
    skipped: list[str] = []
    for ch in req.text.upper():
        if ch.isspace():
            continue  # spaces are pauses between words, not letters
        if ch in SUPPORTED:
            letters.append(Letter(char=ch, clip_url=f"/static/letters/{req.lang}/{ch}.json"))
        elif ch not in skipped:
            skipped.append(ch)
    return FingerspellResponse(lang=req.lang, letters=letters, skipped=skipped)
