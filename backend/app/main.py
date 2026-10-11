"""AICA console API. Run from backend/:  uvicorn app.main:app --port 8000 --reload"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .errors import ApiError, api_error_handler, validation_handler
from .routes import auth, google, invites, ops
from .services import Services, build_services
from .settings import Settings, get_settings

log = logging.getLogger("aica")

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def create_app(settings: Settings | None = None, services: Services | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.services = services or build_services(settings)
        log.info("AICA API ready (app %s)", settings.app_url)
        yield

    app = FastAPI(title="AICA console API", version="0.1.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)

    @app.middleware("http")
    async def same_origin_writes(request: Request, call_next):
        """Cookie sessions + state-changing requests: refuse any write whose
        Origin isn't the console's (CSRF). SameSite=Lax already blocks most
        of this; the check covers older browsers and subdomain tricks."""
        if request.method in UNSAFE and request.url.path.startswith("/api/"):
            origin = (request.headers.get("origin") or "").rstrip("/")
            if origin not in settings.origins:
                return JSONResponse({"error": {"code": "forbidden", "message": "Request blocked: unexpected origin."}}, status_code=403)
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(Exception)
    async def unexpected(_: Request, exc: Exception):
        log.exception("unhandled error", exc_info=exc)
        return JSONResponse({"error": {"code": "unknown", "message": "Something went wrong on our side. Try again in a moment."}}, status_code=500)

    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_handler)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    app.include_router(auth.router)
    app.include_router(google.router)
    app.include_router(invites.router)
    app.include_router(ops.router)
    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
app = create_app()
