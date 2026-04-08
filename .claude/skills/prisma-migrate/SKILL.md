---
name: prisma-migrate
description: Safely run a Prisma schema migration for the bot database. Use when adding fields, changing types, or creating new tables.
disable-model-invocation: true
allowed-tools: Read Edit Bash
---

Run a safe Prisma migration workflow for $ARGUMENTS (describe the change, e.g. "add fundingRate field to Grid").

## Steps

### 1. Read current schema
Read `apps/bot/prisma/schema.prisma` to understand the current model structure.

### 2. Plan the change
Describe what needs to change and check:
- Adding a nullable field? Use `Type?` — safe for existing rows
- Changing a field type? Check if existing data is compatible
- Removing a field? Verify no code references it first (grep the codebase)
- New table? Check foreign key relationships

### 3. Edit the schema
Apply the change to `apps/bot/prisma/schema.prisma`.

### 4. Generate and apply migration
```bash
cd /Users/gustavo/Projects/grvt-grid-bot/apps/bot
npx prisma migrate dev --name "$ARGUMENTS"
```

If on prod / don't want to apply immediately:
```bash
npx prisma migrate dev --name "$ARGUMENTS" --create-only
# Review the generated SQL in prisma/migrations/
npx prisma migrate deploy
```

### 5. Regenerate Prisma client
```bash
npx prisma generate
```

### 6. Verify
```bash
npx prisma studio
# Check the table looks correct
```

### 7. Update TypeScript interfaces if needed
If the change affects fields used in `grid-engine.service.ts`, update the local interface definitions at the top of that file (lines ~10-50).

## Safety rules

- NEVER run `migrate reset` — it drops all data
- NEVER use `--force` without confirming with the user
- Always make new fields nullable (`?`) unless they have a sensible default
- If migration fails: read the SQL in `prisma/migrations/` and diagnose before retrying
