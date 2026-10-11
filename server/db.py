# ============================================================
# SQLite の薄いラッパー
# プロジェクト（旅）・みんなの要望・旅程案・投票・履歴を1ファイルに保存する。
# 依存を増やさないため ORM は使わず、標準の sqlite3 だけで書く。
# ============================================================
import json
import os
import secrets
import sqlite3
import uuid
from datetime import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
DB_PATH = os.environ.get("PLANNER_DB_PATH") or os.path.join(DATA_DIR, "planner.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_auto INTEGER NOT NULL DEFAULT 1,   -- 1=行き先・日程から自動命名（ユーザーが変えたら0）
  region TEXT,
  start_date TEXT,
  num_days INTEGER,
  status TEXT NOT NULL DEFAULT 'collecting',  -- collecting|voting|decided|done
  plan_json TEXT,                          -- フロントの state をそのまま保存
  share_token TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wishes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  nickname TEXT,
  vibes TEXT,          -- JSON配列（雰囲気チップ）
  transport TEXT,
  places TEXT,
  foods TEXT,
  budget TEXT,
  must TEXT,
  avoid TEXT,
  free_text TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  round INTEGER NOT NULL DEFAULT 1,
  idx INTEGER NOT NULL DEFAULT 0,
  title TEXT,
  concept TEXT,
  matched TEXT,        -- JSON配列（反映した要望の要約）
  days_json TEXT,      -- JSON配列 [{title, spots:[{name, category, stayMin, note, lat, lng, fromCandidates}]}]
  source TEXT,         -- 'claude' | 'rules'
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS votes (
  project_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  voter_id TEXT NOT NULL,
  nickname TEXT,
  comment TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, voter_id)
);
CREATE TABLE IF NOT EXISTS history_places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,       -- sightseeing | food | hotel
  region TEXT,
  lat REAL,
  lng REAL,
  place_id TEXT,
  address TEXT,
  rating REAL,
  rating_count INTEGER,
  photo_url TEXT,
  website TEXT,
  phone TEXT,
  memo TEXT,
  stay_min INTEGER,
  cost INTEGER,
  visit_count INTEGER NOT NULL DEFAULT 1,
  first_visited TEXT,
  last_visited TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history_trips (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT,
  region TEXT,
  start_date TEXT,
  num_days INTEGER,
  places_json TEXT,
  total_cost INTEGER,
  archived_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wishes_project ON wishes(project_id);
CREATE INDEX IF NOT EXISTS idx_proposals_project ON proposals(project_id);
CREATE INDEX IF NOT EXISTS idx_history_region ON history_places(region);
"""


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def new_id(prefix: str = "") -> str:
    return prefix + uuid.uuid4().hex[:12]


def new_token() -> str:
    # URLに載せる匿名トークン（推測されにくい長さ）
    return secrets.token_urlsafe(9)


def connect() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_db() -> None:
    with connect() as con:
        con.executescript(SCHEMA)
        # 旧DBへの列追加（foods は v3b で追加）
        cols = {r[1] for r in con.execute("PRAGMA table_info(wishes)")}
        if "foods" not in cols:
            con.execute("ALTER TABLE wishes ADD COLUMN foods TEXT")


def row_to_dict(row) -> dict:
    return dict(row) if row is not None else None


def loads(s, default):
    try:
        return json.loads(s) if s else default
    except (TypeError, ValueError):
        return default


# ---------- プロジェクト ----------
def project_public(row) -> dict:
    """APIで返す形に整える（plan は plan_json をパースして載せる）"""
    if row is None:
        return None
    d = dict(row)
    d["plan"] = loads(d.pop("plan_json", None), None)
    d["nameAuto"] = bool(d.pop("name_auto", 1))
    d["startDate"] = d.pop("start_date", None)
    d["numDays"] = d.pop("num_days", None)
    d["shareToken"] = d.pop("share_token", None)
    d["createdAt"] = d.pop("created_at", None)
    d["updatedAt"] = d.pop("updated_at", None)
    return d


def auto_name(region: str, start_date: str, num_days: int) -> str:
    """「京都の旅（10/3〜 2日間）」のような自動名"""
    label = region or "新しい旅"
    when = ""
    if start_date and len(start_date) >= 10:
        try:
            m, d = int(start_date[5:7]), int(start_date[8:10])
            when = f"{m}/{d}〜"
        except ValueError:
            when = ""
    days = f" {num_days}日間" if num_days else ""
    inner = (when + days).strip()
    return f"{label}の旅" + (f"（{inner}）" if inner else "")


def plan_summary(plan: dict) -> tuple:
    """state から region / startDate / numDays を取り出す"""
    if not isinstance(plan, dict):
        return (None, None, None)
    region = plan.get("region")
    start = plan.get("startDate")
    days = plan.get("days")
    n = len(days) if isinstance(days, list) else plan.get("numDays")
    return (region, start, n)
