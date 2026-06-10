# CLAUDE.md

This file provides comprehensive guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. Development & Build Commands

*   **Start Backend Local**: `npm start` or `npm run dev` (Runs Node.js Express server from root using nodemon).
*   **Install Dependencies**: Run `npm install` in the root directory.
*   **Vercel Deployment**: Push to GitHub. Vercel automatically deploys both frontend (`index.html`) and backend (`/api/index.js`) as a Monorepo on the same domain (`hast-crm.vercel.app`).
*   **Environment**: A `.env` file in the root directory with `PORT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (MUST be set to the `service_role` key in Vercel to bypass RLS), and `JWT_SECRET`.

## 2. Architecture & Code Structure

The project was successfully migrated from Google Apps Script (GAS) to a Monorepo Node.js + Supabase architecture.

*   **Frontend**: Single `index.html` file in the root (~10,200 lines). Calls relative path `/api` using POST.
*   **Backend**: Node.js Express hosted on Vercel under `/api` (`vercel.json` maps `/api(.*)` to `api/index.js`).
*   **Structure**:
    *   `/api/index.js`: Vercel entry point.
    *   `/src/config/index.js`: Supabase client & constants.
    *   `/src/controllers/mainController.js`: Central router for RPC actions (`auth.*`, `customer.*`, `workflow.*`, `notification.*`, `quote.export`, etc.).
    *   `/src/controllers/`: Modular logic (`authController.js`, `crudController.js`, `customerController.js`, `workflowController.js`, `notificationController.js`, `exportController.js`).
    *   `/src/middlewares/auth.js`: JWT authentication & session tracking.
    *   `/src/utils/`: `crypto.js` (hashing/JWT), `helpers.js` (case-conversion).
    *   `/src/templates/`: `.docx` template files for local Word exporting.

## 3. Database Schema (Supabase)

*   All tables reside in the `public` schema and are prefixed with `crm_` (e.g., `crm_customers`, `crm_users`).
*   **Primary Keys & Foreign Keys**: Standard `UUID` generated via `crypto.randomUUID()`.
*   **Soft Deletes**: `is_deleted` is a `BOOLEAN` (`true`/`false`), not a string.
*   **Column Naming**: Strict `snake_case` in DB, mapped dynamically to `camelCase` for the frontend.

## 4. Critical Conventions & Design Patterns

*   **Case Conversion**: The backend implicitly handles conversions using `snakeToCamel` and `camelToSnake` in `src/utils/helpers.js`. 
*   **Field Mapping Safety**: DO NOT manually map properties like `snakePayload.name = snakePayload.full_name` in `crudCreate`/`crudUpdate`. The database columns have been renamed to exactly match the frontend fields via `FIX_SCHEMAS.sql`.
    *   `crm_contacts`: `full_name`
    *   `crm_activities`: `title`
    *   `crm_opportunities`: `name`
    *   `crm_support_tickets`: `subject`
*   **Pre-save Duplicate Check**: `customer.findDuplicates` allows payload-based checking against ALL customers before saving.
*   **Items Handling in Quotes/Orders**: `crudCreate` and `crudUpdate` dynamically extract `items` array from the payload and insert them transactionally into `crm_order_items`.
*   **Auto-generated Fields**: `crudCreate` automatically generates human-readable `code` (e.g., `KH2026-0001`) and `title` (for quotes/orders).

## 5. Security & Permissions (Crucial)

*   **Bypassing RLS**: The backend connects to Supabase using the `service_role` key (stored in `SUPABASE_ANON_KEY` on Vercel) to completely bypass Row-Level Security (RLS), as the Node.js backend implements its own robust JWT-based authentication.
*   **Role-Based Access Control (RBAC)**: Implemented manually in `src/controllers/crudController.js`:
    *   **Staff**: Can only see records `created_by` them, `assigned_to` them, or `visibility = public`. (For customers, they can also see `visibility = department` if created by a colleague in the same department).
    *   **Manager**: Can see all records where `created_by` or `assigned_to` belongs to ANY user in their department.
    *   **Boss/Admin**: Full read access.
*   **Query Builder Evaluation Bug**: When calling `applyPermissionFilter()`, always wrap the return in an object `{ q: query }` to prevent Javascript's `await` from prematurely evaluating the Supabase PostgREST Thenable query builder.

## 6. Local DOCX Export Workflow

*   The feature uses `docxtemplater` + `pizzip`.
*   **Frontend**: `index.html` calls `api('quote.export')` and expects a `downloadUrl` (e.g., `/api/export?type=quote&id=...&token=...`).
*   **Backend**: `exportController.js` intercepts GET `/api/export`, validates the token via query string, fetches DB records, renders the DOCX template in memory, and returns the file buffer directly as an attachment (`Content-Disposition: attachment`).
*   **Templates**: Must be placed in `src/templates/` (`quote_sale_template.docx`, `quote_rental_template.docx`, `order_template.docx`).

## 7. Next Steps & Known Issues

1.  **Design Template Files**: The actual `.docx` template files are currently missing. An Admin needs to design them with placeholders (e.g., `{total}`, `{#items}{product_code}{/items}`) and place them in `src/templates/`.
2.  **Notification UI Enhancements**: Backend APIs (`notification.list`, `markRead`, `markAllRead`) are fully implemented. Frontend may need further polishing for marking single items as read.
3.  **PDF Export Restriction**: Direct PDF export is not supported on Vercel due to the 50MB Serverless limit (LibreOffice cannot be installed). The backend gracefully returns a user-friendly HTML error if PDF format is requested.