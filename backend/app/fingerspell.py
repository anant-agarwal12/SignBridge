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
    clip_url: str | None = None
    pause: bool = False


class FingerspellResponse(BaseModel):
    lang: Literal["isl", "asl"]
    letters: list[Letter]
    skipped: list[str]


@router.post("/fingerspell", response_model=FingerspellResponse)
def fingerspell(req: FingerspellRequest) -> FingerspellResponse:
    letters: list[Letter] = []
    skipped: list[str] = []
    pending_pause = False
    for ch in req.text.upper():
        if ch.isspace():
            # A run of spaces is one word boundary; none at the start or end.
            pending_pause = bool(letters)
            continue
        if ch in SUPPORTED:
            if pending_pause:
                letters.append(Letter(char=" ", clip_url=None, pause=True))
                pending_pause = False
            letters.append(Letter(char=ch, clip_url=f"/static/letters/{req.lang}/{ch}.json"))
        elif ch not in skipped:
            skipped.append(ch)
    return FingerspellResponse(lang=req.lang, letters=letters, skipped=skipped)
