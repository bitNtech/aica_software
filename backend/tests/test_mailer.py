from __future__ import annotations

import json

import httpx

from app.mailer import Mailer

LEAD = {
    "name": "Dr. <script>alert(1)</script>",
    "company": "Priya\r\nBcc: evil@x.in Dental",
    "phone": "9876543210",
    "industry": "Hospital / clinic",
    "calls_per_day": "50–200",
    "utm_source": "google",
    "received_at": "2026-10-12 10:00 UTC",
}


def mailer(handler):
    return Mailer("re_test", "AICA <aica@bitntech.in>", httpx.Client(transport=httpx.MockTransport(handler)))


def test_demo_request_email_is_escaped_and_single_line():
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={"id": "x"})

    assert mailer(handler).demo_request(["sales@bitntech.in", "support@bitntech.in"], LEAD) is True
    [body] = sent
    assert body["to"] == ["sales@bitntech.in", "support@bitntech.in"]
    assert body["subject"] == "Demo request: Priya Bcc: evil@x.in Dental"  # no line breaks reach the header
    assert "<script>" not in body["html"] and "&lt;script&gt;" in body["html"]
    assert "+91 98765 43210" in body["html"] and "utm_source" in body["html"]


def test_demo_request_reports_resend_rejection():
    assert mailer(lambda r: httpx.Response(403, json={"message": "domain not verified"})).demo_request(["a@x.in"], LEAD) is False


def test_demo_request_without_api_key_is_not_sent():
    assert Mailer("", "AICA <a@x.in>").demo_request(["a@x.in"], LEAD) is False
