"""CardDAV operations: list address books, list/get/put/delete vCards.

Mirrors `caldav_client.py` but for the contact side of Purelymail's
WebDAV tree. The official `caldav` Python package does not ship an
address-book client, so we talk RFC 6352 directly with urllib + a small
XML parser. Same auth model as CalDAV (HTTP Basic with the mailbox
password we already encrypt at rest).

Purelymail exposes two books out of the box per account:

    /webdav/{account}/carddav/default/
    /webdav/{account}/carddav/automaticallyCollected/

`default` is the user's main contacts; `automaticallyCollected` is the
book Purelymail's own webmail populates from sent mail, and the one we
write to when auto-collecting calendar invitees.
"""
from __future__ import annotations

import base64
import hashlib
import re
import ssl
import urllib.error
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import List, Optional, Tuple


_DAV_NS = "DAV:"
_CARDDAV_NS = "urn:ietf:params:xml:ns:carddav"


@dataclass(frozen=True)
class CardDavCreds:
    base_url: str  # e.g. https://purelymail.com/webdav/716756/carddav/
    username: str
    password: str


@dataclass
class CardResource:
    href: str            # absolute server path, e.g. /webdav/716756/carddav/default/abc.vcf
    etag: Optional[str]  # server etag without quotes, may be None
    book: str            # "default" or "automaticallyCollected"


@dataclass
class ParsedCard:
    uid: str
    full_name: str
    primary_email: Optional[str]
    emails: List[str]
    org: Optional[str]
    raw_vcard: str


def carddav_url_for(account_id: str) -> str:
    return f"https://purelymail.com/webdav/{account_id}/carddav/"


def _auth_header(username: str, password: str) -> str:
    raw = f"{username}:{password}".encode()
    return "Basic " + base64.b64encode(raw).decode()


def _request(
    method: str,
    url: str,
    username: str,
    password: str,
    *,
    headers: Optional[dict] = None,
    body: Optional[bytes] = None,
    timeout: int = 20,
) -> Tuple[int, dict, bytes]:
    req = urllib.request.Request(url, method=method, data=body)
    req.add_header("Authorization", _auth_header(username, password))
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return r.getcode(), dict(r.headers.items()), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers.items() if e.headers else {}), e.read() or b""


