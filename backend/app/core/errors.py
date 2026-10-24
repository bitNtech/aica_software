"""One error shape for every failure: {"error": {"code", "message", "retryAfter"?}}.
The codes match the frontend's AuthErrorCode."""
from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, retry_after: int | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.retry_after = status, code, message, retry_after


def bad_input(message: str = "Some details are missing. Check the form and try again.") -> ApiError:
    return ApiError(422, "invalid_input", message)


def forbidden(message: str = "You don't have access to that.") -> ApiError:
    return ApiError(403, "forbidden", message)


def unauthenticated() -> ApiError:
    return ApiError(401, "unauthenticated", "Sign in to continue.")


def _body(code: str, message: str, retry_after: int | None = None) -> dict:
    err: dict = {"code": code, "message": message}
    if retry_after is not None:
        err["retryAfter"] = retry_after
    return {"error": err}


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
    return JSONResponse(_body(exc.code, exc.message, exc.retry_after), status_code=exc.status, headers=headers)


async def validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    # Field-level messages are the frontend's job; don't echo submitted values back.
    return JSONResponse(_body("invalid_input", "Some details are missing or not valid. Check the form and try again."), status_code=422)
