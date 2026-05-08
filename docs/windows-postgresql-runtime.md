# Windows PostgreSQL Runtime

This machine uses a local PostgreSQL 16.13 binary install under:

```text
D:\myTool\develop\PostgreSQL
```

Program directory:

```text
D:\myTool\develop\PostgreSQL\pgsql
```

Data directory:

```text
D:\myTool\develop\PostgreSQL\data
```

Log file:

```text
D:\myTool\develop\PostgreSQL\postgresql.log
```

Local development connection:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_novel_platform?schema=public"
QUEUE_DRIVER="postgres"
```

Current project database:

```text
ai_novel_platform
```

The initial Prisma migration has already been applied:

```text
202604290001_initial_core
```

The migrated database currently contains the core schema tables, including `users`, `organizations`, `projects`, `chapters`, `generation_jobs`, and `generation_steps`.

## Start

```powershell
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\pg_ctl.exe' -D 'D:\myTool\develop\PostgreSQL\data' -l 'D:\myTool\develop\PostgreSQL\postgresql.log' start
```

## Stop

```powershell
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\pg_ctl.exe' -D 'D:\myTool\develop\PostgreSQL\data' stop
```

## Status

```powershell
$env:PGPASSWORD='postgres'
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d ai_novel_platform -c 'select version();'
```

List migrated tables:

```powershell
$env:PGPASSWORD='postgres'
& 'D:\myTool\develop\PostgreSQL\pgsql\bin\psql.exe' -h 127.0.0.1 -p 5432 -U postgres -d ai_novel_platform -c "select tablename from pg_tables where schemaname='public' order by tablename;"
```

## Notes

This install is not registered as a Windows service because the current shell is not running as Administrator. After a reboot, start PostgreSQL manually with the command above, or register it later from an elevated PowerShell session.

The downloaded PostgreSQL ZIP is stored at:

```text
D:\myTool\develop\PostgreSQL\downloads\postgresql-16.13-1-windows-x64-binaries.zip
```

The temporary password file created during `initdb` is:

```text
D:\myTool\develop\PostgreSQL\downloads\pgpass.txt
```

It contains the local development password `postgres`. Delete it after explicit confirmation.
