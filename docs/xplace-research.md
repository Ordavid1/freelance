# Local XPlace project research

This private collector saves public project listings to a local SQLite database. It does not log in, click Apply, submit proposals, or write data back to XPlace. It collects at most 15 project cards per run, with a one-second pause between project detail pages.

Run it from the repository root:

```sh
python scripts/xplace_research_scraper.py
```

The default database is `data/xplace_research.sqlite3` (ignored by Git). Repeat the command to refresh those project records. Project IDs are unique, so existing records are updated. To choose a smaller batch or another database path:

```sh
python scripts/xplace_research_scraper.py --limit 8
python scripts/xplace_research_scraper.py --db /path/to/research.sqlite3
```

The `projects` table stores public project fields such as the title, description, amount, payment model, dates, category, and public proposal count. It omits client contact details and personal account fields. The `synthetic_application_examples` table stores four response-pattern examples per project. These examples are explicitly labeled synthetic and are not actual applicants, applications, or XPlace activity.

Inspect the database with any SQLite viewer, or use Python's built-in `sqlite3` module. The collector only uses Python's standard library.
