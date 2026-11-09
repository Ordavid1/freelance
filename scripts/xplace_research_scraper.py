#!/usr/bin/env python3
"""Collect public XPlace project listings into a private, local SQLite database.

Only public listing/detail pages are read. The script never logs in, clicks apply,
submits forms, or writes anything to XPlace. Four explicitly synthetic response
examples are stored per project for offline analysis; they are not real bids.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sqlite3
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE = "https://www.xplace.com"
LISTING_URL = f"{BASE}/jobs?sort=amount_pj"
MAX_PROJECTS = 15
DEFAULT_DB = Path(__file__).resolve().parents[1] / "data" / "xplace_research.sqlite3"
USER_AGENT = "FreelancePlaceLocalResearch/1.0 (public project listing research)"


class VisibleText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self.hidden_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self.hidden_depth:
            self.hidden_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.hidden_depth:
            return
        text = " ".join(data.split())
        if text:
            self.parts.append(text)


def get_page(url: str) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "he,en;q=0.8"})
    try:
        with urlopen(request, timeout=25) as response:
            if response.status != 200:
                raise RuntimeError(f"XPlace returned HTTP {response.status} for {url}")
            return response.read().decode("utf-8", errors="replace")
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RuntimeError(f"Could not fetch public XPlace page {url}: {exc}") from exc


def project_ids(listing_html: str, limit: int) -> list[int]:
    found: list[int] = []
    for raw_id in re.findall(r"/project\?id=(\d+)", listing_html):
        project_id = int(raw_id)
        if project_id not in found:
            found.append(project_id)
        if len(found) >= min(limit, MAX_PROJECTS):
            break
    return found


def extract_project(detail_html: str, project_id: int) -> dict:
    # XPlace server-renders a structured public project object in its Next.js
    # flight payload. Decode that object instead of collecting hidden account data.
    chunks: list[str] = []
    for match in re.finditer(r"self\.__next_f\.push\(\[1,(\"(?:\\.|[^\"\\])*\")\]\)", detail_html):
        try:
            chunks.append(json.loads(match.group(1)))
        except json.JSONDecodeError:
            continue

    decoder = json.JSONDecoder()
    obj = None
    # Flight payloads can split a serialized project object between adjacent
    # chunks, so search the reconstructed stream rather than each chunk alone.
    for chunk in ["".join(chunks)]:
        marker = '"project":'
        cursor = 0
        while True:
            key_at = chunk.find(marker, cursor)
            if key_at < 0:
                break
            start = key_at + len(marker)
            while start < len(chunk) and chunk[start].isspace():
                start += 1
            if start < len(chunk) and chunk[start] == "{":
                try:
                    candidate, _ = decoder.raw_decode(chunk[start:])
                    if isinstance(candidate, dict) and int(candidate.get("projectId", -1)) == project_id:
                        obj = candidate
                        break
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass
            cursor = key_at + len(marker)
        if obj:
            break

    if not obj:
        raise RuntimeError(f"Could not parse the public details for project {project_id}")

    user = obj.get("userDto") or {}
    company = obj.get("companyDto") or {}
    categories = obj.get("projectCategories") or []
    visible = VisibleText()
    visible.feed(detail_html)
    return {
        "project_id": project_id,
        "url": f"{BASE}/project?id={project_id}",
        "title": html.unescape(obj.get("title") or ""),
        "description": html.unescape(obj.get("description") or ""),
        "payment_model": obj.get("paymentModel"),
        "amount": obj.get("amount"),
        "currency": "ILS",
        "created_at": obj.get("dateCreated"),
        "expires_at": obj.get("expirationDate"),
        "due_date": obj.get("projectDueDate"),
        "status": obj.get("status"),
        "proposal_count": obj.get("bidsCount"),
        "categories": [{"id": c.get("id"), "name_en": c.get("nameEn"), "name_he": c.get("nameHe")} for c in categories],
        "visible_text": "\n".join(visible.parts[:120]),
        "scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


SYNTHETIC_EXAMPLES = [
    ("Synthetic example 1", "Relevant experience", "Lead with one directly relevant example and a short delivery plan."),
    ("Synthetic example 2", "Clarifying approach", "Ask one useful scope question and describe the proposed process."),
    ("Synthetic example 3", "Focused specialist", "Emphasize a focused specialization and explain how success will be measured."),
    ("Synthetic example 4", "Milestone proposal", "Suggest clear milestones, a realistic timeline, and the assumptions behind the quote."),
]


def initialize(db: sqlite3.Connection) -> None:
    db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS projects (
            project_id INTEGER PRIMARY KEY,
            url TEXT NOT NULL,
            title TEXT,
            description TEXT,
            payment_model INTEGER,
            amount REAL,
            currency TEXT,
            created_at TEXT,
            expires_at TEXT,
            due_date TEXT,
            status INTEGER,
            proposal_count INTEGER,
            categories_json TEXT NOT NULL,
            visible_text TEXT,
            scraped_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS synthetic_application_examples (
            example_id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            pattern TEXT NOT NULL,
            example_text TEXT NOT NULL,
            is_synthetic INTEGER NOT NULL DEFAULT 1 CHECK(is_synthetic = 1),
            UNIQUE(project_id, label)
        );
        CREATE INDEX IF NOT EXISTS idx_projects_scraped_at ON projects(scraped_at);
    """)


