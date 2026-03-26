const SHEET_NAME = 'Feedback';
const NOTIFY_EMAIL = 'replace-me@example.com';
const SHARED_SECRET = 'replace-me-worker-secret';

function doPost(event) {
  try {
    enforceSecret(event);

    const body = JSON.parse(event.postData.contents || '{}');
    const payload = unwrapPayload(body);
    validatePayload(payload);

    appendRow(payload);
    sendNotification(payload);

    return jsonResponse({ ok: true, stored: true, notified: !!NOTIFY_EMAIL });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: String(error && error.message ? error.message : error),
    });
  }
}

function enforceSecret(event) {
  const secret = String(event?.parameter?.secret || '');
  if (!SHARED_SECRET || secret !== SHARED_SECRET) {
    throw new Error('Invalid secret.');
  }
}

function unwrapPayload(body) {
  if (body && typeof body === 'object' && body.payload && typeof body.payload === 'object') {
    return body.payload;
  }

  return body;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload.');
  }

  if (typeof payload.message !== 'string' || payload.message.trim() === '') {
    throw new Error('Message is required.');
  }
}

function appendRow(payload) {
  const sheet = getSheet();
  sheet.appendRow([
    payload.timestamp || new Date().toISOString(),
    payload.site || '',
    payload.page || '',
    payload.message || '',
    JSON.stringify(payload.fields || {}),
    JSON.stringify(payload.meta || {}),
  ]);
}

function sendNotification(payload) {
  if (!NOTIFY_EMAIL) {
    return;
  }

  const subject = `Feedback: ${payload.site || 'unknown site'} ${payload.page || ''}`;
  const body = [
    `timestamp: ${payload.timestamp || ''}`,
    `site: ${payload.site || ''}`,
    `page: ${payload.page || ''}`,
    '',
    payload.message || '',
    '',
    `fields: ${JSON.stringify(payload.fields || {}, null, 2)}`,
    `meta: ${JSON.stringify(payload.meta || {}, null, 2)}`,
  ].join('\n');

  MailApp.sendEmail(NOTIFY_EMAIL, subject, body);
}

function getSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
    sheet.appendRow([
      'timestamp',
      'site',
      'page',
      'message',
      'fields_json',
      'meta_json',
    ]);
  }

  return sheet;
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
