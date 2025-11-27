# HTTP API

This project exposes a small JSON API for storing and retrieving Mermaid diagrams ("diagrams" ≈ "charts").

By default the FastAPI app listens on `http://127.0.0.1:8000` (or `http://localhost:8000`) when run via `uvicorn main:app --reload` or through the Docker setup.

All endpoints live under the `/api/diagrams` prefix and return JSON.

---

## Data models

### Request body for create / update

`DiagramCreate` and `DiagramUpdate` share the same shape:

```json
{
  "title": "Example diagram",
  "content": "flowchart LR; A --> B",
  "tags": "optional,comma,separated,tags"
}
```

- `title` — short human-readable name for the diagram.
- `content` — raw Mermaid source text.
- `tags` — optional comma-separated tags used by search.

### Response body

Most endpoints return a `DiagramResponse` object or a list of them:

```json
{
  "id": 1,
  "title": "Example diagram",
  "content": "flowchart LR; A --> B",
  "created_at": "2024-01-01T12:34:56.000000",
  "updated_at": "2024-01-01T12:34:56.000000",
  "tags": "example,flowchart"
}
```

Error responses follow FastAPI's default structure, e.g.:

```json
{
  "detail": "Diagram not found"
}
```

---

## Endpoints

### Create a diagram

- **Method**: `POST`
- **Path**: `/api/diagrams`
- **Body**: `DiagramCreate`
- **Success (200)**: returns the created `DiagramResponse`.
- **Failure (500)**: returns `{ "detail": "..." }`.

**Example (curl)**

```bash
curl -X POST "http://localhost:8000/api/diagrams" \
  -H "Content-Type: application/json" \
  -d '{
        "title": "My first chart",
        "content": "flowchart LR; A --> B",
        "tags": "example,flowchart"
      }'
```

**Example response**

```json
{
  "id": 1,
  "title": "My first chart",
  "content": "flowchart LR; A --> B",
  "created_at": "2024-01-01T12:34:56.000000",
  "updated_at": "2024-01-01T12:34:56.000000",
  "tags": "example,flowchart"
}
```

---

### List diagrams (retrieve all existing charts)

This is the main way to retrieve the list of existing diagrams.

- **Method**: `GET`
- **Path**: `/api/diagrams`
- **Query params**: _none_
- **Success (200)**: returns `DiagramResponse[]`.

The results are ordered by `updated_at` descending (most recently updated first).

**Example (curl)**

```bash
curl "http://localhost:8000/api/diagrams"
```

**Example (browser / fetch)**

```js
const diagrams = await fetch("/api/diagrams").then(r => r.json());
```

**Example response**

```json
[
  {
    "id": 1,
    "title": "My first chart",
    "content": "flowchart LR; A --> B",
    "created_at": "2024-01-01T12:34:56.000000",
    "updated_at": "2024-01-01T12:34:56.000000",
    "tags": "example,flowchart"
  },
  {
    "id": 2,
    "title": "Alarm state chart",
    "content": "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Alarm : ANY SD ALARM?",
    "created_at": "2024-01-02T09:00:00.000000",
    "updated_at": "2024-01-02T09:15:00.000000",
    "tags": "alarm,state"
  }
]
```

---

### Search diagrams

Searches by title and tags using a case-insensitive `LIKE` query.

- **Method**: `GET`
- **Path**: `/api/diagrams/search/{query}`
- **Path params**:
  - `query` — substring to match in `title` or `tags`.
- **Success (200)**: returns `DiagramResponse[]`.

**Example**

```bash
curl "http://localhost:8000/api/diagrams/search/alarm"
```

**Example response**

```json
[
  {
    "id": 2,
    "title": "Alarm state chart",
    "content": "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Alarm : ANY SD ALARM?",
    "created_at": "2024-01-02T09:00:00.000000",
    "updated_at": "2024-01-02T09:15:00.000000",
    "tags": "alarm,state"
  }
]
```

---

### Get the most recent diagram

Convenience endpoint to quickly fetch the latest edited diagram.

- **Method**: `GET`
- **Path**: `/api/diagrams/recent`
- **Success (200)**: returns a single `DiagramResponse`.
- **Not found (404)**: `{ "detail": "No diagrams found" }` when the database is empty.

**Example**

```bash
curl "http://localhost:8000/api/diagrams/recent"
```

**Example response**

```json
{
  "id": 2,
  "title": "Alarm state chart",
  "content": "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Alarm : ANY SD ALARM?",
  "created_at": "2024-01-02T09:00:00.000000",
  "updated_at": "2024-01-02T09:15:00.000000",
  "tags": "alarm,state"
}
```

---

### Fetch a single diagram by ID (fetch a chart)

Use this to load a specific saved diagram.

- **Method**: `GET`
- **Path**: `/api/diagrams/{diagram_id}`
- **Path params**:
  - `diagram_id` — integer primary key.
- **Success (200)**: returns a single `DiagramResponse`.
- **Not found (404)**: `{ "detail": "Diagram not found" }`.

**Example (curl)**

```bash
curl "http://localhost:8000/api/diagrams/1"
```

**Example (browser / fetch)**

```js
async function loadDiagram(id) {
  const res = await fetch(`/api/diagrams/${id}`);
  if (!res.ok) throw new Error("Diagram not found");
  return res.json();
}
```

**Example response**

```json
{
  "id": 1,
  "title": "My first chart",
  "content": "flowchart LR; A --> B",
  "created_at": "2024-01-01T12:34:56.000000",
  "updated_at": "2024-01-01T12:34:56.000000",
  "tags": "example,flowchart"
}
```

---

### Update an existing diagram

- **Method**: `PUT`
- **Path**: `/api/diagrams/{diagram_id}`
- **Path params**:
  - `diagram_id` — integer primary key.
- **Body**: `DiagramUpdate`.
- **Success (200)**: returns the updated `DiagramResponse`.
- **Not found (404)**: `{ "detail": "Diagram not found" }`.

**Example**

```bash
curl -X PUT "http://localhost:8000/api/diagrams/1" \
  -H "Content-Type: application/json" \
  -d '{
        "title": "Updated title",
        "content": "flowchart LR; A --> C",
        "tags": "updated,example"
      }'
```

**Example response**

```json
{
  "id": 1,
  "title": "Updated title",
  "content": "flowchart LR; A --> C",
  "created_at": "2024-01-01T12:34:56.000000",
  "updated_at": "2024-01-01T13:00:00.000000",
  "tags": "updated,example"
}
```

---

### Delete a diagram

- **Method**: `DELETE`
- **Path**: `/api/diagrams/{diagram_id}`
- **Path params**:
  - `diagram_id` — integer primary key.
- **Success (200)**: `{ "success": true }`.
- **Not found (404)**: `{ "detail": "Diagram not found" }`.

**Example**

```bash
curl -X DELETE "http://localhost:8000/api/diagrams/1"
```

**Example response**

```json
{
  "success": true
}
```

---

## Notes

- All timestamps are stored and returned as ISO 8601 strings.
- There is currently no pagination; `GET /api/diagrams` returns every diagram ordered by `updated_at`.
- CORS is configured to allow all origins, methods, and headers, which makes it easy to call the API from other tools or local pages while developing.
