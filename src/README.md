# Mergington High School Activities API

A super simple FastAPI application that allows students to view and sign up for extracurricular activities.

## Features

- View all available extracurricular activities
- Sign up for activities
- View active, database-backed school announcements
- Signed-in teachers can create, edit, schedule, and delete announcements from the header dialog

## Getting Started

1. Install the dependencies:

   ```
   pip install -r requirements.txt
   ```

2. Start MongoDB at `mongodb://localhost:27017/`, then run the application from the repository root:

   ```
   uvicorn src.app:app --reload
   ```

3. Open your browser and go to:
   - API documentation: http://localhost:8000/docs
   - Alternative documentation: http://localhost:8000/redoc

## API Endpoints

| Method | Endpoint                                                          | Description                                                         |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/activities`                                                     | Get all activities with their details and current participant count |
| POST   | `/activities/{activity_name}/signup?email=student@mergington.edu&teacher_username=USERNAME` | Sign up for an activity (legacy teacher username check) |
| GET    | `/activities/days` | Get days with scheduled activities |
| POST   | `/activities/{activity_name}/unregister?email=student@mergington.edu&teacher_username=USERNAME` | Unregister a student (legacy teacher username check) |
| POST   | `/auth/login` | Sign in with a JSON body containing `username` and `password`; sets an HttpOnly session cookie |
| GET    | `/auth/check-session` | Return the signed-in teacher using the session cookie; returns 401 if not signed in |
| POST   | `/auth/logout` | Revoke the current session and clear its cookie |
| GET    | `/announcements` | Public list of currently active announcements |
| GET    | `/announcements/manage` | List all announcements, including scheduled and expired messages (sign-in required) |
| POST   | `/announcements` | Create an announcement (sign-in required) |
| PUT    | `/announcements/{id}` | Replace an announcement's message and dates (sign-in required) |
| DELETE | `/announcements/{id}` | Permanently delete an announcement (sign-in required) |

### Announcements

Create and update requests use JSON:

```json
{
  "message": "The club fair is this Friday. Come explore!",
  "starts_on": null,
  "expires_on": "2026-10-30"
}
```

`message` is trimmed plain text (1–1,000 characters). `expires_on` is required;
`starts_on` may be omitted or `null` to publish immediately. Dates use `YYYY-MM-DD`
and UTC calendar days. Both boundaries are inclusive, and a start date cannot be
after expiration. Expired announcements remain available in management until
deleted. Responses include `id`, `message`, `starts_on`, and `expires_on`.

The public noticeboard refreshes every minute and when the browser tab becomes
visible. The management dialog shows Active, Scheduled, and Expired badges,
publishing previews, and an explicit confirmation before deletion.

Initialization seeds an example announcement, expiring 30 days later, only when
the announcements collection is first created. Restarting does not restore deleted
announcements or change existing schedules.

### Authentication compatibility

Login now accepts JSON rather than query-string credentials, and session checks
require a server-issued cookie rather than a username. Existing users must sign
in again after this update. Sessions expire after 12 hours, are stored as token
hashes in MongoDB, and are revoked on logout. Cookies use HttpOnly and SameSite
Strict, plus Secure when served over HTTPS. Use HTTPS for deployments.
Announcement management always validates the session on the server.
Activity registration retains its existing `teacher_username` query parameter.

## Data Model

The application uses a simple data model with meaningful identifiers:

1. **Activities** - Uses activity name as identifier:

   - Description
   - Schedule
   - Maximum number of participants allowed
   - List of student emails who are signed up

2. **Students** - Uses email as identifier:
   - Name
   - Grade level

3. **Announcements** - Uses a MongoDB object ID:
   - Message
   - Optional start date
   - Required expiration date

All data is persisted in the `mergington_high` MongoDB database. Sample activities
and teachers are initialized when their collections are empty. Sessions have a TTL
index for cleanup; expired sessions are also rejected immediately by the API.
Database failures are logged on the server; API responses contain only generic
service errors, not internal database details.
