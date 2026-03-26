# SB Invoices — Professional Invoicing for Freelancers & Small Business

A professional web-based invoicing and document management system for freelancers and small businesses.

## Features

- **4 Document Types**: Invoices, Receipts, Quotations, Damage Reports
- **Auto-numbering**: INV-00001, REC-00001, QUO-00001, REP-00001
- **PDF Export**: Professional branded PDFs with company logo
- **Dashboard**: Stats, revenue charts, recent documents
- **Accounting**: Monthly revenue breakdown by document type
- **Settings**: Business info, banking details, terms & conditions, logo upload
- **Multi-tenant**: Each business has isolated data
- **Authentication**: JWT-based secure login

## Tech Stack

- **Backend**: Flask (Python)
- **Database**: SQLite (swap to PostgreSQL for production)
- **PDF**: ReportLab
- **Frontend**: Vanilla JS + Chart.js (no build step needed)

## Setup & Run

```bash
# Install dependencies
pip install flask PyJWT reportlab Pillow

# Run the app
python app.py
```

Then open http://localhost:5000

## File Structure

```
repairbiz/
├── app.py              # Flask backend + all API routes
├── pdf_generator.py    # ReportLab PDF generation
├── requirements.txt    # Python dependencies
├── repairbiz.db        # SQLite database (auto-created)
├── templates/
│   └── index.html      # Single-page frontend
└── static/
    ├── js/
    │   └── app.js      # Frontend JavaScript
    └── uploads/        # Logos and report photos
```

## API Endpoints

### Auth
- `POST /api/auth/register` — Register business
- `POST /api/auth/login` — Login
- `POST /api/auth/change-password` — Change password

### Business
- `GET /api/business` — Get business profile
- `PUT /api/business` — Update profile/banking/terms
- `POST /api/business/logo` — Upload logo

### Documents
- `GET /api/documents` — List (with filters: type, month, year, search)
- `POST /api/documents` — Create document
- `GET /api/documents/:id` — Get document + items
- `PUT /api/documents/:id` — Update document
- `DELETE /api/documents/:id` — Delete document
- `PATCH /api/documents/:id/status` — Update status
- `GET /api/documents/:id/pdf` — Download PDF

### Dashboard & Accounting
- `GET /api/dashboard` — Stats + charts + recent docs
- `GET /api/accounting?year=2026` — Monthly accounting summary

## Production Notes

1. Change `SECRET_KEY` in app.py to a secure random value
2. Swap SQLite for PostgreSQL (change the connection in `get_db()`)
3. Use gunicorn: `gunicorn -w 4 app:app`
4. Store uploads in S3/cloud storage instead of local filesystem
5. Add HTTPS via nginx reverse proxy
