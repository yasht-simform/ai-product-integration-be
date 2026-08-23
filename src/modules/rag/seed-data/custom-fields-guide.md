# Working with Custom Fields

Custom fields let you attach structured, board-specific data to tasks beyond CloudPulse's built-in
fields (title, description, status, assignee, due date, labels). They were introduced for
text, number, dropdown, and date data in v2.5.0, and gained a fifth type — formula fields, which
compute a value from other numeric custom fields — in v3.3.0. This guide covers all five types, the
per-board limit, and how to add a custom field through both the UI and the API.

## The Four Base Types

| Type       | Use case                                                  | Example                           |
| ---------- | --------------------------------------------------------- | --------------------------------- |
| `text`     | Free-form short text                                      | "Client PO Number"                |
| `number`   | Any numeric value                                         | "Story Points", "Estimated Hours" |
| `dropdown` | A fixed set of choices                                    | "Priority Tier" (P0/P1/P2/P3)     |
| `date`     | A calendar date, distinct from the built-in task due date | "Contract Renewal Date"           |

`dropdown` fields require you to define the allowed options up front; a task's value for a dropdown
field must be one of those predefined options — free-text entry isn't permitted for that type.
`number` fields accept any numeric value (positive, negative, or decimal); CloudPulse doesn't
enforce a minimum or maximum on a base `number` field itself.

## Formula Fields (v3.3.0)

Formula fields, added in v3.3.0, compute their value automatically from other numeric custom fields
already defined on the same board — they're read-only from a task-editing perspective, since their
value is always derived rather than entered directly.

Formula fields support four arithmetic operators over other numeric custom fields on the same
board:

- **`+`** (addition)
- **`-`** (subtraction)
- **`*`** (multiplication)
- **`/`** (division)

For example, a board with `number` fields named `Estimated Hours` and `Hourly Rate` could define a
formula field named `Estimated Cost` with the expression:

```
Estimated Hours * Hourly Rate
```

Or a board tracking both `Story Points` and `Completed Points` could define a `Remaining Points`
formula field:

```
Story Points - Completed Points
```

A formula field can only reference other numeric fields that already exist on the same board —
both other `number`-type custom fields and other formula fields — and it recalculates automatically
whenever one of its inputs changes on a given task.

## The 20-Custom-Field Limit

Each board can define **up to 20 custom fields total**, counting all types together (text, number,
dropdown, date, and formula all draw from the same pool — there's no separate allowance per type).
This limit applies per board, not per workspace, so different boards in the same workspace each get
their own independent allowance of 20.

If a board is already at the limit, the CloudPulse UI blocks creating a 21st field and the API
returns an error rather than silently failing — remove or consolidate an existing field first
(deleting a custom field also removes its stored values from every task on that board, so export
the board first via `cloudpulse export --format json` if you might need the historical values
later).

## Adding a Custom Field via the UI

1. Open the board and click **Board Settings → Custom Fields**.
2. Click **Add Field**.
3. Choose a type: `text`, `number`, `dropdown`, `date`, or `formula`.
4. For a `dropdown` field, enter the list of allowed options.
5. For a `formula` field, select the two (or more) existing numeric fields to combine and choose an
   operator between them.
6. Save. The new field immediately appears on every task on that board, initially empty (or, for a
   formula field, computed from whatever values already exist in its input fields).

## Adding a Custom Field via the API

Custom fields can also be created programmatically against the CloudPulse API
(`https://api.cloudpulse.io/v1`):

```bash
curl -X POST https://api.cloudpulse.io/v1/boards/{boardId}/custom-fields \
  -H "Authorization: Bearer $CLOUDPULSE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Estimated Cost",
    "type": "formula",
    "formula": {
      "expression": "Estimated Hours * Hourly Rate"
    }
  }'
```

For a `dropdown` field, the request body instead includes an `options` array:

```bash
curl -X POST https://api.cloudpulse.io/v1/boards/{boardId}/custom-fields \
  -H "Authorization: Bearer $CLOUDPULSE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Priority Tier",
    "type": "dropdown",
    "options": ["P0", "P1", "P2", "P3"]
  }'
```

A task's custom field values are included in the `customFields` object on the task resource
returned by `GET /v1/tasks/{taskId}`, keyed by the field's name, alongside the task's other
built-in fields (`id`, `title`, `description`, `status`, `assignee`, `dueDate`, `labels`).

## Practical Notes

- Formula fields are convenient for lightweight roll-ups (cost estimates, remaining work, simple
  ratios) directly on a board, but they are not a substitute for a full reporting tool — there's no
  support for conditional logic, only the four arithmetic operators over existing numeric fields.
- Since the 20-field limit is shared across all types, it's worth periodically auditing a
  long-lived board's custom fields for ones that are no longer used before adding new ones.
- Custom field definitions are per-board, so the same field name (e.g. "Priority Tier") on two
  different boards are entirely independent definitions, even if configured identically.
