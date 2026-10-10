# Testing the extension before production

The extension cannot test against a public URL (it only runs on your logged-in Pardot pages), so this folder has a fake Pardot that runs on your own computer.

## 1. Start the mock Pardot
Needs Python 3 (no installs):

    cd mock-pardot
    python3 server.py          # runs on http://localhost:8080  (or: python3 server.py 9000)

Open http://localhost:8080/formHandler/edit/id/48213 — you should see 3 fields and a "+Add New Field" button.
Any numeric ID works (each gets its own fields). ID 404 is a "not found" page, to test the error message.
Changes are kept in memory; restart the server to reset.

## 2. Load the test build of the extension
chrome://extensions -> Developer mode -> Load unpacked -> choose the `pardot-toolkit` folder.
(This build also allows http://localhost. Before production, remove the two http://localhost / http://127.0.0.1 lines and the " (TEST build)" name in manifest.json.)

In the extension -> Settings:
- Pardot base URL: http://localhost:8080
- Form handler URL template: /formHandler/edit/id/{ID}
- Search templates stay as they are (the mock uses the same paths)
Click Save settings.

## 3. Test checklist
Fields tab (handler ID 48213)
- Load fields -> 3 fields listed.
- New field: name job_title, prospect field "Job Title", Not required -> Save changes. Check the mock page: "job_title" appears WITHOUT (r).
- New field with Required chosen -> shows (r).
- Edit: click Edit on email, change prospect field to "First Name", leave Required as is -> email keeps (r).
- Remove sub-tab: tick two fields -> "Remove 2 fields" -> they disappear (confirm popup is auto-accepted).
- Unknown prospect field name -> clear error, nothing saved.
- Duplicate field name -> error "has already been taken".

Batch tab
- Choose test-batch.csv (in this folder) -> "9 rows · 3 form handlers".
- Start batch. Expected: 48213 Saved, 48219 Saved, 48230 Partial (row bad_one fails: prospect field not found).
- Download result CSV -> the required column shows the real saved state; blank required rows show "no".

Harder cases (add to the handler page URL via Settings template, e.g. /formHandler/edit/id/{ID}?reload=1)
- ?reload=1 -> page fully reloads after every save (tests the recovery path).
- ?slow=1 -> saves take 1.5 s (tests waiting).

Search tab
- Search "acme" -> prospects, campaigns, forms, form handlers containing "acme" appear; clicking opens the mock detail page.

## 4. Going to production
Remove the localhost entries from manifest.json, set Settings to your real org URL (for example https://pi.pardot.com), and try ONE form handler in a sandbox/test org first.