def _strip_etag(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    s = raw.strip()
    if s.startswith("W/"):
        s = s[2:].strip()
    if s.startswith('"') and s.endswith('"') and len(s) >= 2:
        s = s[1:-1]
    return s or None


def list_addressbooks(creds: CardDavCreds) -> List[str]:
    """Return the address-book directory names under /carddav/ (one Depth=1
    PROPFIND). Purelymail returns at least 'default' and
    'automaticallyCollected'.
    """
    code, _, body = _request(
        "PROPFIND",
        creds.base_url,
        creds.username,
        creds.password,
        headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
        body=(
            b"<?xml version='1.0' encoding='utf-8' ?>"
            b"<propfind xmlns='DAV:'><prop><resourcetype/></prop></propfind>"
        ),
    )
    if code not in (207, 200):
        raise RuntimeError(f"PROPFIND {creds.base_url} -> HTTP {code}")
    hrefs = re.findall(r"<(?:[^:>]+:)?href[^>]*>([^<]+)</(?:[^:>]+:)?href>", body.decode(errors="replace"))
    out: List[str] = []
    for h in hrefs:
        # Match: /webdav/{acct}/carddav/<book>/
        m = re.match(r"^.*/carddav/([^/]+)/?$", h.strip())
        if not m:
            continue
        name = m.group(1)
        if name and name not in out:
            out.append(name)
    return out


def _book_url(creds: CardDavCreds, book: str) -> str:
    base = creds.base_url.rstrip("/")
    return f"{base}/{book}/"


def list_card_resources(creds: CardDavCreds, book: str) -> List[CardResource]:
    """PROPFIND Depth=1 on one address book; return (href, etag) per vCard."""
    url = _book_url(creds, book)
    code, _, body = _request(
        "PROPFIND",
        url,
        creds.username,
        creds.password,
        headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
        body=(
            b"<?xml version='1.0' encoding='utf-8' ?>"
            b"<propfind xmlns='DAV:'><prop>"
            b"<getetag/><resourcetype/>"
            b"</prop></propfind>"
        ),
    )
    if code not in (207, 200):
        raise RuntimeError(f"PROPFIND {url} -> HTTP {code}")
    # Parse the multistatus XML so we can match etag with href per response.
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        raise RuntimeError(f"unparseable PROPFIND response: {e}")
    out: List[CardResource] = []
    for resp in root.iter(f"{{{_DAV_NS}}}response"):
        href_el = resp.find(f"{{{_DAV_NS}}}href")
        if href_el is None or not (href_el.text or "").strip():
            continue
        href = href_el.text.strip()
        # Only .vcf children — skip the book itself and any collection rows.
        if not href.lower().endswith(".vcf"):
            continue
        etag = None
        for prop in resp.iter(f"{{{_DAV_NS}}}prop"):
            et = prop.find(f"{{{_DAV_NS}}}getetag")
            if et is not None and (et.text or "").strip():
                etag = _strip_etag(et.text)
                break
        out.append(CardResource(href=href, etag=etag, book=book))
    return out


def get_card(creds: CardDavCreds, href: str) -> Tuple[str, Optional[str]]:
    """GET a vCard resource. Returns (raw_text, etag).

    `href` may be absolute path (starts with `/`) or full URL.
    """
    url = _abs_url(creds.base_url, href)
    code, headers, body = _request("GET", url, creds.username, creds.password)
    if code != 200:
        raise RuntimeError(f"GET {url} -> HTTP {code}")
    raw = body.decode("utf-8", errors="replace")
    return raw, _strip_etag(headers.get("ETag") or headers.get("Etag"))


def put_card(
    creds: CardDavCreds,
    book: str,
    raw_vcard: str,
    *,
    filename: Optional[str] = None,
    if_match: Optional[str] = None,
) -> Tuple[str, Optional[str]]:
    """PUT a vCard to a book. Returns (href, etag).

    When `filename` is None we generate `<uuid>.vcf`. Use `if_match=etag`
    to make the write conditional (avoids overwriting concurrent edits).
    """
    fname = filename or f"{uuid.uuid4().hex}.vcf"
    url = _book_url(creds, book) + fname
    headers = {"Content-Type": "text/vcard; charset=utf-8"}
    if if_match:
        headers["If-Match"] = f'"{if_match}"'
    code, resp_headers, _ = _request(
        "PUT",
        url,
        creds.username,
        creds.password,
        headers=headers,
        body=raw_vcard.encode("utf-8"),
    )
    if code not in (200, 201, 204):
        raise RuntimeError(f"PUT {url} -> HTTP {code}")
    href = _href_for(creds.base_url, book, fname)
    return href, _strip_etag(resp_headers.get("ETag") or resp_headers.get("Etag"))


def delete_card(creds: CardDavCreds, href: str) -> None:
    url = _abs_url(creds.base_url, href)
    code, _, _ = _request("DELETE", url, creds.username, creds.password)
    if code not in (200, 202, 204, 404):
        raise RuntimeError(f"DELETE {url} -> HTTP {code}")


def _abs_url(base_url: str, href_or_path: str) -> str:
    if href_or_path.startswith("http://") or href_or_path.startswith("https://"):
        return href_or_path
    # base_url is e.g. https://purelymail.com/webdav/716756/carddav/
    m = re.match(r"^(https?://[^/]+)(/.*)$", base_url)
    if not m:
        return base_url.rstrip("/") + "/" + href_or_path.lstrip("/")
    origin = m.group(1)
    if href_or_path.startswith("/"):
        return origin + href_or_path
    return base_url.rstrip("/") + "/" + href_or_path


def _href_for(base_url: str, book: str, filename: str) -> str:
    """Build the server-relative path for a PUT'd resource so callers can
    cache it without re-parsing the response."""
    m = re.match(r"^https?://[^/]+(/.*)$", base_url)
    base_path = m.group(1) if m else "/"
    return base_path.rstrip("/") + f"/{book}/{filename}"


# ---------------------------------------------------------------------------
# vCard parsing / composition
# ---------------------------------------------------------------------------


def parse_vcard(raw: str) -> Optional[ParsedCard]:
    """Best-effort vCard parser. Returns None when the blob isn't a valid
    vCard. We rely on `vobject` for variance handling (3.0 vs 4.0,
    folded lines, quoted-printable, etc.) but tolerate missing fields.
    """
    import vobject

    try:
        card = vobject.readOne(raw)
    except Exception:
        return None
    if card is None:
        return None

    def _first(name: str) -> Optional[str]:
        try:
            attr = getattr(card, name)
        except AttributeError:
            return None
        try:
            value = attr.value
        except AttributeError:
            return None
        if isinstance(value, str):
            return value.strip() or None
        return None

    uid = _first("uid") or hashlib.sha1(raw.encode("utf-8", errors="replace")).hexdigest()
    fn = _first("fn") or ""
    org_val = None
    try:
        org_attr = card.org
        v = org_attr.value
        if isinstance(v, list):
            org_val = " ".join(str(x).strip() for x in v if str(x).strip())
        else:
            org_val = str(v).strip() or None
    except AttributeError:
        org_val = None

    emails: List[str] = []
    try:
        for em in card.contents.get("email", []):
            v = (em.value or "").strip()
            if v and v.lower() not in (e.lower() for e in emails):
                emails.append(v)
    except Exception:
        emails = []

    # If FN is missing, fall back to N (structured name) or the first email.
    if not fn:
        try:
            n_attr = card.n
            parts = []
            for part in ("prefix", "given", "additional", "family", "suffix"):
                v = getattr(n_attr.value, part, "") or ""
                if isinstance(v, list):
                    v = " ".join(v)
                if v:
                    parts.append(str(v).strip())
            fn = " ".join(p for p in parts if p).strip()
        except AttributeError:
            pass
    if not fn and emails:
        fn = emails[0]

    return ParsedCard(
        uid=str(uid),
        full_name=fn,
        primary_email=emails[0] if emails else None,
        emails=emails,
        org=org_val,
        raw_vcard=raw,
    )


def compose_vcard(uid: str, full_name: str, email: str) -> str:
    """Build a minimal vCard 3.0 for auto-collected invitees. We deliberately
    keep this small — Purelymail's webmail handles the round-trip — and use
    CRLF line endings per RFC 6350 §3.1.
    """
    lines = [
        "BEGIN:VCARD",
        "VERSION:3.0",
        f"UID:{_vcard_escape(uid)}",
        f"FN:{_vcard_escape(full_name or email)}",
        # N: structured name. Required by 3.0 but a single token is fine.
        f"N:{_vcard_escape(full_name or email)};;;;",
        f"EMAIL;TYPE=INTERNET:{_vcard_escape(email)}",
        "END:VCARD",
    ]
    return "\r\n".join(lines) + "\r\n"


def _vcard_escape(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
             .replace(";", "\\;")
             .replace(",", "\\,")
             .replace("\n", "\\n")
             .replace("\r", "")
    )


def synth_etag(raw_vcard: str) -> str:
    """Hash-derived synthetic etag for servers that don't return one."""
    return hashlib.sha1(raw_vcard.encode("utf-8", errors="replace")).hexdigest()