def save_project(db: sqlite3.Connection, project: dict) -> None:
    fields = ("project_id", "url", "title", "description", "payment_model", "amount", "currency",
              "created_at", "expires_at", "due_date", "status", "proposal_count")
    values = [project.get(key) for key in fields]
    values.extend([json.dumps(project["categories"], ensure_ascii=False), project["visible_text"], project["scraped_at"]])
    db.execute("""INSERT INTO projects
        (project_id,url,title,description,payment_model,amount,currency,created_at,expires_at,due_date,status,proposal_count,categories_json,visible_text,scraped_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id) DO UPDATE SET
          url=excluded.url,title=excluded.title,description=excluded.description,
          payment_model=excluded.payment_model,amount=excluded.amount,currency=excluded.currency,
          created_at=excluded.created_at,expires_at=excluded.expires_at,due_date=excluded.due_date,
          status=excluded.status,proposal_count=excluded.proposal_count,
          categories_json=excluded.categories_json,visible_text=excluded.visible_text,scraped_at=excluded.scraped_at""", values)
    for label, pattern, example in SYNTHETIC_EXAMPLES:
        db.execute("""INSERT INTO synthetic_application_examples
            (project_id,label,pattern,example_text,is_synthetic) VALUES (?,?,?,?,1)
            ON CONFLICT(project_id,label) DO UPDATE SET pattern=excluded.pattern,example_text=excluded.example_text,is_synthetic=1""",
                   (project["project_id"], label, pattern, example))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=MAX_PROJECTS, help="Projects to collect (maximum 15).")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="Local SQLite database path.")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between detail-page requests.")
    args = parser.parse_args()
    if not 1 <= args.limit <= MAX_PROJECTS:
        parser.error(f"--limit must be between 1 and {MAX_PROJECTS}")
    if args.delay < 0:
        parser.error("--delay must be non-negative")

    args.db.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.db) as db:
        db.execute("PRAGMA foreign_keys=ON")
        initialize(db)
        ids = project_ids(get_page(LISTING_URL), args.limit)
        if not ids:
            raise RuntimeError("No public project cards were found on the listing page")
        print(f"Found {len(ids)} project cards; collection is capped at {MAX_PROJECTS}.")
        for index, project_id in enumerate(ids):
            project = extract_project(get_page(f"{BASE}/project?id={project_id}"), project_id)
            save_project(db, project)
            db.commit()
            print(f"[{index + 1}/{len(ids)}] Saved {project_id}: {project.get('title', '(untitled)')}")
            if index + 1 < len(ids) and args.delay:
                time.sleep(args.delay)
    print(f"Saved local research data to {args.db}")
    print("Each project has four response-pattern examples marked synthetic; none are real applications.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
