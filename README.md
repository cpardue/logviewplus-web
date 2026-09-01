# LogViewPlus Web

Client-side web application that emulates the core log-analysis features of
LogViewPlus (Clearcove Ltd) and is deployed statically to GitHub Pages.

This is a **clean-room reimplementation** built from the public documentation at
logviewplus.com/docs. It is not affiliated with, endorsed by, or derived from
the source code of LogViewPlus, which is closed-source commercial software.
Intended for personal/internal use (GitHub Pages ToS prohibits commercial SaaS).

## Status

Planning complete (2026-09-01). Implementation starts at Milestone 1.

- `PLAN.md` — repo scaffold, tech stack, deployment design, constraints, roadmap
- `MILESTONE-1.md` — first milestone: parse pipeline MVP (tasks + acceptance criteria)

## Research findings (summary)

Full parity with LogViewPlus is **not possible** on static GitHub Pages. The
following features require a backend / OS access and are out of scope by
architecture: SFTP/FTP/FTPS/SCP, remote databases (SQL Server/Oracle/MySQL/
PostgreSQL/OLEDB), Windows Event Logs, ETW, UDP/TCP syslog port listener, SMTP
notifications, OS command-line execution.

Everything else (parsers, filters, search, merge, zip/clipboard ingest, tail via
File System Access API, SQL-style reporting, dashboards, workspaces, export) is
implemented fully client-side. Log files never leave the user's browser.

## Commands (post-scaffold)

```
npm install
npm run dev        # local dev server
npm test           # vitest unit tests
npm run test:e2e   # playwright smoke tests
npm run build      # production build to dist/
```

Deployment: push to `main` → GitHub Actions builds and deploys to GitHub Pages.
