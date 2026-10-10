# Pardot Toolkit (Chrome extension, Manifest V3)

## Install
1. Unzip the folder.
2. Open chrome://extensions, turn on Developer mode, click "Load unpacked", pick the folder.
3. Log in to Pardot in Chrome, open the extension, go to Settings and check the base URL and form handler URL template.

## Tabs
- Fields: load a form handler by ID. Add / Edit sub-tab (new field, edit field, queue several changes) and Remove sub-tab (tick fields, remove).
- Batch: paste or drop a CSV. Columns: form_handler_id, action (add/edit/remove), external_field, prospect_field, data_format, required, new_external_field.
  Rows are grouped by form handler ID, so each handler is visited once. Handlers run in parallel (Settings). Download the result CSV afterwards.
- Search: searches Pardot list pages for prospects, visitors, campaigns, form handlers and forms and lists the links found.
- Settings: base URL, URL template, parallel handlers, delay, default for Required, notifications, search URLs.

## Required checkbox rule
The box is set to an exact state, never toggled blindly. Blank value = Settings default (Not required). Editing a field with no value leaves Required as it is.

## Things to verify on a real org
The field-list reading, "+Add New Field" button, dialog labels and delete icons are matched by text and attributes (based on the screenshots you shared).
If a step fails, the Error message in the log / result CSV says which one. Search URLs in Settings are best guesses and may need adjusting.
